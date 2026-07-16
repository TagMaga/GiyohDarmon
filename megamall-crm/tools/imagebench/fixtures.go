// Package imagebench generates synthetic test images (no real photos, no
// network fetches) and benchmarks the libvips/bimg pipeline against them.
// This is a development-time tool, not shipped as part of the running
// application — it exists to answer "is libvips safe on this host" before
// any production code is written against it.
package imagebench

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math/rand"
)

// Fixture is one synthetic test file plus what it's meant to exercise.
type Fixture struct {
	Name        string
	Description string
	Bytes       []byte
}

// GenerateAll builds every fixture needed for the benchmark and for the
// later validation test suite. Deterministic (fixed RNG seed) so repeated
// runs are comparable.
func GenerateAll() ([]Fixture, error) {
	var out []Fixture

	// 1. Large "real photo" JPEG, 6000x4000 (24MP), high-frequency noise
	// content so JPEG compression can't shrink it much — used to reach a
	// realistic large-upload size (12-20MB) deliberately, not by accident.
	bigJPEG, err := noiseJPEG(6000, 4000, 97)
	if err != nil {
		return nil, err
	}
	out = append(out, Fixture{
		Name:        "large_photo_6000x4000.jpg",
		Description: "JPEG, 6000x4000 (24MP), high-entropy content, quality=97 — targets 12-20MB",
		Bytes:       bigJPEG,
	})

	// 2. PNG with transparency (alpha channel), moderate size.
	transPNG, err := transparentPNG(1200, 900)
	if err != nil {
		return nil, err
	}
	out = append(out, Fixture{
		Name:        "transparent.png",
		Description: "PNG, 1200x900, RGBA with partial transparency",
		Bytes:       transPNG,
	})

	// 3. High-pixel image just under the configured 40MP cap (should pass
	// the dimension pre-check): 7500x5300 = 39.75MP.
	nearLimitJPEG, err := noiseJPEG(7500, 5300, 85)
	if err != nil {
		return nil, err
	}
	out = append(out, Fixture{
		Name:        "near_limit_7500x5300.jpg",
		Description: "JPEG, 7500x5300 (39.75MP) — just under the 40MP cap, must be accepted",
		Bytes:       nearLimitJPEG,
	})

	// 4. Over the pixel cap: a *header-only* PNG claiming 9000x7000 (63MP)
	// — built via raw IHDR construction (see fakeLargePNG) rather than a
	// real full-resolution encode, so generating this fixture itself stays
	// cheap. This is legitimately decodable (real IDAT, real pixels) but
	// exceeds the pixel-count cap, so it must be rejected by the dimension
	// pre-check before any full decode is attempted.
	overLimitPNG, err := smallButOversizedDimsPNG(9000, 7000)
	if err != nil {
		return nil, err
	}
	out = append(out, Fixture{
		Name:        "over_limit_9000x7000.png",
		Description: "PNG header-declares 9000x7000 (63MP), real but trivial pixel data — must be rejected by dimension pre-check",
		Bytes:       overLimitPNG,
	})

	// 5. Invalid/disguised file: an ELF-like binary blob saved with a .jpg
	// name (the caller supplies the name; here we just produce content that
	// will fail magic-byte sniffing).
	out = append(out, Fixture{
		Name:        "disguised_executable.jpg",
		Description: "Not an image at all (fake ELF-ish header + shellcode-shaped noise), named .jpg",
		Bytes:       disguisedExecutable(),
	})

	// 6. Decompression-bomb-style dimensions: a hand-built PNG with a valid
	// IHDR declaring an enormous 50000x50000 canvas but a truncated/garbage
	// IDAT — a handful of bytes on disk. image.DecodeConfig must report the
	// declared dimensions (so we can reject them) without ever attempting a
	// full pixel decode (which would try to allocate ~10GB and OOM the
	// process if attempted).
	bombPNG := decompressionBombPNG(50000, 50000)
	out = append(out, Fixture{
		Name:        "decompression_bomb_50000x50000.png",
		Description: "PNG IHDR declares 50000x50000 (2.5 billion px), ~100 bytes on disk, IDAT is garbage — must be caught by header-only pre-check",
		Bytes:       bombPNG,
	})

	// 7. Corrupt/truncated real JPEG — a legitimate small JPEG with its tail
	// cut off mid-scan.
	smallJPEG, err := noiseJPEG(800, 600, 80)
	if err != nil {
		return nil, err
	}
	truncated := smallJPEG[:len(smallJPEG)*2/3]
	out = append(out, Fixture{
		Name:        "truncated.jpg",
		Description: "Valid JPEG header, truncated at 2/3 of the file — must fail decode cleanly, not crash/hang",
		Bytes:       truncated,
	})

	return out, nil
}

