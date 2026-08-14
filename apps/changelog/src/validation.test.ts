import { describe, expect, test } from "bun:test";
import { parseChangelogEntryInput } from "./validation.js";

describe("changelog validation", () => {
  test("normalizes tags, defaults version, and maps category to kind", () => {
    const parsed = parseChangelogEntryInput({
      appId: "open-changelog",
      title: " Works ",
      category: "added",
      tags: ["Release", "release", "  api "],
    });
    expect(parsed.version).toBe("Unreleased");
    expect(parsed.kind).toBe("added");
    expect(parsed.category).toBe("added");
    expect(parsed.title).toBe("Works");
    expect(parsed.tags).toEqual(["api", "release"]);
  });

  test("redacts common secrets in text and metadata", () => {
    const parsed = parseChangelogEntryInput({
      appId: "app",
      title: `token sk-${"proj"}-abcdefghijklmnopqrstuvwxyz123456 leaked`,
      details: `github gh${"p"}_abcdefghijklmnopqrstuvwxyz123456 leaked`,
      tags: [`npm_${"abcdefghijklmnopqrstuvwxyz123456"}`],
      commits: [`gh${"p"}_abcdefghijklmnopqrstuvwxyz123456`],
      tasks: [`x${"ai"}-abcdefghijklmnopqrstuvwxyz123456`],
      metadata: {
        apiToken: "do-not-store",
        nested: {
          value: `x${"ai"}-abcdefghijklmnopqrstuvwxyz123456`,
        },
      },
    });
    expect(parsed.title).toContain("[redacted]");
    expect(parsed.details).toContain("[redacted]");
    expect(parsed.tags).toEqual(["[redacted]"]);
    expect(parsed.commits).toEqual(["[redacted]"]);
    expect(parsed.tasks).toEqual(["[redacted]"]);
    expect(parsed.metadata?.apiToken).toBe("[redacted]");
    expect((parsed.metadata?.nested as { value: string }).value).toBe("[redacted]");
  });

  test("rejects impossible dates and conflicting kind/category values", () => {
    expect(() => parseChangelogEntryInput({
      appId: "app",
      title: "Bad date",
      date: "2026-02-31",
    })).toThrow("Date must be a real YYYY-MM-DD date");

    expect(() => parseChangelogEntryInput({
      appId: "app",
      title: "Conflict",
      kind: "added",
      category: "fixed",
    })).toThrow("kind and category must match");
  });
});
