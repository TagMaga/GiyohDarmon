package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/h2non/bimg"
)

// buildExifJPEG returns a small, otherwise-plain JPEG (w x h) with a hand-
// built EXIF APP1 segment declaring the given orientation and a GPS IFD —
// used to verify that processing (a) auto-rotates according to EXIF
// orientation before encoding the WebP variant, and (b) strips all EXIF/GPS
// metadata from the output. Go's stdlib jpeg encoder has no EXIF support,
// so the segment is spliced in by hand immediately after the SOI marker.
func buildExifJPEG(t *testing.T, w, h int, orientation uint16) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var plain bytes.Buffer
	if err := jpeg.Encode(&plain, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode base jpeg: %v", err)
	}
	plainBytes := plain.Bytes()
	if len(plainBytes) < 2 || plainBytes[0] != 0xFF || plainBytes[1] != 0xD8 {
		t.Fatalf("base jpeg missing SOI marker")
	}

	app1 := buildExifAPP1(orientation)

	out := make([]byte, 0, len(plainBytes)+len(app1))
	out = append(out, plainBytes[:2]...) // SOI
	out = append(out, app1...)
	out = append(out, plainBytes[2:]...)
	return out
}

// buildExifAPP1 constructs a minimal but valid EXIF APP1 segment: TIFF
// header, IFD0 with an Orientation tag and a GPS IFD pointer, and a GPS IFD
// with one entry. Little-endian ("II") byte order throughout.
func buildExifAPP1(orientation uint16) []byte {
	const (
		tagOrientation = 0x0112
		tagGPSIFD      = 0x8825
		tagGPSLatRef   = 0x0001
		typeShort      = 3
		typeLong       = 4
		typeAscii      = 2
	)

	var tiff bytes.Buffer
	// TIFF header: byte order, magic 42, offset to IFD0 (right after header = 8).
	tiff.Write([]byte("II"))
	binary.Write(&tiff, binary.LittleEndian, uint16(42))
	binary.Write(&tiff, binary.LittleEndian, uint32(8))

	const ifd0Offset = 8
	const ifd0EntryCount = 2
	const ifd0Size = 2 + ifd0EntryCount*12 + 4
	gpsIFDOffset := uint32(ifd0Offset + ifd0Size)

	// IFD0
	binary.Write(&tiff, binary.LittleEndian, uint16(ifd0EntryCount))

	// Entry: Orientation (SHORT, count 1, value in first 2 bytes of the 4-byte field)
	binary.Write(&tiff, binary.LittleEndian, uint16(tagOrientation))
	binary.Write(&tiff, binary.LittleEndian, uint16(typeShort))
	binary.Write(&tiff, binary.LittleEndian, uint32(1))
	binary.Write(&tiff, binary.LittleEndian, orientation)
	binary.Write(&tiff, binary.LittleEndian, uint16(0)) // pad to 4 bytes

	// Entry: GPS IFD pointer (LONG, count 1, value = offset)
	binary.Write(&tiff, binary.LittleEndian, uint16(tagGPSIFD))
	binary.Write(&tiff, binary.LittleEndian, uint16(typeLong))
	binary.Write(&tiff, binary.LittleEndian, uint32(1))
	binary.Write(&tiff, binary.LittleEndian, gpsIFDOffset)

	binary.Write(&tiff, binary.LittleEndian, uint32(0)) // next IFD offset = none

	// GPS IFD
	binary.Write(&tiff, binary.LittleEndian, uint16(1)) // 1 entry
	binary.Write(&tiff, binary.LittleEndian, uint16(tagGPSLatRef))
	binary.Write(&tiff, binary.LittleEndian, uint16(typeAscii))
	binary.Write(&tiff, binary.LittleEndian, uint32(2))
	tiff.Write([]byte("N\x00\x00\x00")) // "N" + NUL, padded to 4 bytes
	binary.Write(&tiff, binary.LittleEndian, uint32(0))

	payload := append([]byte("Exif\x00\x00"), tiff.Bytes()...)

	segLen := len(payload) + 2
	seg := make([]byte, 0, 4+len(payload))
	seg = append(seg, 0xFF, 0xE1)
	seg = append(seg, byte(segLen>>8), byte(segLen&0xFF))
	seg = append(seg, payload...)
	return seg
}

