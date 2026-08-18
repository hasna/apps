import { describe, expect, it } from "bun:test";
import { parseListQuery } from "../src/server/list-query.js";

describe("parseListQuery", () => {
  it("returns bounded defaults without inventing filters", () => {
    expect(parseListQuery({})).toEqual({ limit: 100, offset: 0, filters: {} });
  });

  it.each([
    ["0", 1],
    ["-20", 1],
    ["1", 1],
    ["25", 25],
    ["1001", 1000],
  ])("clamps limit %s to %d", (raw, expected) => {
    expect(parseListQuery({ limit: raw }).limit).toBe(expected);
  });

  it("falls back for malformed numeric values", () => {
    expect(parseListQuery({ limit: "not-a-number", offset: "not-a-number" })).toEqual({
      limit: 100,
      offset: 0,
      filters: {},
    });
  });

  it("accepts zero offset and refuses negative offset", () => {
    expect(parseListQuery({ offset: "0" }).offset).toBe(0);
    expect(parseListQuery({ offset: "42" }).offset).toBe(42);
    expect(parseListQuery({ offset: "-1" }).offset).toBe(0);
  });

  it("removes pagination keys while preserving supported filter values", () => {
    expect(
      parseListQuery({
        limit: "10",
        offset: "20",
        entity_type: "invoice",
        status: "",
        omitted: undefined,
      }),
    ).toEqual({
      limit: 10,
      offset: 20,
      filters: { entity_type: "invoice", status: "" },
    });
  });

  it("returns a new filter object for every parse", () => {
    const first = parseListQuery({ status: "open" });
    const second = parseListQuery({ status: "open" });

    expect(first.filters).not.toBe(second.filters);
    first.filters.status = "closed";
    expect(second.filters.status).toBe("open");
  });
});
