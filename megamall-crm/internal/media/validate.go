package media

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"

	"github.com/megamall/crm/config"
	_ "golang.org/x/image/webp" // registers WebP with image.DecodeConfig — header-only, pure Go, no libvips call before validation passes
)

// ValidationError is a rejection the caller should show to the user
// (translated to Russian at the handler layer — see handler.go). It is
// always safe to return its Message to an authenticated client; it never
// contains file content or internal paths.
type ValidationError struct {
	Code    string
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

func rejectf(code, format string, args ...any) *ValidationError {
	return &ValidationError{Code: code, Message: fmt.Sprintf(format, args...)}
}

// sniffedType maps a base (no-parameters) MIME type, as returned by
// http.DetectContentType, to the fixed extension we ever persist a file
// under and whether it is an image (subject to the libvips pipeline) or a
// document (PDF — preserved as-is, never rasterized, per the private
// documents requirement).
var sniffedType = map[string]struct {
	ext   string
	image bool
}{
	"image/jpeg":      {".jpg", true},
	"image/png":       {".png", true},
	"image/webp":      {".webp", true},
	"application/pdf": {".pdf", false},
}

// ValidatedFile is everything the rest of the pipeline needs after a file
// has passed every check below.
type ValidatedFile struct {
	Bytes       []byte
	Ext         string
	ContentType string
	IsImage     bool
	Width       int // 0 for non-images
	Height      int
	ChecksumHex string
}

// Validate runs the full server-side validation chain required before any
// upload is accepted, in the order that matters for cost (cheapest/safest
// checks first, so a malicious or oversized file is rejected before any
// expensive work happens):
//
//  1. declared size vs. the category's configured limit
//  2. actual bytes read vs. declared size (catches truncated uploads —
//     see the libvips benchmark finding that a truncated-but-otherwise-
//     valid JPEG does not reliably error out of the decoder)
//  3. magic-byte signature sniff, allowlist-checked (never the client's
//     filename/extension/Content-Type header)
//  4. explicit reject of SVG and executable signatures, even though the
//     allowlist above already implies this by omission — defense in depth
//     so a future allowlist addition can't silently reopen this
//  5. for images: decode *only the header* (image.DecodeConfig) to get
//     real dimensions, reject animated GIF, enforce the pixel-count and
//     per-side caps — all before any full pixel decode is attempted
//
// declaredSize must be the multipart.FileHeader.Size (or equivalent) the
// client claimed; r must be exactly that many bytes.
func Validate(cfg config.MediaConfig, category Category, r io.Reader, declaredSize int64) (*ValidatedFile, *ValidationError) {
	limit := cfg.MaxImageBytes
	if category == CategoryUserDocument {
		limit = cfg.MaxDocumentBytes
	}
	if declaredSize > limit {
		return nil, rejectf("FILE_TOO_LARGE", "file exceeds the %d-byte limit for this category", limit)
	}
	if declaredSize > cfg.MaxUploadBytes {
		return nil, rejectf("FILE_TOO_LARGE", "file exceeds the global %d-byte upload limit", cfg.MaxUploadBytes)
	}

	// Read at most limit+1 bytes so an attacker who lies about
	// declaredSize (multipart headers are client-supplied) can't force an
	// unbounded read; the +1 is just so we can distinguish "exactly at the
	// limit" from "over" without reading the whole oversized body.
	buf, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, rejectf("READ_FAILED", "could not read upload")
	}
	if int64(len(buf)) > limit {
		return nil, rejectf("FILE_TOO_LARGE", "file exceeds the %d-byte limit for this category", limit)
	}
	if int64(len(buf)) != declaredSize {
		// Catches a client/network truncation: the multipart header
		// promised N bytes, we got a different amount. This is the
		// mitigation for the benchmark's "truncated JPEG doesn't always
		// error out of the decoder" finding — the check happens here, at
		// the HTTP layer, not by trusting the image decoder to notice.
		return nil, rejectf("SIZE_MISMATCH", "upload was truncated or size did not match")
	}
	if len(buf) == 0 {
		return nil, rejectf("EMPTY_FILE", "file is empty")
	}

	sniffed := baseContentType(http.DetectContentType(buf))
	if looksLikeSVG(buf) {
		return nil, rejectf("UNSUPPORTED_TYPE", "SVG is not an accepted file type")
	}
	if looksLikeExecutable(buf) {
		return nil, rejectf("UNSUPPORTED_TYPE", "executable content is not an accepted file type")
	}
	t, ok := sniffedType[sniffed]
	if !ok {
		return nil, rejectf("UNSUPPORTED_TYPE", "unsupported file type: %s", sniffed)
	}

	out := &ValidatedFile{Bytes: buf, Ext: t.ext, ContentType: sniffed, IsImage: t.image}

	if t.image {
		cfgImg, format, err := image.DecodeConfig(bytes.NewReader(buf))
		if err != nil {
			return nil, rejectf("CORRUPT_IMAGE", "could not read image header: %v", err)
		}
		if format == "gif" && isAnimatedGIF(buf) {
			return nil, rejectf("UNSUPPORTED_TYPE", "animated GIF is not supported")
		}
		if cfgImg.Width <= 0 || cfgImg.Height <= 0 {
			return nil, rejectf("CORRUPT_IMAGE", "invalid image dimensions")
		}
		if cfgImg.Width > cfg.MaxDimension || cfgImg.Height > cfg.MaxDimension {
			return nil, rejectf("IMAGE_TOO_LARGE", "image dimension exceeds %dpx limit", cfg.MaxDimension)
		}
		px := int64(cfgImg.Width) * int64(cfgImg.Height)
		if px > cfg.MaxPixels {
			return nil, rejectf("IMAGE_TOO_LARGE", "image has %d pixels, exceeding the %d limit", px, cfg.MaxPixels)
		}
		out.Width, out.Height = cfgImg.Width, cfgImg.Height
	}

	sum := sha256.Sum256(buf)
	out.ChecksumHex = hex.EncodeToString(sum[:])

	return out, nil
}