func TestBuildExifJPEG_HasEXIFBeforeProcessing(t *testing.T) {
	buf := buildExifJPEG(t, 400, 200, 6)
	meta, err := bimg.NewImage(buf).Metadata()
	if err != nil {
		t.Fatalf("read metadata of hand-built fixture: %v", err)
	}
	if meta.Orientation != 6 {
		t.Fatalf("fixture sanity check failed: EXIF orientation = %d, want 6 (fixture is broken, not the code under test)", meta.Orientation)
	}
}

func TestProcessProductImage_StripsEXIFAndCorrectsOrientation(t *testing.T) {
	// Orientation 6 = rotate 90 CW: a physically-landscape (2900x1450) source
	// tagged this way should render portrait (1450x2900) once vips applies
	// the rotation — an observable, behavioral proof that auto-rotation
	// really happened, not just that the tag was read. Sized so the
	// post-rotation width (1450) is just over detailWidth (1440): this test
	// needs a master variant to actually be generated (not skipped as a
	// detail-duplicate — see TestProcessProductImage_MasterOmitted*) so it
	// can assert EXIF/GPS stripping on the master's own bytes.
	buf := buildExifJPEG(t, 2900, 1450, 6)
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 20*time.Second, dir, "src.jpg", buf)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}
	if master == nil {
		t.Fatal("expected a master variant for a source wider than detailWidth")
	}

	masterMeta, err := bimg.NewImage(master).Metadata()
	if err != nil {
		t.Fatalf("read master metadata: %v", err)
	}
	if masterMeta.Orientation != 0 && masterMeta.Orientation != 1 {
		t.Errorf("master orientation = %d, want stripped (0 or 1)", masterMeta.Orientation)
	}
	// bimg's EXIF struct doesn't surface GPS tags directly; check at the
	// byte level that no EXIF/GPS chunk survived StripMetadata at all —
	// the source fixture's GPS IFD was tagged "Exif" (see buildExifAPP1),
	// so its absence from the output bytes confirms the strip worked.
	if bytes.Contains(master, []byte("Exif")) {
		t.Error("expected all EXIF (including GPS) metadata to be stripped from the master variant")
	}
	if masterMeta.Size.Width != 1450 || masterMeta.Size.Height != 2900 {
		t.Errorf("master size = %dx%d, want 1450x2900 (source auto-rotated per EXIF orientation 6)", masterMeta.Size.Width, masterMeta.Size.Height)
	}

	if len(variants) != len(ProductVariantSpecs)+1 {
		t.Errorf("got %d variants, want %d (%d sizes + webp_master)", len(variants), len(ProductVariantSpecs)+1, len(ProductVariantSpecs))
	}
}

func TestProcessProductImage_VariantDimensionsPreserveAspectAndNeverUpscale(t *testing.T) {
	png := fixture(t, "transparent.png") // 1200x900
	dir := t.TempDir()

	variants, _, err := ProcessProductImage(context.Background(), 20*time.Second, dir, "src2.png", png)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}

	for _, spec := range ProductVariantSpecs {
		v, ok := variants[spec.Name]
		if !ok {
			t.Fatalf("missing variant %q", spec.Name)
		}
		if v.Width > spec.Width {
			// Never upscale: 1200x900 source, all target widths (320/768/1440)
			// except "detail" (1440 > 1200) should hit exactly spec.Width;
			// detail must not exceed the source width.
			t.Errorf("variant %q width %d exceeds target %d", spec.Name, v.Width, spec.Width)
		}
		wantWidth := spec.Width
		if wantWidth > 1200 {
			wantWidth = 1200 // source width — Enlarge:false caps it here
		}
		if v.Width != wantWidth {
			t.Errorf("variant %q width = %d, want %d", spec.Name, v.Width, wantWidth)
		}
		// Aspect ratio preserved: 1200x900 = 4:3.
		gotRatio := float64(v.Width) / float64(v.Height)
		wantRatio := 1200.0 / 900.0
		if diff := gotRatio - wantRatio; diff > 0.02 || diff < -0.02 {
			t.Errorf("variant %q aspect ratio = %.3f, want ~%.3f", spec.Name, gotRatio, wantRatio)
		}
	}
}

