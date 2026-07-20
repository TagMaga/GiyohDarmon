package media

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// SignedURLParams are the query parameters a signed private-media URL
// carries. Never persisted to the database — minted fresh on every
// authorized response, per the "do not store signed URLs in the database"
// requirement.
type SignedURLParams struct {
	Key     string // media ID or storage key
	Variant string // optional, empty = original
	Expiry  int64  // unix seconds
	Sig     string // hex HMAC-SHA256
}

// Sign produces the HMAC over key+variant+expiry using secret. The
// signature covers the exact tuple a request will be verified against, so
// an attacker who has a valid signature for one key/variant/expiry cannot
// reuse it for a different one (no signature malleability across fields).
func Sign(secret, key, variant string, expiry int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingPayload(key, variant, expiry)))
	return hex.EncodeToString(mac.Sum(nil))
}

func signingPayload(key, variant string, expiry int64) string {
	return key + "|" + variant + "|" + strconv.FormatInt(expiry, 10)
}

// NewSignedURLQuery builds the query string suffix ("?exp=..&sig=..[&v=..]")
// for a private media delivery URL that is valid until expiry. The caller
// (Service.signedURLExpiry) decides expiry, including any cache-bucketing,
// rather than this function computing time.Now() itself — two calls that
// pass the same expiry for the same key+variant must produce byte-identical
// output, which a fresh time.Now() per call would prevent.
func NewSignedURLQuery(secret, key, variant string, expiry time.Time) string {
	exp := expiry.Unix()
	sig := Sign(secret, key, variant, exp)
	q := fmt.Sprintf("exp=%d&sig=%s", exp, sig)
	if variant != "" {
		q += "&v=" + variant
	}
	return q
}

// VerifySignedURL checks p against secret and the current time. Returns
// false for any failure (expired, bad signature, malformed) — callers must
// respond with a generic 404 in every failure case, never a distinguishing
// 403, so a prober can't use the response code to confirm whether a given
// key exists (see handler.go).
func VerifySignedURL(secret string, p SignedURLParams) bool {
	if p.Key == "" || p.Sig == "" || p.Expiry == 0 {
		return false
	}
	if time.Now().Unix() > p.Expiry {
		return false
	}
	want := Sign(secret, p.Key, p.Variant, p.Expiry)
	// Constant-time comparison — a timing side-channel on signature
	// comparison would let an attacker recover a valid signature
	// byte-by-byte.
	return subtle.ConstantTimeCompare([]byte(want), []byte(p.Sig)) == 1
}

// SafeStorageKey reports whether key is safe to join onto a directory path:
// no path separators, no "..", no leading dot, non-empty. Storage keys are
// always server-generated (see NewStorageKey/VariantStorageKey) so this
// should never trip in practice — it exists as a defensive last line
// against path traversal, checked again at the point a key is turned into
// a filesystem path (delivery handler and processing writes both call it).
func SafeStorageKey(key string) bool {
	if key == "" || key == "." || key == ".." {
		return false
	}
	if strings.ContainsAny(key, "/\\") {
		return false
	}
	if strings.Contains(key, "..") {
		return false
	}
	return true
}
