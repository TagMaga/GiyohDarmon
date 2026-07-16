package media

import (
	"bytes"
	"strings"
	"sync"
	"testing"

	"github.com/h2non/bimg"
	"github.com/megamall/crm/config"
	"github.com/megamall/crm/tools/imagebench"
)

var (
	fixturesOnce sync.Once
	fixtureCache []imagebench.Fixture
	fixtureErr   error
)

// testCfg intentionally allows larger byte sizes than production defaults
// (config.go's MediaConfig defaults are 15-20MiB) because imagebench's
// synthetic fixtures are deliberately high-entropy noise images sized to
// stress the pixel/dimension caps, not the byte-size cap — TestValidate_
// RejectsOversizedFile below is what exercises the byte-size limit path.
func testCfg() config.MediaConfig {
	return config.MediaConfig{
		MaxUploadBytes:   40 << 20,
		MaxImageBytes:    35 << 20,
		MaxDocumentBytes: 20 << 20,
		MaxPixels:        40_000_000,
		MaxDimension:     12000,
	}
}

// fixture returns a named synthetic test image, generating the full fixture
// set at most once per test binary run (GenerateAll includes a slow
// 24MP noise-JPEG encode — regenerating it per-test would make the suite
// unnecessarily slow).
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	fixturesOnce.Do(func() {
		fixtureCache, fixtureErr = imagebench.GenerateAll()
	})
	if fixtureErr != nil {
		t.Fatalf("generate fixtures: %v", fixtureErr)
	}
	for _, f := range fixtureCache {
		if f.Name == name {
			return f.Bytes
		}
	}
	t.Fatalf("fixture %q not found", name)
	return nil
}

func TestValidate_AcceptsJPEG(t *testing.T) {
	buf := fixture(t, "near_limit_7500x5300.jpg")
	vf, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr != nil {
		t.Fatalf("expected accept, got %v", verr)
	}
	if !vf.IsImage || vf.Ext != ".jpg" {
		t.Errorf("got IsImage=%v Ext=%v, want image/.jpg", vf.IsImage, vf.Ext)
	}
	if vf.Width != 7500 || vf.Height != 5300 {
		t.Errorf("dimensions = %dx%d, want 7500x5300", vf.Width, vf.Height)
	}
}

func TestValidate_AcceptsPNG(t *testing.T) {
	buf := fixture(t, "transparent.png")
	vf, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr != nil {
		t.Fatalf("expected accept, got %v", verr)
	}
	if !vf.IsImage || vf.Ext != ".png" {
		t.Errorf("got IsImage=%v Ext=%v, want image/.png", vf.IsImage, vf.Ext)
	}
	if vf.Width != 1200 || vf.Height != 900 {
		t.Errorf("dimensions = %dx%d, want 1200x900", vf.Width, vf.Height)
	}
}

func TestValidate_AcceptsWebP(t *testing.T) {
	png := fixture(t, "transparent.png")
	webp, err := bimg.NewImage(png).Process(bimg.Options{Type: bimg.WEBP, Quality: 80})
	if err != nil {
		t.Fatalf("encode webp fixture: %v", err)
	}
	vf, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(webp), int64(len(webp)))
	if verr != nil {
		t.Fatalf("expected accept, got %v", verr)
	}
	if vf.Ext != ".webp" {
		t.Errorf("ext = %v, want .webp", vf.Ext)
	}
}

func TestValidate_AcceptsPDF(t *testing.T) {
	pdf := []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF")
	vf, verr := Validate(testCfg(), CategoryUserDocument, bytes.NewReader(pdf), int64(len(pdf)))
	if verr != nil {
		t.Fatalf("expected accept, got %v", verr)
	}
	if vf.IsImage {
		t.Error("PDF must not be classified as an image")
	}
	if vf.Ext != ".pdf" {
		t.Errorf("ext = %v, want .pdf", vf.Ext)
	}
}

func TestValidate_RejectsInvalidMIME(t *testing.T) {
	text := []byte("this is not an image, just plain text pretending to be one")
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(text), int64(len(text)))
	if verr == nil || verr.Code != "UNSUPPORTED_TYPE" {
		t.Fatalf("expected UNSUPPORTED_TYPE, got %v", verr)
	}
}

func TestValidate_RejectsDisguisedExecutable(t *testing.T) {
	buf := fixture(t, "disguised_executable.jpg")
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr == nil {
		t.Fatal("expected rejection of ELF content disguised as .jpg")
	}
	if verr.Code != "UNSUPPORTED_TYPE" {
		t.Errorf("code = %v, want UNSUPPORTED_TYPE", verr.Code)
	}
}

