import { describe, expect, test } from "bun:test";
import {
  OutputContractError,
  createPageEnvelope,
  fitPageToByteBudget,
  isOutputContractError,
  measureJson,
  measureJsonLines,
  projectRecord,
  projectRecords,
  serializeJson,
  serializeJsonLine,
  serializeJsonLines,
  serializePageJsonLines,
  utf8ByteLength,
  validatePageEnvelope,
} from "../src/output";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof OutputContractError ? error.code : undefined;
  }
  return undefined;
}

describe("output projection", () => {
  test("emits required fields first, selected fields in order, and preserves null", () => {
    const source = { description: undefined, status: "active", id: "p1", name: "One", nullable: null };
    const projected = projectRecord(source, ["name", "nullable", "description"], { requiredFields: ["id", "status"] });
    expect(Object.keys(projected)).toEqual(["id", "status", "name", "nullable"]);
    expect(projected).toEqual({ id: "p1", status: "active", name: "One", nullable: null });
    expect(source).toEqual({ description: undefined, status: "active", id: "p1", name: "One", nullable: null });
  });

  test("deduplicates fields and can explicitly omit unknown optional fields", () => {
    expect(projectRecord({ id: "1", name: "n" }, ["name", "name", "missing"], { unknownFields: "omit" })).toEqual({ name: "n" });
    expect(projectRecords([{ id: "1" }, { id: "2" }], [], { requiredFields: ["id"] })).toEqual([{ id: "1" }, { id: "2" }]);
  });

  test("refuses missing required, missing selected, unsafe, accessor, and exotic records", () => {
    expect(codeOf(() => projectRecord({}, [], { requiredFields: ["id"] }))).toBe("OUTPUT_REQUIRED_FIELD_MISSING");
    expect(codeOf(() => projectRecord({}, ["id"]))).toBe("OUTPUT_UNKNOWN_FIELD");
    expect(codeOf(() => projectRecord({ id: "1" }, ["__proto__"]))).toBe("OUTPUT_INVALID_FIELD");
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => "secret" });
    expect(codeOf(() => projectRecord(accessor, ["value"]))).toBe("OUTPUT_ACCESSOR_PROPERTY");
    expect(codeOf(() => projectRecord(new Date(), []))).toBe("OUTPUT_INVALID_RECORD");
    expect(codeOf(() => projectRecord({ id: "1" }, ["id"], { unknownFields: "bad" as "error" }))).toBe("OUTPUT_INVALID_FIELD");
    let reads = 0;
    const records: unknown[] = [];
    Object.defineProperty(records, 0, { enumerable: true, get: () => { reads += 1; return { id: "1" }; } });
    records.length = 1;
    expect(codeOf(() => projectRecords(records, ["id"]))).toBe("OUTPUT_ACCESSOR_PROPERTY");
    const fields: string[] = [];
    Object.defineProperty(fields, 0, { enumerable: true, get: () => { reads += 1; return "id"; } });
    fields.length = 1;
    expect(codeOf(() => projectRecord({ id: "1" }, fields))).toBe("OUTPUT_ACCESSOR_PROPERTY");
    expect(reads).toBe(0);
  });
});

