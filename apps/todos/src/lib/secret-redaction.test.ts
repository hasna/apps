import { describe, it, expect, beforeEach } from "bun:test";
import {
  scanTextForSecrets,
  redactText,
  safeStringify,
  assertNoSecrets,
  scanFileForSecrets,
  registerCustomRedactor,
  resetCustomRedactors,
  REDACTION_PLACEHOLDER,
} from "./secret-redaction.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("secret redaction", () => {
  beforeEach(() => resetCustomRedactors());

  it("detects OpenAI and GitHub tokens", () => {
    const scan = scanTextForSecrets("key=sk-1234567890abcdef and ghp_1234567890123456789012345678901234");
    expect(scan.clean).toBe(false);
    expect(scan.matches.some((m) => m.pattern === "openai_sk")).toBe(true);
    expect(scan.matches.some((m) => m.pattern === "github_pat")).toBe(true);
  });

  it("redacts secrets from text", () => {
    const redacted = redactText("Authorization: Bearer abcdef1234567890");
    expect(redacted).not.toContain("abcdef1234567890");
    expect(redacted).toContain(REDACTION_PLACEHOLDER);
  });

  it("allows safe placeholders through allowlist", () => {
    const scan = scanTextForSecrets("Use sk-test or ghp_xxx in docs");
    expect(scan.clean).toBe(true);
  });

  it("safeStringify redacts nested metadata", () => {
    const out = safeStringify({ task: "x", metadata: { api_key: "sk-1234567890abcdef" } }, 0);
    expect(out).not.toContain("sk-1234567890abcdef");
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it("assertNoSecrets throws with context", () => {
    expect(() => assertNoSecrets("token ghp_1234567890123456789012345678901234", "comment")).toThrow(/comment/i);
  });

  it("scans files on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "redact-test-"));
    const path = join(dir, "log.txt");
    writeFileSync(path, "password=supersecretvalue123");
    const result = scanFileForSecrets(path);
    expect(result.redacted_text).toContain(REDACTION_PLACEHOLDER);
    rmSync(dir, { recursive: true, force: true });
  });

  it("supports custom redactors", () => {
    registerCustomRedactor((t) => t.replace(/CUSTOM_SECRET/g, "[CUSTOM]"));
    expect(redactText("has CUSTOM_SECRET here")).toContain("[CUSTOM]");
  });
});