// noiseJPEG renders a pseudo-random-noise image (defeats JPEG's DCT
// compression, so file size stays close to worst-case for the given
// dimensions) and encodes it as JPEG at the given quality.
func noiseJPEG(w, h, quality int) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(42))
	// Fill in horizontal bands to keep generation fast (avoid a full
	// per-pixel rand call on 24MP+ images): each row gets its own seed
	// derived from a small buffer, tiled.
	row := make([]byte, w*4)
	for y := 0; y < h; y++ {
		rng.Read(row)
		for x := 0; x < w; x++ {
			i := x * 4
			img.Set(x, y, color.RGBA{row[i], row[i+1], row[i+2], 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func transparentPNG(w, h int) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			alpha := uint8((x * 255) / w)
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, alpha})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// smallButOversizedDimsPNG renders a real, fully-decodable PNG at reduced
// actual resolution content-wise is not what we want here — we want a real
// legitimate image whose *declared* dimensions exceed the cap. Simplest
// correct approach: actually render at the full requested size but with a
// cheap-to-compress flat fill, so the real encode stays fast/small while
// still being a fully valid, fully decodable file at that pixel count.
func smallButOversizedDimsPNG(w, h int) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	flat := color.RGBA{200, 50, 50, 255}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, flat)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func disguisedExecutable() []byte {
	buf := make([]byte, 4096)
	// ELF magic, so it clearly sniffs as application/octet-stream (or
	// similar), never as an image type.
	copy(buf, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1, 0})
	rng := rand.New(rand.NewSource(7))
	rng.Read(buf[8:])
	return buf
}

// decompressionBombPNG hand-constructs the minimum valid PNG byte stream
// (correct signature, correct IHDR with correct CRC) declaring an enormous
// canvas, backed by a tiny/garbage IDAT. image.DecodeConfig only parses
// IHDR, so it reports the huge dimensions instantly; a full image.Decode
// against this file would fail (IDAT doesn't contain valid deflate data for
// that canvas) rather than hang, but our validation must never even attempt
// that full decode once the pre-check sees the declared pixel count.
func decompressionBombPNG(w, h uint32) []byte {
	var buf bytes.Buffer
	buf.Write([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})

	writeChunk := func(typ string, data []byte) {
		var lenB [4]byte
		binary.BigEndian.PutUint32(lenB[:], uint32(len(data)))
		buf.Write(lenB[:])
		typeAndData := append([]byte(typ), data...)
		buf.Write(typeAndData)
		crc := crc32.ChecksumIEEE(typeAndData)
		var crcB [4]byte
		binary.BigEndian.PutUint32(crcB[:], crc)
		buf.Write(crcB[:])
	}

	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], w)
	binary.BigEndian.PutUint32(ihdr[4:8], h)
	ihdr[8] = 8  // bit depth
	ihdr[9] = 6  // color type: RGBA
	ihdr[10] = 0 // compression
	ihdr[11] = 0 // filter
	ihdr[12] = 0 // interlace
	writeChunk("IHDR", ihdr)

	// Garbage IDAT — enough bytes to look plausible, not a real deflate
	// stream for this canvas size. A pre-check must never reach this.
	writeChunk("IDAT", bytes.Repeat([]byte{0x00}, 32))
	writeChunk("IEND", nil)

	return buf.Bytes()
}
