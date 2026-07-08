import { describe, expect, test } from "bun:test";
import { createBase } from "./base.js";
import { exportTableCsv, importTableCsv, parseCsv } from "./csv.js";

describe("parseCsv", () => {
  test("handles quotes, commas, and newlines", () => {
    const rows = parseCsv('a,b\n"hello, world","line1\nline2"\n1,2');
    expect(rows).toEqual([
      ["a", "b"],
      ["hello, world", "line1\nline2"],
      ["1", "2"],
    ]);
  });

  test("handles escaped double quotes", () => {
    const rows = parseCsv('name\n"He said ""hi"""');
    expect(rows[1]).toEqual(['He said "hi"']);
  });
});

describe("import", () => {
  test("infers column types and creates records", () => {
    const base = createBase("B");
    const table = importTableCsv(base, "Name,Score,Active\nAlice,10,true\nBob,20,false", {
      tableName: "People",
    });
    expect(table.name).toBe("People");
    const [name, score, active] = table.fields;
    expect(name!.type).toBe("text");
    expect(score!.type).toBe("number");
    expect(active!.type).toBe("checkbox");
    expect(base.listRecords("People")).toHaveLength(2);
    expect(base.listRecords("People")[0]!.fields[score!.id]).toBe(10);
    expect(base.listRecords("People")[0]!.fields[active!.id]).toBe(true);
  });
});

describe("export", () => {
  test("round-trips values and resolves formula fields", () => {
    const base = createBase("B");
    importTableCsv(base, "Name,Qty,Price\nWidget,3,4\nGadget,2,5", { tableName: "Items" });
    base.addField("Items", { name: "Total", type: "formula", options: { formula: "{Qty} * {Price}" } });
    const csv = exportTableCsv(base.data, base.getTable("Items"));
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["Name", "Qty", "Price", "Total"]);
    expect(rows[1]).toEqual(["Widget", "3", "4", "12"]);
    expect(rows[2]).toEqual(["Gadget", "2", "5", "10"]);
  });

  test("can exclude computed fields", () => {
    const base = createBase("B");
    importTableCsv(base, "Name\nA", { tableName: "T" });
    base.addField("T", { name: "F", type: "formula", options: { formula: "1 + 1" } });
    const csv = exportTableCsv(base.data, base.getTable("T"), { includeComputed: false });
    expect(parseCsv(csv)[0]).toEqual(["Name"]);
  });
});
