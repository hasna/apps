import { describe, expect, test } from "bun:test";
import { parseFeedbackInput, redactSecretsInText } from "./validation.js";

describe("feedback validation", () => {
  test("normalizes tags and defaults kind", () => {
    const parsed = parseFeedbackInput({
      appId: " open-feedback ",
      message: "Works",
      tags: ["Bug", "bug", "  api "],
    });
    expect(parsed.appId).toBe("open-feedback");
    expect(parsed.kind).toBe("other");
    expect(parsed.tags).toEqual(["api", "bug"]);
  });

  test("redacts common secrets in text and metadata", () => {
    const parsed = parseFeedbackInput({
      appId: "app",
      message: `token sk-${"proj"}-abcdefghijklmnopqrstuvwxyz123456 leaked. Authorization: Bearer synthetic-value and secret-${"token"}: synthetic-value`,
      url: "https://example.com/path?token=plain-value&ok=1",
      metadata: {
        apiToken: "do-not-store",
        nested: {
          value: `gh${"p"}_abcdefghijklmnopqrstuvwxyz123456`,
        },
      },
    });
    expect(parsed.message).toContain("[redacted]");
    expect(parsed.message).not.toContain("synthetic-value");
    expect(parsed.url).toBe("https://example.com/path?token=[redacted]&ok=1");
    expect(parsed.metadata?.apiToken).toBe("[redacted]");
    expect((parsed.metadata?.nested as { value: string }).value).toBe("[redacted]");
  });

  test("redacts compact credential fixture table", () => {
    const samples = [
      `Authorization: Bearer synthetic-value`,
      `cookie=sessionid=synthetic-value`,
      `access_token=synthetic-value`,
      `secret-${"token"}: synthetic-value`,
      `key sk-${"ant"}-abcdefghijklmnopqrstuvwxyz123456`,
      `key x${"ai"}-abcdefghijklmnopqrstuvwxyz123456`,
    ];

    for (const sample of samples) {
      expect(redactSecretsInText(sample)).not.toContain("synthetic-value");
      expect(redactSecretsInText(sample)).toContain("[redacted]");
    }
  });
});
