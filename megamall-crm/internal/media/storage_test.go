package media

import (
	"strings"
	"testing"
)

func TestNewStorageKey_NeverDerivedFromInput(t *testing.T) {
	// NewStorageKey takes only an extension — there is no filename
	// parameter at all, so it structurally cannot leak client input into
	// the on-disk path. This test documents/locks that signature.
	k1, err := NewStorageKey(".jpg")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasSuffix(k1, ".jpg") {
		t.Errorf("key %q must end with the given extension", k1)
	}
}

func TestNewStorageKey_Unique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		k, err := NewStorageKey(".png")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if seen[k] {
			t.Fatalf("collision after %d keys: %q", i, k)
		}
		seen[k] = true
	}
}

func TestVariantStorageKey_DeterministicAndSafe(t *testing.T) {
	k1 := VariantStorageKey("abcdef0123456789.jpg", "thumbnail", "v1")
	k2 := VariantStorageKey("abcdef0123456789.jpg", "thumbnail", "v1")
	if k1 != k2 {
		t.Fatalf("VariantStorageKey must be deterministic for the same inputs: %q != %q", k1, k2)
	}
	if !strings.HasSuffix(k1, ".webp") {
		t.Errorf("variant key %q must end in .webp", k1)
	}
	if !SafeStorageKey(k1) {
		t.Errorf("a deterministically-derived variant key must still pass SafeStorageKey: %q", k1)
	}
}

func TestVariantStorageKey_DifferentVariantsDifferentKeys(t *testing.T) {
	thumb := VariantStorageKey("src.jpg", "thumbnail", "v1")
	card := VariantStorageKey("src.jpg", "card", "v1")
	if thumb == card {
		t.Fatal("different variant names must produce different keys")
	}
}

func TestVariantStorageKey_VersionBump(t *testing.T) {
	v1 := VariantStorageKey("src.jpg", "thumbnail", "v1")
	v2 := VariantStorageKey("src.jpg", "thumbnail", "v2")
	if v1 == v2 {
		t.Fatal("a pipeline version bump must change the variant key so old and new variants don't collide")
	}
}
