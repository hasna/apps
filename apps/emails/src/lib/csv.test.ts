// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// parseCsv is the importer used to bulk-create addresses/aliases from a
// pasted CSV block. It is deliberately naive — split on newlines, then
// commas, trim everything — with no quote handling. That naivety is the
// contract callers depend on for paste-style input, and the tests below pin
// BOTH directions of it:
//   - ragged rows must not throw: a short row yields "" for the missing
//     columns and a long row silently drops the extras, because a bulk
//     import that dies on the first ragged row would never import anything;
//   - quoted commas are NOT interpreted (documented limitation) — a row
//     `"a,b"` becomes one column containing `"a` and one containing `b"`,
//     and the test below locks that behavior in so a future quote-aware
//     rewrite is a deliberate, reviewed change rather than a silent one.
// A weak test would only cover the well-formed two-row case, which is
// exactly the case that cannot fail.

import { describe, expect, it } from "bun:test";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("returns [] for empty or header-only content", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   ")).toEqual([]);
    expect(parseCsv("h1,h2")).toEqual([]);
    expect(parseCsv("h1,h2\n")).toEqual([]);
  });

  it("parses a well-formed two-row document", () => {
    expect(parseCsv("name,email\nada,ada@example.com\nbob,bob@example.com")).toEqual([
      { name: "ada", email: "ada@example.com" },
      { name: "bob", email: "bob@example.com" },
    ]);
  });

  it("trims headers and values", () => {
    expect(parseCsv(" name , email \n ada , ada@example.com ")).toEqual([
      { name: "ada", email: "ada@example.com" },
    ]);
  });

  it("fills missing trailing values with empty strings — ragged rows never throw", () => {
    expect(parseCsv("h1,h2\nv1")).toEqual([{ h1: "v1", h2: "" }]);
    expect(parseCsv("h1,h2\n")).toEqual([]);
  });

  it("drops extra values beyond the header width", () => {
    expect(parseCsv("h1\nv1,v2,v3")).toEqual([{ h1: "v1" }]);
  });

  it("handles empty interior values", () => {
    expect(parseCsv("h1,h2\n,only-second")).toEqual([{ h1: "", h2: "only-second" }]);
  });

  it("does not interpret quoted commas — documented limitation, pinned", () => {
    // The naive split treats the quote as an ordinary character. Pinning this
    // is deliberate: silent behavior change here would corrupt imported rows.
    expect(parseCsv('h1\n"a,b"')).toEqual([{ h1: '"a' }]);
  });

  it("trims away surrounding whitespace but not interior spaces", () => {
    expect(parseCsv("h1\n  hello world  ")).toEqual([{ h1: "hello world" }]);
  });
});
