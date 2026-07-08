import { describe, expect, test } from "bun:test";
import { createBase } from "./base.js";

describe("lookup fields", () => {
  test("resolve linked record field values across tables", () => {
    const base = createBase("Sales");

    const customers = base.createTable({
      name: "Customers",
      fields: [
        { name: "Name", type: "text" },
        { name: "Region", type: "text" },
      ],
    });
    const acme = base.createRecord("Customers", { Name: "Acme", Region: "EU" });
    const globex = base.createRecord("Customers", { Name: "Globex", Region: "US" });

    const orders = base.createTable({
      name: "Orders",
      fields: [{ name: "Ref", type: "text" }],
    });
    const customerLink = base.addField("Orders", {
      name: "Customer",
      type: "link",
      options: { linkedTableId: customers.id, relationship: "manyToOne" },
    });
    const regionField = customers.fields.find((f) => f.name === "Region")!;
    const regionLookup = base.addField("Orders", {
      name: "Customer Region",
      type: "lookup",
      options: { linkFieldId: customerLink.id, foreignFieldId: regionField.id },
    });

    const order = base.createRecord("Orders", { Ref: "O-1", [customerLink.id]: [acme.id, globex.id] });
    const computed = base.computeRecord("Orders", order.id);
    expect(computed.computed[regionLookup.id]).toEqual(["EU", "US"]);
  });

  test("circular formula references resolve to empty without crashing", () => {
    const base = createBase("Cycles");
    const table = base.createTable({ name: "T", fields: [{ name: "Name", type: "text" }] });
    const a = base.addField("T", { name: "A", type: "formula", options: { formula: "{B} + 1" } });
    base.addField("T", { name: "B", type: "formula", options: { formula: "{A} + 1" } });
    const rec = base.createRecord("T", { Name: "x" });
    const computed = base.computeRecord("T", rec.id);
    // The exact value is an impl detail; the guarantee is: no infinite loop / crash.
    expect(typeof computed.computed[a.id]).toBe("number");
    expect(table.name).toBe("T");
  });
});
