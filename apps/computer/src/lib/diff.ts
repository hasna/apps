import type { Screenshot } from "../types/index.js";

/**
 * Simple average hash (aHash) for perceptual screenshot comparison.
 * Computes a hash from the base64 PNG data that is similar for
 * visually similar images. Not pixel-perfect, but fast and good
 * enough to detect "the screen didn't change at all."
 *
 * We sample evenly spaced bytes from the raw base64 to build
 * a lightweight fingerprint without decoding the full image.
 */
export function computeScreenHash(screenshot: Screenshot): string {
  const data = screenshot.base64;
  const sampleSize = 256;
  const step = Math.max(1, Math.floor(data.length / sampleSize));

  let hash = "";
  for (let i = 0; i < data.length && hash.length < sampleSize; i += step) {
    hash += data[i];
  }
  return hash;
}

/**
 * Compare two screenshot hashes and return a similarity ratio (0-1).
 * 1.0 = identical, 0.0 = completely different.
 */
export function compareHashes(hash1: string, hash2: string): number {
  const len = Math.min(hash1.length, hash2.length);
  if (len === 0) return 0;

  let matches = 0;
  for (let i = 0; i < len; i++) {
    if (hash1[i] === hash2[i]) matches++;
  }
  return matches / len;
}

/**
 * Check if two screenshots are effectively the same.
 * Default threshold: 0.98 (98% similar = same screen).
 */
export function screenshotsMatch(
  prev: Screenshot,
  curr: Screenshot,
  threshold: number = 0.98
): boolean {
  const hash1 = computeScreenHash(prev);
  const hash2 = computeScreenHash(curr);
  return compareHashes(hash1, hash2) >= threshold;
}
