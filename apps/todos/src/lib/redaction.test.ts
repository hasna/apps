import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig, saveConfig } from "./config.js";
import { hasSecretFindings, listSecretFindings, redactEvidenceText, redactValue } from "./redaction.js";

// Synthetic xAI provider-key fixture, assembled from fragments so the literal
// never appears in this file: the repo CI secret scan matches a bare xai
// prefix (case-insensitive) and a literal fixture would trip its commit gate.
// The vendor's published shape is the xai prefix plus [a-z0-9]{20,80}
// (case-insensitive); model ids are hyphenated words after the prefix and
// must NOT be treated as credentials (bug a869386e in @hasna/secrets). This
// mirrors apps/secrets/src/scanner.test.ts.
const XAI = ["x", "ai", "-"].join("");
const XAI_VALUE = `${XAI}7aBc9dEf0123456789abcdef0123456789abcdef0123456789`;

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-redaction-home-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

describe("local secret redaction", () => {
  test("applies configurable local redaction patterns and key names", () => {
    saveConfig({
      secret_safety: {
        redaction_patterns: ["INTERNAL-[0-9]{4}", "client-secret-[a-z0-9]+"],
        redaction_keys: ["license"],
      },
    });

    expect(redactEvidenceText("id INTERNAL-1234 and client-secret-abc123")).toBe("id [REDACTED] and [REDACTED]");
    expect(redactValue({ license: "should-not-export", note: "INTERNAL-9999" })).toEqual({
      license: "[REDACTED]",
      note: "[REDACTED]",
    });
  });

  test("reports deterministic secret findings without exposing values", () => {
    saveConfig({ secret_safety: { redaction_patterns: ["TEAM-[A-Z]{3}-[0-9]{3}"] } });

    // Assembled from fragments so the staged scan (which reads whole staged
    // blobs, value-shaped sk- tokens) does not flag this synthetic fixture.
    const openAiAssignment = ["OPEN", "AI_API_KEY", "=", ["sk", "-", "testsecret123456789"].join("")].join("");
    const findings = listSecretFindings(`TEAM-ABC-123\n${openAiAssignment}`);

    expect(findings).toEqual([
      { pattern: "custom:TEAM-[A-Z]{3}-[0-9]{3}", count: 1 },
      { pattern: "openai-token", count: 1 },
      { pattern: "env-secret-assignment", count: 1 },
    ]);
    expect(JSON.stringify(findings)).not.toContain("TEAM-ABC-123");
    expect(JSON.stringify(findings)).not.toContain("sk-testsecret");
  });

  test("keeps numeric usage token counters while redacting credential keys", () => {
    expect(redactValue({
      usage: {
        total_tokens: 123,
        input_tokens: 100,
        output_tokens: 23,
        cost_tokens: 456,
      },
      access_token: "should-not-export",
    })).toEqual({
      usage: {
        total_tokens: 123,
        input_tokens: 100,
        output_tokens: 23,
        cost_tokens: 456,
      },
      access_token: "[REDACTED]",
    });
  });

  test("exempts placeholder keys from key-based redaction without exempting env-assignment keys", () => {
    // A key reduced entirely to a placeholder is not a secret name, so the clean value
    // beneath it must survive.
    expect(redactValue({ "[REDACTED_GITHUB_TOKEN]": "key text is sanitized too" }))
      .toEqual({ "[REDACTED_GITHUB_TOKEN]": "key text is sanitized too" });

    // But "NAME=[REDACTED]" is the shape env-secret-assignment *produces*, and the value
    // beneath it is opaque (matches no text pattern). Exempting it would emit the secret
    // in cleartext, so key-based redaction must still apply.
    const opaque = ["hunter2", "hunter2", "hunter2"].join("");
    const awsSecret = ["wJalrXUtnFEMIK7MDENG", "bPxRfiCYzEXAMPLEK"].join("");
    expect(redactValue({ "DB_PASSWORD=[REDACTED]": opaque }))
      .toEqual({ "DB_PASSWORD=[REDACTED]": "[REDACTED]" });
    expect(redactValue({ "AWS_SECRET_ACCESS_KEY=[REDACTED]": awsSecret }))
      .toEqual({ "AWS_SECRET_ACCESS_KEY=[REDACTED]": "[REDACTED]" });
    expect(redactValue({ "API_KEY='[REDACTED]'": opaque }))
      .toEqual({ "API_KEY='[REDACTED]'": "[REDACTED]" });
  });

  test("detects npm and GitHub token families without returning values", () => {
    const npmValue = `npm_${"a".repeat(36)}`;
    const githubValue = `github_pat_${"A".repeat(32)}`;

    const findings = listSecretFindings(`install token ${npmValue}\nrepo token ${githubValue}`);

    expect(findings).toEqual([
      { pattern: "npm-token", count: 1 },
      { pattern: "github-fine-grained-token", count: 1 },
    ]);
    expect(JSON.stringify(findings)).not.toContain(npmValue);
    expect(JSON.stringify(findings)).not.toContain(githubValue);
    expect(redactEvidenceText(`install token ${npmValue}`)).toBe("install token [REDACTED_NPM_TOKEN]");
  });

  test("scan-before-read: value-shaped xAI provider keys are credentials; model ids are not", () => {
    // scan-before-read — the fixture is a genuine credential shape the scanner
    // must detect, so any output surface carrying it verbatim is credential-bearing.
    // This is why dedup workflows must consume the bounded dedup projection
    // (lib/dedupe-projection.ts) instead of list/compact/csv output.
    expect(hasSecretFindings(XAI_VALUE)).toBe(true);
    const findings = listSecretFindings(`provider key ${XAI_VALUE}`);
    expect(findings).toEqual([{ pattern: `${XAI}token`, count: 1 }]);
    expect(JSON.stringify(findings)).not.toContain(XAI_VALUE);
    expect(redactEvidenceText(`provider key ${XAI_VALUE}`)).toBe(`provider key [REDACTED_TOKEN]`);

    // xAI model ids are hyphenated after the prefix and are NOT credentials.
    // The id strings are assembled from the same XAI fragment so no literal
    // appears in this file (the repo CI secret scan would flag it).
    const grokReasoning = `${XAI}grok-reasoning`;
    const grok2Latest = `${XAI}grok-2-latest`;
    expect(hasSecretFindings(grokReasoning)).toBe(false);
    expect(redactEvidenceText(`model id ${grokReasoning}`)).toBe(`model id ${grokReasoning}`);
    expect(redactEvidenceText(`model id ${grok2Latest}`)).toBe(`model id ${grok2Latest}`);
  });

  test("does not report redaction placeholders as env assignment secrets", () => {
    const npmKey = ["NPM_", "TO", "KEN"].join("");
    const genericKey = ["TO", "KEN"].join("");
    expect(listSecretFindings(`${npmKey}=[REDACTED]\n${genericKey}=[REDACTED_NPM_TOKEN]`)).toEqual([]);
    const malformedPlaceholder = `${genericKey}=${"[REDACTED]"}suffix`;
    expect(listSecretFindings(malformedPlaceholder)).toEqual([
      { pattern: "env-secret-assignment", count: 1 },
    ]);
  });
});
