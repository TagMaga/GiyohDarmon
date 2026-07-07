// Package uploads validates and classifies files accepted by POST /uploads.
//
// Validation is allowlist-based and driven entirely by magic-byte sniffing
// (net/http.DetectContentType) — never by the client-supplied filename or
// its extension, which is attacker-controlled. This is what stops an
// attacker from uploading a ".jpg" that is actually an HTML/SVG document:
// the previous implementation trusted the extension, which let a stored-XSS
// PoC (an .html file) get saved and served back with an HTML content type.
package uploads

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

// MaxFileSize caps upload size at 10 MiB — enough for photos and scanned
// documents while bounding per-request disk/memory use.
const MaxFileSize = 10 << 20

// sniffLen matches the read size http.DetectContentType itself expects.
const sniffLen = 512

type fileType struct {
	ext   string
	image bool
}

// allowed maps a sniffed, base (no-parameters) MIME type to the extension we
// persist the file under and whether it should be served inline (images) or
// as an attachment (everything else, currently just PDF). Any content that
// sniffs to a type not in this map is rejected — this is an allowlist, so
// html/svg/js/php/xml/txt/unknown binaries are rejected by construction,
// with no need to enumerate them.
var allowed = map[string]fileType{
	"image/jpeg":      {ext: ".jpg", image: true},
	"image/png":       {ext: ".png", image: true},
	"image/webp":      {ext: ".webp", image: true},
	"application/pdf": {ext: ".pdf", image: false},
}

// Validate sniffs the real content of an upload via magic bytes and enforces
// MaxFileSize. size must be the declared/actual size of the content behind r
// (e.g. multipart.FileHeader.Size). On success it returns the extension to
// persist the file under and the Content-Type to serve it back with; r is
// left seeked to the start.
func Validate(r io.ReadSeeker, size int64) (ext, contentType string, err error) {
	if size > MaxFileSize {
		return "", "", fmt.Errorf("file exceeds maximum size of %d bytes", MaxFileSize)
	}

	buf := make([]byte, sniffLen)
	n, err := io.ReadFull(r, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", "", fmt.Errorf("read file: %w", err)
	}
	if _, serr := r.Seek(0, io.SeekStart); serr != nil {
		return "", "", fmt.Errorf("seek file: %w", serr)
	}

	base := baseContentType(http.DetectContentType(buf[:n]))
	t, ok := allowed[base]
	if !ok {
		return "", "", fmt.Errorf("unsupported file type: %s", base)
	}
	return t.ext, base, nil
}

// SniffAllowed re-derives the Content-Type for a file already on disk by
// sniffing its actual bytes (never trusting its filename/extension) and
// reports whether that type is servable. Used when serving uploads, so a
// file placed on disk before this validation existed (or by any other means)
// can never be served as anything other than one of the allowed types.
func SniffAllowed(r io.ReadSeeker) (contentType string, ok bool) {
	buf := make([]byte, sniffLen)
	n, err := io.ReadFull(r, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", false
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return "", false
	}
	base := baseContentType(http.DetectContentType(buf[:n]))
	_, ok = allowed[base]
	return base, ok
}

// IsImage reports whether contentType (as returned by Validate/SniffAllowed)
// should be served inline. Non-images are served as attachments so a
// browser never renders them as a page.
func IsImage(contentType string) bool {
	return allowed[contentType].image
}

func baseContentType(sniffed string) string {
	if i := strings.IndexByte(sniffed, ';'); i >= 0 {
		return strings.TrimSpace(sniffed[:i])
	}
	return sniffed
}
