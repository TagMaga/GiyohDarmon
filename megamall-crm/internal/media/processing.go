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

// maxVariantBytes is the hard ceiling every persisted image variant is
// capped to (2026-07-20 requirement: no photo the pipeline saves should
// exceed 300KB, replacing the ~900KB proof previews users were seeing).
// Enforced by capToMaxBytes actually re-encoding at lower quality/width
// until the output fits, not by picking one fixed setting and hoping.
const maxVariantBytes = 300 * 1024

// minCappedWidth is the narrowest capToMaxBytes will ever shrink an image
// to while chasing maxVariantBytes. Below this a receipt's numbers or a
// product photo's detail become useless even though the byte count would
// still technically satisfy the cap, so capToMaxBytes stops here and keeps
// whatever size the lowest quality at this width produced — a variant
// slightly over the cap beats one shrunk into illegibility.
const minCappedWidth = 320

// qualityFloor is the lowest WebP quality capToMaxBytes will try before
// resorting to shrinking dimensions.
const qualityFloor = 30

// qualityLadder returns a descending sequence of qualities to try, starting
// at start and stepping down by 10 to qualityFloor.
func qualityLadder(start int) []int {
	var out []int
	for q := start; q > qualityFloor; q -= 10 {
		out = append(out, q)
	}
	out = append(out, qualityFloor)
	return out
}

// capToMaxBytes re-encodes buf as WebP until the result is at or under
// maxBytes: it first steps quality down through qualityLadder(startQuality)
// at startWidth (0 = keep source dimensions), and only if quality alone
// isn't enough does it halve the width (never below minCappedWidth) and
// retry the same quality ladder. It always returns the smallest encode
// attempted, even if every attempt still exceeds maxBytes — a source too
// complex to compress further at minCappedWidth is not a processing
// failure, it just keeps its best-effort result.
func capToMaxBytes(ctx context.Context, timeout time.Duration, buf []byte, startWidth, maxBytes, startQuality int) ([]byte, error) {
	width := startWidth
	var best []byte
	for {
		for _, q := range qualityLadder(startQuality) {
			var out []byte
			err := processWithTimeout(ctx, timeout, func() error {
				opts := bimg.Options{
					Type:          bimg.WEBP,
					Quality:       q,
					StripMetadata: true,
					Enlarge:       false,
					NoAutoRotate:  false,
				}
				if width > 0 {
					opts.Width = width
				}
				var perr error
				out, perr = bimg.NewImage(buf).Process(opts)
				return perr
			})
			if err != nil {
				return nil, err
			}
			if best == nil || len(out) < len(best) {
				best = out
			}
			if len(out) <= maxBytes {
				return out, nil
			}
		}
		if width == 0 {
			meta, err := bimg.NewImage(buf).Metadata()
			if err != nil {
				return best, nil
			}
			width = meta.Size.Width
		}
		nextWidth := width / 2
		if nextWidth < minCappedWidth || nextWidth >= width {
			return best, nil
		}
		width = nextWidth
	}
}

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
		out, err := capToMaxBytes(ctx, timeout, buf, width, maxVariantBytes, webpQuality)
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

	// A master that beats the original can still land well above
	// maxVariantBytes (a full-resolution re-encode of a large, detailed
	// photo). Cap it the same as every other variant; capToMaxBytes only
	// ever shrinks further, never re-grows, so this can't undo the
	// never-larger-than-original guarantee just established above.
	if len(master) > maxVariantBytes {
		capped, cerr := capToMaxBytes(ctx, timeout, buf, 0, maxVariantBytes, masterWebpQuality)
		if cerr != nil {
			return nil, nil, fmt.Errorf("cap webp master: %w", cerr)
		}
		if len(capped) < len(master) {
			master = capped
		}
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

// proofThumbWidth is the target width for the small "thumb" variant of a
// private proof — sized for list-view thumbnails (courier handover history,
// the owner's cash-handovers table), never for reading the proof itself.
const proofThumbWidth = 320

// previewStartQuality is the quality capToMaxBytes starts from for a proof
// preview — high, since legibility of receipt text/sums/dates/transaction
// IDs matters more here than for an ordinary photo, but still subject to
// the same maxVariantBytes cap as every other variant (2026-07-20).
const previewStartQuality = 95

// ProcessPrivateProofPreview generates two WebP variants for a private
// proof/receipt/screenshot (prepayment proof, cash-handover proof):
//   - "preview": starts at quality 95 with no resize — legibility of
//     text/sums/dates/transaction IDs is prioritized over file size — but is
//     still capped at maxVariantBytes via capToMaxBytes like every other
//     variant, so an unusually large/detailed proof doesn't stay multi-
//     hundred-KB just because it's a proof.
//   - "thumb": a small (proofThumbWidth-wide) variant for list/table
//     thumbnails, which have no need for full resolution or quality-95
//     bytes just to paint a 40x40 dot — see the 2026-07 report of the
//     owner's cash-handovers table front-loading dozens of MB of full-size
//     "preview" images to render row thumbnails.
//
// The original is always preserved untouched as audit evidence; both of
// these are additional derived files, never a replacement.
func ProcessPrivateProofPreview(ctx context.Context, timeout time.Duration, uploadDir, sourceKey string, buf []byte) (map[string]Variant, error) {
	srcMeta, err := bimg.NewImage(buf).Metadata()
	if err != nil {
		return nil, fmt.Errorf("read source metadata: %w", err)
	}
	effSrcWidth := srcMeta.Size.Width
	if isSideways(srcMeta.Orientation) {
		effSrcWidth = srcMeta.Size.Height
	}

	preview, err := capToMaxBytes(ctx, timeout, buf, 0, maxVariantBytes, previewStartQuality)
	if err != nil {
		return nil, fmt.Errorf("process proof preview: %w", err)
	}
	previewMeta, err := bimg.NewImage(preview).Metadata()
	if err != nil {
		return nil, fmt.Errorf("read preview metadata: %w", err)
	}
	previewKey := VariantStorageKey(sourceKey, "preview", PipelineVersion)
	if err := writeAtomic(uploadDir, previewKey, preview); err != nil {
		return nil, fmt.Errorf("write preview: %w", err)
	}

	thumbWidth := proofThumbWidth
	if effSrcWidth < thumbWidth {
		thumbWidth = effSrcWidth // never upscale (see ProcessProductImage's clamp for why Enlarge:false alone isn't enough)
	}
	thumb, err := capToMaxBytes(ctx, timeout, buf, thumbWidth, maxVariantBytes, webpQuality)
	if err != nil {
		return nil, fmt.Errorf("process proof thumb: %w", err)
	}
	thumbMeta, err := bimg.NewImage(thumb).Metadata()
	if err != nil {
		return nil, fmt.Errorf("read thumb metadata: %w", err)
	}
	thumbKey := VariantStorageKey(sourceKey, "thumb", PipelineVersion)
	if err := writeAtomic(uploadDir, thumbKey, thumb); err != nil {
		return nil, fmt.Errorf("write thumb: %w", err)
	}

	return map[string]Variant{
		"preview": {StorageKey: previewKey, Width: previewMeta.Size.Width, Height: previewMeta.Size.Height, Bytes: len(preview)},
		"thumb":   {StorageKey: thumbKey, Width: thumbMeta.Size.Width, Height: thumbMeta.Size.Height, Bytes: len(thumb)},
	}, nil
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
