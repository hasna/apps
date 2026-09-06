import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAttachmentsTransport } from "./client-config";

/**
 * Transport-report probes: the resolution names WHERE the authority and the
 * credential came from, never the credential itself, and the pair is
 * re-resolved fresh on every call so a rotation heals without a rebuild.
 */

describe("resolveAttachmentsTransport — transport report", () => {
  test("reports env sources and never leaks the key", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://report.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "super-secret-report-key",
    };
    const report = resolveAttachmentsTransport(env);
    expect(report.transportSource).toBe("HASNA_ATTACHMENTS_API_URL");
    expect(report.apiUrlSource).toBe("HASNA_ATTACHMENTS_API_URL");
    expect(report.apiKeySource).toBe("HASNA_ATTACHMENTS_API_KEY");
    expect(report.apiKeyTier).toBe("env");
    // The credential value is non-enumerable on the resolution, exactly as the
    // shared seam seals it: enumeration, serialization and inspection cannot
    // spill it, while property access still works.
    expect(JSON.stringify(report)).not.toContain("super-secret-report-key");
    expect(Object.values({ ...report })).not.toContain("super-secret-report-key");
    expect(report.apiKey).toBe("super-secret-report-key");
  });

  test("re-resolves fresh on every call — a rotation is visible immediately", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://rotate.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "first-key",
    };
    expect(resolveAttachmentsTransport(env).apiKey).toBe("first-key");
    env.HASNA_ATTACHMENTS_API_KEY = "rotated-key";
    const fresh = resolveAttachmentsTransport(env);
    expect(fresh.apiKey).toBe("rotated-key");
    expect(fresh.apiKeySource).toBe("HASNA_ATTACHMENTS_API_KEY");
  });

  test("a changed authority is reported with its new source, and the refusal names it", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://one.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "key",
    };
    const first = resolveAttachmentsTransport(env);
    expect(first.url).toBe("https://one.hasna.example");
    env.HASNA_ATTACHMENTS_API_URL = "https://two.hasna.example";
    const second = resolveAttachmentsTransport(env);
    expect(second.url).toBe("https://two.hasna.example");
    expect(second.transportSource).toBe("HASNA_ATTACHMENTS_API_URL");
  });

  test("a half-configured pair reports every tier the chain consulted", () => {
    const scratch = mkdtempSync(join(tmpdir(), "attachments-report-refusal-"));
    try {
      try {
        resolveAttachmentsTransport({ HOME: scratch, HASNA_ATTACHMENTS_API_URL: "https://half.hasna.example" });
        throw new Error("expected a refusal");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toMatch(/no API key could be resolved/);
        expect(message).toMatch(/Keychain/);
        expect(message).toMatch(/config\/credentials/);
        expect(message).toMatch(/HASNA_ATTACHMENTS_API_KEY/);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});