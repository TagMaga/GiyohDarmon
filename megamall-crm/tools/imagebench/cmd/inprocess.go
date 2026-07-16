package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/h2non/bimg"
	"github.com/megamall/crm/tools/imagebench"
)

// runInProcess corrects a real measurement mistake from the subprocess-based
// run: importing github.com/h2non/bimg triggers libvips' one-time init
// (dlopen-ing its entire dependency chain — ImageMagick, Poppler, OpenSlide,
// HDF5, etc., see the package rollback doc) the moment the package loads,
// *before* any image is ever processed. Spawning a fresh subprocess per
// fixture (the first benchmark mode above) meant every single measurement —
// including instant pre-check rejections that never touch vips at all —
// included that fixed one-time cost, making every number look identical and
// hiding the actual marginal per-image cost.
//
// Production runs one persistent server process, not a subprocess per
// upload, so that init cost is paid exactly once at server startup. This
// mode measures it in isolation, then measures the *marginal* RSS added by
// each processing operation on top of that baseline, which is the number
// that actually matters for capacity planning.
func runInProcess() {
	vmHWM := func() int64 {
		f, err := os.Open("/proc/self/status")
		if err != nil {
			return -1
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "VmHWM:") {
				fields := strings.Fields(line)
				v, _ := strconv.ParseInt(fields[1], 10, 64)
				return v
			}
		}
		return -1
	}

	fmt.Printf("process start, VmHWM=%d KB\n", vmHWM())

	// Force vips' one-time init by touching the bimg package with a trivial
	// 1x1 pixel operation, isolating that fixed cost from real work.
	_, _, _, _, _ = imagebench.ProcessVariants(mustTinyPNG())
	afterInit := vmHWM()
	fmt.Printf("after libvips init (1x1 warm-up image), VmHWM=%d KB  <- one-time cost, paid once at server startup\n", afterInit)
	fmt.Printf("bimg reports libvips version: %s\n", bimg.VipsVersion)

	fixtures, err := imagebench.GenerateAll()
	if err != nil {
		fmt.Fprintln(os.Stderr, "generate:", err)
		os.Exit(1)
	}

	fmt.Println("\n=== sequential (concurrency=1), marginal cost on top of the warm baseline ===")
	fmt.Printf("%-38s %10s %8s %14s %14s\n", "fixture", "in_bytes", "wall_ms", "VmHWM_after_KB", "marginal_KB")
	prevHWM := afterInit
	for _, f := range fixtures {
		start := time.Now()
		w, h, ok, reason := imagebench.PreCheck(f.Bytes)
		var note string
		if !ok {
			note = "REJECTED: " + reason
		} else {
			_, _, _, _, perr := imagebench.ProcessVariants(f.Bytes)
			if perr != nil {
				note = "PROCESS ERROR: " + perr.Error()
			} else {
				note = fmt.Sprintf("OK %dx%d", w, h)
			}
		}
		wall := time.Since(start)
		hwm := vmHWM()
		fmt.Printf("%-38s %10d %8d %14d %14d   %s\n", f.Name, len(f.Bytes), wall.Milliseconds(), hwm, hwm-prevHWM, note)
		prevHWM = hwm
	}

	fmt.Println("\n=== concurrency=2, two largest fixtures processed in parallel goroutines ===")
	before := vmHWM()
	start := time.Now()
	var wg sync.WaitGroup
	targets := []string{"large_photo_6000x4000.jpg", "near_limit_7500x5300.jpg"}
	for _, f := range fixtures {
		for _, t := range targets {
			if f.Name == t {
				wg.Add(1)
				go func(fx imagebench.Fixture) {
					defer wg.Done()
					imagebench.ProcessVariants(fx.Bytes)
				}(f)
			}
		}
	}
	wg.Wait()
	wall := time.Since(start)
	after := vmHWM()
	fmt.Printf("2 concurrent 24-40MP images: wall=%dms VmHWM_before=%d VmHWM_after=%d marginal=%d KB\n",
		wall.Milliseconds(), before, after, after-before)
}

func mustTinyPNG() []byte {
	// 1x1 fully opaque PNG, hand-built (avoids importing the fixtures'
	// image/png encoder path just for a throwaway warm-up call).
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
		0x54, 0x78, 0x9c, 0x62, 0xf8, 0xcf, 0xc0, 0xf0,
		0x1f, 0x00, 0x05, 0x05, 0x02, 0x80, 0x2d, 0xe5,
		0x31, 0x56, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
		0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
}
