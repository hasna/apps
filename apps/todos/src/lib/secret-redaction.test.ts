import { describe, it, expect, beforeEach } from "bun:test";
import {
  scanTextForSecrets,
  scanAndRedactText,
  redactText,
  safeStringify,
  assertNoSecrets,
  scanFileForSecrets,
  registerCustomRedactor,
  resetCustomRedactors,
  REDACTION_PLACEHOLDER,
  secretScanByteProjections,
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

  it("detects the centralized high-confidence source and release shapes", () => {
    const hosted = [
      ["gh", "p_", "SyntheticHostedTokenValue1234567890"].join(""),
      ["github", "_pat_", "SyntheticHostedTokenValue1234567890"].join(""),
      ["npm", "_", "SyntheticNpmTokenValue12345678901234567890"].join(""),
      ["sk", "-", "SyntheticOpenAiTokenValue1234567890"].join(""),
    ];
    const privateKey = [
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
      "U1lOVEhFVElDX0ZJWFRVUkVfT05MWQ==",
      ["-----END ", "PRIVATE KEY-----"].join(""),
    ].join("\n");
    const source = [
      ["api", "_key=", "syntheticlowercaseassignmentvalue"].join(""),
      ["authorization", ": ", "Bearer", " ", "SyntheticBearerValue1234567890"].join(""),
      ...hosted,
      privateKey,
    ].join("\n");
    const scan = scanTextForSecrets(source, { allowlist: [/synthetic/i] });

    expect(scan.clean).toBe(false);
    expect(scan.matches.map((match) => match.pattern)).toEqual(expect.arrayContaining([
      "generic_credential_assignment",
      "bearer_token",
      "github_token",
      "npm_token",
      "openai_token",
      "private_key_block",
    ]));
    expect(scan.matches.every((match) => Object.keys(match).sort().join(",") === "index,line,pattern")).toBe(true);
    const rendered = JSON.stringify(scan.matches);
    for (const value of hosted) expect(rendered).not.toContain(value.slice(0, 12));
    expect(rendered).not.toContain("SyntheticBearer");
    expect(rendered).not.toContain("U1lOVEhF");
  });

  it("uses each duplicate match index and detects encoded credential variants", () => {
    const placeholder = ["token", "=", "your-api-key-here"].join("");
    const actual = ["token", "=", "syntheticduplicatecredentialvalue"].join("");
    const encoded = encodeURIComponent(["api_key", "=", "syntheticencodedcredentialvalue"].join(""));
    const scan = scanTextForSecrets([placeholder, actual, encoded].join("\n"));

    expect(scan.clean).toBe(false);
    expect(scan.matches.some((match) => match.index === placeholder.length + 1)).toBe(true);
    expect(scan.matches.some((match) => match.pattern.startsWith("encoded_"))).toBe(true);
    expect(JSON.stringify(scan.matches)).not.toContain("syntheticduplicate");
    expect(JSON.stringify(scan.matches)).not.toContain("syntheticencoded");
  });

  it("redacts the exact percent-encoded source span alongside ordinary text matches", () => {
    const encoded = encodeURIComponent(["api", "_key=", "syntheticencodedspanvalue"].join(""));
    const raw = ["Bearer", " ", "SyntheticRawBearerValue1234"].join("");
    const input = `before:${encoded};middle:${raw};after`;
    const result = scanAndRedactText(input);

    expect(result.clean).toBe(false);
    expect(result.matches.some((match) => match.pattern.startsWith("encoded_"))).toBe(true);
    expect(result.redacted_text).toBe(`before:api_key%3D${REDACTION_PLACEHOLDER};middle:${REDACTION_PLACEHOLDER};after`);
    expect(result.redacted_text).not.toContain(encoded);
    expect(result.redacted_text).not.toContain("syntheticencodedspanvalue");
    expect(result.redacted_text).not.toContain("SyntheticRawBearerValue1234");
  });

  it("redacts bounded recursive and double-encoded credential spans without decoding output", () => {
    const credential = ["token", "=", "syntheticrecursivecredentialvalue"].join("");
    const doubleEncoded = encodeURIComponent(encodeURIComponent(credential));
    const recursivelyEncoded = encodeURIComponent(encodeURIComponent(encodeURIComponent(credential)));
    const result = scanAndRedactText(`double=${doubleEncoded}\nrecursive=${recursivelyEncoded}`);

    expect(result.clean).toBe(false);
    expect(result.matches.filter((match) => match.pattern.startsWith("encoded_")).length).toBe(2);
    expect(result.redacted_text).toBe(
      `double=token%253D${REDACTION_PLACEHOLDER}\nrecursive=token%25253D${REDACTION_PLACEHOLDER}`,
    );
    expect(result.redacted_text).not.toContain("syntheticrecursivecredentialvalue");
    expect(result.redacted_text).not.toContain("syntheticrecursivecredentialvalue");
  });

  it("reaches a bounded fixed point for deeply repeated percent encoding", () => {
    const credential = ["api_key", "=", "syntheticdeepcredentialvalue"].join("");
    let encoded = credential;
    for (let pass = 0; pass < 12; pass += 1) encoded = encodeURIComponent(encoded);
    const result = scanAndRedactText(`value[${encoded}]`);

    expect(result.clean).toBe(false);
    expect(result.matches.some((match) => match.pattern.startsWith("encoded_"))).toBe(true);
    expect(result.redacted_text).not.toContain("syntheticdeepcredentialvalue");
    expect(result.redacted_text).toContain(REDACTION_PLACEHOLDER);
  });

  it("preserves JSON and NDJSON delimiters while replacing only credential values", () => {
    const input = [
      JSON.stringify({ token: "syntheticjsoncredentialvalue", ok: true }),
      JSON.stringify({ nested: { password: "syntheticndjsonpasswordvalue" }, count: 2 }),
    ].join("\n");
    const redacted = redactText(input);
    const records = redacted.split("\n").map((line) => JSON.parse(line));

    expect(records).toEqual([
      { token: REDACTION_PLACEHOLDER, ok: true },
      { nested: { password: REDACTION_PLACEHOLDER }, count: 2 },
    ]);
  });

  it("scans raw, compact ASCII, and both UTF-16 byte projections", () => {
    const credential = ["token", "=", "syntheticprojectioncredentialvalue"].join("");
    const compact = new Uint8Array(credential.length * 2);
    for (let index = 0; index < credential.length; index += 1) {
      compact[index * 2] = credential.charCodeAt(index);
      compact[index * 2 + 1] = 0;
    }
    const utf16be = new Uint8Array(compact.length);
    for (let index = 0; index < compact.length; index += 2) {
      utf16be[index] = compact[index + 1]!;
      utf16be[index + 1] = compact[index]!;
    }

    for (const bytes of [new TextEncoder().encode(credential), compact, utf16be]) {
      const findings = secretScanByteProjections(bytes)
        .flatMap((projection) => scanTextForSecrets(projection.text).matches);
      expect(findings.length).toBeGreaterThan(0);
    }
  });

  it("handles malformed, placeholder, adjacent, and mixed-case encoded candidates conservatively", () => {
    const encodedCredential = encodeURIComponent(["Pass", "Word=", "SyntheticMixedCaseCredentialValue"].join(""));
    const encodedPlaceholder = encodeURIComponent(["token", "=", "example-token"].join(""));
    const malformed = "%ZZ%2not-valid";
    const result = scanAndRedactText(
      `left[${encodedCredential}] placeholder[${encodedPlaceholder}] malformed[${malformed}] right`,
    );

    expect(result.redacted_text).toContain(`left[PassWord%3D${REDACTION_PLACEHOLDER}]`);
    expect(result.redacted_text).toContain(`placeholder[${encodedPlaceholder}]`);
    expect(result.redacted_text).toContain(`malformed[${malformed}]`);
    expect(result.redacted_text).not.toContain(encodedCredential);
    expect(result.redacted_text).not.toContain("SyntheticMixedCaseCredentialValue");
  });

  it("redacts partially encoded assignment and bearer shapes at exact source spans", () => {
    const mixedAssignment = ["api", "%5F", "key=", "syntheticmixedassignmentvalue"].join("");
    const mixedBearer = ["Bearer ", "%53", "yntheticMixedBearerValue1234"].join("");
    const result = scanAndRedactText(`left[${mixedAssignment}] middle[${mixedBearer}] right`);

    expect(result.clean).toBe(false);
    expect(result.redacted_text).toBe(
      `left[api%5Fkey=${REDACTION_PLACEHOLDER}] middle[${REDACTION_PLACEHOLDER}] right`,
    );
    expect(result.redacted_text).not.toContain(mixedAssignment);
    expect(result.redacted_text).not.toContain(mixedBearer);
  });

  it("does not let invalid UTF-8 percent bytes suppress an adjacent encoded credential", () => {
    const encodedCredential = encodeURIComponent(["api_key", "=", "syntheticinvalidutf8bypassvalue"].join(""));
    const adversarialCandidate = `%FF${encodedCredential}`;
    const result = scanAndRedactText(`unsafe[${adversarialCandidate}]`);

    expect(result.clean).toBe(false);
    expect(result.redacted_text).toBe(`unsafe[%FFapi_key%3D${REDACTION_PLACEHOLDER}]`);
    expect(result.redacted_text).not.toContain(adversarialCandidate);
  });

  it("does not split an encoded credential at the former candidate-size boundary", () => {
    const encodedCredential = encodeURIComponent(
      ["api_key", "=", "syntheticboundarycredentialvalue"].join(""),
    );
    const adversarialCandidate = `${"a".repeat(4090)}${encodedCredential}`;
    const result = scanAndRedactText(`unsafe[${adversarialCandidate}]`);

    expect(result.clean).toBe(false);
    expect(result.matches.some((match) => match.pattern.startsWith("encoded_"))).toBe(true);
    expect(result.redacted_text).toBe(
      `unsafe[${"a".repeat(4090)}api_key%3D${REDACTION_PLACEHOLDER}]`,
    );
    expect(result.redacted_text).not.toContain(encodedCredential);
    expect(result.redacted_text).not.toContain("syntheticboundarycredentialvalue");
  });

  it("keeps only exact documented low-confidence placeholders clean", () => {
    const placeholders = [
      ["api_key", "=", "your-api-key-here"].join(""),
      ["token", "=", "example-token"].join(""),
      ["password", "=", "[REDACTED]"].join(""),
      "Use sk-test or ghp_xxx in docs",
    ];
    expect(scanTextForSecrets(placeholders.join("\n")).clean).toBe(true);
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
