package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
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
	// Orientation 6 = rotate 90 CW: a physically-landscape (400x200) source
	// tagged this way should render portrait (200x400) once vips applies
	// the rotation — an observable, behavioral proof that auto-rotation
	// really happened, not just that the tag was read.
	buf := buildExifJPEG(t, 400, 200, 6)
	dir := t.TempDir()

	variants, master, err := ProcessProductImage(context.Background(), 20*time.Second, dir, "src.jpg", buf)
	if err != nil {
		t.Fatalf("ProcessProductImage: %v", err)
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
	if masterMeta.Size.Width != 200 || masterMeta.Size.Height != 400 {
		t.Errorf("master size = %dx%d, want 200x400 (source auto-rotated per EXIF orientation 6)", masterMeta.Size.Width, masterMeta.Size.Height)
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

func TestProcessPrivateProofPreview_NoResizeHighQuality(t *testing.T) {
	png := fixture(t, "transparent.png") // 1200x900
	dir := t.TempDir()

	v, err := ProcessPrivateProofPreview(context.Background(), 20*time.Second, dir, "proof1.png", png)
	if err != nil {
		t.Fatalf("ProcessPrivateProofPreview: %v", err)
	}
	if v.Width != 1200 || v.Height != 900 {
		t.Errorf("preview size = %dx%d, want the untouched 1200x900 (proofs are not resized)", v.Width, v.Height)
	}
	if _, err := os.Stat(filepath.Join(dir, v.StorageKey)); err != nil {
		t.Errorf("preview file not found on disk: %v", err)
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
