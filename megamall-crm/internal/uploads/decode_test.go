package uploads

// decode_test.go — Pure unit tests for DecodeBounds, the full-decode guard
// used by the avatar-upload fix (internal/users.uploadAvatar) on top of
// Validate's magic-byte sniff.
//
// No database, no network, no fixtures required.
// Run with: go test ./internal/uploads/ -v -run TestDecodeBounds

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// realJPEG encodes a genuine, fully decodable JPEG of the given size.
func realJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode test jpeg: %v", err)
	}
	return buf.Bytes()
}

// realPNG encodes a genuine, fully decodable PNG of the given size.
func realPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
}

func TestDecodeBounds_ValidJPEGAccepted(t *testing.T) {
	data := realJPEG(t, 64, 32)
	w, h, err := DecodeBounds(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("expected a real jpeg to decode, got: %v", err)
	}
	if w != 64 || h != 32 {
		t.Fatalf("got %dx%d, want 64x32", w, h)
	}
}

func TestDecodeBounds_ValidPNGAccepted(t *testing.T) {
	data := realPNG(t, 48, 24)
	w, h, err := DecodeBounds(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("expected a real png to decode, got: %v", err)
	}
	if w != 48 || h != 24 {
		t.Fatalf("got %dx%d, want 48x24", w, h)
	}
}

// TestDecodeBounds_MalformedImageRejected proves DecodeBounds catches what
// Validate's magic-byte sniff alone cannot: bytes that sniff as a valid
// image MIME type (a real JPEG magic-byte prefix) but are not actually a
// complete, decodable image (here: header + zero filler, no valid JPEG
// structure/scan data after it). This is exactly the gap between "looks like
// an image at the byte-sniffing level" and "is a genuine image."
func TestDecodeBounds_MalformedImageRejected(t *testing.T) {
	data := jpegBytes() // magic-byte prefix + zero padding, not a real JPEG
	ct := "image/jpeg"
	if !IsImage(ct) {
		t.Fatal("test fixture assumption broken: jpegBytes() must sniff as image/jpeg")
	}
	if _, _, err := DecodeBounds(bytes.NewReader(data)); err == nil {
		t.Fatal("expected a malformed (magic-bytes-only) image to fail full decode")
	}
}

func TestDecodeBounds_ZeroByteFileRejected(t *testing.T) {
	if _, _, err := DecodeBounds(bytes.NewReader(nil)); err == nil {
		t.Fatal("expected a zero-byte file to fail decode")
	}
}

// TestDecodeBounds_OversizedDimensionRejected proves the decompression-bomb
// guard: a genuinely valid, fully-decodable image that exceeds
// MaxImageDimension on either side must still be rejected.
func TestDecodeBounds_OversizedDimensionRejected(t *testing.T) {
	data := realPNG(t, MaxImageDimension+1, 10)
	if _, _, err := DecodeBounds(bytes.NewReader(data)); err == nil {
		t.Fatal("expected an oversized-dimension image to be rejected")
	}
}

func TestDecodeBounds_WithinDimensionLimitAccepted(t *testing.T) {
	data := realPNG(t, MaxImageDimension, 10)
	if _, _, err := DecodeBounds(bytes.NewReader(data)); err != nil {
		t.Fatalf("expected an image exactly at the dimension limit to be accepted, got: %v", err)
	}
}
