package users_test

// testmain_test.go — provisions a disposable database + disposable role for
// this package's DB-backed tests (via testutil.Main -> pkg/dbsafety) and
// drops both when the test binary exits. Connection comes exclusively from
// TEST_ADMIN_DSN, never DB_DSN. See pkg/dbsafety's doc comment.
//
// Deliberately package users_test, not users: internal/testutil (which
// this file imports) itself imports internal/users for fixture helpers, so
// an internal-package (package users) test file importing testutil would
// cycle — mirrors internal/products/testmain_test.go exactly, for the same
// reason (see internal/products/mediabridge's doc comment).

import (
	"os"
	"testing"

	"github.com/megamall/crm/internal/testutil"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.Main(m))
}
