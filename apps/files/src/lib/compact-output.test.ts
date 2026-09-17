import { describe, expect, test } from "bun:test";
import type { FileWithTags, SearchResult } from "../types/index.js";
import {
  FILE_COMPACT_FIELDS,
  SEARCH_COMPACT_FIELDS,
  buildFilePage,
  parseFileFields,
} from "./compact-output.js";

function file(index: number): FileWithTags {
  return {
    id: `f_${index}`,
    source_id: "src_1",
    machine_id: "m_1",
    path: `/very/long/folder/${index}/contract-final-${index}.pdf`,
    name: `contract-final-${index}.pdf`,
    original_name: `Contract final ${index}.pdf`,
    canonical_name: `contract-final-${index}.pdf`,
    ext: ".pdf",
    size: 10_000 + index,
    mime: "application/pdf",
    description: "x".repeat(1_000),
    hash: "a".repeat(64),
    status: "active",
    indexed_at: "2026-09-17T00:00:00.000Z",
    modified_at: "2026-09-16T00:00:00.000Z",
    created_at: "2026-09-15T00:00:00.000Z",
    tags: ["legal", "review"],
  };
}

describe("compact file output", () => {
  test("uses bounded compact defaults and a truthful continuation receipt", () => {
    const page = buildFilePage(Array.from({ length: 21 }, (_, i) => file(i)), {
      limit: 20,
      offset: 40,
      detail: "compact",
      fields: FILE_COMPACT_FIELDS,
    });

    expect(page.items).toHaveLength(20);
    expect(page._meta).toEqual({
      count: 20,
      limit: 20,
      offset: 40,
      next_offset: 60,
      has_more: true,
      end_reached: false,
      complete: false,
      all: false,
      detail: "compact",
      fields: [...FILE_COMPACT_FIELDS],
    });
    expect(page.items[0]).toEqual({
      id: "f_0",
      name: "contract-final-0.pdf",
      path: "/very/long/folder/0/contract-final-0.pdf",
      ext: ".pdf",
      size: 10_000,
      mime: "application/pdf",
      status: "active",
      source_id: "src_1",
    });
    expect(JSON.stringify(page).length).toBeLessThan(JSON.stringify(page.items.map((_, i) => file(i))).length / 3);
  });

  test("search defaults retain ranking evidence without full descriptions", () => {
    const result: SearchResult = {
      ...file(1),
      rank: 0.92,
      search_match_sources: ["content"],
      search_document_kinds: ["extracted_text"],
      search_document_count: 2,
    };
    const page = buildFilePage([result], {
      limit: 20,
      offset: 0,
      detail: "compact",
      fields: SEARCH_COMPACT_FIELDS,
    });
    expect(page.items[0]).toMatchObject({
      id: "f_1",
      rank: 0.92,
      search_match_sources: ["content"],
      search_document_kinds: ["extracted_text"],
      search_document_count: 2,
    });
    expect(page.items[0]).not.toHaveProperty("description");
  });

  test("field selection validates names and always retains the immutable id", () => {
    expect(parseFileFields("name,size", "list")).toEqual(["id", "name", "size"]);
    expect(() => parseFileFields("name,secret", "list")).toThrow(/Unknown list file field.*secret/);
    const longId = file(1);
    longId.id = `f_${"x".repeat(600)}`;
    const page = buildFilePage([longId], {
      limit: 1,
      offset: 0,
      detail: "compact",
      fields: ["id"],
    });
    expect((page.items[0] as { id: string }).id).toBe(longId.id);
    expect(page._meta.truncated_fields).toBeUndefined();
  });

  test("rejects search-only fields on lists and full detail combined with fields", async () => {
    expect(() => parseFileFields("rank", "list")).toThrow(/Unknown list file field/);
    const { validateFileProjection } = await import("./compact-output.js");
    expect(() => validateFileProjection("full", ["name"], "list")).toThrow(/cannot be combined/);
  });

  test("bounds retained strings and serialized bytes honestly", () => {
    const long = file(1);
    long.path = `/${"folder/".repeat(400)}`;
    const page = buildFilePage(Array.from({ length: 20 }, () => long), {
      limit: 20,
      offset: 0,
      detail: "compact",
      fields: FILE_COMPACT_FIELDS,
      maxBytes: 4_096,
    });
    expect(page._meta.byte_length).toBe(Buffer.byteLength(JSON.stringify(page)));
    expect(page._meta.byte_length).toBeLessThanOrEqual(4_096);
    expect(page._meta.byte_limited).toBe(true);
    expect(page._meta.has_more).toBe(true);
    expect(page._meta.next_offset).toBe(page.items.length);
    expect(page._meta.truncated_fields).toContain("path");
  });

  test("truncates compact strings on Unicode code-point boundaries", () => {
    const unicode = file(1);
    unicode.name = "😀".repeat(300);
    const page = buildFilePage([unicode], {
      limit: 1,
      offset: 0,
      detail: "compact",
      fields: ["id", "name"],
      maxBytes: 4096,
    });
    expect((page.items[0] as { name: string }).name).toBe(`${"😀".repeat(255)}…`);
    expect(page._meta.truncated_fields).toEqual(["name"]);
  });

  test("probes separately at the hosted 500-row boundary", async () => {
    const { fetchFilePageRows } = await import("./compact-output.js");
    const calls: Array<[number, number]> = [];
    const rows = await fetchFilePageRows(async (limit, offset) => {
      calls.push([limit, offset]);
      return Array.from({ length: limit }, (_, index) => offset + index);
    }, 500, 0);
    expect(rows).toHaveLength(501);
    expect(calls).toEqual([[500, 0], [1, 500]]);
  });

  test("an empty 500-row boundary probe proves completion", async () => {
    const { fetchFilePageRows } = await import("./compact-output.js");
    const calls: Array<[number, number]> = [];
    const rows = await fetchFilePageRows(async (limit, offset) => {
      calls.push([limit, offset]);
      if (offset === 500) return [];
      return Array.from({ length: limit }, (_, index) => file(index));
    }, 500, 0);
    const page = buildFilePage(rows, { limit: 500, offset: 0, detail: "compact" });
    expect(page._meta).toMatchObject({ count: 500, has_more: false, next_offset: null, end_reached: true, complete: true });
    expect(calls).toEqual([[500, 0], [1, 500]]);
  });

  test("tail completion is distinct from whole-query completeness", () => {
    const page = buildFilePage([file(20)], { limit: 20, offset: 20, detail: "compact" });
    expect(page._meta).toMatchObject({
      count: 1,
      has_more: false,
      end_reached: true,
      complete: false,
      all: false,
    });
  });

  test("exhaustive reads are bounded and prove whole-query completeness", async () => {
    const { fetchAllFileRows } = await import("./compact-output.js");
    const source = Array.from({ length: 1_001 }, (_, index) => file(index));
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllFileRows(async (limit, offset) => {
      calls.push([limit, offset]);
      return source.slice(offset, offset + limit);
    }, 1_500);
    const page = buildFilePage(rows, {
      limit: 1_500,
      offset: 0,
      detail: "compact",
      maxBytes: 1024 * 1024,
      all: true,
    });
    expect(rows).toHaveLength(1_001);
    expect(calls).toEqual([[500, 0], [500, 500], [500, 1_000]]);
    expect(page._meta).toMatchObject({
      count: 1_001,
      limit: 1_500,
      offset: 0,
      has_more: false,
      end_reached: true,
      complete: true,
      all: true,
    });

    await expect(fetchAllFileRows(async (limit, offset) => source.slice(offset, offset + limit), 1_000))
      .rejects.toThrow(/hard safety limit of 1000 rows/);
  });

  test("explicit full detail returns the full bounded page", () => {
    const rows = [file(1), file(2)];
    const page = buildFilePage(rows, { limit: 2, offset: 0, detail: "full" });
    expect(page.items).toEqual(rows);
    expect(page._meta).toMatchObject({ count: 2, has_more: false, complete: true, detail: "full" });
  });
});
