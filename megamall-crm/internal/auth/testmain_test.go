package auth

// testmain_test.go — provisions a disposable database + disposable role for
// this package's DB-backed tests (via testutil.Main -> pkg/dbsafety) and
// drops both when the test binary exits. Connection comes exclusively from
// TEST_ADMIN_DSN, never DB_DSN. See pkg/dbsafety's doc comment.

import (
	"os"
	"testing"

	"github.com/megamall/crm/internal/testutil"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.Main(m))
}
