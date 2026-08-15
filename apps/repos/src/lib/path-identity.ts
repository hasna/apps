import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Canonical identity of a path as the filesystem resolves it.
 *
 * `realpath` resolves symlinks AND — on a case-insensitive filesystem such as
 * macOS APFS — returns the on-disk spelling, so `/Users/u/workspace` and
 * `/Users/u/Workspace` that name the same directory produce the SAME key. Two
 * spellings of one directory are one directory; the registry stores path
 * strings and must not index it twice (measured 2026-08-14: `repos scan` over
 * both `~/workspace` and `~/Workspace` bootstrap roots indexed every monorepo
 * clone twice, e.g. apps ids 160 and 206, and `repos repo apps` then threw
 * "Multiple repos have the exact name").
 *
 * On a case-sensitive filesystem the same call preserves the distinction: two
 * directories that differ only in case realpath to different keys, and a
 * case-variant of an existing directory does not resolve at all.
 *
 * The fallback matters: paths that no longer exist (stored rows pointing at a
 * deleted checkout) must not throw. `resolve` is case-PRESERVING, so the
 * fallback can never manufacture a false match between two case-different
 * spellings of a nonexistent path — it only makes the key deterministic for a
 * path that is already spelled identically.
 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
