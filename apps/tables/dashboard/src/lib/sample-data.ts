import { TablesBase, createBase } from "@hasna/tables";

const STATUS_CHOICES = [
  { id: "st_backlog", name: "Backlog", color: "gray" },
  { id: "st_progress", name: "In Progress", color: "amber" },
  { id: "st_shipped", name: "Shipped", color: "green" },
];

const TEAM_CHOICES = [
  { id: "tm_platform", name: "Platform", color: "indigo" },
  { id: "tm_growth", name: "Growth", color: "teal" },
  { id: "tm_design", name: "Design", color: "pink" },
];

/** Build an Airtable-style demo base with typed fields, records, and views. */
export function buildSampleBase(): TablesBase {
  const base = createBase("Product Roadmap");

  base.createTable({
    name: "Features",
    fields: [
      { name: "Feature", type: "text" },
      { name: "Status", type: "singleSelect", options: { choices: STATUS_CHOICES } },
      { name: "Team", type: "singleSelect", options: { choices: TEAM_CHOICES } },
      { name: "Impact", type: "number" },
      { name: "Effort", type: "number" },
      {
        name: "Score",
        type: "formula",
        options: { formula: "ROUND({Impact} / {Effort}, 2)", resultType: "number" },
      },
      { name: "Shipped", type: "checkbox" },
    ],
  });

  const rows: Array<Record<string, unknown>> = [
    { Feature: "Realtime sync", Status: "In Progress", Team: "Platform", Impact: 9, Effort: 5, Shipped: false },
    { Feature: "CSV import", Status: "Shipped", Team: "Platform", Impact: 6, Effort: 2, Shipped: true },
    { Feature: "Dark mode", Status: "Backlog", Team: "Design", Impact: 4, Effort: 3, Shipped: false },
    { Feature: "Formula fields", Status: "Shipped", Team: "Platform", Impact: 8, Effort: 4, Shipped: true },
    { Feature: "Sharing links", Status: "In Progress", Team: "Growth", Impact: 7, Effort: 3, Shipped: false },
    { Feature: "Grid virtualization", Status: "Backlog", Team: "Platform", Impact: 8, Effort: 6, Shipped: false },
    { Feature: "Onboarding tour", Status: "Backlog", Team: "Growth", Impact: 5, Effort: 2, Shipped: false },
    { Feature: "Kanban view", Status: "In Progress", Team: "Design", Impact: 6, Effort: 5, Shipped: false },
  ];
  for (const row of rows) base.createRecord("Features", row);

  const table = base.getTable("Features");
  const statusId = table.fields.find((f) => f.name === "Status")!.id;
  const scoreId = table.fields.find((f) => f.name === "Score")!.id;
  const teamId = table.fields.find((f) => f.name === "Team")!.id;

  // View 2: active work, highest score first
  base.createView("Features", {
    name: "Active by score",
    filters: [{ fieldId: statusId, operator: "neq", value: "Shipped" }],
    sorts: [{ fieldId: scoreId, direction: "desc" }],
  });

  // View 3: grouped by team
  base.createView("Features", {
    name: "By team",
    groupByFieldId: teamId,
    sorts: [{ fieldId: scoreId, direction: "desc" }],
  });

  return base;
}
