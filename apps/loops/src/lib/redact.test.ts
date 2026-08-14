import { describe, expect, test } from "bun:test";
import { scrubSecrets, scrubSecretsDeep } from "./redact.js";

// Credential fixtures are assembled at runtime from fragments so the literal
// token shapes never appear contiguously in source. This keeps source secret
// scanners (e.g. GitHub push protection) from flagging test data, while the
// scrubber still receives the fully-formed credential string at runtime.
const j = (...parts: string[]): string => parts.join("");
const ANT_KEY = j("sk-", "ant-api03-abcDEF123456789_-suffix");
const AWS_KEY = j("AKIA", "IOSFODNN7EXAMPLE");
const GH_PAT = j("ghp", "_AbCdEf0123456789AbCdEf0123456789");
const GH_FINE = j("github", "_pat_11ABCDEFG0123456789_abcdefghij");
const SLACK_TOKEN = j("xoxb", "-1234567890-abcdefghijklmn");
const OPENAI_KEY = j("sk-", "proj-AbCd1234EfGh5678IjKl9012");

describe("scrubSecrets", () => {
  test("scrubs well-known credential token shapes", () => {
    const cases: Array<[string, string]> = [
      [`anthropic ${ANT_KEY} done`, "anthropic [SCRUBBED] done"],
      [`aws ${AWS_KEY} end`, "aws [SCRUBBED] end"],
      [`github ${GH_PAT} end`, "github [SCRUBBED] end"],
      [`github ${GH_FINE} end`, "github [SCRUBBED] end"],
      [`slack ${SLACK_TOKEN} end`, "slack [SCRUBBED] end"],
      [`openai ${OPENAI_KEY} end`, "openai [SCRUBBED] end"],
    ];
    for (const [input, expected] of cases) {
      expect(scrubSecrets(input)).toBe(expected);
    }
  });

  test("scrubs JWTs and Authorization headers", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c";
    // Bare JWTs with no known prefix.
    expect(scrubSecrets(`token ${jwt} end`)).toBe("token [SCRUBBED] end");
    // Authorization headers scrub the credential but keep the header shape.
    expect(scrubSecrets(`Authorization: Bearer ${jwt}`)).toBe("Authorization: Bearer [SCRUBBED]");
    expect(scrubSecrets("Authorization: Basic dXNlcjpwYXNzd29yZC12YWx1ZQ==")).toBe("Authorization: Basic [SCRUBBED]");
    expect(scrubSecrets("authorization = Bearer q7Rt2xVz9LpW4mKe8sYw")).toBe("authorization = Bearer [SCRUBBED]");
    // JSON-embedded headers stay valid JSON.
    const payload = JSON.stringify({ Authorization: `Bearer ${jwt}` });
    const scrubbed = scrubSecrets(payload);
    expect(scrubbed).not.toContain(jwt);
    expect(() => JSON.parse(scrubbed)).not.toThrow();
    // Idempotent on already-scrubbed headers.
    expect(scrubSecrets(scrubSecrets(`Authorization: Bearer ${jwt}`))).toBe("Authorization: Bearer [SCRUBBED]");
  });

  test("scrubs PEM private key blocks including truncated ones", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA7cP2S1yQ9Zx",
      "b3JnLXNlY3JldC1rZXktbWF0ZXJpYWw=",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    expect(scrubSecrets(`before\n${pem}\nafter`)).toBe("before\n[SCRUBBED]\nafter");
    const truncated = "-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7cP2S1yQ9Zx";
    expect(scrubSecrets(truncated)).toBe("[SCRUBBED]");
  });

  test("scrubs high-entropy KEY assignments but keeps low-entropy config", () => {
    expect(scrubSecrets('MY_API_KEY="q7Rt2xVz9LpW4mKe8s"')).toBe('MY_API_KEY="[SCRUBBED]"');
    expect(scrubSecrets("token: 'q7Rt2xVz9LpW4mKe8s'")).toBe("token: '[SCRUBBED]'");
    expect(scrubSecrets("DB_PASSWORD=q7Rt2xVz9LpW4mKe8sYw")).toBe("DB_PASSWORD=[SCRUBBED]");
    // Short, repetitive, or path-like values survive.
    expect(scrubSecrets('FEATURE_KEY="true"')).toBe('FEATURE_KEY="true"');
    expect(scrubSecrets('CACHE_KEY="aaaaaaaaaaaaaaaaaaaa"')).toBe('CACHE_KEY="aaaaaaaaaaaaaaaaaaaa"');
    expect(scrubSecrets('SSH_KEY_PATH="/home/user/.ssh/id_rsa.pub"')).toBe('SSH_KEY_PATH="/home/user/.ssh/id_rsa.pub"');
    // Non-secret-looking variable names are untouched.
    expect(scrubSecrets("RESULT=q7Rt2xVz9LpW4mKe8sYw")).toBe("RESULT=q7Rt2xVz9LpW4mKe8sYw");
  });

  test("scrubs secrets embedded in JSON without breaking the JSON", () => {
    const payload = JSON.stringify({
      apiKey: "q7Rt2xVz9LpW4mKe8sYw",
      note: `used ${ANT_KEY} earlier`,
    });
    const scrubbed = scrubSecrets(payload);
    expect(scrubbed).not.toContain("q7Rt2xVz9LpW4mKe8sYw");
    expect(scrubbed).not.toContain("sk" + "-ant-");
    expect(() => JSON.parse(scrubbed)).not.toThrow();
  });

  test("never corrupts JSON when secret values contain escaped quotes", () => {
    const payload = JSON.stringify({
      apiKey: 'q7Rt2xVz9Lp"W4mKe8sYw',
      other: "plain value",
    });
    const scrubbed = scrubSecrets(payload);
    expect(() => JSON.parse(scrubbed)).not.toThrow();
    expect(scrubbed).not.toContain("q7Rt2xVz9Lp");
    expect(scrubbed).toContain("plain value");
  });

  test("scrubs quoted assignments whose quotes are JSON-escaped", () => {
    // Agent providers emit a JSON document on stdout, so a shell assignment
    // like DB_PASSWORD="..." arrives with its quotes escaped as \".
    const stdout = JSON.stringify({ result: 'export DB_PASSWORD="x9Kd2mQz7Lp4Rv8t"' });
    const scrubbed = scrubSecrets(stdout);
    expect(scrubbed).not.toContain("x9Kd2mQz7Lp4Rv8t");
    expect(scrubbed).toContain("[SCRUBBED]");
    expect(JSON.parse(scrubbed)).toEqual({ result: 'export DB_PASSWORD="[SCRUBBED]"' });
    // JSON-encoded key/value pairs nested inside a JSON string field.
    const nested = JSON.stringify({ result: JSON.stringify({ apiKey: "q7Rt2xVz9LpW4mKe8sYw" }) });
    const nestedScrubbed = scrubSecrets(nested);
    expect(nestedScrubbed).not.toContain("q7Rt2xVz9LpW4mKe8sYw");
    expect(JSON.parse(JSON.parse(nestedScrubbed).result)).toEqual({ apiKey: "[SCRUBBED]" });
    // Authorization headers survive the same escaping.
    const header = JSON.stringify({ result: "Authorization: Bearer q7Rt2xVz9LpW4mKe8sYw" });
    const headerScrubbed = scrubSecrets(header);
    expect(headerScrubbed).not.toContain("q7Rt2xVz9LpW4mKe8sYw");
    expect(JSON.parse(headerScrubbed)).toEqual({ result: "Authorization: Bearer [SCRUBBED]" });
    // Idempotent on the escaped form too.
    expect(scrubSecrets(scrubbed)).toBe(scrubbed);
  });

  test("scrubSecretsDeep scrubs string leaves before serialization", () => {
    const evidence = {
      note: 'found DB_PASSWORD="x9Kd2mQz7Lp4Rv8t" in .env',
      nested: { tokens: [ANT_KEY, "harmless"] },
      count: 2,
      flag: true,
      missing: null,
    };
    const scrubbed = scrubSecretsDeep(evidence);
    expect(scrubbed.note).toBe('found DB_PASSWORD="[SCRUBBED]" in .env');
    expect(scrubbed.nested.tokens).toEqual(["[SCRUBBED]", "harmless"]);
    expect(scrubbed.count).toBe(2);
    expect(scrubbed.flag).toBe(true);
    expect(scrubbed.missing).toBeNull();
    // The original input is not mutated.
    expect(evidence.note).toContain("x9Kd2mQz7Lp4Rv8t");
    // toJSON-bearing objects (e.g. Date) serialize as JSON.stringify would.
    const dated: Record<string, unknown> = { at: new Date("2026-01-01T00:00:00.000Z") };
    expect(scrubSecretsDeep(dated)).toEqual({ at: "2026-01-01T00:00:00.000Z" });
  });

  test("keeps benign structured identifier keys (idempotency/dedupe/route) intact", () => {
    // Workflow run envelopes persist `${loopId}:${scheduledFor}:attempt:N`
    // idempotency keys; the 32-hex loop id clears the entropy threshold, so
    // without the allowlist every workflow run's stdout would be corrupted.
    const idempotencyKey = "a4f09b7c1d2e3f4a5b6c7d8e9f001122:2026-07-02T10:00:00.000Z:attempt:1";
    const envelope = JSON.stringify({ workflowRun: { idempotencyKey, routeKey: "todos-task:proj-a4f09b7c1d2e" } });
    expect(scrubSecrets(envelope)).toBe(envelope);
    expect(scrubSecrets(`LOOPS_IDEMPOTENCY_KEY="${idempotencyKey}"`)).toBe(`LOOPS_IDEMPOTENCY_KEY="${idempotencyKey}"`);
    expect(scrubSecrets('dedupe_key: "a4f09b7c1d2e3f4a5b6c7d8e9f001122"')).toBe('dedupe_key: "a4f09b7c1d2e3f4a5b6c7d8e9f001122"');
    // The allowlist is exact on the key name: a credential-looking key that
    // merely contains one of the words is still scrubbed.
    expect(scrubSecrets('routeKeySecret: "q7Rt2xVz9LpW4mKe8sYw"')).toBe('routeKeySecret: "[SCRUBBED]"');
  });

  test("is idempotent", () => {
    const input = [
      'MY_API_KEY="q7Rt2xVz9LpW4mKe8s"',
      `token ${ANT_KEY}`,
      "-----BEGIN EC PRIVATE KEY-----\nabc123\n-----END EC PRIVATE KEY-----",
    ].join("\n");
    const once = scrubSecrets(input);
    expect(scrubSecrets(once)).toBe(once);
  });

  test("handles 256KB inputs quickly", () => {
    const filler = "regular log output line with nothing sensitive at all 0123456789\n";
    const chunk = `${filler.repeat(50)}${ANT_KEY}\nMY_API_KEY="q7Rt2xVz9LpW4mKe8s"\n`;
    let text = chunk;
    while (text.length < 256 * 1024) text += chunk;
    const startedAt = performance.now();
    const scrubbed = scrubSecrets(text);
    const elapsedMs = performance.now() - startedAt;
    expect(scrubbed).not.toContain("sk" + "-ant-");
    expect(scrubbed).not.toContain("q7Rt2xVz9LpW4mKe8s");
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
