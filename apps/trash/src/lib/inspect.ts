/**
 * Source inspection — `lstat` only, never canonicalize, never traverse.
 *
 * Two rules the ecosystem learned by destroying data (both implemented here,
 * both tested):
 *
 *  1. **A symlink is trashed as an object, never traversed.** `trash-rs` yanked
 *     a release whose changelog reads "symlinks aren't handled correctly, which
 *     can lead to removals of unrelated directory trees", and a trash-cli user
 *     ran `trash node_modules/Butaro/` where `Butaro` was a symlink: the tool
 *     errored, the TARGET was gone, and restore listed nothing.
 *  2. **`lstat` alone does not deliver rule 1 — there are two leaks.** A
 *     trailing slash defeats the final-component rule (`lstat("/bin/")` reports
 *     a directory, not a symlink), so trailing slashes are stripped BEFORE
 *     `lstat`; and intermediate components are always traversed during ordinary
 *     pathname lookup, so every ancestor is opened with `O_NOFOLLOW|O_DIRECTORY`
 *     and a symlinked component is a refusal.
 *
 * "Verify deletability BEFORE the move" (KDE 446537: read-only build trees were
 * copied into trash and then could not be removed; `trash-put -f` on a
 * root-owned dir copies and leaves a stray duplicate) is the refusal evaluation
 * at the bottom of this module. A refusal never copies: we move or we refuse.
 */

import { constants, lstatSync, openSync, closeSync, accessSync, type Stats } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { hashPath, EntryTooLargeError, type HashedKind } from "./hash.js";
import type { CaptureRefusalReason } from "./refusals.js";
import { errnoCode, freeBytesOf, isErrno } from "./fsx.js";

/**
 * System roots that may never be captured — the list `@hasna/hooks` already
 * defines (`apps/hooks/hooks/codewith-native-common.ts:606-630`), copied
 * because the store must refuse these on its own even when the guard is not
 * installed. `root` mode semantics match: the root itself and its DIRECT
 * children are protected (`rm -rf /usr` and `rm -rf /usr/*`), while a targeted
 * delete deeper inside stays allowed. `/tmp` is deliberately absent there, and
 * absent here for the same reason: scratch cleanup is routine and bounded.
 */
export const SYSTEM_PROTECTED_ROOTS: readonly string[] = [
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/srv",
  "/sys",
  "/usr",
  "/var",
  "/Applications",
  "/Library",
  "/System",
  "/Users",
  "/Volumes",
  "/private",
];

export interface ProtectedPathContext {
  home: string;
  /** Extra roots that are protected in FULL (exact match, ancestor, descendant) — the store's own roots. */
  extraRoots?: readonly string[];
}

/** The protected class of §15.11.3, as the store enforces it. */
export function checkProtectedPath(target: string, ctx: ProtectedPathContext): string | null {
  const absolute = resolve(target);

  for (const extra of ctx.extraRoots ?? []) {
    const root = resolve(extra);
    if (absolute === root || absolute.startsWith(root + sep) || root.startsWith(absolute + sep)) {
      return `trash store root ${root}`;
    }
  }

  const home = resolve(ctx.home);
  for (const name of [".hasna", ".ssh", ".aws"]) {
    const protectedPath = join(home, name);
    if (absolute === protectedPath) return `protected root ${protectedPath}`;
  }
  if (absolute === home) return "protected root (home directory)";

  for (const root of SYSTEM_PROTECTED_ROOTS) {
    if (absolute === root) return root === "/" ? "filesystem root /" : `system root ${root}`;
    if (dirname(absolute) === root) return `direct child of system root ${root}`;
  }
  return null;
}

/** Strip trailing separators — `lstat("x/")` follows the link that `lstat("x")` reports. */
export function stripTrailingSlashes(path: string): string {
  let out = path;
  while (out.length > 1 && out.endsWith(sep)) out = out.slice(0, -1);
  return out;
}

export interface CaptureRefusalDraft {
  reason: CaptureRefusalReason;
  detail: string;
}

export interface InspectedSource {
  givenPath: string;
  /** Lexically resolved, trailing slashes stripped. Never canonicalized. */
  absolutePath: string;
  kind: HashedKind;
  sizeBytes: number;
  sha256: string;
  device: number;
  inode: number;
  nlink: number;
  mode: number;
  lstat: Stats;
}

