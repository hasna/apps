import { describe, expect, test } from "bun:test";
import {
  InvalidListQueryError,
  hasListQuery,
  listQueryResponse,
} from "../src/server/list-query.js";

interface Item {
  id: string;
  name: string;
  rank: number;
  active?: boolean;
}

const items: Item[] = [
  { id: "third", name: "Zulu", rank: 3, active: true },
  { id: "first", name: "alpha", rank: 1, active: false },
  { id: "second", name: "Bravo", rank: 2 },
];

const options = {
  default_sort: "rank",
  allowed_sorts: ["id", "name", "rank", "active"],
};

function url(query = ""): URL {
  return new URL(`https://example.test/v1/items${query}`);
}

describe("list query parsing", () => {
  test("returns the original array when no list-query key is present", () => {
    const input = url("?entity_id=entity-1");

    expect(hasListQuery(input)).toBe(false);
    expect(listQueryResponse(input, items, options)).toBe(items);
  });

  test("recognizes every supported list-query key", () => {
    for (const key of ["limit", "offset", "page", "page_size", "sort", "order"]) {
      expect(hasListQuery(url(`?${key}=1`))).toBe(true);
    }
  });

  test("sorts case-insensitive strings without mutating the input", () => {
    const originalIds = items.map((item) => item.id);
    const result = listQueryResponse(url("?sort=name"), items, options);

    expect(Array.isArray(result)).toBe(false);
    if (Array.isArray(result)) throw new Error("expected an envelope");
    expect(result.data.map((item) => item.id)).toEqual(["first", "second", "third"]);
    expect(items.map((item) => item.id)).toEqual(originalIds);
    expect(result.pagination.order).toBe("asc");
  });

  test("supports descending shorthand and an explicit order override", () => {
    const descending = listQueryResponse(url("?sort=-rank"), items, options);
    const overridden = listQueryResponse(url("?sort=-rank&order=asc"), items, options);

    if (Array.isArray(descending) || Array.isArray(overridden)) throw new Error("expected envelopes");
    expect(descending.data.map((item) => item.rank)).toEqual([3, 2, 1]);
    expect(descending.pagination.order).toBe("desc");
    expect(overridden.data.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(overridden.pagination.order).toBe("asc");
  });

  test("applies page_size and one-based page boundaries", () => {
    const result = listQueryResponse(url("?page=2&page_size=2"), items, options);

    if (Array.isArray(result)) throw new Error("expected an envelope");
    expect(result.data.map((item) => item.rank)).toEqual([3]);
    expect(result.pagination).toEqual({
      total: 3,
      returned: 1,
      limit: 2,
      offset: 2,
      has_more: false,
      sort: "rank",
      order: "asc",
    });
  });

  test("uses offset in preference to page and reports remaining rows", () => {
    const result = listQueryResponse(url("?limit=1&offset=1&page=99"), items, options);

    if (Array.isArray(result)) throw new Error("expected an envelope");
    expect(result.data.map((item) => item.rank)).toEqual([2]);
    expect(result.pagination.offset).toBe(1);
    expect(result.pagination.has_more).toBe(true);
  });

  test("caps an oversized limit at the configured maximum", () => {
    const result = listQueryResponse(url("?limit=999"), items, { ...options, max_limit: 2 });

    if (Array.isArray(result)) throw new Error("expected an envelope");
    expect(result.data).toHaveLength(2);
    expect(result.pagination.limit).toBe(2);
    expect(result.pagination.has_more).toBe(true);
  });

  test("uses the bounded default page size when page has no explicit limit", () => {
    const manyItems = Array.from({ length: 5 }, (_, rank) => ({
      id: String(rank),
      name: String(rank),
      rank,
    }));
    const result = listQueryResponse(url("?page=2"), manyItems, { ...options, max_limit: 2 });

    if (Array.isArray(result)) throw new Error("expected an envelope");
    expect(result.data.map((item) => item.rank)).toEqual([2, 3]);
    expect(result.pagination.limit).toBe(2);
    expect(result.pagination.offset).toBe(2);
    expect(result.pagination.has_more).toBe(true);
  });

  test.each([
    ["?limit=0", "limit/page_size must be a positive integer."],
    ["?limit=1.5", "limit/page_size must be a positive integer."],
    ["?page_size=wat", "limit/page_size must be a positive integer."],
    ["?offset=-1", "offset must be a non-negative integer."],
    ["?offset=1.2", "offset must be a non-negative integer."],
    ["?page=0", "page must be a positive integer."],
    ["?page=2.5", "page must be a positive integer."],
    ["?order=sideways", "order must be asc or desc."],
  ])("rejects invalid numeric/order boundary %s", (query, message) => {
    expect(() => listQueryResponse(url(query), items, options)).toThrow(message);
  });

  test("rejects unsupported sort fields with a stable error code", () => {
    try {
      listQueryResponse(url("?sort=missing"), items, options);
      throw new Error("expected list query parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidListQueryError);
      expect((error as InvalidListQueryError).name).toBe("InvalidListQueryError");
      expect((error as InvalidListQueryError).code).toBe("INVALID_LIST_QUERY");
      expect((error as Error).message).toContain("Allowed: id, name, rank, active");
    }
  });
});
