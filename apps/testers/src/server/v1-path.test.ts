import { describe, expect, test } from "bun:test";

import { parsePathSegments } from "./v1.js";

describe("parsePathSegments", () => {
  test("splits a plain resource/id path", () => {
    expect(parsePathSegments("/v1/scenarios/abc123")).toEqual(["scenarios", "abc123"]);
  });

  test("percent-decodes a colon-joined composite id (flow-dependencies)", () => {
    // The standard storage client encodeURIComponent()s the id, so the colon in
    // "scenarioId:dependsOn" arrives as %3A. It must decode back to a literal ":"
    // so the DELETE /v1/flow-dependencies/<id> route can split it.
    const seg = parsePathSegments("/v1/flow-dependencies/sc_from%3Asc_to");
    expect(seg).toEqual(["flow-dependencies", "sc_from:sc_to"]);
    const id = seg[1]!;
    const sepIndex = id.indexOf(":");
    expect(sepIndex).toBeGreaterThanOrEqual(0);
    expect(id.slice(0, sepIndex)).toBe("sc_from");
    expect(id.slice(sepIndex + 1)).toBe("sc_to");
  });

  test("still accepts an unencoded literal colon", () => {
    expect(parsePathSegments("/v1/flow-dependencies/a:b")).toEqual(["flow-dependencies", "a:b"]);
  });

  test("decodes spaces and slashes in ids", () => {
    expect(parsePathSegments("/v1/projects/my%20app")).toEqual(["projects", "my app"]);
    expect(parsePathSegments("/v1/scenarios/a%2Fb")).toEqual(["scenarios", "a/b"]);
  });

  test("falls back to the raw segment on a malformed escape", () => {
    // A stray "%" is not a valid escape; decodeURIComponent would throw. We must
    // not 500 — fall back to the raw segment instead.
    expect(parsePathSegments("/v1/scenarios/100%")).toEqual(["scenarios", "100%"]);
  });

  test("drops empty segments", () => {
    expect(parsePathSegments("/v1/scenarios/")).toEqual(["scenarios"]);
  });
});
