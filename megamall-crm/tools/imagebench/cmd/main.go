// Command imagebench is a dev-only tool (not part of the shipped app) that
// validates whether libvips/bimg is safe to use on this host before any
// product code depends on it. It generates synthetic fixtures, never
// touches the network or real user data, and measures each fixture's
// processing time, peak RSS (via a fresh subprocess per job, so
// measurements never accumulate across iterations), and output size, at
// concurrency 1 and 2.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/megamall/crm/tools/imagebench"
)

func main() {
	if len(os.Args) >= 2 && os.Args[1] == "worker" {
		runWorkerMode()
		return
	}
	if len(os.Args) >= 2 && os.Args[1] == "inprocess" {
		runInProcess()
		return
	}
	runOrchestrator()
}

// runWorkerMode: `imagebench worker <fixture-file>` — processes exactly one
// fixture and prints a WorkerResult as JSON on stdout. Invoked as a fresh
// subprocess per fixture by the orchestrator, purely so peak-RSS
// measurement (via the parent's wait4/Rusage) reflects one job in
// isolation, not cumulative process growth across many iterations.
func runWorkerMode() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: imagebench worker <file>")
		os.Exit(2)
	}
	buf, err := os.ReadFile(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read:", err)
		os.Exit(2)
	}
	res := imagebench.RunOne(filepath.Base(os.Args[2]), buf)
	enc, _ := imagebench.EncodeResult(res)
	fmt.Println(string(enc))
}

type runStats struct {
	Fixture    string                  `json:"fixture"`
	InputBytes int                     `json:"input_bytes"`
	WallMS     int64                   `json:"wall_ms"`
	PeakRSSKB  int64                   `json:"peak_rss_kb"`
	UserCPUms  int64                   `json:"user_cpu_ms"`
	SysCPUms   int64                   `json:"sys_cpu_ms"`
	Result     imagebench.WorkerResult `json:"result"`
	ExitErr    string                  `json:"exit_err,omitempty"`
}

func runOrchestrator() {
	fixtures, err := imagebench.GenerateAll()
	if err != nil {
		fmt.Fprintln(os.Stderr, "generate fixtures:", err)
		os.Exit(1)
	}

	workDir, err := os.MkdirTemp("", "imagebench-fixtures-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "mkdtemp:", err)
		os.Exit(1)
	}
	defer os.RemoveAll(workDir)

	self, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "self exe:", err)
		os.Exit(1)
	}

	paths := make(map[string]string, len(fixtures))
	fmt.Println("=== fixtures generated ===")
	for _, f := range fixtures {
		p := filepath.Join(workDir, f.Name)
		if err := os.WriteFile(p, f.Bytes, 0600); err != nil {
			fmt.Fprintln(os.Stderr, "write fixture:", err)
			os.Exit(1)
		}
		paths[f.Name] = p
		fmt.Printf("  %-38s %10d bytes   %s\n", f.Name, len(f.Bytes), f.Description)
	}

	runFixture := func(name string) runStats {
		start := time.Now()
		cmd := exec.Command(self, "worker", paths[name])
		out, err := cmd.Output()
		wall := time.Since(start)

		stats := runStats{Fixture: name, WallMS: wall.Milliseconds()}
		if info, statErr := os.Stat(paths[name]); statErr == nil {
			stats.InputBytes = int(info.Size())
		}
		if err != nil {
			stats.ExitErr = err.Error()
			return stats
		}
		if err := json.Unmarshal(out, &stats.Result); err != nil {
			stats.ExitErr = "unmarshal: " + err.Error()
		}
		if ps := cmd.ProcessState; ps != nil {
			if ru, ok := ps.SysUsage().(*syscall.Rusage); ok {
				stats.PeakRSSKB = ru.Maxrss // KB on Linux
				stats.UserCPUms = int64(ru.Utime.Sec)*1000 + int64(ru.Utime.Usec)/1000
				stats.SysCPUms = int64(ru.Stime.Sec)*1000 + int64(ru.Stime.Usec)/1000
			}
		}
		return stats
	}

	fmt.Println("\n=== concurrency 1 (sequential) ===")
	var seqResults []runStats
	for _, f := range fixtures {
		s := runFixture(f.Name)
		seqResults = append(seqResults, s)
		printStats(s)
	}

	fmt.Println("\n=== concurrency 2 (pairs run in parallel) ===")
	var mu sync.Mutex
	var parResults []runStats
	// Pair up fixtures for a 2-at-a-time concurrency test; measure total
	// wall time for each pair plus system memory pressure during the run.
	for i := 0; i < len(fixtures); i += 2 {
		batch := fixtures[i:min(i+2, len(fixtures))]
		var wg sync.WaitGroup
		batchStart := time.Now()
		for _, f := range batch {
			wg.Add(1)
			go func(name string) {
				defer wg.Done()
				s := runFixture(name)
				mu.Lock()
				parResults = append(parResults, s)
				mu.Unlock()
			}(f.Name)
		}
		wg.Wait()
		fmt.Printf("  batch of %d finished in %v\n", len(batch), time.Since(batchStart))
		for _, s := range parResults[len(parResults)-len(batch):] {
			printStats(s)
		}
	}

	fmt.Println("\n=== summary table (concurrency=1) ===")
	printTable(seqResults)
	fmt.Println("\n=== summary table (concurrency=2, same fixtures) ===")
	printTable(parResults)
}

func printStats(s runStats) {
	if s.ExitErr != "" {
		fmt.Printf("  %-38s FAILED: %s\n", s.Fixture, s.ExitErr)
		return
	}
	r := s.Result
	if !r.PreCheckOK {
		fmt.Printf("  %-38s REJECTED (pre-check): %s  [%dms, %dKB peak RSS]\n",
			s.Fixture, r.RejectReason, s.WallMS, s.PeakRSSKB)
		return
	}
	if !r.Processed {
		fmt.Printf("  %-38s PROCESS ERROR: %s  [%dms, %dKB peak RSS]\n",
			s.Fixture, r.ProcessError, s.WallMS, s.PeakRSSKB)
		return
	}
	fmt.Printf("  %-38s OK  in=%d thumb=%d card=%d detail=%d webp_master=%d  [%dms, %dKB peak RSS, %dms cpu]\n",
		s.Fixture, r.InputBytes, r.ThumbBytes, r.CardBytes, r.DetailBytes, r.MasterWebP,
		s.WallMS, s.PeakRSSKB, s.UserCPUms+s.SysCPUms)
}

func printTable(results []runStats) {
	fmt.Printf("%-38s %10s %8s %10s %10s\n", "fixture", "in_bytes", "wall_ms", "rss_kb", "cpu_ms")
	for _, s := range results {
		fmt.Printf("%-38s %10d %8d %10d %10d\n",
			s.Fixture, s.InputBytes, s.WallMS, s.PeakRSSKB, s.UserCPUms+s.SysCPUms)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
