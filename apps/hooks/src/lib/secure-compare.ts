/**
 * Constant-time string comparison for API-key checks.
 *
 * The loop always runs over the longer input and the result accumulates
 * XORs, so the timing does not reveal where or whether the values differ.
 * Available on both the bun/node and workerd runtimes.
 */
export function secureEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
