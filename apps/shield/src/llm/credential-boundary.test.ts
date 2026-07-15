import { afterEach, describe, expect, test } from "bun:test";
import { ScannerType, Severity, type Finding } from "../types/index.js";
import { analyzeFinding } from "./analyzer.js";
import { explainFinding } from "./explainer.js";
import { suggestFix } from "./fixer.js";
import { triageFinding } from "./triager.js";
import { sanitizeMessagesForProvider } from "./client.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.CEREBRAS_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.CEREBRAS_API_KEY;
  else process.env.CEREBRAS_API_KEY = originalApiKey;
});

describe("credential finding LLM boundary", () => {
  test("never sends credential findings or their context to an LLM", async () => {
    const syntheticSecret = "ghp_" + "SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error("network must not be reached");
    }) as unknown as typeof fetch;

    const credentialFinding: Finding = {
      id: "finding-1",
      scan_id: "scan-1",
      rule_id: "github-token",
      scanner_type: ScannerType.Secrets,
      severity: Severity.Critical,
      file: "synthetic.env",
      line: 1,
      column: 1,
      end_line: null,
      message: "Potential credential exposure detected (github-token)",
      code_snippet: "[REDACTED]",
      fingerprint: "synthetic-fingerprint",
      suppressed: false,
      suppressed_reason: null,
      llm_explanation: null,
      llm_fix: null,
      llm_exploitability: null,
      created_at: "2026-07-15T00:00:00.000Z",
    };
    const context = `GITHUB_TOKEN=${syntheticSecret}`;

    expect(await analyzeFinding(credentialFinding, context)).toBeNull();
    expect(await explainFinding(credentialFinding, context)).toBeNull();
    expect(await suggestFix(credentialFinding, context)).toBeNull();
    expect(await triageFinding(credentialFinding, context)).toBeNull();
    expect(fetchCalls).toBe(0);
  });

  test("redacts adjacent credentials in the final provider payload", () => {
    const syntheticSecret = "ghp_" + "SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    const payload = JSON.stringify(sanitizeMessagesForProvider([
      { role: "user", content: `ordinary config issue\nGITHUB_TOKEN=${syntheticSecret}` },
    ]));
    expect(payload).not.toContain(syntheticSecret);
    expect(payload).toContain("[REDACTED]");
  });
});
