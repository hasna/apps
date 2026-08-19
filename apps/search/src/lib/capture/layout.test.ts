import { describe, expect, test } from "bun:test";
import { captureObjectKey, parseCaptureObjectKey } from "./layout.js";

describe("captureObjectKey", () => {
  test("builds <prefix>/<date>/<captureId>.md from captured_at", () => {
    expect(
      captureObjectKey({ prefix: "search" }, "2026-08-19T12:00:00.000Z", "capture-abc"),
    ).toBe("search/2026-08-19/capture-abc.md");
  });

  test("strips slashes from the prefix", () => {
    expect(
      captureObjectKey({ prefix: "/search/" }, "2026-08-19T12:00:00.000Z", "c1"),
    ).toBe("search/2026-08-19/c1.md");
  });

  test("throws on an empty prefix (fail closed)", () => {
    expect(() =>
      captureObjectKey({ prefix: "" }, "2026-08-19T12:00:00.000Z", "c1"),
    ).toThrow(/prefix must not be empty/);
  });

  test("throws on a malformed date", () => {
    expect(() =>
      captureObjectKey({ prefix: "search" }, "12:00:00Z", "c1"),
    ).toThrow(/invalid corpus date/);
  });

  test("throws on an unsafe capture id", () => {
    expect(() =>
      captureObjectKey({ prefix: "search" }, "2026-08-19T12:00:00.000Z", "a/b"),
    ).toThrow(/invalid capture id/);
  });
});

describe("parseCaptureObjectKey", () => {
  test("round-trips a generated key", () => {
    const key = captureObjectKey({ prefix: "search" }, "2026-08-19T12:00:00.000Z", "capture-abc");
    expect(parseCaptureObjectKey(key)).toEqual({
      prefix: "search",
      date: "2026-08-19",
      captureId: "capture-abc",
    });
  });

  test("returns null for a non-matching key", () => {
    expect(parseCaptureObjectKey("search/a.md")).toBeNull();
    expect(parseCaptureObjectKey("other/a.md")).toBeNull();
  });
});
