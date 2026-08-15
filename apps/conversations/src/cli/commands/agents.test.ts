import { describe, expect, test } from "bun:test";
import { buildWhoamiPayload } from "./agents.js";
import { isSelfRename } from "../../lib/identity.js";

describe("isSelfRename", () => {
  test("true when renaming the locally persisted identity", () => {
    expect(isSelfRename("augustus", "augustus")).toBe(true);
  });

  test("normalizes case and surrounding whitespace like the store does", () => {
    expect(isSelfRename("  Augustus  ", "augustus")).toBe(true);
  });

  test("false when renaming some other agent", () => {
    expect(isSelfRename("nova-owl", "augustus")).toBe(false);
  });
});

describe("buildWhoamiPayload", () => {
  test("returns offline payload when presence is missing", () => {
    const payload = buildWhoamiPayload("rock-eagle", "env", null, 1_000_000);
    expect(payload).toEqual({
      agent: "rock-eagle",
      source: "env",
      online: false,
      last_seen_at: null,
      last_seen_ago_seconds: null,
    });
  });

  test("computes last_seen_ago_seconds for online presence", () => {
    const payload = buildWhoamiPayload(
      "rock-eagle",
      "auto",
      { online: true, last_seen_at: "1970-01-01T00:15:00.000" },
      1_000_000,
    );

    expect(payload.online).toBe(true);
    expect(payload.last_seen_at).toBe("1970-01-01T00:15:00.000");
    expect(payload.last_seen_ago_seconds).toBe(100);
  });
});
