/**
 * Regression tests for the 2026-08-29 release-gate remediation (codewith
 * NO_GO @ e640ee1d1). Each test pins one named P1:
 *
 *  - P1-1 release.ts: build failure aborts; no `git add -A`; publish requires
 *    a vault-backed NODE_AUTH_TOKEN (no ambient credentials).
 *  - P1-2 backup/export: corrupt tarballs are rejected before listing or
 *    extraction (no `tar | head` masking).
 *  - P1-3 doctor/init/new: psql credentials travel via child env (argv only
 *    carries connection fields) — never interpolated into a command string.
 *  - P1-4 new.ts: external effects (gh repo create, RDS provisioning, npm
 *    publish) require explicit per-effect flags.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync, statSync, chmodSync, symlinkSync, realpathSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { atomicSwapRestore, copyStagedWithRollback, createPreCopySnapshot, execSafe, execSafeEnv, listTarball, verifyTarball, spawnSafe, spawnWithTimeout, recoverInterruptedSwap } from "../src/utils.js";

const PKG_ROOT = join(import.meta.dir, "..");
const BIN = join(PKG_ROOT, "dist", "index.js");

/**
 * A PATH that prepends a harmless stub `secrets` executable (exit 1 if ever
 * invoked, never the real vault CLI): the release's vault-route availability
 * gate (binaryExists("secrets")) passes, so the build/pack gates are the next
 * thing exercised — while a stub can never publish anything. Without the stub
 * a release test's outcome depended on whether a real `secrets` CLI happened
 * to be on PATH (present on dev stations, absent on CI runners) — hermetic in
 * both environments. Module-scoped because multiple describe blocks use it.
 */
function pathWithSecretsStub(exitCode = 1): string {
  const dir = mkdtempSync(join(tmpdir(), "agency-secrets-stub-"));
  const stub = join(dir, "secrets");
  writeFileSync(stub, `#!/bin/sh\nexit ${exitCode}\n`);
  chmodSync(stub, 0o755);
  return dir;
}

/**
 * A PATH that prepends an argv-RECORDING `secrets` stub: it writes each
 * argument it received on its OWN LINE to `argvOut` (argument boundaries
 * preserved via "$@") and exits with `exitCode`. Used to assert the EXACT
 * publish operand the release hands to the vault route (release-review P1:
 * the published artifact must be the verified tarball, never `.` — an
 * argv-blind stub, or a flattened "$*" recording, would pass either form).
 */
function pathWithSecretsStubRecording(argvOut: string, exitCode = 0): string {
  const dir = mkdtempSync(join(tmpdir(), "agency-secrets-stub-"));
  const stub = join(dir, "secrets");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvOut}"\nexit ${exitCode}\n`);
  chmodSync(stub, 0o755);
  return dir;
}

