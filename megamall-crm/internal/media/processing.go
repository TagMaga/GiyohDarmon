package media

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/h2non/bimg"
)

// PipelineVersion is embedded in every derived variant's filename (see
// VariantStorageKey). Bumping it invalidates old variant filenames without
// touching the originals, so a future change to resize/quality settings
// can roll out without needing a destructive rewrite of existing files.
const PipelineVersion = "v1"

// Named widths for the fixed product-image variants — pulled out of
// ProductVariantSpecs so detailWidth can also gate whether a "master"
// variant is worth generating at all (see the master-generation comment in
// ProcessProductImage).
const (
	thumbnailWidth = 320
	cardWidth      = 768
	detailWidth    = 1440
)

// ProductVariantSpecs are the fixed sizes generated for every public
// product image. Widths are targets; aspect ratio is always preserved and
// a source narrower than a given width is never upscaled — its own
// (rotation-corrected) width becomes the ceiling for that variant. See the
// width-clamping comment in ProcessProductImage for why this is done
// explicitly rather than relying on bimg's Enlarge option.
var ProductVariantSpecs = []struct {
	Name  string
	Width int
}{
	{"thumbnail", thumbnailWidth},
	{"card", cardWidth},
	{"detail", detailWidth},
}

const webpQuality = 82
const masterWebpQuality = 90

// masterWebpFallbackQuality is tried once, only if masterWebpQuality
// produced a file no smaller than the original — a single controlled step
// down, not a blanket quality reduction (most images never reach this
// path; see the size-vs-original comparison in ProcessProductImage).
const masterWebpFallbackQuality = 75

// isSideways reports whether an EXIF orientation value implies a 90/270
// degree rotation, which swaps the visual width and height relative to the
// raw stored pixel grid that bimg.Metadata's Size reports. Values 5-8 are
// the transpose/rotate-90 family in the EXIF spec.
func isSideways(orientation int) bool {
	return orientation >= 5 && orientation <= 8
}

// processTimeout bounds a single image's total processing wall time so one
// pathological (but validation-passing) input can't tie up a worker
// indefinitely. Enforced via context cancellation checked between variant
// steps — bimg's C calls themselves are not context-aware, so this is a
// best-effort deadline between steps, not a hard preemption mid-C-call.
func processWithTimeout(ctx context.Context, timeout time.Duration, fn func() error) error {
	done := make(chan error, 1)
	go func() { done <- fn() }()
	select {
	case err := <-done:
		return err
	case <-time.After(timeout):
		return fmt.Errorf("processing exceeded %s timeout", timeout)
	case <-ctx.Done():
		return ctx.Err()
	}
}

