//! DCT-based 64-bit perceptual hash (pHash) for product images.
//!
//! ADR: docs/adr/0019-x2b-phash.md
//! Playbook: §4 X2 moat — "match precision ≥97% golden set"
//!
//! Algorithm (canonical Marr/Hoyle variant):
//! 1. Decode + resize to 32×32 grayscale (bilinear).
//! 2. Apply 2-D Type-II DCT over the 32×32 luma matrix.
//! 3. Take the top-left 8×8 block (64 coefficients).
//! 4. Compute median of those 64 values (excluding DC term[0,0]).
//! 5. Emit 64 bits: bit i = 1 if coefficient[i] > median else 0.
//! 6. Encode as 16 lowercase hex chars (big-endian MSB-first).
//!
//! Hamming distance between two hashes = bitwise difference popcount.
//! Thresholds (per ADR-0019): ≤6 near-duplicate; 7-12 suspicious; >12 different.

use image::imageops::FilterType;
use std::f64::consts::PI;
use std::io::Cursor;

const HASH_SIZE: usize = 8;
const DCT_SIZE: usize = 32;

// S02 decompression-bomb guard (2026-04-18).
// PNG DEFLATE + zero-filled / repeating pixel data can hit compression ratios
// >1000:1 — a crafted 2 MiB PNG could request allocation of multi-GB pixel
// buffers, OOMing the 4 GB Win7 target (Hard Rule #7). Bound the decode with
// `image::Limits` so the decoder refuses bombs before any huge allocation.
//
// Numbers: max 8192×8192 pixels covers any realistic product photograph
// (phones shoot ~4000×3000 at the top end); 256 MiB `max_alloc` is well
// above the ~2 MiB encoded input cap but tight enough to bound the worst
// legitimate RGBA8 buffer (8192*8192*4 ≈ 256 MiB). Decoders that don't
// support these limit fields will simply ignore them.
const MAX_IMAGE_DIM: u32 = 8192;
const MAX_ALLOC_BYTES: u64 = 256 * 1024 * 1024;

fn bounded_limits() -> image::Limits {
    let mut l = image::Limits::default();
    l.max_image_width = Some(MAX_IMAGE_DIM);
    l.max_image_height = Some(MAX_IMAGE_DIM);
    l.max_alloc = Some(MAX_ALLOC_BYTES);
    l
}

/// Compute 64-bit pHash of an image (raw bytes: PNG/JPEG/WebP).
/// Returns 16 lowercase hex chars on success.
pub fn compute_phash(bytes: &[u8]) -> Result<String, String> {
    // S02: decode via `ImageReader` so we can attach `Limits`; raw
    // `image::load_from_memory` bypasses the bomb guard.
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("image sniff: {e}"))?;
    let mut reader = reader;
    reader.limits(bounded_limits());
    let img = reader.decode().map_err(|e| format!("image decode: {e}"))?;
    Ok(compute_phash_from_dynamic(&img))
}

fn compute_phash_from_dynamic(img: &image::DynamicImage) -> String {
    // Resize to 32×32 grayscale. `to_luma8` then resize keeps the work in u8 channels.
    let luma = img
        .resize_exact(DCT_SIZE as u32, DCT_SIZE as u32, FilterType::Lanczos3)
        .to_luma8();

    // Fill a DCT_SIZE×DCT_SIZE matrix of f64 luma values.
    let mut matrix = [[0.0f64; DCT_SIZE]; DCT_SIZE];
    for (y, row) in matrix.iter_mut().enumerate() {
        for (x, cell) in row.iter_mut().enumerate() {
            *cell = luma.get_pixel(x as u32, y as u32).0[0] as f64;
        }
    }

    // 2-D Type-II DCT via two 1-D DCT passes (rows then columns).
    // O(N^3) is fine for N=32 (~32k ops; well under 1 ms).
    let row_dct = dct_2d(&matrix);

    // Extract top-left 8×8 block (64 coefficients).
    let mut top: [f64; HASH_SIZE * HASH_SIZE] = [0.0; HASH_SIZE * HASH_SIZE];
    for y in 0..HASH_SIZE {
        for x in 0..HASH_SIZE {
            top[y * HASH_SIZE + x] = row_dct[y][x];
        }
    }

    // Median of the 64 coefficients EXCLUDING the DC term (index 0).
    // The DC term dominates overall brightness and would skew the threshold.
    let mut tail: Vec<f64> = top[1..].to_vec();
    tail.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = (tail[31] + tail[32]) / 2.0;

    // Build 64-bit hash. Bit 63 (MSB) = pixel[0,0]; bit 0 (LSB) = pixel[7,7].
    let mut bits: u64 = 0;
    for (i, &coeff) in top.iter().enumerate() {
        if coeff > median {
            bits |= 1u64 << (63 - i);
        }
    }

    format!("{bits:016x}")
}