// ─── Master-variant size-aware policy ──────────────────────────────────────
//
// See the size-aware guards documented in ProcessProductImage: (1) a master
// is never generated at all when it would just duplicate the "detail"
// variant's dimensions (source width ≤ detailWidth), (2) a generated master
// is never kept if it isn't smaller than the original, even after one
// fallback-quality retry.

// buildPhotoLikeJPEG renders a smooth gradient with per-pixel dithering
// noise on top — unlike a flat/smooth fixture (which both JPEG and WebP
// compress to near-nothing regardless of quality) or pure random noise
// (which defeats JPEG's DCT particularly badly), this mix behaves like a
// real photo: JPEG's compression ratio varies meaningfully with the
// requested quality, which is what lets these tests reliably land a real
// bimg/libvips WebP re-encode on either side of the original's size — the
// exact dynamic that produced the real 2026-07-17 production canary bug
// (a genuine phone photo's WebP master ending up larger than its JPEG
// original). Deterministic (fixed RNG seed) so results are reproducible.
func buildPhotoLikeJPEG(t *testing.T, w, h, jpegQuality int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(99))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			base := uint8((x * 180 / w) + (y * 60 / h))
			noise := uint8(rng.Intn(40))
			img.Set(x, y, color.RGBA{R: base + noise, G: base/2 + noise, B: 200 - base/3, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
		t.Fatalf("encode photo-like jpeg: %v", err)
	}
	return buf.Bytes()
}

func TestSelectMaster_KeepsPrimaryWhenSmallerThanOriginal(t *testing.T) {
	primary := make([]byte, 100)
	fallback := make([]byte, 50)
	got := selectMaster(primary, fallback, 200)
	if &got[0] != &primary[0] {
		t.Error("expected the primary candidate to be kept when it already beats the original")
	}
}

func TestSelectMaster_FallsBackWhenPrimaryNotSmaller(t *testing.T) {
	primary := make([]byte, 200)  // == original, not smaller
	fallback := make([]byte, 150) // smaller than original
	got := selectMaster(primary, fallback, 200)
	if got == nil || &got[0] != &fallback[0] {
		t.Error("expected the fallback candidate to be kept when the primary doesn't beat the original")
	}
}

func TestSelectMaster_OmitsWhenNeitherCandidateBeatsOriginal(t *testing.T) {
	primary := make([]byte, 250)
	fallback := make([]byte, 210) // still >= original
	got := selectMaster(primary, fallback, 200)
	if got != nil {
		t.Errorf("expected nil (omit) when neither candidate is smaller than the original, got %d bytes", len(got))
	}
}

func TestSelectMaster_OmitsWhenPrimaryLargerAndNoFallbackAttempted(t *testing.T) {
	primary := make([]byte, 250)
	got := selectMaster(primary, nil, 200)
	if got != nil {
		t.Errorf("expected nil (omit) with no fallback and a larger primary, got %d bytes", len(got))
	}
}

