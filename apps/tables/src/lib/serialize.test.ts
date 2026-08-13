import { describe, expect, test } from "bun:test";
import { createBase, TablesBase } from "./base.js";
import { deserializeBase, loadBase, serializeBase } from "./serialize.js";

function sample(): TablesBase {
  const base = createBase("Inventory");
  base.createTable({
    name: "Items",
    fields: [
      { name: "Name", type: "text" },
      { name: "Qty", type: "number" },
    ],
  });
  base.createRecord("Items", { Name: "Bolt", Qty: 100 });
  return base;
}

describe("serialize / deserialize", () => {
  test("round-trips a base through JSON", () => {
    const base = sample();
    const json = serializeBase(base);
    const restored = loadBase(json);
    expect(restored.name).toBe("Inventory");
    expect(restored.listRecords("Items")).toHaveLength(1);
    const qty = restored.getTable("Items").fields[1]!.id;
    expect(restored.listRecords("Items")[0]!.fields[qty]).toBe(100);
  });

  test("pretty output is valid JSON", () => {
    const json = serializeBase(sample(), true);
    expect(json).toContain("\n");
    expect(() => deserializeBase(json)).not.toThrow();
  });

  test("rejects malformed base", () => {
    expect(() => deserializeBase('{"nope": true}')).toThrow();
  });
});