// ProcessProductImage generates the fixed thumbnail/card/detail variants,
// plus a full-resolution WebP "master" *when it's actually worth keeping*
// (see the size-aware guards below — a master that would just duplicate the
// detail variant's dimensions, or that never beats the original's size, is
// never persisted), for a public product photo, writing each atomically
// (write-to-temp-then-rename, so a reader never observes a partially-
// written file) under uploadDir. Returns the variant metadata to persist on
// the Asset row and to return to the frontend; the returned []byte is the
// kept master's bytes, or nil if no master was generated/kept.
func ProcessProductImage(ctx context.Context, timeout time.Duration, uploadDir, sourceKey string, buf []byte) (map[string]Variant, []byte, error) {
	variants := make(map[string]Variant, len(ProductVariantSpecs)+1)

	// bimg.Options.Enlarge only refuses to upscale when *both* Width and
	// Height are set and the source is smaller than both (see bimg's
	// resizer.go: "if inWidth < o.Width && inHeight < o.Height") — with
	// only Width set (Height left at its zero value), that condition can
	// never be true, so Enlarge:false silently does nothing for a
	// width-only resize and bimg happily upscales past the source. To get
	// a real "never upscale" guarantee we clamp the requested width to the
	// source's own (rotation-corrected) width ourselves before calling
	// Process. Caught by TestProcessProductImage_VariantDimensionsPreserve
	// AspectAndNeverUpscale, which failed with a 1440px "detail" variant
	// from a 1200px source before this clamp was added.
	srcMeta, err := bimg.NewImage(buf).Metadata()
	if err != nil {
		return nil, nil, fmt.Errorf("read source metadata: %w", err)
	}
	effSrcWidth := srcMeta.Size.Width
	if isSideways(srcMeta.Orientation) {
		effSrcWidth = srcMeta.Size.Height
	}

	// A fresh bimg.NewImage(buf) is constructed for every Process() call
	// below, deliberately never reused across iterations: bimg.Image.
	// Process mutates its own internal buffer to the *output* of each call
	// (see (*Image).Process in bimg's source), so a shared Image would
	// chain each variant off the previous variant's already-resized output
	// instead of the original — caught by the same test above, where a
	// reused Image produced a "master" sized off the last loop iteration's
	// 1440px-wide "detail" variant.
	for _, spec := range ProductVariantSpecs {
		width := spec.Width
		if effSrcWidth < width {
			width = effSrcWidth
		}
		var out []byte
		err := processWithTimeout(ctx, timeout, func() error {
			var perr error
			out, perr = bimg.NewImage(buf).Process(bimg.Options{
				Width:         width,
				Type:          bimg.WEBP,
				Quality:       webpQuality,
				StripMetadata: true,
				Enlarge:       false,
				NoAutoRotate:  false,
			})
			return perr
		})
		if err != nil {
			return nil, nil, fmt.Errorf("process %s variant: %w", spec.Name, err)
		}
		vMeta, verr := bimg.NewImage(out).Metadata()
		if verr != nil {
			return nil, nil, fmt.Errorf("read %s variant metadata: %w", spec.Name, verr)
		}
		key := VariantStorageKey(sourceKey, spec.Name, PipelineVersion)
		if err := writeAtomic(uploadDir, key, out); err != nil {
			return nil, nil, fmt.Errorf("write %s variant: %w", spec.Name, err)
		}
		variants[spec.Name] = Variant{StorageKey: key, Width: vMeta.Size.Width, Height: vMeta.Size.Height, Bytes: len(out)}
	}

	// The "master" variant is a full-resolution WebP re-encode — its only
	// reason to exist is to be a smaller-than-original, format-normalized
	// stand-in for the original file. Two size-aware guards keep that
	// promise instead of assuming it:
	//
	//  1. Duplicate-of-detail skip: when the source is no wider than
	//     detailWidth, an unclamped master would land at *exactly* the same
	//     pixel dimensions as the "detail" variant already generated above
	//     — a second full-size file that adds nothing but disk space and
	//     processing time. Skipped entirely (no encode attempted) rather
	//     than generated and discarded, since most product photos are
	//     already ≤1440px wide and this is the common case, not an edge
	//     case. The original file (preserved via WriteOriginal, exposed as
	//     MediaAssetInfo.OriginalURL) remains the full-resolution reference.
	//  2. Never-larger-than-original guard: for sources wider than
	//     detailWidth, master genuinely differs from every fixed variant, so
	//     it's worth attempting — but a real-world photo already saved at a
	//     moderate JPEG quality can re-encode *larger* as WebP at a high,
	//     fixed quality (observed in production: a 900x1600, 181,707-byte
	//     JPEG produced a 197,316-byte WebP master — see the 2026-07-17
	//     canary report). One fallback attempt at a lower quality is tried;
	//     if that still isn't smaller than the original, no master is
	//     persisted at all rather than keeping a file that made things
	//     worse. This is a size comparison against the real original, not a
	//     blanket quality cut — the vast majority of images never take the
	//     fallback path, let alone the omit path (see BENCHMARK_RESULTS and
	//     the master-vs-original test coverage in processing_test.go).
	if effSrcWidth <= detailWidth {
		return variants, nil, nil
	}

	genMaster := func(quality int) ([]byte, error) {
		var out []byte
		err := processWithTimeout(ctx, timeout, func() error {
			var perr error
			out, perr = bimg.NewImage(buf).Process(bimg.Options{
				Type:          bimg.WEBP,
				Quality:       quality,
				StripMetadata: true,
				NoAutoRotate:  false,
			})
			return perr
		})
		return out, err
	}

	master, err := genMaster(masterWebpQuality)
	if err != nil {
		return nil, nil, fmt.Errorf("process webp master: %w", err)
	}
	if len(master) >= len(buf) {
		fallback, ferr := genMaster(masterWebpFallbackQuality)
		if ferr != nil {
			return nil, nil, fmt.Errorf("process webp master fallback: %w", ferr)
		}
		master = selectMaster(master, fallback, len(buf))
	}
	if master == nil {
		// Neither the primary nor the fallback attempt beat the original's
		// size — no master file is written, nothing is added to variants.
		// The original itself, already durably written by WriteOriginal
		// before processing began, remains the full-resolution reference.
		return variants, nil, nil
	}

	masterMeta, merr := bimg.NewImage(master).Metadata()
	if merr != nil {
		return nil, nil, fmt.Errorf("read master metadata: %w", merr)
	}
	masterKey := VariantStorageKey(sourceKey, "master", PipelineVersion)
	if err := writeAtomic(uploadDir, masterKey, master); err != nil {
		return nil, nil, fmt.Errorf("write webp master: %w", err)
	}
	// masterMeta's dimensions (not the source's pre-rotation metadata) are
	// used here since EXIF auto-rotation can swap width/height, and the
	// stored variant metadata must describe the bytes actually on disk.
	variants["webp_master"] = Variant{StorageKey: masterKey, Width: masterMeta.Size.Width, Height: masterMeta.Size.Height, Bytes: len(master)}

	return variants, master, nil
}

