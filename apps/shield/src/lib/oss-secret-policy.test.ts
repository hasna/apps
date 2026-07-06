import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { evaluateOssSecretPolicy } from "./oss-secret-policy.js";

describe("OSS secret policy", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `oss-secret-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeRepo(name: string, scripts: Record<string, string> = {}): string {
    const repo = join(root, name);
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "policy@example.invalid"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Policy Test"], { cwd: repo, stdio: "ignore" });
    writeFileSync(
      join(repo, "package.json"),
      JSON.stringify({
        name: `@hasna/${name.replace(/^open-/, "")}`,
        version: "0.0.0",
        type: "module",
        scripts,
      }, null, 2),
      "utf-8",
    );
    return repo;
  }

  test("passes a repo with check, prepublish, and CI secret gates", () => {
    const repo = makeRepo("open-clean", {
      "check:secrets": "shield oss-secrets-policy . --strict",
      prepublishOnly: "bun run check:secrets && bun run build",
    });
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, ".github", "workflows", "ci.yml"), "run: bun run check:secrets\n", "utf-8");

    const result = evaluateOssSecretPolicy({ roots: [root] });
    expect(result.summary.publishable_repos).toBe(1);
    expect(result.summary.violations).toBe(0);
  });

  test("flags no-op check secrets scripts even when prepublish and CI call them", () => {
    const repo = makeRepo("open-noop", {
      "check:secrets": "echo ok",
      prepublishOnly: "bun run check:secrets",
      release: "bun run check:secrets",
    });
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, ".github", "workflows", "ci.yml"), "run: bun run check:secrets\n", "utf-8");

    const result = evaluateOssSecretPolicy({ roots: [root] });
    const noop = result.repos[0]!;
    expect(noop.violations).toContain("package script check:secrets does not run secret scan");
    expect(noop.violations).toContain("prepublish/prepack does not run secret scan");
    expect(noop.violations).toContain("neither release scripts nor CI workflows run secret scan");
  });

  test("flags missing gates and public private-path leakage by file only", () => {
    const repo = makeRepo("open-leaky");
    mkdirSync(join(repo, "docs"), { recursive: true });
    const privatePath = "/home/" + "private-user" + "/workspace/open-leaky";
    writeFileSync(join(repo, "docs", "setup.md"), `Use ${privatePath}\n`, "utf-8");

    const result = evaluateOssSecretPolicy({ roots: [root] });
    const leaky = result.repos[0]!;
    expect(leaky.violations).toContain("missing package script check:secrets");
    expect(leaky.violations).toContain("public docs/scripts/examples contain private path or hostname leakage");
    expect(leaky.files.private_path_or_hostname).toEqual(["docs/setup.md"]);
  });

  test("flags macOS home paths in public surfaces", () => {
    const repo = makeRepo("open-mac-path", {
      "check:secrets": "shield oss-secrets-policy . --strict",
      prepublishOnly: "bun run check:secrets",
      release: "bun run check:secrets",
    });
    mkdirSync(join(repo, "docs"), { recursive: true });
    const privatePath = "/Users/" + "private-user" + "/workspace/open-mac-path";
    writeFileSync(join(repo, "docs", "setup.md"), `Use ${privatePath}\n`, "utf-8");

    const result = evaluateOssSecretPolicy({ roots: [root] });
    const leaky = result.repos[0]!;
    expect(leaky.violations).toContain("public docs/scripts/examples contain private path or hostname leakage");
    expect(leaky.files.private_path_or_hostname).toEqual(["docs/setup.md"]);
  });

  test("requires owner reason and expiry for live-shaped fixture allowlists", () => {
    const repo = makeRepo("open-fixture", {
      "check:secrets": "shield oss-secrets-policy . --strict",
      prepublishOnly: "bun run check:secrets",
      release: "bun run check:secrets",
    });
    mkdirSync(join(repo, "tests"), { recursive: true });
    mkdirSync(join(repo, "security"), { recursive: true });
    const token = "ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    writeFileSync(join(repo, "tests", "fixture.test.ts"), `const token = "${token}";\n`, "utf-8");
    writeFileSync(
      join(repo, "security", "oss-secret-allowlist.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            path: "tests/fixture.test.ts",
            rule_id: "github-token",
            owner: "@hasna/fixture",
            reason: "invalid synthetic scanner fixture",
            expires_at: "2099-01-01",
          },
        ],
      }),
      "utf-8",
    );

    const result = evaluateOssSecretPolicy({ roots: [root] });
    expect(result.summary.violations).toBe(0);
    expect(result.repos[0]!.counts.allowed_fixture_findings).toBe(1);
  });

  test("does not allowlist secret-shaped values in normal source paths", () => {
    const repo = makeRepo("open-source-secret", {
      "check:secrets": "shield oss-secrets-policy . --strict",
      prepublishOnly: "bun run check:secrets",
      release: "bun run check:secrets",
    });
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "security"), { recursive: true });
    const token = "ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    writeFileSync(join(repo, "src", "config.ts"), `const token = "${token}";\n`, "utf-8");
    writeFileSync(
      join(repo, "security", "oss-secret-allowlist.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            path: "src/config.ts",
            rule_id: "github-token",
            owner: "@hasna/source-secret",
            reason: "not a fixture",
            expires_at: "2099-01-01",
          },
        ],
      }),
      "utf-8",
    );

    const result = evaluateOssSecretPolicy({ roots: [root] });
    const repoResult = result.repos[0]!;
    expect(repoResult.violations).toContain("invalid secret fixture allowlist entries");
    expect(repoResult.violations).toContain("unsuppressed critical/high secret-shaped fixtures or values");
    expect(repoResult.counts.allowed_fixture_findings).toBe(0);
    expect(repoResult.files.unsuppressed_secret_findings).toEqual(["src/config.ts"]);
  });

  test("classifies vendored secret-shaped fixtures without suppressing the count", () => {
    const repo = makeRepo("open-vendored", {
      "check:secrets": "shield oss-secrets-policy . --strict",
      prepublishOnly: "bun run check:secrets",
      release: "bun run check:secrets",
    });
    mkdirSync(join(repo, "vendor", "upstream"), { recursive: true });
    const token = "ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    writeFileSync(join(repo, "vendor", "upstream", "fixture.txt"), `token=${token}\n`, "utf-8");

    const result = evaluateOssSecretPolicy({ roots: [root] });
    const repoResult = result.repos[0]!;
    expect(repoResult.counts.vendored_or_upstream_findings).toBe(1);
    expect(repoResult.counts.unsuppressed_secret_findings).toBe(0);
    expect(repoResult.files.vendored_or_upstream_findings).toEqual(["vendor/upstream/fixture.txt"]);
    expect(repoResult.violations).not.toContain("unsuppressed critical/high secret-shaped fixtures or values");
  });

  test("scans credential and extensionless text files", () => {
    const repo = makeRepo("open-pem", {
      "check:secrets": "shield oss-secrets-policy . --strict",
      prepublishOnly: "bun run check:secrets",
      release: "bun run check:secrets",
    });
    const pem = "-----BEGIN RSA" + " PRIVATE KEY-----\nfake\n-----END RSA" + " PRIVATE KEY-----\n";
    writeFileSync(join(repo, "key.pem"), pem, "utf-8");

    const result = evaluateOssSecretPolicy({ roots: [root] });
    const repoResult = result.repos[0]!;
    expect(repoResult.violations).toContain("unsuppressed critical/high secret-shaped fixtures or values");
    expect(repoResult.files.unsuppressed_secret_findings).toEqual(["key.pem"]);
  });

  test("descends through private workspace roots to publishable child packages", () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "workspace-root",
        private: true,
        workspaces: ["packages/*"],
      }),
      "utf-8",
    );
    mkdirSync(join(root, "packages", "open-child"), { recursive: true });
    writeFileSync(
      join(root, "packages", "open-child", "package.json"),
      JSON.stringify({
        name: "@hasna/child",
        version: "0.0.0",
        scripts: {},
      }),
      "utf-8",
    );

    const result = evaluateOssSecretPolicy({ roots: [root] });
    expect(result.summary.publishable_repos).toBe(1);
    expect(result.repos[0]!.relative_path).toBe("packages/open-child");
    expect(result.repos[0]!.violations).toContain("missing package script check:secrets");
  });

  test("treats nested packages inside an explicit task worktree root as canonical", () => {
    const worktreeRoot = join(root, ".hasna", "loops", "worktrees", "open-security", "policy-branch");
    mkdirSync(join(worktreeRoot, "sdk"), { recursive: true });
    writeFileSync(
      join(worktreeRoot, "package.json"),
      JSON.stringify({
        name: "@hasna/shield",
        version: "0.0.0",
        scripts: {},
      }),
      "utf-8",
    );
    writeFileSync(
      join(worktreeRoot, "sdk", "package.json"),
      JSON.stringify({
        name: "@hasna/shield-sdk",
        version: "0.0.0",
        scripts: {},
      }),
      "utf-8",
    );

    const result = evaluateOssSecretPolicy({ roots: [worktreeRoot] });
    expect(result.repos.map((repo) => [repo.relative_path, repo.canonical])).toEqual([
      [".", true],
      ["sdk", true],
    ]);
  });
});
