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
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSafe, execSafeEnv, listTarball, verifyTarball, spawnWithTimeout } from "../src/utils.js";
import { publishTokenAvailable } from "../src/commands/release.js";

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
function fixtureRepo(opts: { buildExitsNonZero?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "agency-release-fixture-"));
  mkdirSync(join(dir, "open-fixme"));
  const pkgDir = join(dir, "open-fixme");
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name: "@hasna/fixme",
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
  test("publishTokenAvailable is false without NODE_AUTH_TOKEN", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    delete process.env.NODE_AUTH_TOKEN;
    try {
      expect(publishTokenAvailable()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.NODE_AUTH_TOKEN = saved;
    }
  });

  test("publishTokenAvailable is true with NODE_AUTH_TOKEN", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = "npm_dummy_token_for_test";
    try {
      expect(publishTokenAvailable()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = saved;
    }
  });

  test("build failure aborts the release with no commit", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = "npm_dummy_token_for_test";
    try {
      const dir = fixtureRepo({ buildExitsNonZero: true });
      const res = runCli(["release", "fixme", "--dir", dir], { NODE_AUTH_TOKEN: "npm_dummy_token_for_test" }, dir);
      expect(res.stdout).toContain("failed");
      expect(res.stdout).toContain("build failed");
      const pkg = JSON.parse(readFileSync(join(dir, "open-fixme", "package.json"), "utf8"));
      expect(pkg.version).toBe("0.1.0"); // never bumped
    } finally {
      if (saved === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = saved;
    }
  });

  test("release refuses without NODE_AUTH_TOKEN before any mutation", () => {
    const saved = process.env.NODE_AUTH_TOKEN;
    delete process.env.NODE_AUTH_TOKEN;
    try {
      const dir = fixtureRepo();
      const res = runCli(["release", "fixme", "--dir", dir], {}, dir);
      expect(res.stdout).toContain("NODE_AUTH_TOKEN");
      const pkg = JSON.parse(readFileSync(join(dir, "open-fixme", "package.json"), "utf8"));
      expect(pkg.version).toBe("0.1.0"); // never bumped — token gate fires first
    } finally {
      if (saved !== undefined) process.env.NODE_AUTH_TOKEN = saved;
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
      expect(res.stdout).toContain("NODE_AUTH_TOKEN is not set");
      expect(res.stdout).toContain("Skipping GitHub repo creation");
    } finally {
      if (saved !== undefined) process.env.NODE_AUTH_TOKEN = saved;
    }
  }, 90_000);
});
