import { describe, it, expect } from "bun:test";
import { redactSecrets, containsSecrets, redactMemoryForOutput, redactTextFragment, redactSearchResultForOutput } from "./redact.js";
import type { Memory } from "../types/index.js";

const REDACTED = "[REDACTED]";

// ============================================================================
// redactSecrets
// ============================================================================

describe("redactSecrets", () => {
  // --- OpenAI keys ---
  it("redacts OpenAI API key", () => {
    const input = "my key is sk-abc123def456ghi789jk";
    expect(redactSecrets(input)).toBe(`my key is ${REDACTED}`);
  });

  it("redacts OpenAI key with longer suffix", () => {
    const input = "sk" + "-proj-" + "abcdefghij1234567890extra";
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  // --- Anthropic keys ---
  it("redacts Anthropic API key", () => {
    const input = "key: sk" + "-ant-" + "abc123def456ghi789jk";
    expect(redactSecrets(input)).toBe(`key: ${REDACTED}`);
  });

  // --- Generic key patterns ---
  it("redacts pk_test_ prefixed keys", () => {
    const input = "pk_test_abcdefghijklmnop";
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  it("redacts tok- prefixed tokens", () => {
    const input = "tok-abcdefghij1234567890";
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  it("redacts api_key- prefixed keys", () => {
    const input = "api_key-abcdefghij1234567890";
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  it("redacts api-key prefixed keys (case insensitive)", () => {
    const input = "API-KEY_abcdefghij1234567890";
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  // --- AWS access keys ---
  it("redacts AWS access key ID", () => {
    const input = "aws_access_key_id = AK" + "IAIOSFODNN7EXAMPLE";
    expect(redactSecrets(input)).toBe(`aws_access_key_id = ${REDACTED}`);
  });

  // --- GitHub tokens ---
  it("redacts GitHub personal access token (ghp underbar)", () => {
    const token = "gh" + "p_" + "a".repeat(36);
    const input = `token: ${token}`;
    expect(redactSecrets(input)).toBe(`token: ${REDACTED}`);
  });

  it("redacts GitHub OAuth token (gho underbar)", () => {
    const token = "gh" + "o_" + "b".repeat(36);
    const input = `auth: ${token}`;
    expect(redactSecrets(input)).toBe(`auth: ${REDACTED}`);
  });

  it("redacts GitHub server token (ghs_)", () => {
    const token = "ghs_" + "c".repeat(36);
    expect(redactSecrets(token)).toBe(REDACTED);
  });

  // --- npm tokens ---
  it("redacts npm tokens", () => {
    const token = "npm_" + "d".repeat(36);
    expect(redactSecrets(`npm token: ${token}`)).toBe(`npm token: ${REDACTED}`);
  });

  // --- Bearer tokens ---
  it("redacts Bearer tokens in headers", () => {
    const input = "Authorization: Bearer eyABCDEFGHIJKLMNOPQRSTU";
    expect(redactSecrets(input)).toBe(`Authorization: ${REDACTED}`);
  });

  // --- Connection strings ---
  it("redacts postgres connection string", () => {
    const input = "DATABASE_URL=postgres://admin:s3cret@db.example.com:5432/mydb";
    expect(redactSecrets(input)).toBe(`DATABASE_URL=${REDACTED}`);
  });

  it("redacts redis connection string", () => {
    const input = "REDIS_URL=redis://user:pass@redis.host:6379/0";
    expect(redactSecrets(input)).toBe(`REDIS_URL=${REDACTED}`);
  });

  it("redacts mongodb connection string", () => {
    const input = "mongodb://root:password123@mongo.host:27017/admin";
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  // --- Stripe keys ---
  it("redacts Stripe secret key (sk_test_)", () => {
    const key = "sk_test_" + "e".repeat(24);
    expect(redactSecrets(`stripe: ${key}`)).toBe(`stripe: ${REDACTED}`);
  });

  it("redacts Stripe publishable key (pk_live_)", () => {
    const key = "pk_live_" + "f".repeat(24);
    expect(redactSecrets(key)).toBe(REDACTED);
  });

  // --- Slack tokens ---
  it("redacts Slack bot tokens (xoxb-)", () => {
    const token = "xoxb-" + "g".repeat(24);
    expect(redactSecrets(`slack: ${token}`)).toBe(`slack: ${REDACTED}`);
  });

  // --- JWT tokens ---
  it("redacts JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456ghi";
    const input = `token: ${jwt}`;
    expect(redactSecrets(input)).toBe(`token: ${REDACTED}`);
  });

  // --- .env secrets ---
  it("redacts SECRET_KEY=value pattern", () => {
    const input = 'SECRET_KEY="my-super-secret-value"';
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  it("redacts API_TOKEN=value pattern", () => {
    const input = "API_TOKEN=abcdefghijklmnop1234";
    expect(redactSecrets(input)).toContain(REDACTED);
    expect(redactSecrets(input)).not.toContain("abcdefghijklmnop1234");
  });

  it("redacts PASSWORD=value pattern", () => {
    const input = "DATABASE_PASSWORD=hunter2hunter2";
    expect(redactSecrets(input)).toContain(REDACTED);
    expect(redactSecrets(input)).not.toContain("hunter2hunter2");
  });

  it("redacts AUTH_CREDENTIAL pattern", () => {
    const input = "AUTH_CREDENTIAL=someLongSecretValue99";
    expect(redactSecrets(input)).toBe(REDACTED);
  });

  // --- Non-secrets preserved ---
  it("preserves normal text", () => {
    const input = "This is a normal sentence about programming.";
    expect(redactSecrets(input)).toBe(input);
  });

  it("preserves URLs without credentials", () => {
    const input = "Visit https://example.com/api/v1/docs for more info.";
    expect(redactSecrets(input)).toBe(input);
  });

  it("preserves short strings", () => {
    const input = "sk-short";
    expect(redactSecrets(input)).toBe(input);
  });

  it("preserves normal variable assignments", () => {
    const input = "PORT=3000";
    expect(redactSecrets(input)).toBe(input);
  });

  // --- Multiple secrets ---
  it("redacts multiple secrets in one string", () => {
    const openai = "sk-abc123def456ghi789jk";
    const ghToken = "gh" + "p_" + "x".repeat(36);
    const input = `Keys: ${openai} and ${ghToken} are secret`;
    const result = redactSecrets(input);
    expect(result).toBe(`Keys: ${REDACTED} and ${REDACTED} are secret`);
    expect(result).not.toContain("sk-abc");
    expect(result).not.toContain("gh" + "p_");
  });

  // --- Empty string ---
  it("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });

  // --- Idempotent ---
  it("is idempotent on already-redacted text", () => {
    const input = `key: ${REDACTED}`;
    expect(redactSecrets(input)).toBe(input);
  });
});

// ============================================================================
// containsSecrets
// ============================================================================

describe("containsSecrets", () => {
  it("returns true for OpenAI key", () => {
    expect(containsSecrets("sk-abc123def456ghi789jk")).toBe(true);
  });

  it("returns true for Anthropic key", () => {
    expect(containsSecrets("sk" + "-ant-" + "abc123def456ghi789jk")).toBe(true);
  });

  it("returns true for AWS access key", () => {
    expect(containsSecrets("AK" + "IAIOSFODNN7EXAMPLE")).toBe(true);
  });

  it("returns true for GitHub token", () => {
    expect(containsSecrets("gh" + "p_" + "a".repeat(36))).toBe(true);
  });

  it("returns true for JWT", () => {
    expect(
      containsSecrets(
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456ghi"
      )
    ).toBe(true);
  });

  it("returns true for connection string", () => {
    expect(containsSecrets("postgres://user:pass@host:5432/db")).toBe(true);
  });

  it("returns true for Stripe key", () => {
    expect(containsSecrets("sk_test_" + "z".repeat(24))).toBe(true);
  });

  it("returns true for Bearer token", () => {
    expect(containsSecrets("Bearer eyABCDEFGHIJKLMNOPQRSTU")).toBe(true);
  });

  it("returns false for normal text", () => {
    expect(containsSecrets("Hello world, this is fine.")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(containsSecrets("")).toBe(false);
  });

  it("returns false for short key-like string", () => {
    expect(containsSecrets("sk-short")).toBe(false);
  });

  it("returns true for .env secret pattern", () => {
    expect(containsSecrets("SECRET_KEY=super-secret-value-here")).toBe(true);
  });
});

// ============================================================================
// redactMemoryForOutput — read-path (list/search/show) display redaction
// ============================================================================

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "m-test-1",
    key: "ordinary-key",
    value: "ordinary value",
    category: "fact",
    scope: "private",
    summary: null,
    tags: [],
    importance: 5,
    source: "agent",
    status: "active",
    pinned: false,
    agent_id: null,
    project_id: null,
    session_id: null,
    machine_id: null,
    flag: null,
    when_to_use: null,
    sequence_group: null,
    sequence_order: null,
    content_type: "text",
    namespace: null,
    created_by_agent: null,
    updated_by_agent: null,
    trust_score: null,
    metadata: {},
    access_count: 0,
    version: 1,
    expires_at: null,
    valid_from: null,
    valid_until: null,
    ingested_at: null,
    created_at: "2026-08-24 00:00:00",
    updated_at: "2026-08-24 00:00:00",
    accessed_at: null,
    ...overrides,
  };
}

describe("redactMemoryForOutput", () => {
  const AWS_KEY = "AK" + "IAIOSFODNN7EXAMPLE"; // AKIA + 16 chars
  const NPM_TOKEN = "npm_" + "a".repeat(36);

  it("redacts a credential-shaped key (the write path never redacts keys)", () => {
    const out = redactMemoryForOutput(makeMemory({ key: AWS_KEY }));
    expect(out.key).toBe(REDACTED);
    expect(out.key).not.toContain(AWS_KEY);
  });

  it("redacts credential-shaped value and summary", () => {
    const out = redactMemoryForOutput(
      makeMemory({ value: `token ${NPM_TOKEN}`, summary: `aws ${AWS_KEY}` }),
    );
    expect(out.value).not.toContain(NPM_TOKEN);
    expect(out.summary).not.toContain(AWS_KEY);
  });

  it("redacts string leaves inside metadata while preserving structure", () => {
    const out = redactMemoryForOutput(
      makeMemory({ metadata: { url: "https://example.com", token: NPM_TOKEN, nested: { aws: AWS_KEY, n: 3 } } }),
    );
    expect(JSON.stringify(out.metadata)).not.toContain(NPM_TOKEN);
    expect(JSON.stringify(out.metadata)).not.toContain(AWS_KEY);
    expect(out.metadata.url).toBe("https://example.com");
    expect(out.metadata.nested.n).toBe(3);
  });

  it("preserves ordinary keys, values and coordination metadata", () => {
    const input = makeMemory({
      key: "ordinary-key",
      value: "ordinary value that must survive",
      importance: 9,
      scope: "shared",
      category: "knowledge",
      agent_id: "agent-chief-knowledge",
      tags: ["coordination"],
    });
    const out = redactMemoryForOutput(input);
    expect(out.key).toBe("ordinary-key");
    expect(out.value).toBe("ordinary value that must survive");
    expect(out.id).toBe(input.id);
    expect(out.importance).toBe(9);
    expect(out.scope).toBe("shared");
    expect(out.category).toBe("knowledge");
    expect(out.agent_id).toBe("agent-chief-knowledge");
    expect(out.tags).toEqual(["coordination"]);
    expect(out.created_at).toBe(input.created_at);
  });
});

// redactSearchResultForOutput / redactTextFragment — the search read path
// (todos e12c7659). A search result's HIGHLIGHT SNIPPETS are derived from the
// same memory text as the key/value, so a query that matches inside a
// credential-shaped key yields a snippet carrying the whole key — redacting
// the memory alone is not enough for the search verb.
// ============================================================================

describe("redactTextFragment", () => {
  const NPM_TOKEN = "npm_" + "a".repeat(36);

  it("redacts a credential-shaped token inside a text fragment", () => {
    expect(redactTextFragment(`prefix ${NPM_TOKEN} suffix`)).not.toContain(NPM_TOKEN);
  });

  it("preserves ordinary text", () => {
    expect(redactTextFragment("ordinary snippet text")).toBe("ordinary snippet text");
  });
});

describe("redactSearchResultForOutput", () => {
  const NPM_TOKEN = "npm_" + "a".repeat(36);

  it("redacts the result memory and every highlight snippet, keeping score/match_type", () => {
    const result = {
      memory: makeMemory({ id: "m-res", key: NPM_TOKEN }),
      score: 1.5,
      match_type: "exact" as const,
      highlights: [
        { field: "key" as const, snippet: `…${NPM_TOKEN}…` },
        { field: "value" as const, snippet: "ordinary value" },
      ],
    };
    const out = redactSearchResultForOutput(result);
    expect(out.memory.key).not.toContain(NPM_TOKEN);
    expect(out.highlights![0]!.snippet).not.toContain(NPM_TOKEN);
    // The snippet that never held a token is untouched.
    expect(out.highlights![1]!.snippet).toBe("ordinary value");
    // Coordination metadata survives.
    expect(out.score).toBe(1.5);
    expect(out.match_type).toBe("exact");
    expect(out.memory.id).toBe("m-res");
  });
});