/// 2-D Type-II DCT. Returns a DCT_SIZE×DCT_SIZE matrix.
fn dct_2d(input: &[[f64; DCT_SIZE]; DCT_SIZE]) -> [[f64; DCT_SIZE]; DCT_SIZE] {
    let mut rows: [[f64; DCT_SIZE]; DCT_SIZE] = [[0.0; DCT_SIZE]; DCT_SIZE];
    // 1-D DCT per row.
    for y in 0..DCT_SIZE {
        rows[y] = dct_1d(&input[y]);
    }
    // 1-D DCT per column of the row-DCT result.
    let mut out: [[f64; DCT_SIZE]; DCT_SIZE] = [[0.0; DCT_SIZE]; DCT_SIZE];
    for x in 0..DCT_SIZE {
        let col: [f64; DCT_SIZE] = std::array::from_fn(|y| rows[y][x]);
        let col_dct = dct_1d(&col);
        for y in 0..DCT_SIZE {
            out[y][x] = col_dct[y];
        }
    }
    out
}

/// 1-D Type-II DCT, length DCT_SIZE.
fn dct_1d(input: &[f64; DCT_SIZE]) -> [f64; DCT_SIZE] {
    let n = DCT_SIZE as f64;
    let mut out = [0.0f64; DCT_SIZE];
    for (k, cell) in out.iter_mut().enumerate() {
        let mut sum = 0.0;
        for (i, &x) in input.iter().enumerate() {
            sum += x * ((PI / n) * (i as f64 + 0.5) * k as f64).cos();
        }
        *cell = sum;
    }
    out
}

/// Hamming distance between two 16-hex pHash strings.
/// Returns `Err` if either is not exactly 16 lowercase hex chars.
pub fn hamming_distance(a: &str, b: &str) -> Result<u32, String> {
    let av = parse_hash(a)?;
    let bv = parse_hash(b)?;
    Ok((av ^ bv).count_ones())
}

