/**
 * Verdict comment parser for the `repos pr-monitor` verb.
 *
 * The fleet's canonical verdict line, mandated by the review posting rule:
 *
 *   [REVIEW] <GO|NO_GO> — <owner/repo>#<n> @ <sha> — lens: <lens>, reviewer <name> (<i> of <n>)
 *
 * This module owns three contracts (pr-monitor design section 2.4, acceptance
 * criterion 2):
 *
 * 1. `parseVerdictLine` — one line in, one verdict or null. Only lines that
 *    START with `[REVIEW]` at column zero match; em-dash, en-dash and hyphen
 *    separators are accepted; the sha may be abbreviated (7-40 hex); the
 *    `owner/repo#n` target is required (owner optional); lens and reviewer
 *    are extracted when present. Everything else — missing prefix, non-GO/
 *    NO_GO value, missing @, short or non-hex sha, missing #n, embedded
 *    prose — is null, never a throw.
 * 2. `parseVerdictsFromBody` — scans a comment body line by line, skipping
 *    GitHub quote-reply lines (`> ...`) and fenced code blocks, so quoted
 *    verdicts and pasted examples never match. Duplicate identical lines
 *    within one body collapse to one verdict.
 * 3. `resolveVerdictAtHead` — the newest verdict (by createdAt, comment id
 *    tie-break) whose sha equals the head sha. Verdicts at an older sha are
 *    ignored at head; a newer GO at a newer head supersedes an older NO_GO;
 *    NO_GO at head with no newer GO resolves NO_GO. The classification
 *    engine (section 2.4 table) consumes this.
 */

/** The two verdict values the fleet posts. */
export type VerdictValue = "GO" | "NO_GO";

/** One parsed verdict line, plus the comment metadata it came from. */
export interface ParsedVerdict {
  verdict: VerdictValue;
  /** GitHub owner from the `owner/repo#n` target; null when the line used a bare `repo#n`. */
  owner: string | null;
  repo: string;
  number: number;
  /** The sha the verdict is bound to, lowercased. */
  sha: string;
  /** The `lens:` value when the tail carried one. */
  lens: string | null;
  /** The reviewer name when the tail carried one. */
  reviewer: string | null;
  commentId: number | null;
  createdAt: string | null;
}

/**
 * The line shape, per the canonical form. The middle between the verdict and
 * `@ <sha>` must carry the `(owner/)repo#n` target; the tail after the sha is
 * optional and may carry lens/reviewer.
 */
const VERDICT_LINE_RE =
  /^\[REVIEW\]\s+(GO|NO_GO)\s+[—–-]\s+(.+?)\s+@\s+([0-9a-fA-F]{7,40})(?![0-9a-fA-F])(?:\s*[—–-]\s*(.*))?\s*$/;

/** `owner/repo#n` or `repo#n`, exactly — nothing glued to the number. */
const PR_REF_RE = /(?:([A-Za-z0-9_.-]+)\/)?([A-Za-z0-9_.-]+)#(\d+)(?![A-Za-z0-9_.-])/;

/** The `lens: <value>` fragment, captured up to the comma or the line end. */
const LENS_RE = /lens:\s*([^,\n]+)/i;

/** The `reviewer <name>` fragment; names may be slugs or single words. */
const REVIEWER_RE = /reviewer\s+([A-Za-z0-9_.-]+)/i;

/**
 * Parse one verdict line. Returns null — never throws — for malformed input,
 * prose, quoted lines, or a verdict value outside GO/NO_GO.
 */
export function parseVerdictLine(line: unknown): ParsedVerdict | null {
  if (typeof line !== "string") return null;
  const match = VERDICT_LINE_RE.exec(line);
  if (!match) return null;
  const [, verdict, middle, sha] = match;
  if (!verdict || !middle || !sha) return null;
  const tail = match[4];

  const ref = PR_REF_RE.exec(middle);
  if (!ref) return null;
  const [, owner, repo, number] = ref;
  if (!repo || !number) return null;

  let lens: string | null = null;
  let reviewer: string | null = null;
  if (tail) {
    const lensMatch = LENS_RE.exec(tail);
    if (lensMatch?.[1]?.trim()) lens = lensMatch[1].trim();
    const reviewerMatch = REVIEWER_RE.exec(tail);
    if (reviewerMatch?.[1]) reviewer = reviewerMatch[1];
  }

  return {
    verdict: verdict as VerdictValue,
    owner: owner ?? null,
    repo,
    number: Number(number),
    sha: sha.toLowerCase(),
    lens,
    reviewer,
    commentId: null,
    createdAt: null,
  };
}

/**
 * Parse every verdict line in a comment body. Lines inside GitHub quote
 * replies (`> ...`) and fenced code blocks (``` or ~~~) are never verdicts;
 * identical lines within one body collapse to one verdict. The caller's
 * comment metadata (id, createdAt) is carried through to each result.
 */
export function parseVerdictsFromBody(
  body: unknown,
  meta?: { id?: number | null; createdAt?: string | null },
): ParsedVerdict[] {
  if (typeof body !== "string" || body.length === 0) return [];
  const results: ParsedVerdict[] = [];
  const seen = new Set<string>();
  let fence: string | null = null;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const fenceStart = /^\s*(```|~~~)/.exec(line);
    if (fenceStart) {
      if (fence === null) fence = fenceStart[1] ?? null;
      else if (fence === fenceStart[1]) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (/^\s*>/.test(line)) continue;

    const parsed = parseVerdictLine(line);
    if (!parsed) continue;
    const key = [
      parsed.verdict,
      parsed.owner ?? "",
      parsed.repo,
      parsed.number,
      parsed.sha,
      parsed.lens ?? "",
      parsed.reviewer ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...parsed, commentId: meta?.id ?? null, createdAt: meta?.createdAt ?? null });
  }
  return results;
}

/**
 * The effective verdict at a head sha: the newest verdict naming exactly that
 * sha. Ordering is by createdAt (ISO strings compare lexicographically);
 * comments without a timestamp sort as oldest, and equal timestamps break on
 * the higher comment id. Returns null when no verdict names the head sha.
 */
export function resolveVerdictAtHead(
  verdicts: readonly ParsedVerdict[],
  headSha: string | null,
): ParsedVerdict | null {
  if (!headSha) return null;
  const target = headSha.toLowerCase();
  let best: ParsedVerdict | null = null;
  for (const verdict of verdicts) {
    if (verdict.sha.toLowerCase() !== target) continue;
    if (!best || isNewer(verdict, best)) best = verdict;
  }
  return best;
}

function isNewer(a: ParsedVerdict, b: ParsedVerdict): boolean {
  const aTime = a.createdAt ?? "";
  const bTime = b.createdAt ?? "";
  if (aTime !== bTime) return aTime > bTime;
  return (a.commentId ?? 0) > (b.commentId ?? 0);
}