describe("truthful page envelopes", () => {
  test("derives count and preserves explicit terminal-page versus population completeness", () => {
    const terminalPage = createPageEnvelope({
      items: [{ id: 3 }],
      limit: 2,
      cursor: 2,
      nextCursor: null,
      hasMore: false,
      complete: false,
      total: 3,
      detail: "compact",
      fields: ["id", "id"],
      sort: { field: "id", direction: "asc" },
    });
    expect(terminalPage._meta).toMatchObject({
      contract_version: 1,
      count: 1,
      total: 3,
      has_more: false,
      complete: false,
      truncated: false,
      fields: ["id"],
    });
    expect(Object.isFrozen(terminalPage)).toBe(true);
    expect(Object.isFrozen(terminalPage.items)).toBe(true);
    expect(Object.isFrozen(terminalPage._meta)).toBe(true);
    expect(Object.isFrozen(terminalPage._meta.fields)).toBe(true);
    expect(Object.isFrozen(terminalPage._meta.sort)).toBe(true);
  });

  test("accepts a proven complete population", () => {
    expect(createPageEnvelope({ items: [1, 2], limit: 2, hasMore: false, complete: true, total: 2 })._meta.complete).toBe(true);
  });

  test("enforces numeric offset progress and known-total boundaries", () => {
    const valid = createPageEnvelope({
      items: [{ id: 11 }],
      limit: 1,
      cursor: 10,
      nextCursor: 11,
      hasMore: true,
      complete: false,
      total: 20,
    });
    expect(valid._meta).toMatchObject({ cursor: 10, next_cursor: 11, cursor_semantics: "offset" });

    expect(codeOf(() => createPageEnvelope({
      items: [{ id: 11 }], limit: 1, cursor: 10, nextCursor: 5, hasMore: true, complete: false, total: 20,
    }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({
      items: [{ id: 11 }], limit: 1, cursor: 10, nextCursor: 12, hasMore: true, complete: false, total: 20,
    }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({
      items: [{ id: 1 }], limit: 1, cursor: 0, nextCursor: null, hasMore: false, complete: false, total: 2,
    }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({
      items: [{ id: 2 }], limit: 1, cursor: 1, nextCursor: 2, hasMore: true, complete: false, total: 2,
    }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({
      items: [{ id: 2 }], limit: 1, cursor: 1, nextCursor: null, hasMore: false, complete: true,
    }))).toBe("OUTPUT_INVALID_PAGE");

    const terminal = createPageEnvelope({
      items: [{ id: 2 }], limit: 1, cursor: 1, nextCursor: null, hasMore: false, complete: false, total: 2,
    });
    expect(terminal._meta).toMatchObject({ cursor: 1, has_more: false, complete: false, total: 2 });
    const wholeQuery = createPageEnvelope({
      items: [{ id: 2 }],
      limit: 1,
      cursor: 1,
      cursorSemantics: "whole-query",
      nextCursor: null,
      hasMore: false,
      complete: true,
      total: 1,
    });
    expect(wholeQuery._meta).toMatchObject({ complete: true, cursor: 1, cursor_semantics: "whole-query" });
    expect(codeOf(() => createPageEnvelope({
      items: [{ id: 1 }],
      limit: 1,
      cursor: 99,
      cursorSemantics: "whole-query",
      nextCursor: null,
      hasMore: false,
      complete: false,
      total: 2,
    }))).toBe("OUTPUT_INVALID_PAGE");
    const truncatedWholeQuery = createPageEnvelope({
      items: [{ id: 1 }],
      limit: 1,
      cursor: 99,
      cursorSemantics: "whole-query",
      nextCursor: null,
      hasMore: false,
      complete: false,
      total: 2,
      truncated: true,
      truncationReasons: ["byte_budget"],
    });
    expect(truncatedWholeQuery._meta).toMatchObject({ truncated: true, cursor_semantics: "whole-query" });
  });

  test("refuses contradictory pagination and completeness claims", () => {
    expect(codeOf(() => createPageEnvelope({ items: [1, 2], limit: 1, hasMore: false, complete: false }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, hasMore: true, complete: false }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, nextCursor: 1, hasMore: false, complete: false }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, nextCursor: 1, hasMore: true, complete: true }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, hasMore: false, complete: false, truncated: true }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [1], limit: 1, hasMore: false, complete: true, total: 2 }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, hasMore: false, complete: false, sort: { field: "id", direction: "sideways" as "asc" } }))).toBe("OUTPUT_INVALID_PAGE");
    let sortReads = 0;
    const sort = Object.defineProperty({ field: "id" }, "direction", { enumerable: true, get: () => { sortReads += 1; return "asc"; } });
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, hasMore: false, complete: false, sort: sort as { field: string; direction: "asc" } }))).toBe("OUTPUT_ACCESSOR_PROPERTY");
    expect(sortReads).toBe(0);
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, hasMore: false, complete: false, detail: null as unknown as string }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, hasMore: false, complete: false, byteLength: 2, maxBytes: 1 }))).toBe("OUTPUT_INVALID_PAGE");
    expect(codeOf(() => createPageEnvelope({ items: [], limit: 1, cursor: 1, nextCursor: 1, hasMore: true, complete: false }))).toBe("OUTPUT_INVALID_PAGE");
  });
});

