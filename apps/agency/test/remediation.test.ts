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
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync, statSync, chmodSync, symlinkSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { copyStagedWithRollback, execSafe, execSafeEnv, listTarball, verifyTarball, spawnSafe, spawnWithTimeout } from "../src/utils.js";

const PKG_ROOT = join(import.meta.dir, "..");
const BIN = join(PKG_ROOT, "dist", "index.js");

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

/** Minimal git repo with a package.json and a build script; returns its dir. */
function fixtureRepo(opts: { buildExitsNonZero?: boolean; packageName?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "agency-release-fixture-"));
  mkdirSync(join(dir, "open-fixme"));
  const pkgDir = join(dir, "open-fixme");
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: opts.packageName ?? "@hasna/fixme",
        version: "0.1.0",
        scripts: { build: opts.buildExitsNonZero ? "echo boom && exit 1" : "echo ok" },
      },
      null,
      2,
    ) + "\n",
  );
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
      const res = runCli(["release", "fixme", "--dir", dir, "--reviewed-sha", head], { NODE_AUTH_TOKEN: "npm_dummy_token_for_test" }, dir);
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