func TestValidate_RejectsSVG(t *testing.T) {
	svg := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(svg), int64(len(svg)))
	if verr == nil || verr.Code != "UNSUPPORTED_TYPE" {
		t.Fatalf("expected SVG rejected as UNSUPPORTED_TYPE, got %v", verr)
	}
}

func TestValidate_RejectsCorruptImage(t *testing.T) {
	buf := fixture(t, "truncated.jpg")
	// A JPEG magic-byte prefix with a body cut mid-stream must fail the
	// declared-size-vs-actual-bytes check before ever reaching the decoder
	// — see the doc comment on Validate and the benchmark finding that
	// libjpeg alone does not reliably error on truncation.
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf))+500)
	if verr == nil || verr.Code != "SIZE_MISMATCH" {
		t.Fatalf("expected SIZE_MISMATCH for a declared-size lie, got %v", verr)
	}
}

func TestValidate_RejectsOversizedFile(t *testing.T) {
	cfg := testCfg()
	cfg.MaxImageBytes = 100
	buf := fixture(t, "transparent.png")
	_, verr := Validate(cfg, CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr == nil || verr.Code != "FILE_TOO_LARGE" {
		t.Fatalf("expected FILE_TOO_LARGE, got %v", verr)
	}
}

func TestValidate_RejectsExcessivePixels(t *testing.T) {
	buf := fixture(t, "over_limit_9000x7000.png")
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr == nil || verr.Code != "IMAGE_TOO_LARGE" {
		t.Fatalf("expected IMAGE_TOO_LARGE for 63MP image, got %v", verr)
	}
}

func TestValidate_AcceptsNearLimitPixels(t *testing.T) {
	buf := fixture(t, "near_limit_7500x5300.jpg")
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr != nil {
		t.Fatalf("expected a 39.75MP image (under the 40MP cap) to pass, got %v", verr)
	}
}

func TestValidate_RejectsDecompressionBombWithoutFullDecode(t *testing.T) {
	buf := fixture(t, "decompression_bomb_50000x50000.png")
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr == nil || verr.Code != "IMAGE_TOO_LARGE" {
		t.Fatalf("expected IMAGE_TOO_LARGE for a declared 50000x50000 image, got %v", verr)
	}
}

func TestValidate_RejectsEmptyFile(t *testing.T) {
	_, verr := Validate(testCfg(), CategoryProductImage, bytes.NewReader(nil), 0)
	if verr == nil || verr.Code != "EMPTY_FILE" {
		t.Fatalf("expected EMPTY_FILE, got %v", verr)
	}
}

func TestValidate_UnknownCategoryRejected(t *testing.T) {
	if Category("not_a_real_category").Valid() {
		t.Fatal("an unrecognized category string must not be Valid()")
	}
}

func TestValidate_ChecksumIsDeterministic(t *testing.T) {
	buf := fixture(t, "transparent.png")
	vf1, verr1 := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	vf2, verr2 := Validate(testCfg(), CategoryProductImage, bytes.NewReader(buf), int64(len(buf)))
	if verr1 != nil || verr2 != nil {
		t.Fatalf("unexpected rejection: %v / %v", verr1, verr2)
	}
	if vf1.ChecksumHex != vf2.ChecksumHex || len(vf1.ChecksumHex) != 64 {
		t.Errorf("checksum mismatch or wrong length: %q vs %q", vf1.ChecksumHex, vf2.ChecksumHex)
	}
}

func TestLooksLikeSVG(t *testing.T) {
	cases := map[string]bool{
		`<svg xmlns="http://www.w3.org/2000/svg"></svg>`: true,
		`<?xml version="1.0"?><svg></svg>`:               true,
		`plain text`:                                     false,
	}
	for in, want := range cases {
		if got := looksLikeSVG([]byte(in)); got != want {
			t.Errorf("looksLikeSVG(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestLooksLikeExecutable(t *testing.T) {
	if !looksLikeExecutable([]byte{0x7f, 'E', 'L', 'F', 0, 0}) {
		t.Error("ELF magic must be detected")
	}
	if !looksLikeExecutable([]byte{'M', 'Z', 0x90, 0}) {
		t.Error("MZ (PE) magic must be detected")
	}
	if looksLikeExecutable([]byte{0xFF, 0xD8, 0xFF}) {
		t.Error("a real JPEG magic must not be flagged as executable")
	}
}

func TestBaseContentType(t *testing.T) {
	if got := baseContentType("image/png; charset=binary"); got != "image/png" {
		t.Errorf("got %q", got)
	}
	if strings.Contains(baseContentType("image/jpeg"), ";") {
		t.Error("no-parameter input should pass through unchanged")
	}
}
