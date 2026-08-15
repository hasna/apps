import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

const DEPRECATION = "uptime is renamed to uptimemon";

/**
 * Build-freshness gate.
 *
 * Every assertion below runs the *built* artifacts named in `package.json#bin`,
 * because that is what an installed bin symlink actually executes. But `dist/`
 * is gitignored and the bare `bun test` runner never builds, so without this
 * gate the whole file happily asserts against a previous build: a fresh
 * checkout fails with an inscrutable "module not found", and — far worse — a
 * tree whose source has regressed still passes green against a stale `dist/`.
 * A test that cannot fail when the behaviour it guards is removed is not a
 * guard, so this runs at module scope and takes the entire file down with a
 * named cause rather than letting any test report a result it did not earn.
 */
function newestSourceFile(dir: string): { path: string; mtimeMs: number } {
  let newest = { path: dir, mtimeMs: 0 };
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // `parentPath` is the current Node/Bun field; `path` is its deprecated alias.
    const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath ?? entry.path;
    const full = join(parent, entry.name);
    const { mtimeMs } = statSync(full);
    if (mtimeMs > newest.mtimeMs) newest = { path: full, mtimeMs };
  }
  return newest;
}

const REBUILD = 'Run "bun run build" (or "bun run test", which now builds first) and re-run.';
const newestSource = newestSourceFile(join(root, "src"));

for (const [name, binPath] of Object.entries(pkg.bin)) {
  const absolute = join(root, binPath);
  if (!existsSync(absolute)) {
    throw new Error(
      `STALE BUILD: bin "${name}" -> ${binPath} does not exist.\n` +
        `These tests execute built artifacts, and dist/ is gitignored and not built by "bun test".\n` +
        REBUILD,
    );
  }
  if (statSync(absolute).mtimeMs < newestSource.mtimeMs) {
    throw new Error(
      `STALE BUILD: bin "${name}" -> ${binPath} is older than ${relative(root, newestSource.path)}.\n` +
        `dist/ does not reflect current src/, so these tests would assert against a previous build ` +
        `and could pass while the behaviour under test is regressed.\n` +
        REBUILD,
    );
  }
}

function runEntry(entry: string, args: string[], dbPath: string) {
  const result = Bun.spawnSync({
    cmd: ["bun", entry, ...args],
    cwd: root,
    env: { ...process.env, HASNA_UPTIME_DB: dbPath, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function withDb<T>(fn: (dbPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "uptime-bin-rename-"));
  try {
    return fn(join(dir, "uptime.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("package declares uptimemon as the real bin and keeps uptime as a transition bin", () => {
  // The retired name must still be published this release, pointing at the shim.
  expect(pkg.bin.uptimemon).toBe("dist/cli/index.js");
  expect(pkg.bin.uptime).toBe("dist/cli/deprecated-uptime.js");
  // uptime-mcp is already namespaced and is explicitly out of scope for the rename.
  expect(pkg.bin["uptime-mcp"]).toBe("dist/mcp/index.js");

  for (const binPath of Object.values(pkg.bin)) {
    const absolute = join(root, binPath);
    expect(existsSync(absolute)).toBe(true);
    // A bin that is not executable cannot be run through the installed symlink.
    expect(statSync(absolute).mode & 0o111).not.toBe(0);
  }
});

test("both bin entries carry a shebang so the installed symlink is executable", () => {
  for (const binPath of [pkg.bin.uptimemon, pkg.bin.uptime]) {
    const contents = readFileSync(join(root, binPath), "utf8");
    expect(contents.startsWith("#!")).toBe(true);
  }
});

test("both names resolve to the same CLI and report the same version", () => {
  withDb((dbPath) => {
    const renamed = runEntry(pkg.bin.uptimemon, ["--version"], dbPath);
    const retired = runEntry(pkg.bin.uptime, ["--version"], dbPath);

    expect(renamed.exitCode).toBe(0);
    expect(retired.exitCode).toBe(0);
    // Same entry behind both names: identical stdout.
    expect(retired.stdout).toBe(renamed.stdout);
  });
});

test("the deprecation notice appears on the retired name only, and only on stderr", () => {
  withDb((dbPath) => {
    const renamed = runEntry(pkg.bin.uptimemon, ["list"], dbPath);
    const retired = runEntry(pkg.bin.uptime, ["list"], dbPath);

    // Retired name warns, on stderr, exactly once.
    expect(retired.stderr).toContain(DEPRECATION);
    expect(retired.stderr.split(DEPRECATION).length - 1).toBe(1);
    // Never on stdout: stdout is the machine-readable surface.
    expect(retired.stdout).not.toContain(DEPRECATION);

    // The new name is silent on both streams.
    expect(renamed.stderr).not.toContain(DEPRECATION);
    expect(renamed.stdout).not.toContain(DEPRECATION);
  });
});

test("the retired name still does its job rather than just warning", () => {
  withDb((dbPath) => {
    const renamed = runEntry(pkg.bin.uptimemon, ["list"], dbPath);
    const retired = runEntry(pkg.bin.uptime, ["list"], dbPath);

    // A deprecation notice that breaks the command is not a transition.
    expect(retired.exitCode).toBe(renamed.exitCode);
    expect(retired.stdout).toBe(renamed.stdout);
  });
});

test("--json output stays clean on the retired name despite the deprecation line", () => {
  withDb((dbPath) => {
    const retired = runEntry(pkg.bin.uptime, ["list", "--json"], dbPath);
    const renamed = runEntry(pkg.bin.uptimemon, ["list", "--json"], dbPath);

    expect(retired.exitCode).toBe(0);
    // The whole of stdout must parse: a warning leaking onto stdout would break this.
    expect(() => JSON.parse(retired.stdout)).not.toThrow();
    expect(JSON.parse(retired.stdout)).toEqual(JSON.parse(renamed.stdout));
    // And the warning must still have been emitted, on the other stream.
    expect(retired.stderr).toContain(DEPRECATION);
  });
});
