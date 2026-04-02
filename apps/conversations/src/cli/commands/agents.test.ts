import { describe, expect, test } from "bun:test";
import { buildWhoamiPayload } from "./agents.js";

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
