package media

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// NewStorageKey generates a server-side random on-disk identifier. It never
// derives anything from the client-supplied filename — that value is
// attacker-controlled and must never influence a filesystem path (path
// traversal, collision, or overwrite-another-user's-file risk). ext must be
// one of the fixed extensions this package already validated the content
// as (".jpg", ".png", ".webp", ".pdf", ...), never taken from the client's
// filename directly.
func NewStorageKey(ext string) (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate storage key: %w", err)
	}
	return hex.EncodeToString(raw[:]) + ext, nil
}

// VariantStorageKey derives a deterministic, content/version-based key for
// a processed variant from its source asset's storage key and the variant
// name (e.g. "thumb", "card", "detail", "webp"). Deterministic naming (as
// opposed to another random key) means re-processing the same source with
// the same pipeline version produces the same key, which is what makes the
// "atomic file writes with content/version-based filenames" requirement
// meaningful: a write-then-rename to this exact path is safe to retry.
func VariantStorageKey(sourceKey, variant, pipelineVersion string) string {
	base := sourceKey
	if i := lastDot(sourceKey); i >= 0 {
		base = sourceKey[:i]
	}
	return fmt.Sprintf("%s.%s.%s.webp", base, pipelineVersion, variant)
}

func lastDot(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '.' {
			return i
		}
	}
	return -1
}
