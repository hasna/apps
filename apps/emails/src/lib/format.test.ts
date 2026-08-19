// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// Formatting helpers for the CLI's human surface. The hermetic runner sets
// NO_COLOR=1, and ansi.ts honors it, so every assertion below is against the
// PLAIN (non-ANSI) rendering — deterministic in the runner. The file pins
// NO_COLOR itself so the suite stays deterministic even outside the runner.
//
// Failure modes a weak test would miss:
//   - truncate at and below the ellipsis length: len=1 must yield "…" alone,
//     and len=0 currently returns a LONGER string ("abc…") — the slice
//     bound goes negative and wraps. That quirk is pinned deliberately so a
//     fix is a reviewed change, not a silent one;
//   - truncate must not add an ellipsis when the string already fits;
//   - padRight must count VISIBLE characters, not bytes: an ANSI-wrapped
//     value pads to its visible width or columns shift;
//   - tableRow joins with two spaces and pads every column.

import { beforeEach, describe, expect, it } from "bun:test";
import { colorDnsStatus, colorStatus, formatDate, padRight, tableRow, truncate } from "./format.js";

beforeEach(() => {
  process.env.NO_COLOR = "1";
});

describe("colorStatus", () => {
  it("maps every status to its color class, rendered plain under NO_COLOR", () => {
    expect(colorStatus("delivered")).toBe("delivered");
    expect(colorStatus("bounced")).toBe("bounced");
    expect(colorStatus("complained")).toBe("complained");
    expect(colorStatus("failed")).toBe("failed");
    expect(colorStatus("sent")).toBe("sent");
    expect(colorStatus("pending")).toBe("pending");
  });

  it("falls back to gray for unknown statuses — never throws, never renders codes", () => {
    expect(colorStatus("weird")).toBe("weird");
    expect(colorStatus("")).toBe("");
  });
});

describe("colorDnsStatus", () => {
  it("prefixes the status glyphs for the known states", () => {
    expect(colorDnsStatus("verified")).toBe("✓ verified");
    expect(colorDnsStatus("pending")).toBe("○ pending");
    expect(colorDnsStatus("failed")).toBe("✗ failed");
  });

  it("renders unknown states plain", () => {
    expect(colorDnsStatus("not_set")).toBe("not_set");
  });
});

describe("truncate", () => {
  it("returns the string unchanged when it fits", () => {
    expect(truncate("abc", 3)).toBe("abc");
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("", 3)).toBe("");
  });

  it("replaces the trailing character with the ellipsis when it does not fit", () => {
    expect(truncate("abcd", 3)).toBe("ab…");
    expect(truncate("abcd", 2)).toBe("a…");
    expect(truncate("abcd", 1)).toBe("…");
  });

  it("pins the len=0 quirk — a negative slice bound wraps and returns longer", () => {
    // slice(0, -1) drops the last char, then the ellipsis is appended.
    expect(truncate("abcd", 0)).toBe("abc…");
  });
});

describe("formatDate", () => {
  it("renders an ISO instant as a compact local-ish label", () => {
    const out = formatDate("2026-08-19T12:34:56.000Z");
    // en-US month/day plus 12-hour clock; assert the pieces rather than the
    // exact zone-dependent hour.
    expect(out).toMatch(/^Aug 19, /);
    expect(out).toMatch(/\d{1,2}:\d{2} (AM|PM)$/);
  });
});

describe("padRight", () => {
  it("pads plain strings to the requested visible width", () => {
    expect(padRight("ab", 4)).toBe("ab  ");
    expect(padRight("abcd", 4)).toBe("abcd");
  });

  it("never pads shorter than the visible width", () => {
    expect(padRight("abcdef", 4)).toBe("abcdef");
  });

  it("counts ANSI escape codes as invisible — visible text is what aligns", () => {
    const wrapped = "[32mred[0m"; // visible length 3
    const padded = padRight(wrapped, 6);
    expect(padded).toBe(wrapped + "   ");
    expect(padded.length).toBe(wrapped.length + 3);
  });
});

describe("tableRow", () => {
  it("joins columns with two spaces after padding each", () => {
    // "a" padded to 2, then two separators, then "b" padded to 2.
    expect(tableRow(["a", 2], ["b", 2])).toBe("a   b ");
    expect(tableRow(["abcdef", 3], ["x", 4])).toBe("abcdef  x   ");
  });
});