describe("strict deterministic serialization", () => {
  test("sorts object keys recursively and preserves array order", () => {
    const left = { z: 1, a: { d: 4, b: 2 }, list: [{ y: 2, x: 1 }, 0] };
    const right = { list: [{ x: 1, y: 2 }, 0], a: { b: 2, d: 4 }, z: 1 };
    expect(serializeJson(left)).toBe('{"a":{"b":2,"d":4},"list":[{"x":1,"y":2},0],"z":1}');
    expect(serializeJson(right)).toBe(serializeJson(left));
    expect(serializeJson(left, { pretty: true, trailingNewline: true })).toEndWith("\n");
  });

  test("uses exact LF framing for JSON and JSONL", () => {
    expect(serializeJsonLine({ b: 2, a: 1 })).toBe('{"a":1,"b":2}\n');
    expect(serializeJsonLines([])).toBe("");
    expect(serializeJsonLines([{ b: 2, a: 1 }, null])).toBe('{"a":1,"b":2}\nnull\n');
    expect(serializeJsonLines([{ line: "a\r\nb" }])).not.toContain("\r\n}");
  });

  test("measures UTF-8 bytes, including JSON escaping and final newlines", () => {
    expect(utf8ByteLength("aé😀")).toBe(7);
    const measured = measureJson({ emoji: "😀" });
    expect(measured.bytes).toBe(utf8ByteLength(measured.text));
    const lines = measureJsonLines([{ emoji: "😀" }]);
    expect(lines.bytes).toBe(utf8ByteLength(lines.text));
    expect(lines.text.endsWith("\n")).toBe(true);
  });

  test("normalizes negative zero and rejects lossy or executable JSON shapes", () => {
    expect(serializeJson({ n: -0 })).toBe('{"n":0}');
    expect(codeOf(() => serializeJson({ n: Number.NaN }))).toBe("OUTPUT_NON_FINITE_NUMBER");
    expect(codeOf(() => serializeJson({}, { pretty: "yes" as unknown as boolean }))).toBe("OUTPUT_UNSUPPORTED_VALUE");
    expect(codeOf(() => serializeJson({ n: BigInt(1) }))).toBe("OUTPUT_UNSUPPORTED_VALUE");
    expect(codeOf(() => serializeJson({ n: undefined }))).toBe("OUTPUT_UNSUPPORTED_VALUE");
    expect(codeOf(() => serializeJson([, 1]))).toBe("OUTPUT_UNSUPPORTED_VALUE");
    expect(codeOf(() => serializeJson(new Date()))).toBe("OUTPUT_UNSUPPORTED_VALUE");
    expect(codeOf(() => serializeJson({ toJSON: () => "hidden" }))).toBe("OUTPUT_UNSUPPORTED_VALUE");
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => "hidden" });
    expect(codeOf(() => serializeJson(accessor))).toBe("OUTPUT_ACCESSOR_PROPERTY");
    let reads = 0;
    const array: unknown[] = [];
    Object.defineProperty(array, 0, { enumerable: true, get: () => { reads += 1; return "hidden"; } });
    array.length = 1;
    expect(codeOf(() => serializeJson(array))).toBe("OUTPUT_ACCESSOR_PROPERTY");
    expect(codeOf(() => serializeJsonLines(array))).toBe("OUTPUT_ACCESSOR_PROPERTY");
    expect(reads).toBe(0);
    const error = new OutputContractError("OUTPUT_INVALID_PAGE", "invalid");
    expect(isOutputContractError(error)).toBe(true);
    expect(isOutputContractError({ name: "OutputContractError", code: "OUTPUT_INVALID_PAGE", message: "invalid" })).toBe(true);
    expect(isOutputContractError({ name: "OutputContractError", code: "NOT_REAL", message: "invalid" })).toBe(false);
  });

  test("refuses cycles but permits shared acyclic records", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(codeOf(() => serializeJson(circular))).toBe("OUTPUT_CIRCULAR_REFERENCE");
    const shared = { value: 1 };
    expect(serializeJson({ a: shared, b: shared })).toBe('{"a":{"value":1},"b":{"value":1}}');
  });
});

