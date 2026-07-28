package inventory_test

// testmain_test.go — provisions a disposable database + disposable role for
// this package's DB-backed tests (via testutil.Main -> pkg/dbsafety) and
// drops both when the test binary exits. Connection comes exclusively from
// TEST_ADMIN_DSN, never DB_DSN. See pkg/dbsafety's doc comment.
//
// Lives in the external inventory_test package (not inventory) because
// internal/testutil itself imports internal/inventory for fixture helpers —
// an in-package test file importing testutil here would be an import cycle.

import (
	"os"
	"testing"

	"github.com/megamall/crm/internal/testutil"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.Main(m))
}
