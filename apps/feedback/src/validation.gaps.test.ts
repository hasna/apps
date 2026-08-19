// Sol-guided coverage — Priority 3: validation contract gaps.
//
// Each assertion is two-sided: the valid arm and the invalid arm of the same
// boundary, so a loosened validator fails the negative case and a tightened
// one fails the positive case.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  FEEDBACK_TASK_ERROR_MAX_LENGTH,
  isFeedbackLinkageDelta,
  normalizeTags,
  parseFeedbackInput,
  parseFeedbackLinkageDelta,
  parseFeedbackStatus,
  parseStoredFeedbackItem,
  redactSensitiveJson,
  truncateTaskError,
  validationErrorMessage,
} from "./validation.js";
import type { FeedbackItem } from "./types.js";

const NOW = "2026-08-01T00:00:00.000Z";

function storedItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "fb-1",
    appId: "app-a",
    message: "stored round trip",
    createdAt: NOW,
    updatedAt: NOW,
    status: "new",
    source: "cli",
    kind: "other",
    tags: ["B", "a"],
    ...overrides,
  };
}

describe("feedback validation gaps", () => {
  test("parseFeedbackStatus accepts all four statuses and rejects anything else", () => {
    expect(parseFeedbackStatus("new")).toBe("new");
    expect(parseFeedbackStatus("triaged")).toBe("triaged");
    expect(parseFeedbackStatus("shipped")).toBe("shipped");
    expect(parseFeedbackStatus("closed")).toBe("closed");
    expect(() => parseFeedbackStatus("bogus")).toThrow(z.ZodError);
    expect(() => parseFeedbackStatus("")).toThrow(z.ZodError);
    expect(() => parseFeedbackStatus(undefined as unknown as string)).toThrow(z.ZodError);
    expect(() => parseFeedbackStatus("NEW")).toThrow(z.ZodError);
  });

  test("a stored item round-trips its task linkage, changelog receipt, and timestamps", () => {
    const item = storedItem({
      status: "shipped",
      changelogRef: "CH-42",
      shippedAt: "2026-08-02T00:00:00.000Z",
      taskRef: {
        provider: "todos",
        taskId: "task-uuid-9",
        shortId: "APP-0009",
        createdAt: "2026-08-01T01:00:00.000Z",
      },
      taskAttempt: { startedAt: "2026-08-01T01:00:00.000Z", attempts: 3 },
    });
    const parsed = parseStoredFeedbackItem(item);
    expect(parsed.changelogRef).toBe("CH-42");
    expect(parsed.shippedAt).toBe("2026-08-02T00:00:00.000Z");
    expect(parsed.taskRef?.taskId).toBe("task-uuid-9");
    expect(parsed.taskRef?.shortId).toBe("APP-0009");
    expect(parsed.taskAttempt?.attempts).toBe(3);
    expect(parsed.tags).toEqual(["a", "b"]);
  });

  test("truncateTaskError keeps exactly 4096 characters and truncates above it to 4095 plus ellipsis", () => {
    const exact = "x".repeat(FEEDBACK_TASK_ERROR_MAX_LENGTH);
    expect(truncateTaskError(exact)).toBe(exact);
    expect(truncateTaskError(exact).length).toBe(4096);

    const over = "y".repeat(FEEDBACK_TASK_ERROR_MAX_LENGTH + 1);
    const truncated = truncateTaskError(over);
    expect(truncated.length).toBe(4096);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.slice(0, -1)).toBe("y".repeat(4095));

    expect(truncateTaskError("  padded  ")).toBe("padded");
  });

  test("feedbackLinkageDelta accepts a valid delta and rejects malformed shapes", () => {
    const valid = parseFeedbackLinkageDelta({
      patch: "task",
      id: "fb-1",
      taskRef: { provider: "todos", taskId: "t-1", createdAt: NOW },
      taskError: null,
    });
    expect(valid.patch).toBe("task");
    expect(valid.id).toBe("fb-1");
    expect(valid.taskRef?.taskId).toBe("t-1");

    expect(() => parseFeedbackLinkageDelta({ patch: "other", id: "fb-1" })).toThrow(z.ZodError);
    expect(() => parseFeedbackLinkageDelta({ patch: "task" })).toThrow(z.ZodError);
    expect(() =>
      parseFeedbackLinkageDelta({ patch: "task", id: "fb-1", taskRef: { provider: "todos", taskId: "t-1" } }),
    ).toThrow(z.ZodError);
    expect(() =>
      parseFeedbackLinkageDelta({ patch: "task", id: "fb-1", taskAttempt: { attempts: 0 } }),
    ).toThrow(z.ZodError);
    expect(() =>
      parseFeedbackLinkageDelta({ patch: "task", id: "fb-1", taskAttempt: { attempts: 1 } }),
    ).toThrow(z.ZodError);
  });

  test("isFeedbackLinkageDelta recognizes only the task patch marker", () => {
    expect(isFeedbackLinkageDelta({ patch: "task", id: "fb-1" })).toBe(true);
    expect(isFeedbackLinkageDelta({})).toBe(false);
    expect(isFeedbackLinkageDelta(null)).toBe(false);
    expect(isFeedbackLinkageDelta({ patch: "other" })).toBe(false);
    expect(isFeedbackLinkageDelta("task")).toBe(false);
  });

  test("parseFeedbackInput rejects every documented invalid boundary", () => {
    expect(() => parseFeedbackInput({ appId: "   ", message: "m" })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "app-a", message: "   " })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "app-a", message: "m", email: "not-an-email" })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "app-a", message: "m", rating: 0 })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "app-a", message: "m", rating: 6 })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "app-a", message: "m", rating: Number.NaN })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "app-a", message: "m", rating: Number.POSITIVE_INFINITY })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "app-a", message: "m", tags: Array.from({ length: 26 }, (_, i) => `t${i}`) })).toThrow(z.ZodError);
    expect(() => parseFeedbackInput({ appId: "a".repeat(129), message: "m" })).toThrow(z.ZodError);
  });

  test("parseFeedbackInput accepts the boundaries it documents", () => {
    const min = parseFeedbackInput({ appId: "app-a", message: "m", rating: 1 });
    expect(min.rating).toBe(1);
    const max = parseFeedbackInput({ appId: "app-a", message: "m", rating: 5 });
    expect(max.rating).toBe(5);
    const tags = parseFeedbackInput({ appId: "app-a", message: "m", tags: Array.from({ length: 25 }, (_, i) => `t${i}`) });
    expect(tags.tags).toHaveLength(25);
    const longApp = parseFeedbackInput({ appId: "a".repeat(128), message: "m" });
    expect(longApp.appId).toHaveLength(128);
    const defaults = parseFeedbackInput({ appId: "app-a", message: "m" });
    expect(defaults.kind).toBe("other");
    expect(defaults.tags).toEqual([]);
  });

  test("normalizeTags lowercases, trims, dedupes, sorts, and drops empties", () => {
    expect(normalizeTags(["B", " a ", "a", "c", "B", "", "  "])).toEqual(["a", "b", "c"]);
    expect(normalizeTags()).toEqual([]);
    expect(normalizeTags(["single"])).toEqual(["single"]);
  });

  test("validationErrorMessage distinguishes zod issues from ordinary errors and values", () => {
    let zodError: unknown;
    try {
      parseFeedbackStatus("nope");
    } catch (error) {
      zodError = error;
    }
    expect(zodError).toBeInstanceOf(z.ZodError);
    const zodMessage = validationErrorMessage(zodError);
    expect(zodMessage).toContain("Invalid enum value");

    expect(validationErrorMessage(new Error("plain failure"))).toBe("plain failure");
    expect(validationErrorMessage("raw string")).toBe("raw string");
  });

  test("redactSensitiveJson redacts sensitive keys at any depth but leaves benign values and primitives intact", () => {
    // The value under a sensitive KEY is redacted by key before any value
    // scanning, so the fixture carries a benign value (a synthetic token shape
    // would trip the repo's own secret detector in a test fixture).
    const redacted = redactSensitiveJson({
      apiKey: "super-secret-value",
      name: "Export button",
      appId: "app-a",
      nested: { authorization: "Bearer abcdefgh", count: 3, enabled: true },
      list: [{ password: "p@ss" }, "plain"],
      nothing: null,
    }) as Record<string, unknown>;
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.name).toBe("Export button");
    expect(redacted.appId).toBe("app-a");
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.authorization).toBe("[redacted]");
    expect(nested.count).toBe(3);
    expect(nested.enabled).toBe(true);
    const list = redacted.list as unknown[];
    expect((list[0] as Record<string, unknown>).password).toBe("[redacted]");
    expect(list[1]).toBe("plain");
    expect(redacted.nothing).toBeNull();
  });

  test("string values have secrets redacted, with short bearer tokens below 8 characters left alone", () => {
    // Measured contract: the header pattern requires a COLON after the keyword
    // and consumes the value up to the next comma/semicolon/newline. A keyword
    // without a colon is ordinary prose and must NOT be redacted.
    const colonDelimited = redactSensitiveJson("password: xyz, token: abcdefgh");
    expect(colonDelimited).toBe("password: [redacted], token: [redacted]");

    const noColon = redactSensitiveJson("use token: abcdefgh, and password xyz here");
    expect(noColon).toBe("use token: [redacted], and password xyz here");

    const benign = redactSensitiveJson("this sentence has no secret keys");
    expect(benign).toBe("this sentence has no secret keys");

    const short = redactSensitiveJson("Bearer abc");
    expect(short).toBe("Bearer abc");
    const qualifying = redactSensitiveJson("Bearer abcdefgh");
    expect(qualifying).toBe("Bearer [redacted]");
  });
});
