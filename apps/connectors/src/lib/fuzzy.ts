/**
 * Levenshtein distance for fuzzy connector search.
 * No dependencies — pure implementation.
 */

/** Compute edit distance between two strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row optimization (O(n) space)
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insert
        prev[j] + 1,          // delete
        prev[j - 1] + cost    // substitute
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Check if token fuzzy-matches target within maxDistance.
 * Only applies to tokens >= 3 chars to avoid false positives.
 */
export function fuzzyMatch(token: string, target: string, maxDistance = 2): boolean {
  if (token.length < 3) return false;
  if (target.includes(token)) return true; // exact substring = always match
  if (Math.abs(token.length - target.length) > maxDistance) return false; // quick reject
  return levenshtein(token, target) <= maxDistance;
}

/**
 * Find best fuzzy match score for a token against a list of candidates.
 * Returns 0 if no match within threshold.
 */
export function bestFuzzyScore(token: string, candidates: string[], maxDistance = 2): number {
  if (token.length < 3) return 0;
  let bestDist = maxDistance + 1;
  for (const c of candidates) {
    if (Math.abs(token.length - c.length) > maxDistance) continue;
    const d = levenshtein(token, c);
    if (d < bestDist) bestDist = d;
    if (d === 0) return maxDistance + 1; // perfect match, max score
  }
  if (bestDist > maxDistance) return 0;
  // Closer = higher score: dist 1 → score 2, dist 2 → score 1
  return maxDistance - bestDist + 1;
}
