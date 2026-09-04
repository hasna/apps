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
import { existsSync, realpathSync, statSync } from "node:fs";
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
  /** Bypass the drift refusal. Set only by `run-now --allow-dirty` or an acknowledged stored target. */
  allowDirty?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Test seam: skip the memo so a fixture can mutate a file within the same mtime tick. */
  skipCache?: boolean;
}

/**
 * Verification is O(bundle bytes), bounded at 8 MiB, and a 5-minute loop would
 * otherwise re-hash an unchanged tree 288 times a day. The memo key carries the
 * bundle directory's inode, size and both timestamps, so a real edit always
 * invalidates it; `skipCache` exists because a test can mutate a file inside a
 * single filesystem timestamp tick, which no production edit does.
 */
const verificationCache = new Map<
  string,
  { fingerprint: string; changedPaths: string[]; digest: string; version: number }
>();

/** Exported for tests: drop the memo so a fixture can re-verify a mutated tree. */
export function clearBundleVerificationCache(): void {
  verificationCache.clear();
}

function treeFingerprint(dir: string): string {
  const stats = statSync(dir);
  return `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

/**
 * Decide how (and whether) a bundled loop's target may run.
 *
 * Returns `undefined` for a loop with no bundle: the caller keeps its existing
 * resolution untouched, which is what makes this safe to enable fleet-wide
 * before every loop is bundled.
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

  const fingerprint = treeFingerprint(root);
  const cacheKey = `${root} ${fingerprint}`;
  let verified = opts.skipCache ? undefined : verificationCache.get(cacheKey);
  if (!verified) {
    const local = inspectLocalBundle(bundleName, opts.env ?? process.env);
    verified = {
      fingerprint,
      changedPaths: local.changedPaths,
      digest: local.manifest?.bundleDigest ?? "",
      version: local.manifest?.version ?? 0,
    };
    if (!opts.skipCache) verificationCache.set(cacheKey, verified);
  }
  if (verified.changedPaths.length > 0 && !opts.allowDirty) {
    return {
      ok: false,
      refusal: {
        error: "BUNDLE_DRIFT",
        message:
          `bundle '${bundleName}' no longer matches its manifest; refusing to run. ` +
          `Changed paths: ${verified.changedPaths.join(", ")}. ` +
          `Re-pull with 'loops bundle pull ${bundleName}', push the change, or pass --allow-dirty.`,
        changedPaths: [...verified.changedPaths],
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
      bundleDigest: verified.digest,
      bundleVersion: verified.version,
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
