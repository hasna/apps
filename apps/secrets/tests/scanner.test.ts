import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanHistoryExposures, scanWorkspaceExposures } from "../src/scanner.js";
import { hermeticGit } from "./setup/hermetic-git.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function fakeOpenAiToken(): string {
  return ["sk", "proj", "livevalueabcdefghijklmnopqrstuvwxyz"].join("-");
}

function fakePackageRegistryToken(): string {
  return ["npm", "livevalueabcdefghijklmnopqrstuvwxyz"].join("_");
}

function gitAvailable(): boolean {
  return spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
}

function git(args: string[], cwd = testDir): void {
  // Hermetic fixture git — see tests/setup/hermetic-git.ts for why, and
  // tests/hermetic-git.test.ts for the assertions that hold it to its word.
  // Inlining the env here instead is what let two of the channels that carry
  // core.hooksPath stay open, unnoticed and untested, so route every fixture
  // git call through the shared helper.
  hermeticGit(args, cwd);
}

describe("exposure scanner", () => {
  it("returns bounded redacted workspace findings", () => {
    const first = fakeOpenAiToken();
    const second = fakePackageRegistryToken();
    writeFileSync(
      join(testDir, "app.env"),
      `OPENAI_API_KEY=${first}\nPACKAGE_TOKEN=${second}\n`,
    );

    const result = scanWorkspaceExposures({ root: testDir, limit: 1 });
    const repeated = scanWorkspaceExposures({ root: testDir, limit: 1 });
    const serialized = JSON.stringify(result);

    expect(result.schema).toBe("open-secrets.exposure-scan.v1");
    expect(result.redacted).toBe(true);
    expect(result.findingCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe("findings");
    expect(result.nextCursor).toBeString();
    expect(result.findings[0].path).toBe("app.env");
    expect(result.findings[0].id).toMatch(/^secret-exposure:[0-9a-f]{24}$/);
    expect(result.findings[0].id).toBe(repeated.findings[0].id);
    expect(result.findings[0].evidencePath).toBe(`app.env:1:${result.findings[0].column}`);
    expect(result.findings[0].preview).toContain("***REDACTED***");
    expect(result.findings[0].remediation).toEqual({
      kind: "credential_exposure",
      priority: "critical",
      steps: [
        "verify_finding",
        "revoke_credential",
        "rotate_credential",
        "remove_from_source",
        "update_dependents",
        "rescan",
      ],
    });
    expect(result).not.toHaveProperty("generated_at");
    expect(serialized).not.toContain(first);
    expect(serialized).not.toContain(second);
  });

  it("continues workspace findings with a redacted chunk cursor and stable ids", () => {
    const value = fakeOpenAiToken();
    for (const name of ["a.env", "b.env", "c.env"]) {
      writeFileSync(join(testDir, name), `OPENAI_API_KEY=${value}\n`);
    }

    const first = scanWorkspaceExposures({ root: testDir, limit: 1 });
    const second = scanWorkspaceExposures({ root: testDir, limit: 1, cursor: first.nextCursor });
    const third = scanWorkspaceExposures({ root: testDir, limit: 1, cursor: second.nextCursor });
    const repeated = scanWorkspaceExposures({ root: testDir, limit: 1 });
    const findings = [...first.findings, ...second.findings, ...third.findings];

    expect(findings.map((finding) => finding.path)).toEqual(["a.env", "b.env", "c.env"]);
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(3);
    for (const finding of findings) {
      expect(finding.id).toMatch(/^secret-exposure:[0-9a-f]{24}$/);
      expect(finding.remediation.kind).toBe("credential_exposure");
    }
    expect(repeated.findings[0].id).toBe(first.findings[0].id);
    expect(third.nextCursor).toBeUndefined();
    expect(JSON.stringify([first, second, third])).not.toContain(value);
  });

  it("resumes a workspace timeout without skipping unscanned content in the current file", () => {
    const value = fakeOpenAiToken();
    writeFileSync(
      join(testDir, "app.env"),
      ["metadata only", "still metadata", `OPENAI_API_KEY=${value}`].join("\n"),
    );

    const originalNow = Date.now;
    let calls = 0;
    Date.now = (() => {
      calls += 1;
      return calls < 6 ? 1_000 : 1_010;
    }) as typeof Date.now;

    let first: ReturnType<typeof scanWorkspaceExposures>;
    try {
      first = scanWorkspaceExposures({ root: testDir, limit: 10, timeoutMs: 1 });
    } finally {
      Date.now = originalNow;
    }
    const second = scanWorkspaceExposures({ root: testDir, limit: 10, cursor: first.nextCursor });

    expect(first.truncated).toBe(true);
    expect(first.truncatedReason).toBe("timeout");
    expect(first.findingCount).toBe(0);
    expect(first.nextCursor).toBeString();
    expect(second.truncated).toBe(false);
    expect(second.findingCount).toBe(1);
    expect(second.findings[0]).toMatchObject({
      path: "app.env",
      line: 3,
      detector: "openai_api_key",
    });
    expect(JSON.stringify([first, second])).not.toContain(value);
  });

  it("returns redacted git history findings with commit references", () => {
    if (!gitAvailable()) return;

    const value = fakeOpenAiToken();
    git(["init"]);
    git(["config", "user.name", "Hasna Secrets Test"]);
    git(["config", "user.email", "secrets-test@example.invalid"]);
    writeFileSync(join(testDir, "config.env"), `OPENAI_API_KEY=${value}\n`);
    git(["add", "config.env"]);
    git(["commit", "-m", "add config"]);

    const result = scanHistoryExposures({ root: testDir, limit: 5, maxCommits: 5 });
    const serialized = JSON.stringify(result);

    expect(result.redacted).toBe(true);
    expect(result.findingCount).toBeGreaterThan(0);
    expect(result.findings[0].path).toBe("config.env");
    expect(result.findings[0].commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.findings[0].evidencePath).toStartWith(`${result.findings[0].commit}:config.env:1:`);
    expect(result.findings[0].preview).toContain("***REDACTED***");
    expect(result.findings[0].remediation.steps).toContain("purge_git_history");
    expect(serialized).not.toContain(value);
  });

  it("continues through full history by commit chunk", () => {
    if (!gitAvailable()) return;

    git(["init"]);
    git(["config", "user.name", "Hasna Secrets Test"]);
    git(["config", "user.email", "secrets-test@example.invalid"]);
    writeFileSync(join(testDir, "config.env"), `OPENAI_API_KEY=${fakeOpenAiToken()}\n`);
    git(["add", "config.env"]);
    git(["commit", "-m", "first config"]);
    writeFileSync(join(testDir, "config.env"), `PACKAGE_TOKEN=${fakePackageRegistryToken()}\n`);
    git(["commit", "-am", "second config"]);

    const first = scanHistoryExposures({ root: testDir, limit: 10, maxCommits: 1 });
    const second = scanHistoryExposures({
      root: testDir,
      limit: 10,
      maxCommits: 1,
      cursor: first.nextCursor,
    });

    expect(first.truncatedReason).toBe("max_commits");
    expect(first.nextCursor).toBeString();
    expect(second.nextCursor).toBeUndefined();
    expect([...first.findings, ...second.findings]).toHaveLength(2);
    expect(new Set([...first.findings, ...second.findings].map((finding) => finding.id)).size).toBe(2);
  });

  it("rejects cursors for a different root without scanning", () => {
    writeFileSync(
      join(testDir, "app.env"),
      `OPENAI_API_KEY=${fakeOpenAiToken()}\nPACKAGE_TOKEN=${fakePackageRegistryToken()}\n`,
    );
    const first = scanWorkspaceExposures({ root: testDir, limit: 1 });
    const otherDir = join(testDir, "other");
    mkdirSync(otherDir);

    const result = scanWorkspaceExposures({ root: otherDir, cursor: first.nextCursor });
    expect(result.findingCount).toBe(0);
    expect(result.stats.errors[0]).toContain("does not match");
  });

  it("keeps history scans bounded to the requested root", () => {
    if (!gitAvailable()) return;

    const outside = fakeOpenAiToken();
    const inside = fakePackageRegistryToken();
    const allowedDir = join(testDir, "allowed");
    mkdirSync(allowedDir, { recursive: true });

    git(["init"]);
    git(["config", "user.name", "Hasna Secrets Test"]);
    git(["config", "user.email", "secrets-test@example.invalid"]);
    writeFileSync(join(testDir, "root.env"), `OPENAI_API_KEY=${outside}\n`);
    writeFileSync(join(allowedDir, "config.env"), `PACKAGE_TOKEN=${inside}\n`);
    git(["add", "."]);
    git(["commit", "-m", "add config"]);

    const result = scanHistoryExposures({ root: allowedDir, limit: 5, maxCommits: 5 });
    const serialized = JSON.stringify(result);

    expect(result.redacted).toBe(true);
    expect(result.findingCount).toBe(1);
    expect(result.findings[0].path).toBe("config.env");
    expect(serialized).not.toContain(outside);
    expect(serialized).not.toContain(inside);
  });

  it("enforces total workspace file and byte limits", () => {
    writeFileSync(join(testDir, "a.txt"), "metadata only\n");
    writeFileSync(join(testDir, "b.txt"), `OPENAI_API_KEY=${fakeOpenAiToken()}\n`);

    const byFiles = scanWorkspaceExposures({ root: testDir, maxFiles: 1 });
    expect(byFiles.truncated).toBe(true);
    expect(byFiles.truncatedReason).toBe("max_files");
    expect(byFiles.stats.filesScanned).toBe(1);

    const byBytes = scanWorkspaceExposures({ root: testDir, maxBytesScanned: 1 });
    expect(byBytes.truncated).toBe(true);
    expect(byBytes.truncatedReason).toBe("max_bytes");
    expect(byBytes.findingCount).toBe(0);
  });

  it("does not flag non-secret metadata constants as credential assignments", () => {
    writeFileSync(
      join(testDir, "constants.ts"),
      [
        'export const CANONICAL_SECRETS_RDS_CLUSTER = "example-apps-prod-postgres";',
        'export const CANONICAL_SECRETS_RDS_SECRET_PATH = "example/secrets/prod/rds";',
      ].join("\n"),
    );

    const result = scanWorkspaceExposures({ root: testDir });
    expect(result.findingCount).toBe(0);
  });

  it("does not flag npm env var NAMES as package registry tokens while real npm_ values still fire (two-sided)", () => {
    // Known-negative: npm's documented lifecycle env var names are variable
    // NAMES (npm_ + a word), never token values. Regression for the staged
    // scan blocking commits on files that merely reference them (row
    // 2693dbc4): "npm_" + 12+ chars of [A-Za-z0-9_] matched
    // npm_lifecycle_event and npm_package_name.
    const namesDir = join(testDir, "names");
    mkdirSync(namesDir, { recursive: true });
    writeFileSync(
      join(namesDir, "lifecycle.ts"),
      'const lifecycleEvent = process.env["npm_lifecycle_event"];\n',
    );
    writeFileSync(join(namesDir, "manifest.ts"), 'const pkg = process.env["npm_package_name"];\n');

    const names = scanWorkspaceExposures({ root: namesDir });
    expect(names.findingCount).toBe(0);
    expect(
      names.findings.some((f) => f.detector === "package_registry_token"),
    ).toBe(false);

    // Known-positive: a value-shaped npm_ token (npm_ + 20+ alnum, the fleet's
    // established value/name discriminator) must still fire.
    const valuesDir = join(testDir, "values");
    mkdirSync(valuesDir, { recursive: true });
    const value = ["npm", "livevalueabcdefghijklmnopqrstuvwxyz"].join("_");
    writeFileSync(join(valuesDir, "config.env"), `PACKAGE_TOKEN=${value}\n`);

    const values = scanWorkspaceExposures({ root: valuesDir });
    expect(
      values.findings.some((f) => f.detector === "package_registry_token"),
    ).toBe(true);
  });

  it("does not treat task-first slugs as OpenAI keys while preserving synthetic key detection", () => {
    const taskFirstSlug = ["global-signal-to-ta", "sk", "-first-never-drift"].join("");
    const syntheticOpenAiKey = fakeOpenAiToken();
    const slugDir = join(testDir, "slug-only");
    expect(taskFirstSlug).toBe("global-signal-to-task-first-never-drift");

    mkdirSync(slugDir);
    writeFileSync(join(slugDir, "slug.txt"), `${taskFirstSlug}\n`);
    writeFileSync(join(testDir, "positive.env"), `OPENAI_API_KEY=${syntheticOpenAiKey}\n`);

    const slugOnly = scanWorkspaceExposures({ root: slugDir });
    const withPositiveControl = scanWorkspaceExposures({ root: testDir });
    const serialized = JSON.stringify(withPositiveControl);

    expect(slugOnly.findingCount).toBe(0);
    expect(withPositiveControl.findings.map((finding) => finding.detector)).toEqual(["openai_api_key"]);
    expect(serialized).not.toContain(syntheticOpenAiKey);
    expect(withPositiveControl.findings[0].preview).toContain("***REDACTED***");
  });

  it("detects PEM private-key blocks, Stripe keys and AWS access-key ids by content", () => {
    const stripeKey = ["sk", "live", "51abcDEF0123ghijKLMN4567"].join("_");
    const awsId = ["AK", "IA", "IOSFODNN7EXAMPLE"].join("");
    const pemHeader = `${"-".repeat(5)}BEGIN RSA PRIVATE KEY${"-".repeat(5)}`;

    writeFileSync(
      join(testDir, "server.key"),
      [pemHeader, "MIIEpAIBAAKCAQEA0Zqfake", `${"-".repeat(5)}END RSA PRIVATE KEY${"-".repeat(5)}`].join("\n"),
    );
    writeFileSync(join(testDir, "creds.txt"), `STRIPE_KEY=${stripeKey}\nAWS=${awsId}\n`);

    const result = scanWorkspaceExposures({ root: testDir });
    const serialized = JSON.stringify(result);
    const detectors = result.findings.map((finding) => finding.detector);

    expect(detectors).toContain("private_key_block");
    expect(detectors).toContain("stripe_secret_key");
    expect(detectors).toContain("aws_access_key_id");
    // High severity for every content-based key finding.
    for (const finding of result.findings) {
      expect(finding.severity).toBe("high");
    }
    // Values stay redacted in output.
    expect(serialized).not.toContain(stripeKey);
    expect(serialized).not.toContain(awsId);
    expect(result.findings[0].preview).toContain("***REDACTED***");
  });
});