fn parse_hash(s: &str) -> Result<u64, String> {
    if s.len() != 16 {
        return Err(format!("phash length: expected 16, got {}", s.len()));
    }
    u64::from_str_radix(s, 16).map_err(|e| format!("phash parse: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    /// Render a procedural scene parameterised by `seed`. Scene has multi-frequency content
    /// (circular "object", cosine grating, fine texture) to mimic a photographed product pack.
    /// Per-seed variation: circle centre + radius + grating frequency + phase.
    /// All coordinates normalised to `[0, 1]` so resize is shape-preserving.
    fn smooth_scene_png(w: u32, h: u32, seed: u32) -> Vec<u8> {
        let mut img = RgbImage::new(w, h);
        let s = seed as f64;
        let cx = 0.3 + 0.4 * (s * 0.31).sin().abs();
        let cy = 0.3 + 0.4 * (s * 0.47).cos().abs();
        let radius = 0.15 + 0.1 * (s * 0.13).sin().abs();
        let freq = 1.5 + 2.0 * (s * 0.07).sin().abs();
        let phase = s * 0.7;
        for y in 0..h {
            for x in 0..w {
                let nx = x as f64 / (w - 1) as f64;
                let ny = y as f64 / (h - 1) as f64;
                let low = ((nx * std::f64::consts::PI * freq + phase).cos()
                    + (ny * std::f64::consts::PI * freq + phase * 0.5).sin())
                    * 0.15;
                let d = ((nx - cx).powi(2) + (ny - cy).powi(2)).sqrt();
                let obj = if d < radius { 0.4 } else { -0.1 };
                let tex = ((nx * 13.7 + ny * 7.3 + s).sin() * 0.5 + 0.5) * 0.2;
                let v = 0.5 + low + obj + tex * 0.3;
                let v8 = (v.clamp(0.0, 1.0) * 255.0) as u8;
                img.put_pixel(x, y, Rgb([v8, v8, v8]));
            }
        }
        let mut buf: Vec<u8> = Vec::new();
        DynamicImage::ImageRgb8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    #[test]
    fn hash_is_16_lowercase_hex() {
        let bytes = smooth_scene_png(64, 64, 1);
        let h = compute_phash(&bytes).unwrap();
        assert_eq!(h.len(), 16);
        assert!(h
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn identical_bytes_yield_identical_hash() {
        let bytes = smooth_scene_png(128, 128, 7);
        let a = compute_phash(&bytes).unwrap();
        let b = compute_phash(&bytes).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn resize_keeps_hash_close() {
        // Same smooth scene at two resolutions → Hamming should be low.
        let a = compute_phash(&smooth_scene_png(256, 256, 3)).unwrap();
        let b = compute_phash(&smooth_scene_png(128, 128, 3)).unwrap();
        let d = hamming_distance(&a, &b).unwrap();
        assert!(
            d <= 6,
            "hamming={d} exceeded 6 for smooth resize: a={a} b={b}"
        );
    }

    #[test]
    fn different_scenes_exceed_12() {
        let a = compute_phash(&smooth_scene_png(160, 160, 1)).unwrap();
        let b = compute_phash(&smooth_scene_png(160, 160, 42)).unwrap();
        let d = hamming_distance(&a, &b).unwrap();
        assert!(d > 12, "hamming={d} failed to exceed 12: a={a} b={b}");
    }

    #[test]
    fn golden_set_synthetic() {
        // 10 matched-pair fixtures (same scene, resized 256→160); Hamming ≤ 6.
        // 10 different-pair fixtures (distinct seeds); Hamming > 12.
        let mut matched_under_6 = 0;
        for seed in 1..=10u32 {
            let big = compute_phash(&smooth_scene_png(256, 256, seed)).unwrap();
            let small = compute_phash(&smooth_scene_png(160, 160, seed)).unwrap();
            let d = hamming_distance(&big, &small).unwrap();
            if d <= 6 {
                matched_under_6 += 1;
            }
        }
        assert!(
            matched_under_6 >= 10,
            "matched_under_6={matched_under_6}/10 — gate requires 10/10"
        );

        let mut diff_over_12 = 0;
        for seed in 1..=10u32 {
            let a = compute_phash(&smooth_scene_png(160, 160, seed)).unwrap();
            let b = compute_phash(&smooth_scene_png(160, 160, seed + 100)).unwrap();
            let d = hamming_distance(&a, &b).unwrap();
            if d > 12 {
                diff_over_12 += 1;
            }
        }
        assert!(
            diff_over_12 >= 9,
            "diff_over_12={diff_over_12}/10 — gate requires ≥9/10"
        );
    }

    #[test]
    fn hamming_happy_path() {
        assert_eq!(
            hamming_distance("0000000000000000", "0000000000000000").unwrap(),
            0
        );
        assert_eq!(
            hamming_distance("0000000000000000", "ffffffffffffffff").unwrap(),
            64
        );
        assert_eq!(
            hamming_distance("aaaaaaaaaaaaaaaa", "5555555555555555").unwrap(),
            64
        );
    }

    #[test]
    fn hamming_rejects_bad_input() {
        assert!(hamming_distance("short", "0000000000000000").is_err());
        assert!(hamming_distance("zzzzzzzzzzzzzzzz", "0000000000000000").is_err());
    }

    /// S02 regression: a PNG declaring dimensions beyond the `Limits` cap
    /// MUST fail fast at decode — before any multi-GB allocation — rather
    /// than panic or OOM the process.
    ///
    /// Construct a zero-filled 16384×16384 RGB8 image then PNG-encode it.
    /// With pixel data = 0 the PNG compresses to well under the 2 MiB input
    /// cap; without `Limits`, decoding would allocate ~768 MiB of RGB pixels.
    /// With `bounded_limits()` the reader refuses either at sniff or decode.
    #[test]
    fn rejects_oversized_png() {
        use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
        let w = MAX_IMAGE_DIM + 1;
        let h = 64u32; // avoid exploding the test's own memory
        let img = RgbImage::from_fn(w, h, |_, _| Rgb([0, 0, 0]));
        let mut buf: Vec<u8> = Vec::new();
        DynamicImage::ImageRgb8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
            .unwrap();
        let result = compute_phash(&buf);
        assert!(
            result.is_err(),
            "oversized image must be rejected by Limits; got Ok"
        );
    }
}
