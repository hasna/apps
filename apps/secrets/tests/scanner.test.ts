import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanHistoryExposures, scanWorkspaceExposures } from "../src/scanner.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `open-secrets-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  // Hermetic fixture git: ignore the operator's global/system git config. On a
  // Hasna fleet machine the global core.hooksPath installs a staged-secrets
  // pre-commit hook, which (correctly, for real repos) blocks these fixtures'
  // deliberately fake credentials and made both history tests fail everywhere.
  // The hook still governs real commits; only the throwaway fixture repo in
  // tmpdir is exempt. This does not weaken the hook or the scanner under test.
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
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
    const serialized = JSON.stringify(result);

    expect(result.redacted).toBe(true);
    expect(result.findingCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe("findings");
    expect(result.findings[0].path).toBe("app.env");
    expect(result.findings[0].preview).toContain("***REDACTED***");
    expect(serialized).not.toContain(first);
    expect(serialized).not.toContain(second);
  });

  it("returns redacted git history findings with commit references", () => {
    if (!gitAvailable()) return;

    const value = fakeOpenAiToken();
    git(["init"]);
    git(["config", "user.name", "Open Secrets Test"]);
    git(["config", "user.email", "open-secrets-test@example.invalid"]);
    writeFileSync(join(testDir, "config.env"), `OPENAI_API_KEY=${value}\n`);
    git(["add", "config.env"]);
    git(["commit", "-m", "add config"]);

    const result = scanHistoryExposures({ root: testDir, limit: 5, maxCommits: 5 });
    const serialized = JSON.stringify(result);

    expect(result.redacted).toBe(true);
    expect(result.findingCount).toBeGreaterThan(0);
    expect(result.findings[0].path).toBe("config.env");
    expect(result.findings[0].commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.findings[0].preview).toContain("***REDACTED***");
    expect(serialized).not.toContain(value);
  });

  it("keeps history scans bounded to the requested root", () => {
    if (!gitAvailable()) return;

    const outside = fakeOpenAiToken();
    const inside = fakePackageRegistryToken();
    const allowedDir = join(testDir, "allowed");
    mkdirSync(allowedDir, { recursive: true });

    git(["init"]);
    git(["config", "user.name", "Open Secrets Test"]);
    git(["config", "user.email", "open-secrets-test@example.invalid"]);
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
