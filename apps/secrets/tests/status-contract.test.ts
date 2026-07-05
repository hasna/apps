import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "../src/db.js";
import { getSecretReferenceStatus } from "../src/status.js";
import { registerUser, setSecret } from "../src/store.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), "private-account-123-demo-host", `open-secrets-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");
  resetDb();
});

afterEach(() => {
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  rmSync(testDir, { recursive: true, force: true });
});

describe("secret reference status contract", () => {
  it("reports metadata-only health without values, secret keys, hosts, or provider inventory", () => {
    const privateValue = "raw-super-secret-token-value";
    const privateKeyName = "private-account-123/demo-host/provider/live/token";
    const privateLabel = "demo-host private account token";
    setSecret(privateKeyName, privateValue, "token", privateLabel);
    setSecret("example/synthetic/test/api_key", "sk-synthetic-value", "api_key");
    registerUser("agent-status", "Status Agent", "agent");

    const status = getSecretReferenceStatus();
    expect(status).toMatchObject({
      service: "secrets",
      schemaVersion: "1.0",
      package: {
        name: "@hasna/secrets",
        version: expect.any(String),
      },
      counts: {
        secrets: 2,
        users: 1,
      },
      safety: {
        includesSecretValues: false,
        includesSecretKeys: false,
        includesProviderInventory: false,
        statusOutputIsMetadataOnly: true,
      },
      cloudRuntime: {
        safety: {
          includesSecretValues: false,
          includesRawEnvValues: false,
          includesAwsSecretString: false,
          includesRemoteRows: false,
          includesLocalFileContents: false,
          metadataOnlyDiagnostics: true,
        },
      },
    });
    expect(status.counts.byType.token).toBe(1);
    expect(status.counts.byType.api_key).toBe(1);

    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain(privateKeyName);
    expect(serialized).not.toContain("private-account-123");
    expect(serialized).not.toContain("demo-host");
    expect(serialized).not.toContain(testDir);
    expect(serialized).not.toContain(privateLabel);
    expect(serialized).not.toContain("\"SecretString\":\"");

    const cli = Bun.spawnSync({
      cmd: ["bun", "src/index.ts", "status", "--json"],
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, OPEN_SECRETS_DB: process.env.OPEN_SECRETS_DB! },
    });
    expect(cli.exitCode).toBe(0);
    const output = new TextDecoder().decode(cli.stdout);
    expect(JSON.parse(output).counts.secrets).toBe(2);
    expect(output).not.toContain(privateValue);
    expect(output).not.toContain(privateKeyName);
    expect(output).not.toContain("private-account-123");
    expect(output).not.toContain("demo-host");
    expect(output).not.toContain(testDir);
  });
});
