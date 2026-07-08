import { describe, expect, test } from "bun:test";
import { TablesBase, createBase } from "./base.js";

function tasksBase(): TablesBase {
  const base = createBase("Work");
  base.createTable({
    name: "Tasks",
    fields: [
      { name: "Title", type: "text" },
      { name: "Priority", type: "number" },
      { name: "Done", type: "checkbox" },
      { name: "Owner", type: "singleSelect" },
    ],
  });
  base.createRecord("Tasks", { Title: "A", Priority: 3, Done: false, Owner: "alice" });
  base.createRecord("Tasks", { Title: "B", Priority: 1, Done: true, Owner: "bob" });
  base.createRecord("Tasks", { Title: "C", Priority: 2, Done: false, Owner: "alice" });
  return base;
}

describe("view filtering", () => {
  test("filters by checkbox eq", () => {
    const base = tasksBase();
    const table = base.getTable("Tasks");
    const done = table.fields[2]!.id;
    const view = base.createView("Tasks", { name: "Open", filters: [{ fieldId: done, operator: "eq", value: false }] });
    const result = base.queryView("Tasks", view.id);
    expect(result.records).toHaveLength(2);
  });

  test("numeric gt filter", () => {
    const base = tasksBase();
    const priority = base.getTable("Tasks").fields[1]!.id;
    const view = base.createView("Tasks", { name: "High", filters: [{ fieldId: priority, operator: "gte", value: 2 }] });
    expect(base.queryView("Tasks", view.id).records).toHaveLength(2);
  });

  test("or conjunction", () => {
    const base = tasksBase();
    const t = base.getTable("Tasks");
    const priority = t.fields[1]!.id;
    const view = base.createView("Tasks", {
      name: "Edge",
      filterConjunction: "or",
      filters: [
        { fieldId: priority, operator: "eq", value: 1 },
        { fieldId: priority, operator: "eq", value: 3 },
      ],
    });
    expect(base.queryView("Tasks", view.id).records).toHaveLength(2);
  });
});

describe("view sorting", () => {
  test("sort by priority asc", () => {
    const base = tasksBase();
    const t = base.getTable("Tasks");
    const priority = t.fields[1]!.id;
    const title = t.fields[0]!.id;
    const view = base.createView("Tasks", { name: "Sorted", sorts: [{ fieldId: priority, direction: "asc" }] });
    const titles = base.queryView("Tasks", view.id).records.map((r) => r.computed[title]);
    expect(titles).toEqual(["B", "C", "A"]);
  });

  test("sort desc", () => {
    const base = tasksBase();
    const t = base.getTable("Tasks");
    const priority = t.fields[1]!.id;
    const title = t.fields[0]!.id;
    const view = base.createView("Tasks", { name: "SortedDesc", sorts: [{ fieldId: priority, direction: "desc" }] });
    const titles = base.queryView("Tasks", view.id).records.map((r) => r.computed[title]);
    expect(titles).toEqual(["A", "C", "B"]);
  });

  test("sorts a decimal-valued formula field numerically, not as a string", () => {
    const base = createBase("Calc");
    base.createTable({
      name: "Rows",
      fields: [
        { name: "Name", type: "text" },
        { name: "Impact", type: "number" },
        { name: "Effort", type: "number" },
        { name: "Score", type: "formula", options: { formula: "ROUND({Impact} / {Effort}, 2)" } },
      ],
    });
    // scores: 2.5, 2.33, 1.33 — string collation would put 2.33 before 2.5.
    base.createRecord("Rows", { Name: "a", Impact: 5, Effort: 2 }); // 2.5
    base.createRecord("Rows", { Name: "b", Impact: 7, Effort: 3 }); // 2.33
    base.createRecord("Rows", { Name: "c", Impact: 4, Effort: 3 }); // 1.33
    const scoreId = base.getTable("Rows").fields.find((f) => f.name === "Score")!.id;
    const titleId = base.getTable("Rows").fields[0]!.id;
    const view = base.createView("Rows", { name: "byScore", sorts: [{ fieldId: scoreId, direction: "desc" }] });
    const order = base.queryView("Rows", view.id).records.map((r) => r.computed[titleId]);
    expect(order).toEqual(["a", "b", "c"]); // 2.5, 2.33, 1.33
  });
});

describe("view grouping", () => {
  test("groups by owner", () => {
    const base = tasksBase();
    const owner = base.getTable("Tasks").fields[3]!.id;
    const view = base.createView("Tasks", { name: "ByOwner", groupByFieldId: owner });
    const result = base.queryView("Tasks", view.id);
    expect(result.groups).toBeDefined();
    const groups = result.groups!;
    expect(groups).toHaveLength(2);
    const alice = groups.find((g) => g.key === "alice");
    expect(alice?.records).toHaveLength(2);
  });
});