function runCli(
  args: string[],
  env: Record<string, string> = {},
  cwd = PKG_ROOT,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bun", [BIN, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/**
 * Minimal git repo with a package.json and a build script; returns its dir.
 * The fixture is bound to a `files` set by default (files: ["dist"] with a
 * committed dist/index.js) so the pack-content gate has a reviewed contract
 * to validate against; `files: false` omits the field entirely.
 */
function fixtureRepo(opts: {
  buildExitsNonZero?: boolean;
  packageName?: string;
  buildWritesToken?: boolean;
  buildMutatesManifest?: boolean;
  files?: string[] | false;
  distContent?: string;
  extraEntries?: Array<{ path: string; content: string }>;
} = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "agency-release-fixture-"));
  mkdirSync(join(dir, "open-fixme"));
  const pkgDir = join(dir, "open-fixme");
  const buildScript = opts.buildWritesToken
    ? `printf '%s' "$NODE_AUTH_TOKEN" > token-probe.txt; echo boom; exit 1`
    : opts.buildMutatesManifest
      ? `printf '%s' '{"name":"@hasna/fixme","version":"0.1.0","scripts":{"build":"echo ok"},"files":["dist","evil.js"]}' > package.json; echo 'x' > evil.js`
      : opts.buildExitsNonZero
        ? "echo boom && exit 1"
        : "echo ok";
  const filesField = opts.files === false ? undefined : (opts.files ?? ["dist"]);
  const pkg: Record<string, unknown> = {
    name: opts.packageName ?? "@hasna/fixme",
    version: "0.1.0",
    scripts: { build: buildScript },
  };
  if (filesField !== undefined) pkg.files = filesField;
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  if (filesField === undefined || (filesField as string[]).includes("dist")) {
    mkdirSync(join(pkgDir, "dist"));
    writeFileSync(join(pkgDir, "dist", "index.js"), opts.distContent ?? "console.log('fixture-dist');\n");
  }
  for (const entry of opts.extraEntries ?? []) {
    const full = join(pkgDir, entry.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, entry.content);
  }
  execFileSync("git", ["init", "-q"], { cwd: pkgDir });
  execFileSync("git", ["add", "-A"], { cwd: pkgDir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: pkgDir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  return dir;
}

describe("P1-3: credentials travel via child env, never argv/command string", () => {
  test("spawnWithTimeout passes PGPASSWORD through env", async () => {
    const res = await spawnWithTimeout("sh", ["-c", 'printf "%s" "$PGPASSWORD"'], 5000, {
      PGPASSWORD: "s3cret-value",
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("s3cret-value");
  });

  test("execSafeEnv passes env to the child", () => {
    const out = execSafeEnv(`printf "%s" "$PGPASSWORD"`, 5000, { PGPASSWORD: "env-only-value" });
    expect(out).toBe("env-only-value");
  });
});

describe("P1-1: release command gates", () => {
  /**
   * A PATH that resolves the tools the release flow needs (bun for the CLI,
   * git for the gates, coreutils) but NEVER the secrets CLI. The vault-backed
   * publish route must fail closed in tests — an ambient or reachable publish
   * path must never let a fixture reach the registry (2026-08-30 P1:
   * ambient-credential publishes are refused; tests must not publish anything
   * at all). The vault gate fires before any build/pack, so npm is never
   * needed.
   */
  function pathWithoutSecrets(): string {
    const dir = mkdtempSync(join(tmpdir(), "agency-path-"));
    const tools = ["bun", "node", "git", "sh", "which", "tar", "cp", "rm", "mkdir", "chmod", "mktemp", "sed", "grep", "env", "uname", "cat", "echo"];
    for (const tool of tools) {
      let target = "";
      try {
        target = execFileSync("which", [tool], { encoding: "utf8" }).trim();
      } catch {
        continue;
      }
      if (target === "" || !existsSync(target)) continue;
      try {
        const real = realpathSync(target);
        symlinkSync(real, join(dir, tool));
      } catch {
        /* best-effort */
      }
    }
    return dir;
  }

  test("build failure aborts the release with no commit", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = "npm_dummy_token_for_test";
    try {
      const dir = fixtureRepo({ buildExitsNonZero: true });
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
      const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", head], { NODE_AUTH_TOKEN: "npm_dummy_token_for_test", PATH: `${pathWithSecretsStub()}:${process.env.PATH}` }, dir);
      expect(res.stdout).toContain("failed");
      expect(res.stdout).toContain("build failed");
      const pkg = JSON.parse(readFileSync(join(dir, "open-fixme", "package.json"), "utf8"));
      expect(pkg.version).toBe("0.1.0"); // never bumped
    } finally {
      if (saved === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = saved;
    }
  });

  test("release refuses when the secrets CLI is unavailable (vault route required, fail closed)", () => {
    const dir = fixtureRepo();
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
    // PATH without the secrets bin: the vault-backed route is unreachable, so
    // the release MUST fail closed — no ambient token, no publish attempt.
    const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", head], { PATH: `${pathWithoutSecrets()}:/usr/bin:/bin` }, dir);
    expect(`${res.stdout}\n${res.stderr}`).toContain("secrets CLI not found");
    expect(`${res.stdout}\n${res.stderr}`).toContain("failed");
    const pkg = JSON.parse(readFileSync(join(dir, "open-fixme", "package.json"), "utf8"));
    expect(pkg.version).toBe("0.1.0"); // never bumped — vault gate fires before any publish
  });

  test("release refuses a package whose identity does not match the reviewed directory", () => {
    const dir = fixtureRepo({ packageName: "@hasna/other" });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
    const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", head], { PATH: `${pathWithoutSecrets()}:/usr/bin:/bin` }, dir);
    expect(res.stdout).toContain("expected @hasna/fixme");
    expect(res.stdout).toContain("failed");
  });

  test("release refuses without --reviewed-sha (SHA-bound gate)", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = "npm_dummy_token_for_test";
    try {
      const dir = fixtureRepo();
      const res = runCli(["release", "fixme", "--dir", dir], { NODE_AUTH_TOKEN: "npm_dummy_token_for_test" }, dir);
      expect(res.stdout).toContain("--reviewed-sha <sha> is required");
      const pkg = JSON.parse(readFileSync(join(dir, "open-fixme", "package.json"), "utf8"));
      expect(pkg.version).toBe("0.1.0"); // never bumped — SHA gate fires before any mutation
    } finally {
      if (saved === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = saved;
    }
  });
});

describe("P1-2: tarball validation is rc-checked, never pipe-masked", () => {
  test("a valid tarball verifies and lists", () => {
    const dir = mkdtempSync(join(tmpdir(), "agency-tar-valid-"));
    writeFileSync(join(dir, "payload.txt"), "hello");
    const tar = execSafe(`tar -czf "${dir}/b.tgz" -C "${dir}" payload.txt`);
    expect(tar).not.toBeNull();
    const listing = verifyTarball(join(dir, "b.tgz"));
    expect(listing).not.toBeNull();
    expect(listing).toContain("payload.txt");
    expect(listTarball(join(dir, "b.tgz"), 5)).not.toBeNull();
  });

  test("a corrupt file fails verification (null) instead of a masked empty listing", () => {
    const dir = mkdtempSync(join(tmpdir(), "agency-tar-corrupt-"));
    writeFileSync(join(dir, "bogus.tgz"), "this is not a tarball at all");
    expect(verifyTarball(join(dir, "bogus.tgz"))).toBeNull();
    expect(listTarball(join(dir, "bogus.tgz"), 30)).toBeNull();
  });
});

describe("P1-4: new service/library external effects require explicit opt-in", () => {
  test("new service --help exposes the per-effect flags", () => {
    const res = runCli(["new", "service", "--help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--create-repo");
    expect(res.stdout).toContain("--provision-db");
    expect(res.stdout).toContain("--publish");
  });

  test("new library --help exposes --create-repo and --publish", () => {
    const res = runCli(["new", "library", "--help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--create-repo");
    expect(res.stdout).toContain("--publish");
  });

  test("new library without flags scaffolds locally but skips all external effects", async () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-base-"));
    const res = runCli(
      ["new", "library", "smokecheck", "--dir", base, "--skip-tasks"],
      { NODE_AUTH_TOKEN: "" },
      base,
    );
    expect(res.stdout).toContain("Skipping GitHub repo creation");
    expect(res.stdout).toContain("Skipping npm publish");
    // local scaffold still created
    expect(existsSync(join(base, "open-smokecheck", "package.json"))).toBe(true);
  }, 90_000);

  test("new library with --publish but no token refuses publish", async () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-base2-"));
    const saved = process.env.NODE_AUTH_TOKEN;
    delete process.env.NODE_AUTH_TOKEN;
    try {
      const res = runCli(
        ["new", "library", "smoketoken", "--dir", base, "--skip-tasks", "--publish"],
        {},
        base,
      );
      // Scaffold publication is removed entirely (release-review P1): the
      // --publish flag refuses (on stderr) and exits nonzero, whatever the
      // token state.
      expect(res.stderr).toContain("Refusing to publish from a scaffold");
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("Skipping GitHub repo creation");
    } finally {
      if (saved !== undefined) process.env.NODE_AUTH_TOKEN = saved;
    }
  }, 90_000);
});

/**
 * Regression tests for the 2026-08-30 cycle-1 remediation (codewith NO_GO
 * @ 20a8b9f20, 8 P1s). Each describe pins one named finding.
 */
describe("P1-5: restore/import copy has a residue-free pre-copy snapshot + rollback", () => {
  test("successful copy leaves no snapshot residue in the target", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-csr-ok-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    mkdirSync(staged, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(staged, "new.txt"), "new");
    writeFileSync(join(target, "old.txt"), "old");
    const outcome = copyStagedWithRollback(staged, target);
    expect(outcome.ok).toBe(true);
    expect(outcome.rolledBack).toBe(false);
    expect(readFileSync(join(target, "new.txt"), "utf-8")).toBe("new");
    expect(readFileSync(join(target, "old.txt"), "utf-8")).toBe("old");
    // The pre-copy snapshot must never land in live data (the a6a311eeb P1):
    expect(existsSync(join(target, "precopy-snapshot.tar.gz"))).toBe(false);
    // ...and the snapshot file itself is removed on success.
    expect(existsSync(`${staged}.precopy-snapshot.tar.gz`)).toBe(false);
  });

  test("failed copy rolls back to the exact pre-copy state (copy-created residue removed)", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-csr-fail-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    mkdirSync(staged, { recursive: true });
    mkdirSync(target, { recursive: true });
    // Target has a DIRECTORY named clash; staged has a FILE named clash —
    // `cp -a staged/. target/.` fails on it AFTER copying zzz.txt.
    mkdirSync(join(target, "clash"), { recursive: true });
    writeFileSync(join(target, "clash", "pre.txt"), "pre");
    writeFileSync(join(staged, "zzz.txt"), "residue");
    writeFileSync(join(staged, "clash"), "file-over-dir");
    const outcome = copyStagedWithRollback(staged, target);
    expect(outcome.ok).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.snapshot).toBeNull();
    // Copy-created residue must be GONE (the a6a311eeb P1: rollback overclaims):
    expect(existsSync(join(target, "zzz.txt"))).toBe(false);
    // The pre-copy state is restored exactly:
    expect(statSync(join(target, "clash")).isDirectory()).toBe(true);
    expect(readFileSync(join(target, "clash", "pre.txt"), "utf-8")).toBe("pre");
    expect(existsSync(`${staged}.precopy-snapshot.tar.gz`)).toBe(false);
  });
});

