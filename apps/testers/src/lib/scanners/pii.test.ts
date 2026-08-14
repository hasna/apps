process.env["TESTERS_DB_PATH"] = ":memory:";

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { scanForPii } from "./pii.js";
import { scanPiiEndpoint } from "./pii-scanner.js";

describe("pii — scanForPii", () => {
  // ─── Email detection ────────────────────────────────────────────────────────

  test("detects email address", () => {
    const result = scanForPii("Contact us at admin@example.com for support.");
    expect(result.some((d) => d.type === "email")).toBe(true);
  });

  test("detects multiple emails", () => {
    const result = scanForPii("Email a@b.com and c@d.org");
    const emails = result.filter((d) => d.type === "email");
    expect(emails.length).toBe(2);
  });

  test("redacts email value (shows first 3 chars + ***)", () => {
    const result = scanForPii("admin@example.com");
    const detection = result.find((d) => d.type === "email");
    expect(detection).toBeDefined();
    expect(detection!.value).toBe("adm***");
    expect(detection!.value).not.toContain("example.com");
  });

  test("email detection is high severity", () => {
    const result = scanForPii("test@example.com");
    expect(result.find((d) => d.type === "email")?.severity).toBe("high");
  });

  test("no false positive on non-email text", () => {
    const result = scanForPii("Hello world, no PII here.");
    expect(result.filter((d) => d.type === "email")).toHaveLength(0);
  });

  // ─── Phone detection ────────────────────────────────────────────────────────

  test("detects US phone number with dashes", () => {
    const result = scanForPii("Call us at 555-123-4567.");
    expect(result.some((d) => d.type === "phone")).toBe(true);
  });

  test("detects US phone number with dots", () => {
    const result = scanForPii("Phone: 555.123.4567");
    expect(result.some((d) => d.type === "phone")).toBe(true);
  });

  test("detects phone with area code in parens", () => {
    const result = scanForPii("Call (800) 555-1234 today.");
    expect(result.some((d) => d.type === "phone")).toBe(true);
  });

  test("phone detection is medium severity", () => {
    const result = scanForPii("555-123-4567");
    expect(result.find((d) => d.type === "phone")?.severity).toBe("medium");
  });

  // ─── SSN detection ──────────────────────────────────────────────────────────

  test("detects SSN format", () => {
    const result = scanForPii("SSN: 123-45-6789");
    expect(result.some((d) => d.type === "ssn")).toBe(true);
  });

  test("SSN detection is critical severity", () => {
    const result = scanForPii("Social Security: 123-45-6789");
    expect(result.find((d) => d.type === "ssn")?.severity).toBe("critical");
  });

  // ─── API key detection ──────────────────────────────────────────────────────

  test("detects OpenAI-style sk- key", () => {
    const result = scanForPii("API key: sk-abc123def456ghi789jkl012mno345pqr678stu901");
    expect(result.some((d) => d.type === "api_key")).toBe(true);
  });

  test("API key detection is critical severity", () => {
    const result = scanForPii("sk-test12345678901234567890123456789012345678901234");
    expect(result.find((d) => d.type === "api_key")?.severity).toBe("critical");
  });

  // ─── Private IP detection ────────────────────────────────────────────────────

  test("detects 10.x.x.x private IP", () => {
    const result = scanForPii("Server at 10.0.0.1 is down.");
    expect(result.some((d) => d.type === "ip_private")).toBe(true);
  });

  test("detects 192.168.x.x private IP", () => {
    const result = scanForPii("Connect to 192.168.1.100");
    expect(result.some((d) => d.type === "ip_private")).toBe(true);
  });

  test("detects 172.16.x.x private IP", () => {
    const result = scanForPii("Internal host at 172.16.5.23.");
    expect(result.some((d) => d.type === "ip_private")).toBe(true);
  });

  test("private IP detection is medium severity", () => {
    const result = scanForPii("192.168.0.1");
    expect(result.find((d) => d.type === "ip_private")?.severity).toBe("medium");
  });

  test("does not flag public IPs as private", () => {
    const result = scanForPii("Public server at 8.8.8.8");
    expect(result.filter((d) => d.type === "ip_private")).toHaveLength(0);
  });

  // ─── Custom seed PII ────────────────────────────────────────────────────────

  test("detects custom seed PII value", () => {
    const result = scanForPii("The user john.smith@company.org called.", ["john.smith@company.org"]);
    const custom = result.filter((d) => d.type === "custom");
    expect(custom.length).toBeGreaterThan(0);
  });

  test("custom seed PII is case-insensitive", () => {
    const result = scanForPii("JOHN SMITH is the name.", ["john smith"]);
    const custom = result.filter((d) => d.type === "custom");
    expect(custom.length).toBeGreaterThan(0);
  });

  test("custom seed PII is high severity", () => {
    const result = scanForPii("Phone: 555-0001, user Alice.", ["Alice"]);
    const custom = result.find((d) => d.type === "custom");
    expect(custom?.severity).toBe("high");
  });

  test("redacts custom seed value", () => {
    const result = scanForPii("Contact Alice today.", ["Alice"]);
    const custom = result.find((d) => d.type === "custom");
    expect(custom).toBeDefined();
    expect(custom!.value).toBe("Ali***");
  });

  test("ignores empty seed values", () => {
    const result = scanForPii("Hello world", ["", " ", ""]);
    expect(result.filter((d) => d.type === "custom")).toHaveLength(0);
  });

  // ─── Context extraction ──────────────────────────────────────────────────────

  test("provides context around match", () => {
    const result = scanForPii("The user is admin@example.com and needs help.");
    const detection = result.find((d) => d.type === "email");
    expect(detection?.context).toContain("admin");
    expect(detection?.context).toContain("example");
  });

  test("context is at most ~60 chars around the match", () => {
    // Use spaces to break the email regex from gobbling adjacent text
    const result = scanForPii("  ".repeat(50) + "test@example.com" + "  ".repeat(50));
    const detection = result.find((d) => d.type === "email");
    expect(detection?.context).toBeDefined();
    // Context should be under 80 chars (25 + match + 25 + optional "...")
    expect(detection!.context.length).toBeLessThanOrEqual(80);
  });

  // ─── Position tracking ──────────────────────────────────────────────────────

  test("records position of match", () => {
    const text = "Hello, admin@example.com is the contact.";
    const result = scanForPii(text);
    const detection = result.find((d) => d.type === "email");
    expect(detection?.position).toBe(text.indexOf("admin@example.com"));
  });

  test("returns detections sorted by position", () => {
    const text = "First: admin@example.com. Then 192.168.1.1.";
    const result = scanForPii(text);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.position).toBeGreaterThanOrEqual(result[i - 1]!.position);
    }
  });

  // ─── Clean text ─────────────────────────────────────────────────────────────

  test("returns empty array for clean text", () => {
    const result = scanForPii("Hello! The weather is nice today. No sensitive data here.");
    expect(result).toHaveLength(0);
  });

  test("returns empty array for empty string", () => {
    const result = scanForPii("");
    expect(result).toHaveLength(0);
  });

  // ─── Multiple PII types in same text ────────────────────────────────────────

  test("detects multiple PII types in same text", () => {
    const text = "Email: user@test.com, SSN: 123-45-6789, Phone: 555-123-4567";
    const result = scanForPii(text);
    const types = new Set(result.map((d) => d.type));
    expect(types.has("email")).toBe(true);
    expect(types.has("ssn")).toBe(true);
    expect(types.has("phone")).toBe(true);
  });

  test("redaction applies to all detected values", () => {
    const result = scanForPii("admin@example.com 555-123-4567");
    for (const detection of result) {
      expect(detection.value).toContain("***");
      expect(detection.value.length).toBeLessThan(10); // always short (3 chars + ***)
    }
  });
});

