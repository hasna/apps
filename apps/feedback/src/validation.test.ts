import { describe, expect, test } from "bun:test";
import { parseFeedbackInput } from "./validation.js";

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
      message: `token sk-${"proj"}-abcdefghijklmnopqrstuvwxyz123456 leaked`,
      metadata: {
        apiToken: "do-not-store",
        nested: {
          value: `gh${"p"}_abcdefghijklmnopqrstuvwxyz123456`,
        },
      },
    });
    expect(parsed.message).toContain("[redacted]");
    expect(parsed.metadata?.apiToken).toBe("[redacted]");
    expect((parsed.metadata?.nested as { value: string }).value).toBe("[redacted]");
  });
});
