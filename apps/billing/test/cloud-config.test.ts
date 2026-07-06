import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCloudPoolConfig } from "../src/db/cloud.js";
import { assertModeConsistency, resolveStorageMode, resolveDatabaseUrl, scrubDatabaseUrl } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";

const KEYS = ["HASNA_BILLING_STORAGE_MODE", "HASNA_BILLING_DATABASE_URL", "HASNA_BILLING_DATABASE_URL_FILE", "PGSSLROOTCERT"];
function clearEnv(): void {
  for (const k of KEYS) delete process.env[k];
}
afterEach(clearEnv);

describe("storage mode resolution (§2.3)", () => {
  it("defaults to local and normalizes deprecated aliases to cloud", () => {
    clearEnv();
    expect(resolveStorageMode({})).toBe("local");
    expect(resolveStorageMode({ HASNA_BILLING_STORAGE_MODE: "self_hosted" })).toBe("cloud");
    expect(resolveStorageMode({ HASNA_BILLING_STORAGE_MODE: "cloud" })).toBe("cloud");
    expect(() => resolveStorageMode({ HASNA_BILLING_STORAGE_MODE: "hybrid-cache" })).toThrow();
  });

  it("fail-closed when a DSN is present but mode resolves to local (§2.3)", () => {
    expect(() => assertModeConsistency({ HASNA_BILLING_DATABASE_URL: "postgres://x/y?sslmode=verify-full" })).toThrow(/mis-deploy|local/);
  });

  it("resolves the DSN value only for connecting, never to pick a mode", () => {
    expect(resolveDatabaseUrl({ HASNA_BILLING_DATABASE_URL: "postgres://x/y" })).toBe("postgres://x/y");
    expect(resolveDatabaseUrl({})).toBeNull();
  });

  it("scrubs the DSN from the environment after connect (§2.4)", () => {
    const env: Record<string, string | undefined> = { HASNA_BILLING_DATABASE_URL: "postgres://secret@x/y" };
    scrubDatabaseUrl(env);
    expect(env["HASNA_BILLING_DATABASE_URL"]).toBeUndefined();
  });
});

describe("cloud TLS (§4.8) — verify-full enforced without a live DB", () => {
  it("requires sslmode=verify-full", () => {
    process.env["HASNA_BILLING_DATABASE_URL"] = "postgres://u:p@h:5432/db?sslmode=require";
    process.env["PGSSLROOTCERT"] = "/dev/null";
    expect(() => buildCloudPoolConfig()).toThrow(/verify-full/);
  });

  it("builds a verify-full pool config with a CA bundle", () => {
    const caPath = join(mkdtempSync(join(tmpdir(), "billing-ca-")), "ca.pem");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nMIICdummy\n-----END CERTIFICATE-----\n");
    process.env["HASNA_BILLING_DATABASE_URL"] = "postgres://u:p@h:5432/db?sslmode=verify-full";
    process.env["PGSSLROOTCERT"] = caPath;
    const cfg = buildCloudPoolConfig();
    expect(cfg.connectionString).toContain("verify-full");
    expect(cfg.ssl).toBeDefined();
    expect((cfg.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized).toBe(true);
  });

  it("cloud mode fails closed on openDatabase (no ephemeral fallback, failure class 2)", () => {
    process.env["HASNA_BILLING_STORAGE_MODE"] = "cloud";
    process.env["HASNA_BILLING_DATABASE_URL"] = "postgres://u:p@h/db?sslmode=verify-full";
    expect(() => openDatabase()).toThrow(/cloud|PURE REMOTE/);
  });
});