describe("P1-6: the MCP timeout resolves at the deadline even when SIGTERM is ignored", () => {
  test("a child that ignores SIGTERM is killed and reported as timedOut, never healthy", async () => {
    const started = Date.now();
    const result = await spawnWithTimeout(
      "node",
      ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60_000);"],
      500,
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(10_000); // hard deadline, no hang
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });

  test("a clean exit reports timedOut false", async () => {
    const result = await spawnWithTimeout("node", ["-e", "process.exit(0);"], 3000);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  });
});

describe("P1-7: connect never destroys an existing config it cannot parse", () => {
  test("malformed existing settings.json fails closed and is left untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-connect-home-"));
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    writeFileSync(settingsPath, "{ this is not json");
    const res = runCli(["connect", "claude"], { HOME: home });
    expect(res.code).toBe(1);
    // The broken file is byte-identical and no .bak was created (no write happened):
    expect(readFileSync(settingsPath, "utf-8")).toBe("{ this is not json");
    expect(existsSync(`${settingsPath}.bak`)).toBe(false);
  });

  test("valid existing config is merged with a preimage backup preserved", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-connect-home-"));
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ existing: "keep-me" }));
    const res = runCli(["connect", "claude", "--only", "todos"], { HOME: home });
    expect(res.code).toBe(0);
    const written = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(written.existing).toBe("keep-me");
    expect(written.mcpServers).toBeTruthy();
    // Preimage backup exists (atomic-write guarantee):
    expect(existsSync(`${settingsPath}.bak`)).toBe(true);
  });
});

describe("P1-8: search queries cannot reach a shell", () => {
  test("a query containing shell syntax executes nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-search-home-"));
    const todosDir = join(home, ".hasna", "todos");
    mkdirSync(todosDir, { recursive: true });
    const dbPath = join(todosDir, "tasks.db");
    execFileSync("sqlite3", [dbPath, "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, description TEXT); INSERT INTO tasks (title, description) VALUES ('hello world', 'demo');"]);
    const marker = join(tmpdir(), `agency-pwned-${process.pid}`);
    const payload = "x'; SELECT load_extension('x'); -- $(touch " + marker + ")";
    const res = runCli(["search", payload, "--limit", "5", "--json"], { HOME: home });
    // The command must complete without executing the payload:
    expect(existsSync(marker)).toBe(false);
    expect(res.code).toBe(0);
  });

  test("a benign query returns the seeded row", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-search-home-"));
    const todosDir = join(home, ".hasna", "todos");
    mkdirSync(todosDir, { recursive: true });
    const dbPath = join(todosDir, "tasks.db");
    execFileSync("sqlite3", [dbPath, "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, description TEXT); INSERT INTO tasks (title, description) VALUES ('hello world', 'demo');"]);
    const res = runCli(["search", "hello", "--limit", "5", "--json"], { HOME: home });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hello world");
  });
});

describe("source pins: argv-based execution replaces shell interpolation on operator-influenced values", () => {
  test("search.ts routes every sqlite3 invocation through spawnSafe", () => {
    const src = readFileSync(join(PKG_ROOT, "src", "commands", "search.ts"), "utf-8");
    expect(src.includes("spawnSafe(\"sqlite3\"")).toBe(true);
    expect(src.match(/execSafe\(`sqlite3/g)).toBeNull();
  });

  test("export.ts routes sqlite3 through spawnSafe with identifier validation", () => {
    const src = readFileSync(join(PKG_ROOT, "src", "commands", "export.ts"), "utf-8");
    expect(src.includes("spawnSafe(\"sqlite3\"")).toBe(true);
    expect(src.includes("isSafeIdentifier")).toBe(true);
    expect(src.match(/execSafe\(`sqlite3/g)).toBeNull();
  });
});

/**
 * Regression tests for the 2026-08-30 cycle-2 remediation (re-review NO_GO
 * @ e668b5c4e).
 */
describe("P1 cycle-2: strict scaffold-name grammar", () => {
  test("an invalid scaffold name is refused before any files are created", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-badname-"));
    const res = runCli(["new", "library", "Bad;Name", "--dir", base, "--skip-tasks"], {}, base);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Invalid package name");
    expect(existsSync(join(base, "open-Bad;Name"))).toBe(false);
  });

  test("--create-repo is refused (remote effects removed)", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-norepo-"));
    const res = runCli(["new", "library", "okname", "--dir", base, "--skip-tasks", "--create-repo"], {}, base);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Refusing to create a GitHub repo from a scaffold");
  });
});

