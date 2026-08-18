import { describe, expect, it } from "bun:test";
import {
  InvalidListQueryError,
  listQueryResponse,
} from "../src/server/list-query.js";

const options = {
  default_sort: "name",
  allowed_sorts: ["name", "score", "active", "optional"],
  max_limit: 3,
};

describe("listQueryResponse", () => {
  it("preserves the original array when no supported list query is present", () => {
    const items = [{ name: "beta" }, { name: "alpha" }];

    expect(listQueryResponse(new URL("https://example.test/v1/items"), items, options)).toBe(items);
    expect(listQueryResponse(new URL("https://example.test/v1/items?filter=active"), items, options)).toBe(items);
  });

  it("sorts strings case-insensitively without mutating the input", () => {
    const items = [{ name: "Zulu" }, { name: "alpha" }, { name: "Bravo" }];

    const result = listQueryResponse(new URL("https://example.test/v1/items?sort=name"), items, options);

    expect(result).toEqual({
      data: [{ name: "alpha" }, { name: "Bravo" }, { name: "Zulu" }],
      pagination: {
        total: 3,
        returned: 3,
        limit: null,
        offset: 0,
        has_more: false,
        sort: "name",
        order: "asc",
      },
    });
    expect(items).toEqual([{ name: "Zulu" }, { name: "alpha" }, { name: "Bravo" }]);
  });

  it("supports descending shorthand and lets an explicit order override it", () => {
    const items = [{ name: "one", score: 1 }, { name: "three", score: 3 }, { name: "two", score: 2 }];

    expect(
      listQueryResponse(new URL("https://example.test/v1/items?sort=-score"), items, options),
    ).toMatchObject({ data: [{ score: 3 }, { score: 2 }, { score: 1 }], pagination: { order: "desc" } });
    expect(
      listQueryResponse(new URL("https://example.test/v1/items?sort=-score&order=asc"), items, options),
    ).toMatchObject({ data: [{ score: 1 }, { score: 2 }, { score: 3 }], pagination: { order: "asc" } });
  });

  it("paginates by page and page_size and reports the complete population", () => {
    const items = ["alpha", "bravo", "charlie", "delta", "echo"].map((name) => ({ name }));

    expect(
      listQueryResponse(new URL("https://example.test/v1/items?page=2&page_size=2"), items, options),
    ).toEqual({
      data: [{ name: "charlie" }, { name: "delta" }],
      pagination: {
        total: 5,
        returned: 2,
        limit: 2,
        offset: 2,
        has_more: true,
        sort: "name",
        order: "asc",
      },
    });
  });

  it("uses the bounded page default and clamps explicit limits", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ name }));

    expect(listQueryResponse(new URL("https://example.test/v1/items?page=2"), items, options)).toMatchObject({
      data: [{ name: "d" }, { name: "e" }, { name: "f" }],
      pagination: { limit: 3, offset: 3, has_more: true },
    });
    expect(listQueryResponse(new URL("https://example.test/v1/items?limit=999"), items, options)).toMatchObject({
      data: [{ name: "a" }, { name: "b" }, { name: "c" }],
      pagination: { limit: 3, offset: 0, has_more: true },
    });
  });

  it("supports an offset without forcing a limit", () => {
    const items = ["a", "b", "c"].map((name) => ({ name }));

    expect(listQueryResponse(new URL("https://example.test/v1/items?offset=1"), items, options)).toMatchObject({
      data: [{ name: "b" }, { name: "c" }],
      pagination: { limit: null, offset: 1, has_more: false },
    });
  });

  it("orders booleans and treats nullish values as empty strings", () => {
    const items = [
      { name: "true", active: true, optional: "z" },
      { name: "false", active: false, optional: undefined },
      { name: "null", active: false, optional: null },
    ];

    expect(listQueryResponse(new URL("https://example.test/v1/items?sort=active"), items, options)).toMatchObject({
      data: [{ name: "false" }, { name: "null" }, { name: "true" }],
    });
    expect(listQueryResponse(new URL("https://example.test/v1/items?sort=optional"), items, options)).toMatchObject({
      data: [{ name: "false" }, { name: "null" }, { name: "true" }],
    });
  });

  it.each([
    ["sort=missing", "Unsupported sort field: missing. Allowed fields: name, score, active, optional."],
    ["order=sideways", "order must be asc or desc."],
    ["limit=0", "limit/page_size must be a positive integer."],
    ["page_size=1.5", "limit/page_size must be a positive integer."],
    ["offset=-1", "offset must be a non-negative integer."],
    ["page=0", "page must be a positive integer."],
  ])("rejects invalid list query boundary %s", (query, message) => {
    expect(() => listQueryResponse(new URL(`https://example.test/v1/items?${query}`), [], options)).toThrow(message);
  });

  it("exposes a stable machine-readable error contract", () => {
    const error = new InvalidListQueryError("bad query");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InvalidListQueryError");
    expect(error.code).toBe("INVALID_LIST_QUERY");
    expect(InvalidListQueryError.code).toBe("INVALID_LIST_QUERY");
    expect(InvalidListQueryError.suggestion).toBe("Use a supported sort field and positive integer limit/offset.");
  });
});