// ─── scanPiiEndpoint ──────────────────────────────────────────────────────────

describe("scanPiiEndpoint", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("returns empty issues when response has no PII", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Hello! How can I help you today?" }), { status: 200 }))
    );

    const result = await scanPiiEndpoint({
      url: "http://localhost:3000",
      endpoint: "/api/chat",
      testPrompts: ["Hello"],
    });

    expect(result.issues).toHaveLength(0);
  });

  test("detects PII in AI response", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "The admin email is admin@company.com" }), { status: 200 }))
    );

    const result = await scanPiiEndpoint({
      url: "http://localhost:3000",
      endpoint: "/api/chat",
      testPrompts: ["What is the admin email?"],
    });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === "pii_leak")).toBe(true);
  });

  test("detects seed PII in response", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "The user secret-token-xyz123 is valid." }), { status: 200 }))
    );

    const result = await scanPiiEndpoint({
      url: "http://localhost:3000",
      endpoint: "/api/chat",
      testPrompts: ["Check token"],
      seedPii: ["secret-token-xyz123"],
    });

    expect(result.issues.length).toBeGreaterThan(0);
  });

  test("handles endpoint returning non-200 gracefully", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response("error", { status: 500 }))
    );

    const result = await scanPiiEndpoint({
      url: "http://localhost:3000",
      endpoint: "/api/chat",
      testPrompts: ["Hello"],
    });

    // No issues (we couldn't scan the response)
    expect(result.issues).toHaveLength(0);
  });

  test("handles network error gracefully", async () => {
    global.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));

    const result = await scanPiiEndpoint({
      url: "http://localhost:3000",
      endpoint: "/api/chat",
      testPrompts: ["Hello"],
    });

    expect(result.issues).toHaveLength(0);
  });

  test("result has correct url and pages", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 200 }))
    );

    const result = await scanPiiEndpoint({
      url: "http://localhost:3000",
      endpoint: "/api/chat",
      testPrompts: ["Test"],
    });

    expect(result.url).toBe("http://localhost:3000");
    expect(result.pages).toContain("http://localhost:3000/api/chat");
  });

  test("scans multiple prompts", async () => {
    let callCount = 0;
    global.fetch = mock(() => {
      callCount++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    await scanPiiEndpoint({
      url: "http://localhost:3000",
      endpoint: "/api/chat",
      testPrompts: ["Prompt 1", "Prompt 2", "Prompt 3"],
    });

    expect(callCount).toBe(3);
  });

  test("PII issue has pii_leak type", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ text: "Contact user@test.com" }), { status: 200 }))
    );

    const result = await scanPiiEndpoint({
      url: "http://localhost:3000",
      testPrompts: ["Hello"],
    });

    const piiIssue = result.issues.find((i) => i.type === "pii_leak");
    expect(piiIssue).toBeDefined();
    expect(piiIssue?.message).toContain("email");
  });
});