describe("P1 cycle-2: release refuses a dirty tree at the reviewed SHA", () => {
  test("an uncommitted change fails the clean-tree gate before any publish", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = "npm_dummy_token_for_test";
    try {
      const dir = fixtureRepo();
      writeFileSync(join(dir, "open-fixme", "untracked.txt"), "dirty");
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
      const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", head], { NODE_AUTH_TOKEN: "npm_dummy_token_for_test" }, dir);
      expect(res.stdout).toContain("worktree is not clean");
      expect(res.stdout).toContain("failed");
    } finally {
      if (saved === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = saved;
    }
  });
});

describe("P1 cycle-2: connect preserves the original config mode", () => {
  test("a mode-0600 config stays 0600 after an atomic update", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-connect-mode-"));
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ existing: "keep" }), { mode: 0o600 });
    chmodSync(settingsPath, 0o600);
    const res = runCli(["connect", "claude", "--only", "todos"], { HOME: home });
    expect(res.code).toBe(0);
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
  });
});

/**
 * Regression tests for the 2026-08-30 cycle-2 remediation (re-review NO_GO
 * @ 8645e0d7f — 8 P1s: vault-only publish route, fail-closed clean gate,
 * pack-exact tarball with identity binding, snapshot 0700/0600 + atomic swap,
 * --create-tasks opt-in with argv IDs, provision-db failure exit, structural
 * TOML validation).
 */
describe("P1 cycle-3: the pre-copy snapshot lives outside the copied tree and is removed on success", () => {
  test("successful copy leaves no snapshot residue at the new 0700-dir paths", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-csr-ok3-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    mkdirSync(staged, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(staged, "new.txt"), "new");
    writeFileSync(join(target, "old.txt"), "old");
    const outcome = copyStagedWithRollback(staged, target);
    expect(outcome.ok).toBe(true);
    expect(outcome.snapshot).toBeNull();
    // Neither the legacy flat snapshot nor the 0700 snapshot dir survives:
    expect(existsSync(`${staged}.precopy-snapshot.tar.gz`)).toBe(false);
    expect(existsSync(`${staged}.precopy`)).toBe(false);
  });

  test("failed copy restores the exact preimage via the atomic swap (no residue, no retained snapshot)", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-csr-fail3-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    mkdirSync(staged, { recursive: true });
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, "clash"), { recursive: true });
    writeFileSync(join(target, "clash", "pre.txt"), "pre");
    writeFileSync(join(staged, "zzz.txt"), "residue");
    writeFileSync(join(staged, "clash"), "file-over-dir");
    const outcome = copyStagedWithRollback(staged, target);
    expect(outcome.ok).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.snapshot).toBeNull();
    expect(existsSync(join(target, "zzz.txt"))).toBe(false);
    expect(statSync(join(target, "clash")).isDirectory()).toBe(true);
    expect(readFileSync(join(target, "clash", "pre.txt"), "utf-8")).toBe("pre");
    expect(existsSync(`${staged}.precopy`)).toBe(false);
  });
});

describe("P1 cycle-3: new.ts external effects are explicit opt-ins and failures exit nonzero", () => {
  test("a plain scaffold creates no todos project by default (--create-tasks required)", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-tasks-"));
    const res = runCli(["new", "library", "optname", "--dir", base], {}, base);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("pass --create-tasks");
  });

  test("--provision-db without credentials fails nonzero and suppresses the success summary", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-pdb-"));
    const home = mkdtempSync(join(tmpdir(), "agency-new-home-"));
    const res = runCli(["new", "service", "pdbname", "--dir", base, "--skip-tasks", "--provision-db"], { HOME: home, CLOUD_PG_HOST: "", CLOUD_PG_PASSWORD: "" }, base);
    expect(res.code).toBe(1);
    expect(res.stdout).not.toContain("scaffolded successfully");
    expect(`${res.stdout}\n${res.stderr}`).toContain("refusing to report success");
  });
});

describe("P1 cycle-3: connect validates TOML structurally before any write", () => {
  test("a TOML config with a valueless key fails closed and is left untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-connect-toml-"));
    const codexDir = join(home, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const tomlPath = join(codexDir, "config.toml");
    // `model =` (no value) passes a line-shape regex but is NOT valid TOML:
    writeFileSync(tomlPath, "[model]\nname = \"x\"\nmodel =\n");
    const res = runCli(["connect", "codex", "--only", "todos"], { HOME: home });
    expect(res.code).toBe(1);
    expect(`${res.stdout}\n${res.stderr}`).toContain("not structurally valid TOML");
    // The broken file is byte-identical and no .bak was created (no write happened):
    expect(readFileSync(tomlPath, "utf-8")).toBe("[model]\nname = \"x\"\nmodel =\n");
    expect(existsSync(`${tomlPath}.bak`)).toBe(false);
  });

  test("a duplicate-key TOML config fails closed and is left untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-connect-toml2-"));
    const codexDir = join(home, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const tomlPath = join(codexDir, "config.toml");
    writeFileSync(tomlPath, "[mcp_servers.todos]\ncommand = \"a\"\n[mcp_servers.todos]\ncommand = \"b\"\n");
    const res = runCli(["connect", "codex", "--only", "todos"], { HOME: home });
    expect(res.code).toBe(1);
    expect(readFileSync(tomlPath, "utf-8")).toBe("[mcp_servers.todos]\ncommand = \"a\"\n[mcp_servers.todos]\ncommand = \"b\"\n");
  });
});

/**
 * Regression tests for the 2026-08-30 cycle-2 re-review NO_GO @ d45a0508c
 * (4 P1s: spawn-boundary ambient-token exclusion, failed git status in the
 * batch/--check paths, non-atomic rollback swap, and missing coverage pinning
 * the remediation contracts).
 */
