package uploads

// uploads_test.go — Pure unit tests for upload content-type validation.
//
// No database, no network, no fixtures required.
// Run with: go test ./internal/uploads/ -v

import (
	"bytes"
	"strings"
	"testing"
)

// jpegBytes returns a minimal valid JPEG magic-byte prefix followed by
// filler — enough for http.DetectContentType to recognize it as image/jpeg.
func jpegBytes() []byte {
	header := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01}
	return append(header, bytes.Repeat([]byte{0x00}, 100)...)
}

// pngBytes returns the 8-byte PNG signature followed by filler.
func pngBytes() []byte {
	header := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	return append(header, bytes.Repeat([]byte{0x00}, 100)...)
}

// webpBytes returns a minimal RIFF/WEBP container header.
func webpBytes() []byte {
	b := []byte("RIFF")
	b = append(b, 0x00, 0x00, 0x00, 0x00) // chunk size, unchecked by the sniffer
	b = append(b, []byte("WEBPVP8 ")...)
	return append(b, bytes.Repeat([]byte{0x00}, 100)...)
}

func TestValidate_JPEGAccepted(t *testing.T) {
	data := jpegBytes()
	ext, ct, err := Validate(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("expected jpeg to be accepted, got error: %v", err)
	}
	if ext != ".jpg" || ct != "image/jpeg" {
		t.Fatalf("got ext=%q ct=%q, want .jpg/image/jpeg", ext, ct)
	}
}

func TestValidate_PNGAccepted(t *testing.T) {
	data := pngBytes()
	ext, ct, err := Validate(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("expected png to be accepted, got error: %v", err)
	}
	if ext != ".png" || ct != "image/png" {
		t.Fatalf("got ext=%q ct=%q, want .png/image/png", ext, ct)
	}
}

func TestValidate_WebPAccepted(t *testing.T) {
	data := webpBytes()
	ext, ct, err := Validate(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("expected webp to be accepted, got error: %v", err)
	}
	if ext != ".webp" || ct != "image/webp" {
		t.Fatalf("got ext=%q ct=%q, want .webp/image/webp", ext, ct)
	}
}

func TestValidate_HTMLRejected(t *testing.T) {
	data := []byte(`<!DOCTYPE html><html><body><script>document.title="XSS-PROOF-"+document.cookie</script></body></html>`)
	_, _, err := Validate(bytes.NewReader(data), int64(len(data)))
	if err == nil {
		t.Fatal("expected html content to be rejected")
	}
}

func TestValidate_HTMLRejected_DisguisedAsJPEG(t *testing.T) {
	// The core of the fix: content is HTML regardless of the filename the
	// client claims — validation must key off the sniffed bytes, not a
	// client-supplied extension. This test exercises Validate the same way
	// as the html-content test but documents the disguise scenario the
	// original vulnerability relied on (a .html file saved as if trusted).
	data := []byte(`<html><body><script>alert(document.domain)</script></body></html>`)
	_, _, err := Validate(bytes.NewReader(data), int64(len(data)))
	if err == nil {
		t.Fatal("expected disguised html content to be rejected regardless of claimed extension")
	}
	if !strings.Contains(err.Error(), "unsupported file type") {
		t.Fatalf("expected an unsupported-file-type error, got: %v", err)
	}
}

func TestValidate_SVGRejected(t *testing.T) {
	data := []byte(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	_, _, err := Validate(bytes.NewReader(data), int64(len(data)))
	if err == nil {
		t.Fatal("expected svg content to be rejected")
	}
}

func TestValidate_UnknownBinaryRejected(t *testing.T) {
	data := bytes.Repeat([]byte{0xDE, 0xAD, 0xBE, 0xEF}, 25)
	_, _, err := Validate(bytes.NewReader(data), int64(len(data)))
	if err == nil {
		t.Fatal("expected unrecognized binary content to be rejected")
	}
}

func TestValidate_OversizedRejected(t *testing.T) {
	data := jpegBytes()
	_, _, err := Validate(bytes.NewReader(data), MaxFileSize+1)
	if err == nil {
		t.Fatal("expected oversized file to be rejected")
	}
	if !strings.Contains(err.Error(), "exceeds maximum size") {
		t.Fatalf("expected a size-limit error, got: %v", err)
	}
}

func TestIsImage(t *testing.T) {
	if !IsImage("image/jpeg") || !IsImage("image/png") || !IsImage("image/webp") {
		t.Fatal("expected image/* content types to be treated as images")
	}
	if IsImage("application/pdf") {
		t.Fatal("expected application/pdf to not be treated as an image")
	}
}
