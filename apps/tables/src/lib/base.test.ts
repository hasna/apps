import { describe, expect, test } from "bun:test";
import { TablesBase, createBase } from "./base.js";

function seededBase(): TablesBase {
  const base = createBase("CRM");
  base.createTable({
    name: "Deals",
    fields: [
      { name: "Name", type: "text" },
      { name: "Amount", type: "number" },
      { name: "Won", type: "checkbox" },
      { name: "Stage", type: "singleSelect", options: { choices: [
        { id: "sel1", name: "Lead" },
        { id: "sel2", name: "Closed" },
      ] } },
    ],
  });
  return base;
}

describe("tables", () => {
  test("createTable auto-creates a default grid view and sets primary field", () => {
    const base = createBase("B");
    const table = base.createTable({ name: "T" });
    expect(table.fields).toHaveLength(1);
    expect(table.primaryFieldId).toBe(table.fields[0]!.id);
    expect(table.views).toHaveLength(1);
    expect(table.views[0]!.type).toBe("grid");
  });

  test("getTable resolves by id and name", () => {
    const base = seededBase();
    const byName = base.getTable("Deals");
    expect(base.getTable(byName.id).id).toBe(byName.id);
  });
});

describe("records", () => {
  test("create + coerce values by field name", () => {
    const base = seededBase();
    const rec = base.createRecord("Deals", { Name: "Acme", Amount: "5000", Won: "true" });
    expect(rec.fields[base.getTable("Deals").fields[1]!.id]).toBe(5000);
    const won = base.getTable("Deals").fields[2]!.id;
    expect(rec.fields[won]).toBe(true);
  });

  test("update merges fields and bumps updatedTime", async () => {
    const base = seededBase();
    const rec = base.createRecord("Deals", { Name: "Acme" });
    const before = rec.updatedTime;
    await Bun.sleep(2);
    const updated = base.updateRecord("Deals", rec.id, { Amount: 100 });
    expect(updated.updatedTime >= before).toBe(true);
    const amountId = base.getTable("Deals").fields[1]!.id;
    expect(updated.fields[amountId]).toBe(100);
  });

  test("delete removes the record", () => {
    const base = seededBase();
    const rec = base.createRecord("Deals", { Name: "X" });
    base.deleteRecord("Deals", rec.id);
    expect(base.listRecords("Deals")).toHaveLength(0);
  });

  test("unknown field throws", () => {
    const base = seededBase();
    expect(() => base.createRecord("Deals", { Nope: 1 })).toThrow();
  });
});

describe("fields", () => {
  test("cannot delete primary field", () => {
    const base = seededBase();
    const primary = base.getTable("Deals").primaryFieldId;
    expect(() => base.deleteField("Deals", primary)).toThrow();
  });

  test("delete field strips it from records", () => {
    const base = seededBase();
    const table = base.getTable("Deals");
    const amount = table.fields[1]!.id;
    const rec = base.createRecord("Deals", { Amount: 42 });
    base.deleteField("Deals", amount);
    expect(base.getRecord("Deals", rec.id).fields[amount]).toBeUndefined();
  });
});

describe("formula fields", () => {
  test("computed at read time", () => {
    const base = seededBase();
    base.addField("Deals", {
      name: "Doubled",
      type: "formula",
      options: { formula: "{Amount} * 2" },
    });
    const rec = base.createRecord("Deals", { Name: "A", Amount: 21 });
    const computed = base.computeRecord("Deals", rec.id);
    const doubledId = base.getTable("Deals").fields.find((f) => f.name === "Doubled")!.id;
    expect(computed.computed[doubledId]).toBe(42);
  });

  test("formula referencing another formula", () => {
    const base = seededBase();
    base.addField("Deals", { name: "Tax", type: "formula", options: { formula: "{Amount} * 0.1" } });
    base.addField("Deals", { name: "Total", type: "formula", options: { formula: "{Amount} + {Tax}" } });
    const rec = base.createRecord("Deals", { Amount: 100 });
    const computed = base.computeRecord("Deals", rec.id);
    const totalId = base.getTable("Deals").fields.find((f) => f.name === "Total")!.id;
    expect(computed.computed[totalId]).toBe(110);
  });

  test("computed fields are never stored", () => {
    const base = seededBase();
    const f = base.addField("Deals", { name: "Doubled", type: "formula", options: { formula: "{Amount}*2" } });
    const rec = base.createRecord("Deals", { Amount: 5, [f.id]: 999 });
    expect(rec.fields[f.id]).toBeUndefined();
  });
});