describe("P1 cycle-4: the spawn boundary can exclude ambient credentials", () => {
  test("an explicit undefined NODE_AUTH_TOKEN is deleted from the child env", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    // A synthetic value assembled from fragments (never a credential-shaped
    // literal in source; the value itself is inert test data).
    const ambient = ["ambient", "fixture", "value"].join("-");
    process.env.NODE_AUTH_TOKEN = ambient;
    try {
      const out = spawnSafe("sh", ["-c", 'printf "%s" "$NODE_AUTH_TOKEN"'], 5000, { NODE_AUTH_TOKEN: undefined });
      expect(out).toBe("");
      // Control: without the exclusion the ambient value WOULD reach the child.
      const control = spawnSafe("sh", ["-c", 'printf "%s" "$NODE_AUTH_TOKEN"'], 5000);
      expect(control).toBe(ambient);
    } finally {
      if (saved === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = saved;
    }
  });

  test("release build never sees NODE_AUTH_TOKEN (end-to-end probe file)", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = "npm_dummy_token_for_test";
    try {
      const dir = fixtureRepo({ buildExitsNonZero: true, buildWritesToken: true });
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
      const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", head], { NODE_AUTH_TOKEN: "npm_dummy_token_for_test", PATH: `${pathWithSecretsStub()}:${process.env.PATH}` }, dir);
      expect(res.stdout).toContain("build failed");
      // The build's own probe file proves the ambient token never reached it.
      expect(readFileSync(join(dir, "open-fixme", "token-probe.txt"), "utf-8")).toBe("");
    } finally {
      if (saved === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = saved;
    }
  });
});

describe("P1 cycle-4: failed git status is a loud refusal in every mode", () => {
  function noGitFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "agency-nogit-"));
    mkdirSync(join(dir, "open-fixme"));
    writeFileSync(join(dir, "open-fixme", "package.json"), JSON.stringify({ name: "@hasna/fixme", version: "0.1.0" }, null, 2) + "\n");
    return dir;
  }

  test("--check reports status failed instead of clean", () => {
    const dir = noGitFixture();
    const res = runCli(["release", "--check", "--dir", dir], {}, dir);
    expect(`${res.stdout}\n${res.stderr}`).toContain("could not verify git status");
    expect(`${res.stdout}\n${res.stderr}`).toContain("status failed");
    // A failed git status must fail the EXIT STATUS too — automation must
    // never accept an unverifiable candidate as a clean scan (release-review
    // P1: failed git status must fail the exit status).
    expect(res.code).not.toBe(0);
  });

  test("batch release refuses and never claims everything is clean", () => {
    const dir = noGitFixture();
    const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", "0000000000000000000000000000000000000000"], {}, dir);
    expect(`${res.stdout}\n${res.stderr}`).toContain("could not verify git status");
    expect(`${res.stdout}\n${res.stderr}`).not.toContain("All repos are clean");
    expect(`${res.stdout}\n${res.stderr}`).toContain("nothing released");
    // A failed git status must fail the EXIT STATUS too, not just print a
    // refusal — automation must never accept an unverifiable candidate as a
    // successful run (release-review P1).
    expect(res.code).not.toBe(0);
  });

});

