/**
 * Test sandbox — every fixture this suite creates lives under a fresh
 * `mkdtemp` directory, and every destructive helper in here asserts the
 * absolute target is inside that directory before it touches anything.
 *
 * The assertion is not ceremony. These tests exercise a tool whose entire job
 * is deleting things; a fixture path that escapes its sandbox by accident (a
 * relative path resolved against the wrong cwd, a `--spool` that defaulted,
 * a symlink that pointed somewhere real) would be indistinguishable from a
 * working test until it destroyed something outside the sandbox. So:
 *
 *   1. the sandbox root is created with `mkdtempSync` (a name no other process
 *      can have predicted) directly under the OS temp directory;
 *   2. `assertInside` resolves the target and requires the sandbox root
 *      followed by a path separator — `/tmp/trash-test-abc` never matches
 *      `/tmp/trash-test-abc-evil`;
 *   3. `safeRemove` re-checks the root's own shape (parent is the temp
 *      directory, basename carries the prefix) and refuses to follow a symlink
 *      that has replaced it;
 *   4. `testEnv` points EVERY path root at the sandbox, so a bug that ignores
 *      the explicit overrides still cannot resolve to a real user directory.
 */

import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, lstatSync, realpathSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const PREFIX = "trash-test-";

/** Thrown when a path escapes its sandbox — a bug in the test, never a warning. */
export class SandboxEscapeError extends Error {
  constructor(target: string, root: string) {
    super(`refusing to touch ${target}: it is not inside the sandbox root ${root}`);
    this.name = "SandboxEscapeError";
  }
}

export interface Sandbox {
  /** The sandbox root — a fresh `mkdtemp` under the OS temp directory. */
  readonly root: string;
  /** Absolute path inside the sandbox; `assertInside` runs on the result. */
  path(...segments: string[]): string;
  /** Write a fixture file (creating parents) and return its absolute path. */
  file(relativePath: string, content: string | Buffer): string;
  /** Create a fixture directory tree and return its absolute path. */
  dir(relativePath: string): string;
  /** Create a symlink AT `relativePath` pointing at `target`; returns its absolute path. */
  symlink(target: string, relativePath: string): string;
  /**
   * Recursively remove something INSIDE the sandbox. Refuses anything else, and
   * refuses when the sandbox root itself is no longer the directory we made.
   */
  safeRemove(target: string): void;
  /** Remove the whole sandbox. Called in `afterEach`, best-effort. */
  cleanup(): void;
  /** Assert `target` is inside the sandbox; returns the resolved path. */
  assertInside(target: string): string;
}

function assertSandboxRoot(root: string): void {
  if (basename(root).startsWith(PREFIX) === false) {
    throw new SandboxEscapeError(root, `${PREFIX}*`);
  }
  const parent = realpathSync(dirname(root));
  if (!statSync(parent).isDirectory()) {
    throw new SandboxEscapeError(root, "a directory");
  }
  if (parent !== realpathSync(tmpdir()) && !parent.startsWith("/dev/shm")) {
    throw new SandboxEscapeError(root, `a directory under ${tmpdir()} or /dev/shm`);
  }
}

export function createSandbox(): Sandbox {
  return createSandboxAt(tmpdir());
}

/**
 * A sandbox on another device (`/dev/shm`), so the cross-device refusal can be
 * exercised for real rather than mocked. Same guarantees: a random `mkdtemp`
 * name and a prefix assertion before anything is removed.
 */
export function createSandboxAt(parentDir: string): Sandbox {
  const parent = realpathSync(parentDir);
  const root = realpathSync(mkdtempSync(join(parent, PREFIX)));
  assertSandboxRoot(root);

  const assertInside = (target: string): string => {
    const absolute = resolve(target);
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new SandboxEscapeError(absolute, root);
    }
    return absolute;
  };

  return {
    root,
    assertInside,
    path(...segments: string[]): string {
      return assertInside(join(root, ...segments));
    },
    file(relativePath: string, content: string | Buffer): string {
      const target = assertInside(join(root, relativePath));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      return target;
    },
    dir(relativePath: string): string {
      const target = assertInside(join(root, relativePath));
      mkdirSync(target, { recursive: true });
      return target;
    },
    symlink(target: string, relativePath: string): string {
      const link = assertInside(join(root, relativePath));
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link);
      return link;
    },
    safeRemove(target: string): void {
      const absolute = assertInside(target);
      assertSandboxRoot(root);
      const info = lstatSync(root);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new SandboxEscapeError(root, "a real directory created by this sandbox");
      }
      rmSync(absolute, { recursive: true, force: true });
    },
    cleanup(): void {
      if (!basename(root).startsWith(PREFIX)) return;
      try {
        assertSandboxRoot(root);
      } catch {
        return;
      }
      try {
        if (!lstatSync(root).isDirectory()) return;
      } catch {
        return;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * An environment that points every root at the sandbox and clears every
 * trash-specific variable. A test that forgets an explicit override still
 * cannot reach `~/.hasna/trash`.
 */
export function testEnv(sandbox: Sandbox, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: sandbox.path("home"),
    HASNA_CONFIG_HOME: sandbox.path("hasna", "config"),
    HASNA_DATA_HOME: sandbox.path("hasna", "data"),
    HASNA_STATE_HOME: sandbox.path("hasna", "state"),
    HASNA_CACHE_HOME: sandbox.path("hasna", "cache"),
    HASNA_TRASH_API_URL: undefined,
    HASNA_TRASH_BUCKET: undefined,
    HASNA_TRASH_LOCAL: undefined,
    HASNA_TRASH_API_KEY: undefined,
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  mkdirSync(env.HOME as string, { recursive: true });
  return env;
}

/** True when two paths live on the same filesystem — used to skip EXDEV tests. */
export function sameDevice(a: string, b: string): boolean {
  return statSync(a).dev === statSync(b).dev;
}

/**
 * A spawn-able environment: `testEnv` values with the `undefined` entries
 * dropped (Bun.spawn rejects a non-string value rather than ignoring it).
 */
export function spawnEnv(sandbox: Sandbox, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(testEnv(sandbox, extra))) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function readdirCount(dir: string): number {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith(".tmp-")).length;
  } catch {
    return 0;
  }
}

export { PREFIX as SANDBOX_PREFIX };