export interface InspectOptions {
  cwd: string;
  home: string;
  maxBytes: number;
  extraProtectedRoots?: readonly string[];
  /** An ancestor that is a symlink is a refusal (§4). */
  checkSymlinkComponents?: boolean;
}

export interface InspectResult {
  givenPath: string;
  absolutePath: string;
  missing: boolean;
  refusals: CaptureRefusalDraft[];
  source: InspectedSource | null;
}

/**
 * Walk every ancestor of `absolute` (excluding the final component) and open
 * it with `O_NOFOLLOW|O_DIRECTORY`. A symlinked component fails with `ELOOP` —
 * that is the refusal, because a path that resolves THROUGH a symlink is not
 * the path the caller thinks they are deleting.
 */
function inspectAncestors(absolute: string): CaptureRefusalDraft[] {
  const refusals: CaptureRefusalDraft[] = [];
  const parent = dirname(absolute);
  if (parent === absolute) return refusals;

  const parts = parent.split(sep).filter((part) => part.length > 0);
  let prefix: string = sep;
  for (const part of parts) {
    prefix = prefix === sep ? `${sep}${part}` : `${prefix}${sep}${part}`;

    // `lstat` is the primary check, because it answers the question directly.
    // The `O_NOFOLLOW` open below is defence in depth: on Linux the two do NOT
    // agree — `open(dir, O_RDONLY|O_DIRECTORY|O_NOFOLLOW)` on a symlink to a
    // directory reports ENOTDIR, not ELOOP, so an errno-only check that looks
    // for ELOOP misses every symlinked ancestor. (Measured: Linux 6.17.)
    let info: Stats;
    try {
      info = lstatSync(prefix);
    } catch (error) {
      const code = errnoCode(error);
      // A component that is not a directory (or is absent) means the whole path
      // is absent: not a refusal, just nothing to capture.
      if (code === "ENOENT" || code === "ENOTDIR") return refusals;
      if (code === "EACCES" || code === "EPERM") {
        refusals.push({
          reason: "permission",
          detail: `cannot stat ${prefix} (${code}) — the path cannot be verified, so it will not be moved`,
        });
        return refusals;
      }
      refusals.push({ reason: "io_error", detail: `lstat(${prefix}) failed: ${code ?? String(error)}` });
      return refusals;
    }

    if (info.isSymbolicLink()) {
      refusals.push({
        reason: "symlink_component",
        detail: `${prefix} is a symlink — a path resolved through a symlink is refused, not traversed`,
      });
      return refusals;
    }
    if (!info.isDirectory()) return refusals;

    try {
      const fd = openSync(prefix, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(fd);
    } catch (error) {
      const code = errnoCode(error);
      if (code === "ELOOP" || code === "ENOTDIR") {
        refusals.push({
          reason: "symlink_component",
          detail: `${prefix} became a symlink during inspection (${code}) — refusing to traverse it`,
        });
        return refusals;
      }
      if (code === "ENOENT") return refusals;
      if (code === "EACCES" || code === "EPERM") {
        refusals.push({
          reason: "permission",
          detail: `cannot open ${prefix} (${code}) — the path cannot be verified, so it will not be moved`,
        });
        return refusals;
      }
      refusals.push({ reason: "io_error", detail: `opening ${prefix} failed: ${code ?? String(error)}` });
      return refusals;
    }
  }
  return refusals;
}

/**
 * Inspect a source path. Never throws for a bad path: every failure is a
 * refusal draft, so the caller can apply §11.7's excluded/refused decision.
 */
export function inspectSource(givenPath: string, options: InspectOptions): InspectResult {
  const given = givenPath.trim();
  const stripped = stripTrailingSlashes(given);
  const absolute = resolve(options.cwd, stripped);

  const result: InspectResult = {
    givenPath,
    absolutePath: absolute,
    missing: false,
    refusals: [],
    source: null,
  };

  if (stripped.length === 0) {
    result.refusals.push({ reason: "io_error", detail: "empty path" });
    return result;
  }

  const protectedLabel = checkProtectedPath(absolute, {
    home: options.home,
    extraRoots: options.extraProtectedRoots,
  });
  if (protectedLabel) {
    result.refusals.push({ reason: "protected_path", detail: protectedLabel });
    return result;
  }

  if (options.checkSymlinkComponents !== false) {
    result.refusals.push(...inspectAncestors(absolute));
    if (result.refusals.some((r) => r.reason === "symlink_component")) return result;
  }

  let info: Stats;
  try {
    info = lstatSync(absolute);
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
      result.missing = true;
      return result;
    }
    result.refusals.push({
      reason: errnoCode(error) === "EACCES" || errnoCode(error) === "EPERM" ? "permission" : "io_error",
      detail: `lstat(${absolute}) failed: ${errnoCode(error) ?? String(error)}`,
    });
    return result;
  }

  if (!info.isFile() && !info.isDirectory() && !info.isSymbolicLink()) {
    result.refusals.push({
      reason: "special_file",
      detail: `${absolute} is a ${info.isFIFO() ? "fifo" : info.isSocket() ? "socket" : "device node"}`,
    });
    return result;
  }

  let hashed;
  try {
    hashed = hashPath(absolute, { maxBytes: options.maxBytes });
  } catch (error) {
    if (error instanceof EntryTooLargeError) {
      result.refusals.push({
        reason: "too_large",
        detail: `${absolute} is ${error.sizeBytes} bytes, over the ${error.maxBytes}-byte cap`,
      });
      return result;
    }
    const code = errnoCode(error);
    result.refusals.push({
      reason: code === "EACCES" || code === "EPERM" ? "hash_unreadable" : "io_error",
      detail: `hashing ${absolute} failed: ${code ?? String(error)}`,
    });
    return result;
  }

  result.source = {
    givenPath,
    absolutePath: absolute,
    kind: hashed.kind,
    sizeBytes: hashed.sizeBytes,
    sha256: hashed.sha256,
    device: info.dev,
    inode: info.ino,
    nlink: info.nlink,
    mode: info.mode,
    lstat: info,
  };
  return result;
}

