import { describe, expect, it } from "bun:test";
import { compactRecord, parseJsonObject } from "./util.js";

describe("utility helpers", () => {
  it("falls back to empty objects for invalid JSON", () => {
    expect(parseJsonObject("{bad")).toEqual({});
  });

  it("compacts records with optional titles and share URLs", () => {
    expect(compactRecord({
      id: "id",
      slug: "slug",
      kind: "text",
      title: "Title",
      shareUrl: "http://clip.test/s/slug",
      createdAt: "2026-07-05T00:00:00.000Z",
    })).toBe("id slug text Title http://clip.test/s/slug 2026-07-05T00:00:00.000Z");

    expect(compactRecord({
      id: "id",
      slug: "slug",
      kind: "text",
      title: null,
      createdAt: "2026-07-05T00:00:00.000Z",
    })).toBe("id slug text 2026-07-05T00:00:00.000Z");
  });
});
