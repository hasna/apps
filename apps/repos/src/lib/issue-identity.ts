/**
 * An issue's GitHub identity.
 *
 * Mirrors `pr-identity.ts` deliberately rather than sharing its regexes: an
 * issue URL is `/issues/<n>` and a pull request URL is `/pull/<n>`, and a
 * shared "PR or issue" parser would silently accept the wrong collection
 * (issues never contain pull requests and vice versa — measured: `PullRequest`
 * does not implement `Issue`, brief §3.2). The PR path is left untouched.
 */
export interface IssueIdentity {
  owner: string;
  repo: string;
  number: number;
}

const ISSUE_URL = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/;

/** Parse `https://github.com/<owner>/<repo>/issues/<n>`; null when unparseable. */
export function parseIssueUrl(url: unknown): IssueIdentity | null {
  if (typeof url !== "string" || url.length === 0) return null;
  const match = ISSUE_URL.exec(url.trim());
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/i, ""), number };
}

/**
 * Owner/name of a normalized `host/owner/name` remote identity, as produced by
 * `sanitizeRemoteIdentity`. Returns null for anything else.
 */
export function parseRemoteIdentity(remoteUrl: unknown): { owner: string; repo: string } | null {
  if (typeof remoteUrl !== "string") return null;
  const parts = remoteUrl.split("/");
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
  return { owner: parts[1], repo: parts[2] };
}

/**
 * Resolve the org/repo a stored issue row belongs to.
 *
 * The URL wins whenever it is parseable, exactly like `resolvePullRequestOrigin`:
 * an issue row can be attached to a repo record whose remote points somewhere
 * else entirely, and in that case the repo record's org is simply wrong. The
 * owning repo record is only a fallback for rows with no usable URL.
 */
export function resolveIssueOrigin(
  url: unknown,
  fallbackRemoteUrl: unknown,
  fallbackOrg: unknown,
): { org: string | null; repo: string | null } {
  const fromUrl = parseIssueUrl(url);
  if (fromUrl) return { org: fromUrl.owner, repo: fromUrl.repo };

  const fromRemote = parseRemoteIdentity(fallbackRemoteUrl);
  if (fromRemote) return { org: fromRemote.owner, repo: fromRemote.repo };

  return { org: typeof fallbackOrg === "string" && fallbackOrg ? fallbackOrg : null, repo: null };
}