export interface DeletabilityOptions {
  /** Device of the spool files directory — a mismatch is `EXDEV`, refused, never copied. */
  spoolDevice: number;
  /** Free bytes on the spool filesystem. */
  spoolFreeBytes: number;
  minFreeBytes: number;
  maxEntryBytes: number;
  sizeBytes: number;
}

/**
 * "Verify deletability BEFORE the move."
 *
 * The checks that decide whether the capture is even attempted. Everything here
 * is a refusal *draft*: it becomes a refusal only if the path is not exempt by
 * an exclude glob (§11.7).
 */
export function evaluateDeletability(absolutePath: string, options: DeletabilityOptions): CaptureRefusalDraft[] {
  const refusals: CaptureRefusalDraft[] = [];

  if (options.sizeBytes > options.maxEntryBytes) {
    refusals.push({
      reason: "too_large",
      detail: `${options.sizeBytes} bytes exceeds capture.maxEntryBytes (${options.maxEntryBytes})`,
    });
  }

  if (options.spoolFreeBytes - options.sizeBytes < options.minFreeBytes) {
    refusals.push({
      reason: "disk_low",
      detail:
        `free space ${options.spoolFreeBytes} - entry ${options.sizeBytes} would breach ` +
        `capture.minFreeBytes (${options.minFreeBytes})`,
    });
  }

  let device: number;
  try {
    device = lstatSync(absolutePath).dev;
  } catch (error) {
    refusals.push({ reason: "io_error", detail: `lstat failed: ${errnoCode(error) ?? String(error)}` });
    return refusals;
  }
  if (device !== options.spoolDevice) {
    refusals.push({
      reason: "cross_device",
      detail: `source is on device ${device}, the spool on ${options.spoolDevice} — EXDEV is refused, never copied`,
    });
  }

  const parent = dirname(absolutePath);
  try {
    accessSync(parent, constants.W_OK | constants.X_OK);
  } catch (error) {
    refusals.push({
      reason: "not_deletable",
      detail: `parent ${parent} is not writable/searchable (${errnoCode(error) ?? String(error)}) — the move would fail after staging`,
    });
  }

  return refusals;
}

/** Free space helper used by the store when it needs the same number twice. */
export function spoolFreeBytes(spoolDir: string): number {
  return freeBytesOf(spoolDir);
}