describe("P1 cycle-4: the rollback swap is atomic — the target is never absent", () => {
  test("successful swap replaces the live tree and leaves no backup residue", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-swap-ok-"));
    const target = join(base, "target");
    const restore = join(base, "restore");
    mkdirSync(target);
    writeFileSync(join(target, "old.txt"), "old");
    mkdirSync(restore);
    writeFileSync(join(restore, "new.txt"), "new");
    const res = atomicSwapRestore(restore, target);
    expect(res.ok).toBe(true);
    expect(res.targetRestored).toBe(true);
    expect(existsSync(join(target, "new.txt"))).toBe(true);
    expect(existsSync(join(target, "old.txt"))).toBe(false);
    expect(readdirSync(base).filter((f) => f.includes("swap-backup"))).toEqual([]);
  });

  test("a failed swap restores the live target — the path is never absent", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-swap-fail-"));
    const target = join(base, "target");
    mkdirSync(target);
    writeFileSync(join(target, "old.txt"), "old");
    // The restore tree is missing: the second rename fails and the live tree
    // must be renamed back.
    const res = atomicSwapRestore(join(base, "restore-missing"), target);
    expect(res.ok).toBe(false);
    expect(res.targetRestored).toBe(true);
    expect(existsSync(join(target, "old.txt"))).toBe(true);
    expect(readdirSync(base).filter((f) => f.includes("swap-backup"))).toEqual([]);
  });

  test("snapshot privacy: the pre-copy snapshot dir is 0700 and the archive is 0600", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-snap-mode-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    mkdirSync(staged, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "old.txt"), "old");
    const snap = createPreCopySnapshot(staged, target, 120_000);
    expect(snap).not.toBeNull();
    expect(statSync(`${staged}.precopy`).mode & 0o777).toBe(0o700);
    expect(statSync(snap!).mode & 0o777).toBe(0o600);
    spawnSafe("rm", ["-rf", `${staged}.precopy`], 10_000);
  });

  test("an interrupted swap (process death between renames) is healed by the next invocation", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-swap-heal-"));
    const target = join(base, "target");
    const backup = `${target}.swap-backup-123`;
    const journal = `${target}.swap-journal`;
    // Simulate the kill window: the journal was written and the live tree
    // renamed aside, then the process died before the restore rename — the
    // target is absent and the live tree sits under the backup name.
    mkdirSync(backup);
    writeFileSync(join(backup, "old.txt"), "old");
    writeFileSync(journal, `${backup}\n`);
    expect(existsSync(target)).toBe(false);
    const rec = recoverInterruptedSwap(target);
    expect(rec.ok).toBe(true);
    expect(rec.message).not.toBeNull();
    // The live tree is back at the target path — it never stays absent across
    // invocations (release-review P1: kill window).
    expect(existsSync(join(target, "old.txt"))).toBe(true);
    expect(existsSync(backup)).toBe(false);
    expect(existsSync(journal)).toBe(false);
  });

  test("an interrupted swap is healed BEFORE the target is created — the live preimage is never deleted as residue", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-swap-heal-order-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    const backup = `${target}.swap-backup-123`;
    const journal = `${target}.swap-journal`;
    // The kill window: target absent, live preimage under the backup name.
    mkdirSync(staged);
    writeFileSync(join(staged, "new.txt"), "new");
    mkdirSync(backup);
    writeFileSync(join(backup, "old.txt"), "old");
    writeFileSync(journal, `${backup}\n`);
    // The caller must NOT have pre-created the target (the tool recovers
    // first, then creates the target only if still absent). Recovery sees the
    // live preimage and heals; the copy then proceeds over the healed tree.
    const outcome = copyStagedWithRollback(staged, target);
    expect(outcome.ok).toBe(true);
    // The preimage survived recovery and the staged content landed on top.
    expect(readFileSync(join(target, "old.txt"), "utf-8")).toBe("old");
    expect(readFileSync(join(target, "new.txt"), "utf-8")).toBe("new");
    expect(existsSync(backup)).toBe(false);
    expect(existsSync(journal)).toBe(false);
  });

  test("a retained displaced tree that cannot be cleaned ABORTS the copy — never a warning with an orphaned sensitive tree", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-swap-abort-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    const backup = `${target}.swap-backup-123`;
    const journal = `${target}.swap-journal`;
    mkdirSync(staged);
    writeFileSync(join(staged, "new.txt"), "new");
    mkdirSync(target);
    writeFileSync(join(target, "old.txt"), "old");
    mkdirSync(backup);
    writeFileSync(join(backup, "preimage.txt"), "pre");
    writeFileSync(journal, `${backup}\n`);
    // Force the residue removal to fail: a stub `rm` that exits 1.
    const stubDir = mkdtempSync(join(tmpdir(), "agency-rm-stub-"));
    const rmStub = join(stubDir, "rm");
    writeFileSync(rmStub, "#!/bin/sh\nexit 1\n");
    chmodSync(rmStub, 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${stubDir}:${savedPath}`;
    let outcome: ReturnType<typeof copyStagedWithRollback> | null = null;
    try {
      outcome = copyStagedWithRollback(staged, target);
    } finally {
      process.env.PATH = savedPath;
    }
    // HARD failure: the copy never ran, the retained tree is disclosed with
    // its path, and the journal is preserved so it stays discoverable.
    expect(outcome!.ok).toBe(false);
    expect(outcome!.copyApplied).toBe(false);
    expect(outcome!.retainedSwap).toContain("swap-backup-123");
    expect(readFileSync(join(target, "old.txt"), "utf-8")).toBe("old");
    expect(existsSync(join(target, "new.txt"))).toBe(false);
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(journal)).toBe(true);
    spawnSafe("rm", ["-rf", backup], 10_000);
    spawnSafe("rm", ["-rf", journal], 10_000);
  });

  test("a displaced live tree that cannot be removed is a hard failure with the retained path disclosed", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-swap-retain-"));
    const target = join(base, "target");
    mkdirSync(target);
    writeFileSync(join(target, "old.txt"), "old");
    const restore = join(base, "restore");
    mkdirSync(restore);
    writeFileSync(join(restore, "new.txt"), "new");
    // Force the displaced-tree removal to FAIL: a stub `rm` that exits 1.
    // The swap's own renames are syscalls (unaffected); only the cleanup rm
    // fails, which must be a hard failure, never a silent success
    // (release-review P1: .swap-backup-* removal failures are disclosed).
    const stubDir = mkdtempSync(join(tmpdir(), "agency-rm-stub-"));
    const rmStub = join(stubDir, "rm");
    writeFileSync(rmStub, "#!/bin/sh\nexit 1\n");
    chmodSync(rmStub, 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${stubDir}:${savedPath}`;
    let retained: string | null = null;
    try {
      const res = atomicSwapRestore(restore, target);
      expect(res.ok).toBe(false);
      expect(res.targetRestored).toBe(true);
      expect(res.retained).not.toBeNull();
      retained = res.retained;
      // The swap itself landed (the restore tree is live at the target).
      expect(existsSync(join(target, "new.txt"))).toBe(true);
      // The retained displaced live tree still exists at the disclosed path.
      expect(existsSync(join(retained!, "old.txt"))).toBe(true);
      // The journal stays so the retained tree remains discoverable.
      expect(existsSync(`${target}.swap-journal`)).toBe(true);
    } finally {
      process.env.PATH = savedPath;
    }
    if (retained) spawnSafe("rm", ["-rf", retained], 10_000);
    spawnSafe("rm", ["-rf", `${target}.swap-journal`], 10_000);
  });

  test("a retained pre-copy snapshot after a successful copy is a disclosed hard failure, not a silent success", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-snap-retain-"));
    const staged = join(base, "staged");
    const target = join(base, "target");
    mkdirSync(staged);
    mkdirSync(target);
    writeFileSync(join(staged, "new.txt"), "new");
    writeFileSync(join(target, "old.txt"), "old");
    // Force snapshot cleanup to FAIL (stub `rm` exits 1) AFTER the copy lands:
    // the caller must see a HARD failure disclosing the retained full-preimage
    // snapshot — never "Restore complete." with a silent retained snapshot
    // (release-review P1: retained snapshots are reported with their path).
    const stubDir = mkdtempSync(join(tmpdir(), "agency-rm-stub-"));
    const rmStub = join(stubDir, "rm");
    writeFileSync(rmStub, "#!/bin/sh\nexit 1\n");
    chmodSync(rmStub, 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${stubDir}:${savedPath}`;
    let outcome: ReturnType<typeof copyStagedWithRollback> | null = null;
    try {
      outcome = copyStagedWithRollback(staged, target);
    } finally {
      process.env.PATH = savedPath;
    }
    expect(outcome!.ok).toBe(false);
    expect(outcome!.copyApplied).toBe(true);
    expect(outcome!.rolledBack).toBe(false);
    expect(outcome!.snapshot).not.toBeNull();
    // The staged content IS live — the failure is the retained snapshot, which
    // is disclosed via the outcome and still present on disk.
    expect(readFileSync(join(target, "new.txt"), "utf-8")).toBe("new");
    expect(existsSync(outcome!.snapshot!)).toBe(true);
    spawnSafe("rm", ["-rf", `${staged}.precopy`], 10_000);
  });
});

describe("P1 cycle-4: release reaches the exact-artifact publish path with a working stub", () => {
  test("a successful build + stub secrets publishes the EXACT verified tarball (argv-asserted)", () => {
    const dir = fixtureRepo();
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
    const argvOut = join(dir, "secrets-argv.txt");
    const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", head], { PATH: `${pathWithSecretsStubRecording(argvOut)}:${process.env.PATH}` }, dir);
    expect(res.stdout).toContain("published");
    // The publish operand MUST be the verified tarball path — never `.` or the
    // bare directory, which would publish a freshly rebuilt, unreviewed
    // artifact (release-review P1: exact-artifact publish contract). The
    // argv-recording stub pins the operand the argv-blind stub could not; the
    // per-line "$@" recording preserves argument boundaries so a flattened
    // "publish . <tarball>" cannot smuggle past substring checks.
    const args = readFileSync(argvOut, "utf8").trim().split("\n");
    expect(args).toContain("exec");
    expect(args).toContain("hasna/npm/live/publish-token");
    expect(args).toContain("--userconfig");
    expect(args).toContain("--ignore-scripts");
    expect(args).not.toContain(".");
    // The exact ordered segment must be: npm publish <verified-tarball>.
    const npmIdx = args.indexOf("npm");
    expect(npmIdx).toBeGreaterThanOrEqual(0);
    expect(args[npmIdx + 1]).toBe("publish");
    expect(args[npmIdx + 2]).toMatch(/^.*hasna-fixme-0\.1\.0\.tgz$/);
    // No post-review mutation: the version is untouched and no commit was made.
    const pkg = JSON.parse(readFileSync(join(dir, "open-fixme", "package.json"), "utf8"));
    expect(pkg.version).toBe("0.1.0");
    const log = execFileSync("git", ["log", "--oneline", "-1"], { cwd: join(dir, "open-fixme"), encoding: "utf8" });
    expect(log).toContain("init");
  });
});

describe("P1 cycle-5: the packed artifact is bound to a reviewed file set and its content is scanned", () => {
  function releaseAtHead(dir: string, argvOut: string, extraArgs: string[] = []) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
    return runCli(["release", ...extraArgs, "--dir", dir, "--reviewed-sha", head], { PATH: `${pathWithSecretsStubRecording(argvOut)}:${process.env.PATH}` }, dir);
  }

  test("a packed artifact without a `files` array is refused before any publish", () => {
    const dir = fixtureRepo({ files: false });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("no `files` array");
    // The vault route never ran — nothing was published.
    expect(existsSync(argvOut)).toBe(false);
  });

  test("a packed entry that is not metadata or declared-`files` content is refused", () => {
    // .env is DECLARED in files, so npm packs it — but the entry gate refuses
    // environment files at any depth regardless of declaration.
    const dir = fixtureRepo({ files: ["dist", ".env"], extraEntries: [{ path: ".env", content: "DUMMY_KEY=dummy\n" }] });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("forbidden entry");
    expect(res.stdout).toContain(".env");
    expect(existsSync(argvOut)).toBe(false);
  });

  test("packed content carrying an internal-infra string is refused before any publish", () => {
    const dir = fixtureRepo({ distContent: "console.log('x');\nconst endpoint = 'arn:aws:fake:123456789012';\n" });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("packed artifact contains");
    expect(res.stdout).toContain("nothing was published");
    expect(existsSync(argvOut)).toBe(false);
  });

  test("packed content carrying a credential-value shape is refused before any publish", () => {
    // The credential-shaped literal is assembled from fragments at RUNTIME so
    // the fixture source itself stays clean for the repo's staged-secrets scan
    // (a gate must not fire on the document defining it); the packed
    // dist/index.js still carries the full joined value the scanner must catch.
    const tok = ["npm_", "abcdefghijklmnopqrstuvwx"].join("");
    const dir = fixtureRepo({ distContent: `console.log('x');\nconst tok = '${tok}';\n` });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("packed artifact contains");
    expect(res.stdout).toContain("nothing was published");
    expect(existsSync(argvOut)).toBe(false);
  });

  test("a clean, bound candidate still publishes (negative control)", () => {
    const dir = fixtureRepo();
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.stdout).toContain("published");
    expect(existsSync(argvOut)).toBe(true);
  });

  test("a build that mutates the reviewed manifest is refused (post-build cleanliness gate)", () => {
    // The build rewrites package.json (adding a files entry) and drops a
    // payload file — the reviewed source manifest can no longer bind the
    // packed bytes (release-review P1 @ 6f2c8b8f9).
    const dir = fixtureRepo({
      buildMutatesManifest: true,
    });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("dirty after the build");
    expect(existsSync(argvOut)).toBe(false);
  });

  test("packed content carrying a private-scope string is refused before any publish", () => {
    const dir = fixtureRepo({ distContent: "console.log('x');\nconst dep = require('@hasna-internal/foo');\n" });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("packed artifact contains");
    expect(res.stdout).toContain("nothing was published");
    expect(existsSync(argvOut)).toBe(false);
  });

  test("packed content carrying a fine-grained GitHub token shape is refused before any publish", () => {
    // Fragment-joined so the fixture source stays clean for the staged-secrets
    // scan; the packed dist still carries the full joined value.
    const tok = ["github_pat_", "abcdefghijklmnopqrstuvwx"].join("");
    const dir = fixtureRepo({ distContent: `console.log('x');\nconst tok = '${tok}';\n` });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("packed artifact contains");
    expect(res.stdout).toContain("nothing was published");
    expect(existsSync(argvOut)).toBe(false);
  });

  test("packed content carrying a classic GitHub PAT shape is refused before any publish", () => {
    // Fragment-joined so the fixture source stays clean for the staged-secrets
    // scan; the packed dist still carries the full joined value. Regression
    // for the 2026-08-30 cycle-5 review P1: the o/u/s/r rewrite of the GitHub
    // token class dropped the classic p prefix, so a classic-PAT credential
    // passed the packed-content scan undetected.
    const tok = ["gh", "p_", "abcdefghijklmnopqrstuvwx"].join("");
    const dir = fixtureRepo({ distContent: `console.log('x');\nconst tok = '${tok}';\n` });
    const argvOut = join(dir, "secrets-argv.txt");
    const res = releaseAtHead(dir, argvOut, ["fixme"]);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("packed artifact contains");
    expect(res.stdout).toContain("nothing was published");
    expect(existsSync(argvOut)).toBe(false);
  });
});

describe("P1 cycle-5: the default (no-argument) release path releases clean reviewed candidates", () => {
  test("a clean, pushed repo at the reviewed sha is released by the no-arg path", () => {
    const dir = fixtureRepo();
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(dir, "open-fixme"), encoding: "utf8" }).trim();
    const argvOut = join(dir, "secrets-argv.txt");
    const res = runCli(["release", "--dir", dir, "--reviewed-sha", head], { PATH: `${pathWithSecretsStubRecording(argvOut)}:${process.env.PATH}` }, dir);
    // The previously unreachable path: a CLEAN candidate is selected and
    // released (release-review P1 @ 3f1611276: dirty-or-unpushed-only
    // selection made the no-argument release workflow impossible).
    expect(res.stdout).toContain("published");
    expect(existsSync(argvOut)).toBe(true);
    const args = readFileSync(argvOut, "utf8").trim().split("\n");
    const npmIdx = args.indexOf("npm");
    expect(npmIdx).toBeGreaterThanOrEqual(0);
    expect(args[npmIdx + 2]).toMatch(/^.*hasna-fixme-0\.1\.0\.tgz$/);
  });

  test("a batch release bound to a sha no repo holds fails closed and publishes nothing", () => {
    const dir = fixtureRepo();
    const argvOut = join(dir, "secrets-argv.txt");
    const res = runCli(["release", "--dir", dir, "--reviewed-sha", "0000000000000000000000000000000000000000"], { PATH: `${pathWithSecretsStubRecording(argvOut)}:${process.env.PATH}` }, dir);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("No repo is at --reviewed-sha");
    expect(existsSync(argvOut)).toBe(false);
  });
});

describe("P1 cycle-4: new.ts external todos records travel as validated argv", () => {
  function todosStubDir(ids: { template: string; project: string }): string {
    const dir = mkdtempSync(join(tmpdir(), "agency-todos-stub-"));
    const stub = join(dir, "todos");
    writeFileSync(
      stub,
      [
        "#!/bin/sh",
        `if [ "$1" = "--json" ] && [ "$2" = "projects" ]; then echo '{"id":"${ids.project}","name":"optname"}'; exit 0; fi`,
        `if [ "$1" = "--json" ] && [ "$2" = "templates" ]; then echo '[{"id":"${ids.template}","name":"open-source-project"}]'; exit 0; fi`,
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(stub, 0o755);
    return dir;
  }

  function todosModuleStub(base: string): void {
    const modDir = join(base, "node_modules", "@hasna", "todos");
    mkdirSync(modDir, { recursive: true });
    writeFileSync(join(modDir, "package.json"), JSON.stringify({ name: "@hasna/todos", main: "index.js" }));
    writeFileSync(
      join(modDir, "index.js"),
      [
        'const fs = require("fs");',
        "exports.tasksFromTemplate = (templateId, projectId, opts) => { fs.writeFileSync(process.env.ARGV_PROBE, JSON.stringify([templateId, projectId, opts.name])); return [{ title: 'task-1' }, { title: 'task-2' }]; };",
        "exports.initBuiltinTemplates = () => {};",
        "",
      ].join("\n"),
    );
  }

  test("valid template/project ids travel as separate argv values and create tasks", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-argv-"));
    const probe = join(base, "argv.json");
    todosModuleStub(base);
    const res = runCli(["new", "library", "optname", "--dir", base, "--create-tasks"], { PATH: `${todosStubDir({ template: "tmpl-xyz789", project: "proj-abc123" })}:${process.env.PATH}`, ARGV_PROBE: probe }, base);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Created 2 setup tasks");
    expect(readFileSync(probe, "utf-8")).toBe(JSON.stringify(["tmpl-xyz789", "proj-abc123", "optname"]));
  });

  test("an id outside the strict grammar is refused before any side effect", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-argv-bad-"));
    const probe = join(base, "argv.json");
    todosModuleStub(base);
    const res = runCli(["new", "library", "optname", "--dir", base, "--create-tasks"], { PATH: `${todosStubDir({ template: "tmpl.bad", project: "proj-abc123" })}:${process.env.PATH}`, ARGV_PROBE: probe }, base);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Refusing to create tasks");
    // The tasks script never ran — no side effect.
    expect(existsSync(probe)).toBe(false);
  });
});

describe("P1 cycle-4: --provision-db fails closed when the provisioner fails", () => {
  test("credentials present but psql failing terminates nonzero and suppresses success", () => {
    const base = mkdtempSync(join(tmpdir(), "agency-new-psql-"));
    const home = mkdtempSync(join(tmpdir(), "agency-new-psql-home-"));
    const dir = mkdtempSync(join(tmpdir(), "agency-psql-stub-"));
    const stub = join(dir, "psql");
    writeFileSync(stub, "#!/bin/sh\necho 'psql: connection failed' >&2\nexit 1\n");
    chmodSync(stub, 0o755);
    const res = runCli(
      ["new", "service", "psqlname", "--dir", base, "--skip-tasks", "--provision-db"],
      { HOME: home, PATH: `${dir}:${process.env.PATH}`, CLOUD_PG_HOST: "db.internal", CLOUD_PG_PASSWORD: "x" },
      base,
    );
    expect(res.code).toBe(1);
    expect(`${res.stdout}\n${res.stderr}`).toContain("refusing to report success");
    expect(res.stdout).not.toContain("scaffolded successfully");
  });
});

describe("P1 cycle-4: connect re-parses the merged document before any write", () => {
  test("a merge whose output would be invalid TOML is refused and the file is untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "agency-connect-toml3-"));
    const codexDir = join(home, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const tomlPath = join(codexDir, "config.toml");
    // `mcp_servers` as an inline array of tables is valid TOML on its own,
    // but appending `[mcp_servers.todos]` redefines the key — the merged
    // document must fail the post-merge reparse and never be written.
    writeFileSync(tomlPath, "mcp_servers = [{ command = \"x\" }]\n");
    const res = runCli(["connect", "codex", "--only", "todos"], { HOME: home });
    expect(res.code).toBe(1);
    expect(`${res.stdout}\n${res.stderr}`).toContain("structural TOML validation");
    expect(readFileSync(tomlPath, "utf-8")).toBe("mcp_servers = [{ command = \"x\" }]\n");
    expect(existsSync(`${tomlPath}.bak`)).toBe(false);
  });
});
