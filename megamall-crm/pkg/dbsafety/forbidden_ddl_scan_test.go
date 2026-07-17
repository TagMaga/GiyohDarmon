package dbsafety

// TestNoAlterRoleOrAlterUserInTrackedSource is a repo-wide regression test:
// no test helper, migration, or scratch script may ever contain an
// ALTER USER or ALTER ROLE statement against a pre-existing role. The prior
// production incident was exactly this — a scratch test running ALTER ROLE
// against the live production role. Legitimate role creation always goes
// through internal/testutil.setupDisposableDB's CREATE ROLE, which this
// scan does not flag.
//
// The two forbidden phrases are assembled from parts below so this file
// itself doesn't trip its own scanner.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var scannedExtensions = map[string]bool{
	".go":   true,
	".sql":  true,
	".sh":   true,
	".yml":  true,
	".yaml": true,
}

var skippedDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"dist":         true,
	"tmp":          true,
	"release":      true,
	"graphify-out": true,
}

func TestNoAlterRoleOrAlterUserInTrackedSource(t *testing.T) {
	repoRoot := repoRoot(t)

	forbidden := []string{
		strings.ToUpper("alter" + " " + "role"),
		strings.ToUpper("alter" + " " + "user"),
	}

	var violations []string

	err := filepath.Walk(repoRoot, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			if skippedDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !scannedExtensions[filepath.Ext(path)] {
			return nil
		}
		if info.Name() == "forbidden_ddl_scan_test.go" {
			return nil
		}

		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		upper := strings.ToUpper(string(data))
		for _, phrase := range forbidden {
			if strings.Contains(upper, phrase) {
				rel, _ := filepath.Rel(repoRoot, path)
				violations = append(violations, rel+": contains "+strings.ToLower(phrase))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk repo for forbidden-DDL scan: %v", err)
	}

	if len(violations) > 0 {
		t.Fatalf("found %d file(s) with a forbidden ALTER USER/ALTER ROLE statement — role mutation must only ever "+
			"happen via internal/testutil.setupDisposableDB's CREATE ROLE on a role it just created itself:\n%s",
			len(violations), strings.Join(violations, "\n"))
	}
}

// repoRoot walks up from the current package directory to the nearest
// go.mod (the megamall-crm/ backend module), then one level further if a
// .git directory is found there — that's the actual monorepo root, which
// also holds web-admin/, mobile/, .github/workflows/, and the top-level
// scripts/ and deploy.sh this scan is meant to cover too. Falls back to the
// go.mod directory itself if no such parent is found, so the scan still
// covers the whole backend even in an unusual checkout layout.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			if _, gitErr := os.Stat(filepath.Join(filepath.Dir(dir), ".git")); gitErr == nil {
				return filepath.Dir(dir)
			}
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate go.mod by walking up from the current directory")
		}
		dir = parent
	}
}