describe("JSONL page receipts and byte budgets", () => {
  test("validates page structure and always emits the final receipt", () => {
    const page = createPageEnvelope({ items: [{ id: "a" }], limit: 1, hasMore: false, complete: true, total: 1 });
    const lines = serializePageJsonLines(page).trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ _type: "item", item: { id: "a" } });
    expect(lines[1]._type).toBe("page_receipt");
    expect(lines[1]._meta.complete).toBe(true);

    const unbranded = JSON.parse(serializeJson(page));
    const canonical = validatePageEnvelope(unbranded);
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(serializePageJsonLines(unbranded as typeof page).trimEnd().split("\n")).toHaveLength(2);

    const forged = {
      items: [{ id: "a" }, { id: "b" }],
      _meta: {
        contract_version: 1,
        count: 999,
        total: 1,
        limit: 1,
        cursor: null,
        next_cursor: null,
        cursor_semantics: "offset",
        has_more: false,
        complete: true,
        truncated: false,
      },
    };
    expect(codeOf(() => serializePageJsonLines(forged as unknown as typeof page))).toBe("OUTPUT_INVALID_PAGE");

    const calledWithRemovedOption = serializePageJsonLines as unknown as (value: typeof page, options: unknown) => string;
    expect(calledWithRemovedOption(page, { includeReceipt: false }).trimEnd().split("\n")).toHaveLength(2);
  });

  test("fits the largest ordered prefix and embeds exact byte metrics", () => {
    const page = createPageEnvelope({
      items: [{ id: 1, text: "a".repeat(80) }, { id: 2, text: "b".repeat(80) }, { id: 3, text: "c".repeat(80) }],
      limit: 3,
      cursor: 0,
      nextCursor: null,
      hasMore: false,
      complete: true,
      total: 3,
      detail: "compact",
    });
    const twoItemSize = measureJson(createPageEnvelope({
      items: page.items.slice(0, 2),
      limit: 3,
      cursor: 0,
      nextCursor: 2,
      hasMore: true,
      complete: false,
      total: 3,
      truncated: true,
      truncationReasons: ["byte_budget"],
      detail: "compact",
      byteLength: 999,
      maxBytes: 9999,
    })).bytes;
    const fitted = fitPageToByteBudget(page, { maxBytes: twoItemSize + 20, nextCursorForIndex: (index) => index });
    expect(fitted.envelope.items.map((item) => item.id)).toEqual([1, 2]);
    expect(fitted.omitted_items).toBe(1);
    expect(fitted.bytes).toBe(utf8ByteLength(fitted.text));
    expect(fitted.envelope._meta.byte_length).toBe(fitted.bytes);
    expect(fitted.envelope._meta.max_bytes).toBe(twoItemSize + 20);
    expect(fitted.envelope._meta).toMatchObject({ complete: false, truncated: true, has_more: true, next_cursor: 2 });
    expect(fitted.envelope._meta.truncation_reasons).toContain("byte_budget");
  });

  test("derives numeric continuation from the current offset when byte clipping", () => {
    const page = createPageEnvelope({
      items: [
        { id: 101, text: "a".repeat(80) },
        { id: 102, text: "b".repeat(80) },
        { id: 103, text: "c".repeat(80) },
      ],
      limit: 3,
      cursor: 100,
      nextCursor: null,
      hasMore: false,
      complete: false,
      total: 103,
      detail: "compact",
    });
    const twoItemCandidate = createPageEnvelope({
      items: page.items.slice(0, 2),
      limit: 3,
      cursor: 100,
      nextCursor: 102,
      hasMore: true,
      complete: false,
      total: 103,
      truncated: true,
      truncationReasons: ["byte_budget"],
      detail: "compact",
      byteLength: 999,
      maxBytes: 9999,
    });
    const budget = measureJson(twoItemCandidate).bytes + 20;
    const fitted = fitPageToByteBudget(page, {
      maxBytes: budget,
      nextCursorForIndex: (index) => index,
    });
    expect(fitted.envelope.items.map((item) => item.id)).toEqual([101, 102]);
    expect(fitted.envelope._meta).toMatchObject({
      cursor: 100,
      next_cursor: 102,
      cursor_semantics: "offset",
      has_more: true,
      total: 103,
    });
  });

  test("retains a complete page when it fits and refuses unsafe clipping", () => {
    const page = createPageEnvelope({ items: [{ id: 1 }], limit: 1, hasMore: false, complete: true, total: 1 });
    const fitted = fitPageToByteBudget(page, { maxBytes: 4096 });
    expect(fitted.omitted_items).toBe(0);
    expect(fitted.envelope._meta.complete).toBe(true);
    expect(codeOf(() => fitPageToByteBudget(page, { maxBytes: 1 }))).toBe("OUTPUT_ITEM_EXCEEDS_BUDGET");
    const oversized = createPageEnvelope({
      items: [{ id: 1, text: "x".repeat(2_000) }],
      limit: 1,
      hasMore: false,
      complete: true,
      total: 1,
    });
    expect(codeOf(() => fitPageToByteBudget(oversized, { maxBytes: 300, nextCursorForIndex: (index) => index }))).toBe("OUTPUT_ITEM_EXCEEDS_BUDGET");
  });
});