// selectMaster picks which candidate WebP master (if any) is worth keeping:
// the primary (quality-90) attempt if it already beats the original's size,
// else the fallback (lower-quality) attempt if *it* beats the original,
// else nil — meaning no master should be persisted at all. Pulled out as a
// pure function (no I/O, no image processing) so the size-decision policy
// itself is directly unit-testable without depending on real codec output.
func selectMaster(primary, fallback []byte, originalLen int) []byte {
	if len(primary) < originalLen {
		return primary
	}
	if fallback != nil && len(fallback) < originalLen {
		return fallback
	}
	return nil
}

// ProcessPrivateProofPreview generates a single high-quality WebP preview
// for a private proof/receipt/screenshot (prepayment proof, cash-handover
// proof) — deliberately *not* aggressively compressed, so text/sums/dates/
// transaction IDs stay legible, per the requirement. The original is
// always preserved untouched as audit evidence; this preview is an
// additional derived file, never a replacement.
func ProcessPrivateProofPreview(ctx context.Context, timeout time.Duration, uploadDir, sourceKey string, buf []byte) (Variant, error) {
	img := bimg.NewImage(buf)
	var out []byte
	err := processWithTimeout(ctx, timeout, func() error {
		var perr error
		out, perr = img.Process(bimg.Options{
			// No resize — proofs are usually already screen/phone
			// resolution; downsizing risks making numbers illegible.
			Type:          bimg.WEBP,
			Quality:       95, // high quality: legibility over file size
			StripMetadata: true,
			NoAutoRotate:  false,
		})
		return perr
	})
	if err != nil {
		return Variant{}, fmt.Errorf("process proof preview: %w", err)
	}
	meta, err := bimg.NewImage(out).Metadata()
	if err != nil {
		return Variant{}, fmt.Errorf("read preview metadata: %w", err)
	}
	key := VariantStorageKey(sourceKey, "preview", PipelineVersion)
	if err := writeAtomic(uploadDir, key, out); err != nil {
		return Variant{}, fmt.Errorf("write preview: %w", err)
	}
	return Variant{StorageKey: key, Width: meta.Size.Width, Height: meta.Size.Height, Bytes: len(out)}, nil
}

// writeAtomic writes data to <dir>/<key> via a temp file in the same
// directory followed by rename(2), which is atomic on the same filesystem
// — a concurrent reader either sees the old state (nothing, for a new key)
// or the fully-written new file, never a partial write. The temp file is
// always removed on any failure path (including a panic recovery), per
// the "clean temporary files after every failure" requirement.
func writeAtomic(dir, key string, data []byte) (err error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("ensure upload dir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".tmp-"+key+"-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync temp file: %w", err)
	}
	if err = tmp.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}
	if err = os.Rename(tmpName, filepath.Join(dir, key)); err != nil {
		return fmt.Errorf("rename into place: %w", err)
	}
	return nil
}

// WriteOriginal atomically persists the validated original upload under
// its server-generated storage key, before any processing is attempted —
// so a processing failure never leaves the original unrecoverable (the
// "preserve the original temporarily for rollback" / "preserve original as
// audit evidence" requirements).
func WriteOriginal(dir, key string, data []byte) error {
	return writeAtomic(dir, key, data)
}