func TestProcessProductImage_MasterOmittedWhenItWouldDuplicateDetailDimensions(t *testing.T) {
	// 900x700 is comfortably under detailWidth (1440): an unclamped master
	// would land at exactly the source's own dimensions, identical to the
	// already-generated "detail" variant — must be skipped, not generated
	// and discarded.
	jpg := buildPhotoLikeJPEG(t, 900, 700, 90)
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 20*time.Second, dir, "small.jpg", jpg)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}
	if master != nil {
		t.Errorf("expected no master bytes returned, got %d bytes", len(master))
	}
	if _, ok := variants["webp_master"]; ok {
		t.Error("expected no webp_master variant when source width <= detailWidth")
	}
	if len(variants) != len(ProductVariantSpecs) {
		t.Errorf("got %d variants, want exactly %d (thumbnail/card/detail, no master)", len(variants), len(ProductVariantSpecs))
	}
	// The detail variant must still be generated normally and match the
	// source's own dimensions (900 < 1440, so it isn't clamped further).
	d, ok := variants["detail"]
	if !ok || d.Width != 900 || d.Height != 700 {
		t.Errorf("detail variant = %+v, want 900x700", d)
	}
	// No stray "*master*" file must exist on disk.
	assertNoMasterFile(t, dir)
}

func TestProcessProductImage_TinyImage_NoUpscaleAndMasterOmitted(t *testing.T) {
	jpg := buildPhotoLikeJPEG(t, 100, 80, 90)
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 20*time.Second, dir, "tiny.jpg", jpg)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}
	if master != nil {
		t.Error("expected no master for a tiny source")
	}
	for _, spec := range ProductVariantSpecs {
		v, ok := variants[spec.Name]
		if !ok {
			t.Fatalf("missing variant %q", spec.Name)
		}
		if v.Width != 100 || v.Height != 80 {
			t.Errorf("variant %q = %dx%d, want 100x80 (never upscale a 100x80 source)", spec.Name, v.Width, v.Height)
		}
	}
	assertNoMasterFile(t, dir)
}

func TestProcessProductImage_LargeNoiseJPEG_MasterKeptAndSmallerThanOriginal(t *testing.T) {
	// large_photo_6000x4000.jpg is a 24MP, quality=97, high-entropy JPEG
	// (~12-20MB) — matches the Phase 1 benchmark fixture that produced a
	// master more than 3 orders of magnitude smaller than the original.
	jpg := fixture(t, "large_photo_6000x4000.jpg")
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 60*time.Second, dir, "large.jpg", jpg)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}
	v, ok := variants["webp_master"]
	if !ok || master == nil {
		t.Fatal("expected a master variant for a large, high-entropy JPEG")
	}
	if len(master) >= len(jpg) {
		t.Errorf("master (%d bytes) not smaller than original (%d bytes)", len(master), len(jpg))
	}
	if v.Bytes != len(master) {
		t.Errorf("variant metadata bytes = %d, want %d", v.Bytes, len(master))
	}
}

func TestProcessProductImage_ModerateJPEG_MasterKeptViaFallbackQuality(t *testing.T) {
	// Quality=80 at 1600x2000: the primary quality-90 master reliably comes
	// out larger than this original (empirically ~150%), but the
	// masterWebpFallbackQuality retry reliably beats it (~83%) — exercises
	// the fallback-succeeds branch specifically, distinct from both the
	// "primary already smaller" and "neither beats it" cases.
	jpg := buildPhotoLikeJPEG(t, 1600, 2000, 80)
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 30*time.Second, dir, "moderate.jpg", jpg)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}
	v, ok := variants["webp_master"]
	if !ok || master == nil {
		t.Fatal("expected the fallback-quality master to be kept")
	}
	if len(master) >= len(jpg) {
		t.Errorf("kept master (%d bytes) not smaller than original (%d bytes)", len(master), len(jpg))
	}
	if v.Bytes != len(master) {
		t.Errorf("variant metadata bytes = %d, want %d", v.Bytes, len(master))
	}
}

