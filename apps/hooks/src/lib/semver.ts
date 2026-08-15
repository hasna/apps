/**
 * Shared semver validation (P2-10).
 *
 * Every surface that accepts a hook version — manifest validation, publish,
 * the serve and worker artifact routes — must accept and reject the SAME
 * set. Previously the manifest accepted "1.2.3-beta" (unanchored regex)
 * while the artifact routes demanded a bare `\d+\.\d+\.\d+` at the end of
 * the path, so a pinned prerelease install 404'd. This is the one pattern:
 * full semver with optional prerelease and build metadata.
 */

export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/**
 * A version segment used inside a URL path. Prerelease and build metadata
 * can contain '+' (build metadata) which must be percent-encoded in URLs;
 * the route regex accepts the encoded and decoded forms.
 */
export const SEMVER_PATH_SEGMENT = "[0-9A-Za-z.+_-]+";

export function isValidSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

export function semverError(value: string): string {
  return `version '${value}' is not valid semver (expected e.g. 1.2.3 or 1.2.3-beta.1)`;
}

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

function parseVersion(value: string): ParsedVersion {
  // Build metadata (everything after the FIRST '+') never participates in
  // precedence; a prerelease follows the first '-' of the core.
  const coreAndPre = value.split("+")[0];
  const dash = coreAndPre.indexOf("-");
  const core = dash >= 0 ? coreAndPre.slice(0, dash) : coreAndPre;
  const pre = dash >= 0 ? coreAndPre.slice(dash + 1).split(".") : [];
  const [major, minor, patch] = core.split(".").map(Number);
  return { core: [major, minor, patch], pre };
}

/**
 * Full semver precedence (semver.org §11), shared by every surface that
 * must ORDER published versions — the registry latest pointer (bug
 * 6e412e52) compares with this and nothing else.
 *
 * Returns <0 when a sorts before b, 0 when equal, >0 when a sorts after b.
 * Build metadata never participates. Prerelease identifiers compare by the
 * spec's rules: numeric identifiers numerically, numeric before alphanumeric,
 * fewer identifiers before more, release before any prerelease.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }

  const aPre = pa.pre.length > 0;
  const bPre = pb.pre.length > 0;
  if (!aPre && !bPre) return 0;
  if (aPre && !bPre) return -1; // 1.0.0-alpha < 1.0.0
  if (!aPre && bPre) return 1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.pre[i];
    const bi = pb.pre[i];
    if (ai === undefined) return -1; // fewer identifiers sorts first
    if (bi === undefined) return 1;
    if (ai === bi) continue;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) return Number(ai) < Number(bi) ? -1 : 1;
    if (aNum) return -1; // numeric identifiers sort before alphanumeric
    if (bNum) return 1;
    return ai < bi ? -1 : 1;
  }
  return 0;
}
