import { describe, expect, test } from "bun:test";
import {
  resolveAliasedString,
  resolveCollectionQueryOptions,
  resolveExportFormat,
  resolveIso8601Date,
  resolvePresentString,
} from "./strict-query-values";

describe("strict query values", () => {
  test("distinguishes absent optional strings from present-empty values", () => {
    expect(resolvePresentString(null, "channel")).toBeUndefined();
    expect(resolvePresentString("  conversations  ", "channel")).toBe("conversations");
    expect(() => resolvePresentString("", "channel")).toThrow("channel must not be empty");
    expect(() => resolvePresentString("   ", "channel")).toThrow("channel must not be empty");
  });

  test("validates both names of an aliased query value before choosing one", () => {
    expect(resolveAliasedString(new URLSearchParams("session=one&session_id=one"), "session", "session_id"))
      .toBe("one");
    expect(() => resolveAliasedString(
      new URLSearchParams("session=one&session_id="),
      "session",
      "session_id",
    )).toThrow("session_id must not be empty");
    expect(() => resolveAliasedString(
      new URLSearchParams("session=one&session_id=two"),
      "session",
      "session_id",
    )).toThrow("session and session_id must match when both are provided");
  });

  test("accepts strict ISO 8601 dates and rejects Date.parse-only values", () => {
    expect(resolveIso8601Date("2026-07-19", "since")).toBe("2026-07-19");
    expect(resolveIso8601Date("2026-07-19T05:00:00.123Z", "since"))
      .toBe("2026-07-19T05:00:00.123Z");
    expect(resolveIso8601Date("2026-07-19T08:00:00+03:00", "since"))
      .toBe("2026-07-19T08:00:00+03:00");
    for (const value of ["1", "July 19, 2026", "2026-02-30", "2026-07-19T05:00:00"]) {
      expect(() => resolveIso8601Date(value, "since"), value)
        .toThrow("since must be a valid ISO 8601 date");
    }
  });

  test("uses strict collection pagination and caps for every present value", () => {
    const valid = resolveCollectionQueryOptions(new URLSearchParams(
      "limit=5&cursor=2&offset=2&max_bytes=4096&preview_bytes=128&timeout_ms=500",
    ));
    expect(valid).toEqual({
      limit: 5,
      offset: 2,
      maxBytes: 4096,
      previewBytes: 128,
      timeoutMs: 500,
    });

    for (const query of [
      "limit=",
      "cursor=",
      "offset=",
      "max_bytes=",
      "preview_bytes=",
      "timeout_ms=",
      "cursor=1&offset=2",
    ]) {
      expect(() => resolveCollectionQueryOptions(new URLSearchParams(query)), query).toThrow();
    }
  });

  test("defaults export format only when absent", () => {
    expect(resolveExportFormat(null)).toBe("json");
    expect(resolveExportFormat("csv")).toBe("csv");
    expect(() => resolveExportFormat("")).toThrow("format must not be empty");
    expect(() => resolveExportFormat("xml")).toThrow("format must be json or csv");
  });
});