func TestProcessProductImage_LowQualityJPEG_MasterOmitted_NoOrphanFile(t *testing.T) {
	// Quality=40 at 1600x2000: already a small, heavily-compressed JPEG.
	// Empirically, both the primary (quality-90) and fallback
	// (masterWebpFallbackQuality) WebP re-encodes come out larger than this
	// original (~225% and ~110% respectively) — the real "never keep a
	// generated master that is larger than the original" case, exercised
	// end-to-end (not just the pure selectMaster unit tests above).
	jpg := buildPhotoLikeJPEG(t, 1600, 2000, 40)
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 30*time.Second, dir, "lowq.jpg", jpg)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}
	if master != nil {
		t.Errorf("expected master to be omitted (neither candidate beat the original), got %d bytes", len(master))
	}
	if _, ok := variants["webp_master"]; ok {
		t.Error("expected no webp_master key in variant metadata when omitted")
	}
	// The other three variants must still be present and correct —
	// omitting master must not affect the fixed variants at all.
	for _, spec := range ProductVariantSpecs {
		if _, ok := variants[spec.Name]; !ok {
			t.Errorf("missing variant %q after master omission", spec.Name)
		}
	}
	// Filesystem cleanup: omitting the master must never leave a partial or
	// full master file (or any stray temp file) on disk.
	assertNoMasterFile(t, dir)
}

func TestProcessProductImage_TransparentPNG_LargerThanDetailWidth_MasterInvariantHolds(t *testing.T) {
	// The shared "transparent.png" fixture is 1200x900 (under detailWidth,
	// so it would hit the duplicate-skip path) — build a wider one here
	// specifically to exercise the real generate-and-compare path for a
	// PNG/alpha source, matching the Phase 1 benchmark's PNG row (which
	// showed the master smaller than the original: 140.5KB -> 106.9KB).
	png := transparentPNGFixture(t, 1600, 1200)
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 30*time.Second, dir, "wide.png", png)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
	}

	// Regardless of which way this particular content falls, the
	// never-larger-than-original guarantee must hold: if a master is
	// present, it's smaller than the original and its file exists; if
	// absent, no file was written for it.
	v, ok := variants["webp_master"]
	if ok {
		if master == nil || len(master) >= len(png) {
			t.Errorf("kept master must be smaller than the %d-byte original, got %d bytes", len(png), len(master))
		}
		if v.Bytes != len(master) {
			t.Errorf("variant metadata bytes = %d, want %d", v.Bytes, len(master))
		}
		if _, statErr := os.Stat(filepath.Join(dir, v.StorageKey)); statErr != nil {
			t.Errorf("master variant file missing on disk: %v", statErr)
		}
	} else {
		if master != nil {
			t.Error("master bytes returned but no webp_master variant recorded")
		}
		assertNoMasterFile(t, dir)
	}
}

// transparentPNGFixture renders a PNG with an alpha channel at the given
// size — same construction as imagebench's transparentPNG fixture, just
// parameterized so tests can exceed detailWidth (the shared fixture is a
// fixed 1200x900).
func transparentPNGFixture(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			alpha := uint8((x * 255) / w)
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: alpha})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode transparent png: %v", err)
	}
	return buf.Bytes()
}

// assertNoMasterFile fails the test if any file whose name contains
// "master" (the pipeline's variant-name convention — see
// VariantStorageKey) exists in dir, including leftover ".tmp-*" files from
// a would-be write that should never have been attempted.
func assertNoMasterFile(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	for _, e := range entries {
		if bytes.Contains([]byte(e.Name()), []byte("master")) {
			t.Errorf("unexpected master-related file on disk: %s", e.Name())
		}
	}
}

func TestProcessPrivateProofPreview_NoResizeHighQuality(t *testing.T) {
	png := fixture(t, "transparent.png") // 1200x900
	dir := t.TempDir()

	variants, err := ProcessPrivateProofPreview(context.Background(), 20*time.Second, dir, "proof1.png", png)
	if err != nil {
		t.Fatalf("ProcessPrivateProofPreview: %v", err)
	}
	v, ok := variants["preview"]
	if !ok {
		t.Fatal("expected a \"preview\" variant")
	}
	if v.Width != 1200 || v.Height != 900 {
		t.Errorf("preview size = %dx%d, want the untouched 1200x900 (proofs are not resized)", v.Width, v.Height)
	}
	if _, err := os.Stat(filepath.Join(dir, v.StorageKey)); err != nil {
		t.Errorf("preview file not found on disk: %v", err)
	}
}

