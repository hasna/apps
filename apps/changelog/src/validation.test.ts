import { describe, expect, test } from "bun:test";
import {
  appIdSchema,
  normalizeAppId,
  normalizeRefs,
  parseAppId,
  parseChangelogDate,
  parseChangelogEntryInput,
  parseChangelogEntryUpdate,
  parseChangelogKind,
  parseStoredChangelogEntry,
  redactSensitiveJson,
  validationErrorMessage,
} from "./validation.js";

describe("changelog validation", () => {
  test("normalizes tags, defaults version, and maps category to kind", () => {
    const parsed = parseChangelogEntryInput({
      appId: "changelog",
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

describe("normalizeRefs", () => {
  test("dedupes, trims, drops empties, and sorts refs", () => {
    expect(normalizeRefs(["b", "a", "b", "  c  ", ""])).toEqual(["a", "b", "c"]);
  });

  test("redacts secret-shaped refs before dedupe", () => {
    expect(normalizeRefs([`sk-${"proj"}-abcdefghijklmnopqrstuvwxyz123456`, "plain"])).toEqual([
      "[redacted]",
      "plain",
    ]);
  });
});

describe("parseChangelogEntryUpdate", () => {
  test("partial single-field updates leave other fields undefined", () => {
    const partial = parseChangelogEntryUpdate({ title: "Only the title" });
    expect(partial).toEqual({ title: "Only the title" });
    expect(partial.appId).toBeUndefined();
    expect(partial.version).toBeUndefined();
    expect(partial.kind).toBeUndefined();
  });

  test("normalizes appId and tags in an update", () => {
    const updated = parseChangelogEntryUpdate({
      appId: "@hasna/My-App",
      tags: ["Release", "release"],
    });
    expect(updated.appId).toBe("my-app");
    expect(updated.tags).toEqual(["release"]);
  });

  test("rejects conflicting kind and category in an update", () => {
    expect(() => parseChangelogEntryUpdate({ kind: "added", category: "fixed" })).toThrow(
      "kind and category must match",
    );
  });
});

describe("kind rejection", () => {
  test("parseChangelogKind rejects values outside the seven kinds", () => {
    expect(() => parseChangelogKind("bogus")).toThrow();
    expect(() => parseChangelogKind(42)).toThrow();
  });

  test("entry input and update reject an invalid kind", () => {
    expect(() => parseChangelogEntryInput({ appId: "app", title: "X", kind: "bogus" })).toThrow();
    expect(() => parseChangelogEntryUpdate({ kind: "bogus" })).toThrow();
  });
});

describe("parseStoredChangelogEntry", () => {
  const validRow = {
    id: "00000000-0000-4000-8000-000000000001",
    appId: "app",
    version: "1.0.0",
    kind: "added",
    category: "added",
    title: "Stored",
    date: "2026-07-01",
    tags: [],
    links: [],
    commits: [],
    tasks: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    source: "server",
  };

  test("accepts a valid stored row", () => {
    expect(parseStoredChangelogEntry(validRow).id).toBe(validRow.id);
  });

  test("rejects stored rows missing required fields or carrying invalid values", () => {
    const { createdAt, ...missingCreated } = validRow;
    expect(() => parseStoredChangelogEntry(missingCreated)).toThrow();
    expect(() => parseStoredChangelogEntry({ ...validRow, source: "hacker" })).toThrow();
    expect(() => parseStoredChangelogEntry({ ...validRow, date: "2026-02-31" })).toThrow();
    expect(() => parseStoredChangelogEntry({ ...validRow, kind: "bogus" })).toThrow();
  });
});

describe("validationErrorMessage", () => {
  test("zod errors produce a path: message summary joined by semicolons", () => {
    const zodError = appIdSchema.safeParse("BAD").error;
    expect(zodError).toBeDefined();
    expect(validationErrorMessage(zodError!)).toMatch(/^input: /);
  });

  test("plain errors and strings pass through their message", () => {
    expect(validationErrorMessage(new Error("boom"))).toBe("boom");
    expect(validationErrorMessage("raw string")).toBe("raw string");
  });
});

describe("parseChangelogDate", () => {
  test("explicit now is used when the date is absent", () => {
    const now = new Date("2026-05-15T10:00:00.000Z");
    expect(parseChangelogDate(undefined, now)).toBe("2026-05-15");
  });

  test("an explicit date passes through and an impossible date is rejected", () => {
    expect(parseChangelogDate("2026-07-01", new Date("2026-05-15T10:00:00.000Z"))).toBe("2026-07-01");
    expect(() => parseChangelogDate("2026-02-31")).toThrow();
  });
});

describe("appIdSchema rejection", () => {
  test("rejects uppercase, leading-hyphen, and empty app ids", () => {
    expect(appIdSchema.safeParse("MyApp").success).toBe(false);
    expect(appIdSchema.safeParse("-app").success).toBe(false);
    expect(appIdSchema.safeParse("").success).toBe(false);
    expect(appIdSchema.safeParse("app").success).toBe(true);
  });

  test("parseAppId normalizes a scoped npm name and rejects unnormalizable values", () => {
    expect(parseAppId("@hasna/todos")).toBe("todos");
    expect(() => parseAppId("@")).toThrow();
  });

  test("normalizeAppId throws for empty and whitespace-only values", () => {
    expect(() => normalizeAppId("")).toThrow();
    expect(() => normalizeAppId("   ")).toThrow();
  });
});

describe("redactSensitiveJson", () => {
  test("redacts values under secret-shaped keys at any depth", () => {
    const redacted = redactSensitiveJson({
      apiKey: "k",
      authorization: "Bearer x",
      password: "p",
      refresh_token: "r",
      private_key: "pk",
      cookie: "c",
      credential: "cr",
      secret: "s",
      nested: { token: "t" },
    });
    expect(redacted).toEqual({
      apiKey: "[redacted]",
      authorization: "[redacted]",
      password: "[redacted]",
      refresh_token: "[redacted]",
      private_key: "[redacted]",
      cookie: "[redacted]",
      credential: "[redacted]",
      secret: "[redacted]",
      nested: { token: "[redacted]" },
    });
  });

  test("benign keys and benign values pass through unchanged", () => {
    const input = {
      title: "Release notes",
      count: 3,
      enabled: true,
      note: null,
      links: ["https://example.com", "plain"],
    };
    expect(redactSensitiveJson(input)).toEqual(input);
  });

  test("secret-shaped VALUES inside benign strings are still redacted", () => {
    expect(redactSensitiveJson({ title: `token sk-${"proj"}-abcdefghijklmnopqrstuvwxyz123456` })).toEqual({
      title: "token [redacted]",
    });
  });
});
