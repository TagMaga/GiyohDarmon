package media

import (
	"strings"
	"testing"
	"time"
)

const testSecret = "test-signing-secret-do-not-use-in-prod"

func TestSignedURL_ValidRoundTrip(t *testing.T) {
	expiry := time.Now().Add(time.Minute).Unix()
	sig := Sign(testSecret, "abc123.jpg", "thumbnail", expiry)
	ok := VerifySignedURL(testSecret, SignedURLParams{Key: "abc123.jpg", Variant: "thumbnail", Expiry: expiry, Sig: sig})
	if !ok {
		t.Fatal("expected a freshly signed, unexpired URL to verify")
	}
}

func TestSignedURL_ExpiredRejected(t *testing.T) {
	expiry := time.Now().Add(-time.Minute).Unix() // already expired
	sig := Sign(testSecret, "abc123.jpg", "thumbnail", expiry)
	ok := VerifySignedURL(testSecret, SignedURLParams{Key: "abc123.jpg", Variant: "thumbnail", Expiry: expiry, Sig: sig})
	if ok {
		t.Fatal("expired signature must not verify")
	}
}

func TestSignedURL_InvalidSignatureRejected(t *testing.T) {
	expiry := time.Now().Add(time.Minute).Unix()
	ok := VerifySignedURL(testSecret, SignedURLParams{Key: "abc123.jpg", Variant: "thumbnail", Expiry: expiry, Sig: "0000not-a-real-signature"})
	if ok {
		t.Fatal("garbage signature must not verify")
	}
}

func TestSignedURL_WrongKeyRejected(t *testing.T) {
	expiry := time.Now().Add(time.Minute).Unix()
	sig := Sign(testSecret, "abc123.jpg", "thumbnail", expiry)
	// Same signature, different key — a signature must be bound to the
	// exact key it was minted for (no cross-key replay).
	ok := VerifySignedURL(testSecret, SignedURLParams{Key: "different-key.jpg", Variant: "thumbnail", Expiry: expiry, Sig: sig})
	if ok {
		t.Fatal("a signature for one key must not verify for a different key")
	}
}

func TestSignedURL_WrongVariantRejected(t *testing.T) {
	expiry := time.Now().Add(time.Minute).Unix()
	sig := Sign(testSecret, "abc123.jpg", "thumbnail", expiry)
	ok := VerifySignedURL(testSecret, SignedURLParams{Key: "abc123.jpg", Variant: "detail", Expiry: expiry, Sig: sig})
	if ok {
		t.Fatal("a signature for one variant must not verify for a different variant")
	}
}

func TestSignedURL_WrongSecretRejected(t *testing.T) {
	expiry := time.Now().Add(time.Minute).Unix()
	sig := Sign(testSecret, "abc123.jpg", "thumbnail", expiry)
	ok := VerifySignedURL("a-completely-different-secret", SignedURLParams{Key: "abc123.jpg", Variant: "thumbnail", Expiry: expiry, Sig: sig})
	if ok {
		t.Fatal("a signature minted with a different secret must not verify")
	}
}

func TestSignedURL_MissingFieldsRejected(t *testing.T) {
	cases := []SignedURLParams{
		{Key: "", Variant: "thumbnail", Expiry: time.Now().Add(time.Minute).Unix(), Sig: "x"},
		{Key: "abc.jpg", Variant: "thumbnail", Expiry: 0, Sig: "x"},
		{Key: "abc.jpg", Variant: "thumbnail", Expiry: time.Now().Add(time.Minute).Unix(), Sig: ""},
	}
	for i, p := range cases {
		if VerifySignedURL(testSecret, p) {
			t.Errorf("case %d: expected rejection for incomplete params %+v", i, p)
		}
	}
}

func TestNewSignedURLQuery_ContainsExpectedFields(t *testing.T) {
	q := NewSignedURLQuery(testSecret, "key1.webp", "card", time.Now().Add(5*time.Minute))
	if !strings.Contains(q, "exp=") || !strings.Contains(q, "sig=") || !strings.Contains(q, "v=card") {
		t.Fatalf("query string missing expected fields: %q", q)
	}
}

func TestNewSignedURLQuery_OmitsEmptyVariant(t *testing.T) {
	q := NewSignedURLQuery(testSecret, "key1.webp", "", time.Now().Add(5*time.Minute))
	if strings.Contains(q, "&v=") {
		t.Fatalf("empty variant should not appear in the query string: %q", q)
	}
}

func TestSafeStorageKey(t *testing.T) {
	valid := []string{"abc123.jpg", "a1b2c3.v1.thumbnail.webp"}
	invalid := []string{"", ".", "..", "../etc/passwd", "a/b.jpg", `a\b.jpg`, "..evil"}

	for _, k := range valid {
		if !SafeStorageKey(k) {
			t.Errorf("SafeStorageKey(%q) = false, want true", k)
		}
	}
	for _, k := range invalid {
		if SafeStorageKey(k) {
			t.Errorf("SafeStorageKey(%q) = true, want false (path traversal / malformed key)", k)
		}
	}
}