func TestProcessPrivateProofPreview_GeneratesSmallThumb(t *testing.T) {
	png := fixture(t, "transparent.png") // 1200x900
	dir := t.TempDir()

	variants, err := ProcessPrivateProofPreview(context.Background(), 20*time.Second, dir, "proof2.png", png)
	if err != nil {
		t.Fatalf("ProcessPrivateProofPreview: %v", err)
	}
	thumb, ok := variants["thumb"]
	if !ok {
		t.Fatal("expected a \"thumb\" variant")
	}
	if thumb.Width != proofThumbWidth {
		t.Errorf("thumb width = %d, want %d", thumb.Width, proofThumbWidth)
	}
	if thumb.Height != 240 { // 900 * (320/1200), aspect preserved
		t.Errorf("thumb height = %d, want 240 (aspect preserved)", thumb.Height)
	}
	if _, err := os.Stat(filepath.Join(dir, thumb.StorageKey)); err != nil {
		t.Errorf("thumb file not found on disk: %v", err)
	}
	if thumb.Bytes >= variants["preview"].Bytes {
		t.Errorf("thumb (%d bytes) should be smaller than preview (%d bytes)", thumb.Bytes, variants["preview"].Bytes)
	}
}

func TestProcessPrivateProofPreview_NeverUpscalesThumb(t *testing.T) {
	// A source narrower than proofThumbWidth must not be upscaled — the
	// thumb's width ceiling is the source's own (rotation-corrected) width,
	// same guarantee ProcessProductImage gives its fixed variants.
	tiny := buildPhotoLikeJPEG(t, 100, 80, 90)
	dir := t.TempDir()

	variants, err := ProcessPrivateProofPreview(context.Background(), 20*time.Second, dir, "proof3.jpg", tiny)
	if err != nil {
		t.Fatalf("ProcessPrivateProofPreview: %v", err)
	}
	thumb := variants["thumb"]
	if thumb.Width != 100 || thumb.Height != 80 {
		t.Errorf("thumb = %dx%d, want unmodified source size 100x80 (no upscale)", thumb.Width, thumb.Height)
	}
}

func TestWriteAtomic_NoTempFileLeftOnSuccess(t *testing.T) {
	dir := t.TempDir()
	if err := writeAtomic(dir, "final.bin", []byte("hello")); err != nil {
		t.Fatalf("writeAtomic: %v", err)
	}
	assertOnlyFinalFile(t, dir, "final.bin")
}

func TestWriteAtomic_NoTempFileLeftOnFailure(t *testing.T) {
	dir := t.TempDir()
	// A key pointing into a subdirectory that doesn't exist forces a
	// failure (whether at CreateTemp or the final Rename depends on
	// exactly how the path is joined) — either way, the deferred cleanup
	// in writeAtomic must leave no .tmp-* file behind.
	err := writeAtomic(dir, filepath.Join("nonexistent-subdir", "final.bin"), []byte("data"))
	if err == nil {
		t.Fatal("expected writeAtomic to fail when the rename target directory doesn't exist")
	}

	entries, rerr := os.ReadDir(dir)
	if rerr != nil {
		t.Fatalf("read dir: %v", rerr)
	}
	for _, e := range entries {
		if len(e.Name()) >= 5 && e.Name()[:5] == ".tmp-" {
			t.Errorf("leftover temp file after failed write: %s", e.Name())
		}
	}
}

func assertOnlyFinalFile(t *testing.T, dir, want string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	for _, e := range entries {
		if e.Name() != want {
			t.Errorf("unexpected leftover file %q in %s", e.Name(), dir)
		}
	}
}
