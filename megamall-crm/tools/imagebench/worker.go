package imagebench

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/h2non/bimg"
)

// MaxPixels is the same decompression-bomb / resource-exhaustion guard the
// real validation pipeline will use (internal/uploads, added alongside
// this benchmark). Kept in one place so the benchmark and the production
// code can never silently drift apart on the number.
const MaxPixels = 40_000_000 // 40 megapixels

// WorkerResult is the JSON contract between the orchestrator process and a
// single worker subprocess (one subprocess per fixture, so peak-RSS
// measurement via wait4()/Rusage reflects exactly that one job).
type WorkerResult struct {
	Fixture      string `json:"fixture"`
	InputBytes   int    `json:"input_bytes"`
	PreCheckOK   bool   `json:"pre_check_ok"`
	RejectReason string `json:"reject_reason,omitempty"`
	DeclaredW    int    `json:"declared_w,omitempty"`
	DeclaredH    int    `json:"declared_h,omitempty"`
	DeclaredPx   int64  `json:"declared_px,omitempty"`
	Processed    bool   `json:"processed"`
	ThumbBytes   int    `json:"thumb_bytes,omitempty"`
	CardBytes    int    `json:"card_bytes,omitempty"`
	DetailBytes  int    `json:"detail_bytes,omitempty"`
	MasterWebP   int    `json:"master_webp_bytes,omitempty"`
	ProcessError string `json:"process_error,omitempty"`
}

// PreCheck runs the cheap, stdlib-only, header-only dimension check that
// must gate every image before it is ever handed to libvips/bimg. This is
// the actual decompression-bomb defense: image.DecodeConfig reads only the
// format header (a few dozen bytes), never allocates a pixel buffer, so it
// is safe to run on completely untrusted input.
func PreCheck(buf []byte) (w, h int, ok bool, reason string) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(buf))
	if err != nil {
		return 0, 0, false, fmt.Sprintf("undecodable header: %v", err)
	}
	px := int64(cfg.Width) * int64(cfg.Height)
	if px > MaxPixels {
		return cfg.Width, cfg.Height, false, fmt.Sprintf("pixel count %d exceeds cap %d", px, MaxPixels)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return cfg.Width, cfg.Height, false, "non-positive dimensions"
	}
	return cfg.Width, cfg.Height, true, ""
}

// ProcessVariants runs the same operation set the real product-image
// pipeline will perform: thumbnail/card/detail resizes plus a full-size
// WebP master, all metadata-stripped, none upscaled beyond the source.
func ProcessVariants(buf []byte) (thumb, card, detail, master []byte, err error) {
	img := bimg.NewImage(buf)

	variant := func(width int) ([]byte, error) {
		return img.Process(bimg.Options{
			Width:         width,
			Type:          bimg.WEBP,
			Quality:       82,
			StripMetadata: true,
			Enlarge:       false, // never upscale smaller sources
			NoAutoRotate:  false, // correct EXIF orientation, then strip it
		})
	}

	thumb, err = variant(320)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("thumbnail: %w", err)
	}
	card, err = variant(768)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("card: %w", err)
	}
	detail, err = variant(1440)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("detail: %w", err)
	}
	master, err = img.Process(bimg.Options{
		Type:          bimg.WEBP,
		Quality:       90,
		StripMetadata: true,
		NoAutoRotate:  false,
	})
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("master webp: %w", err)
	}
	return thumb, card, detail, master, nil
}

// RunOne is the worker-subprocess entry point: process a single fixture
// (read from stdin as raw bytes, name given as argv), print a WorkerResult
// as JSON on stdout. Never panics on bad input — every failure mode is
// reported, not crashed, matching the "reject corrupt files cleanly"
// requirement.
func RunOne(name string, buf []byte) WorkerResult {
	res := WorkerResult{Fixture: name, InputBytes: len(buf)}

	w, h, ok, reason := PreCheck(buf)
	res.DeclaredW, res.DeclaredH = w, h
	res.DeclaredPx = int64(w) * int64(h)
	res.PreCheckOK = ok
	if !ok {
		res.RejectReason = reason
		return res
	}

	thumb, card, detail, master, err := ProcessVariants(buf)
	if err != nil {
		res.ProcessError = err.Error()
		return res
	}
	res.Processed = true
	res.ThumbBytes = len(thumb)
	res.CardBytes = len(card)
	res.DetailBytes = len(detail)
	res.MasterWebP = len(master)
	return res
}

// EncodeResult is a small helper so main.go doesn't need to import encoding/json.
func EncodeResult(r WorkerResult) ([]byte, error) {
	return json.Marshal(r)
}
