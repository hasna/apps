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