func baseContentType(sniffed string) string {
	if i := strings.IndexByte(sniffed, ';'); i >= 0 {
		return strings.TrimSpace(sniffed[:i])
	}
	return sniffed
}

// looksLikeSVG checks for XML/SVG signatures net/http's sniffer does not
// reliably classify as a rejected type on its own (it may report SVG as
// "text/xml; charset=utf-8" or "text/plain", neither of which is in our
// allowlist — but we check explicitly anyway so this rejection reason is
// unambiguous in logs, and so it stays rejected even if a future allowlist
// change adds a generic "text/*" or "xml" entry by mistake).
func looksLikeSVG(buf []byte) bool {
	head := buf
	if len(head) > 512 {
		head = head[:512]
	}
	lower := strings.ToLower(string(head))
	return strings.Contains(lower, "<svg") ||
		(strings.Contains(lower, "<?xml") && strings.Contains(lower, "svg"))
}

// looksLikeExecutable checks the handful of magic bytes that matter here:
// ELF (Linux), MZ (Windows PE), and Mach-O (macOS, both endian/bit-width
// magics). Belt-and-suspenders alongside the allowlist above.
func looksLikeExecutable(buf []byte) bool {
	sigs := [][]byte{
		{0x7f, 'E', 'L', 'F'},
		{'M', 'Z'},
		{0xfe, 0xed, 0xfa, 0xce}, {0xfe, 0xed, 0xfa, 0xcf}, // Mach-O 32/64 BE
		{0xce, 0xfa, 0xed, 0xfe}, {0xcf, 0xfa, 0xed, 0xfe}, // Mach-O 32/64 LE
	}
	for _, sig := range sigs {
		if bytes.HasPrefix(buf, sig) {
			return true
		}
	}
	return false
}

// isAnimatedGIF reports whether a GIF has more than one image frame. GIF is
// not in sniffedType today (so this is currently unreachable via Validate,
// which already rejects "image/gif" as unsupported at the allowlist step)
// — kept ready for the day a static-GIF allowlist entry is added, so
// animated GIF stays blocked even then, per the explicit requirement.
func isAnimatedGIF(buf []byte) bool {
	frames := 0
	pos := 0
	for pos+1 < len(buf) {
		idx := bytes.IndexByte(buf[pos:], 0x2C) // Image Descriptor separator
		if idx < 0 {
			break
		}
		frames++
		if frames > 1 {
			return true
		}
		pos += idx + 1
	}
	return false
}

// ErrUnknownCategory is returned by (*Service).Create when the caller did
// not supply one of the fixed, recognized categories — uploads without an
// explicit recognized category are rejected outright, never defaulted.
var ErrUnknownCategory = errors.New("unknown or missing media category")
