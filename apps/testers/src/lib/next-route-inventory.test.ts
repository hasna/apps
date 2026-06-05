process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { listScenarios } from "../db/scenarios.js";
import { listTestingWorkflows } from "../db/workflows.js";
import { discoverNextRouteInventory, importNextRouteInventory } from "./next-route-inventory.js";

let tempDirs: string[] = [];

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "testers-next-routes-"));
  tempDirs.push(root);

  mkdirSync(join(root, "packages", "web", "app", "(public)", "(pages)", "pricing"), { recursive: true });
  writeFileSync(join(root, "packages", "web", "app", "(public)", "(pages)", "pricing", "page.tsx"), "export default function Page() { return null; }\n");

  mkdirSync(join(root, "packages", "web", "app", "(dashboard)", "[orgSlug]", "billing"), { recursive: true });
  writeFileSync(join(root, "packages", "web", "app", "(dashboard)", "[orgSlug]", "billing", "page.tsx"), "import { BillingActions } from './billing-actions';\nexport default function Page() { return <><a href=\"/[orgSlug]/billing/history\">History</a><BillingActions /></>; }\n");
  writeFileSync(join(root, "packages", "web", "app", "(dashboard)", "[orgSlug]", "billing", "billing-actions.tsx"), "export function BillingActions() { return <form aria-label=\"Top up credits\"><button aria-label=\"Add credits\">Add credits</button><input name=\"amount\" placeholder=\"Credit amount\" /></form>; }\n");

  mkdirSync(join(root, "packages", "web", "app", "api", "v1", "(commerce)", "billing", "top-ups"), { recursive: true });
  writeFileSync(join(root, "packages", "web", "app", "api", "v1", "(commerce)", "billing", "top-ups", "route.ts"), "export async function GET() {}\nexport async function POST() {}\n");

  mkdirSync(join(root, "packages", "web", "app", "api", "v1", "(admin)", "admin", "users", "[id]"), { recursive: true });
  writeFileSync(join(root, "packages", "web", "app", "api", "v1", "(admin)", "admin", "users", "[id]", "route.ts"), "export const DELETE = async () => new Response();\n");

  return root;
}

describe("next route inventory", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("discovers Next.js page and API routes with categories and methods", () => {
    const root = makeRepo();
    const inventory = discoverNextRouteInventory({ rootDir: root });

    expect(inventory.total).toBe(4);
    expect(inventory.pages).toBe(2);
    expect(inventory.apiRoutes).toBe(2);
    expect(inventory.dynamic).toBe(2);
    expect(inventory.categories).toMatchObject({ public: 1, commerce: 2, admin: 1 });

    const billingPage = inventory.items.find((item) => item.routePath === "/:orgSlug/billing")!;
    expect(billingPage.kind).toBe("page");
    expect(billingPage.requiresAuth).toBe(true);
    expect(billingPage.tags).toContain("area:commerce");
    expect(billingPage.tags).toContain("dynamic-route");
    expect(billingPage.fixtureParams).toEqual(["orgSlug"]);
    expect(billingPage.actions.map((action) => action.label)).toContain("Add credits");
    expect(billingPage.actions.map((action) => action.label)).toContain("Credit amount");

    const topUpsApi = inventory.items.find((item) => item.routePath === "/api/v1/billing/top-ups")!;
    expect(topUpsApi.kind).toBe("api");
    expect(topUpsApi.methods).toEqual(["GET", "POST"]);
    expect(topUpsApi.actions.map((action) => action.label)).toEqual(["GET", "POST"]);
    expect(topUpsApi.priority).toBe("critical");
  });

  test("upserts route scenarios and grouped sandbox workflows", () => {
    const root = makeRepo();
    const project = createProject({ name: "alumia", scenarioPrefix: "ALM" });

    const result = importNextRouteInventory({
      rootDir: root,
      projectId: project.id,
      createScenarios: true,
      createWorkflows: true,
      workflowTarget: "sandbox",
      workflowProvider: "e2b",
      workflowExecution: {
        target: "sandbox",
        provider: "e2b",
        env: { OPENAI_API_KEY: "$?OPENAI_API_KEY" },
      },
    });

    expect(result.created).toBe(4);
    expect(result.workflows.length).toBe(4);

    const scenarios = listScenarios({ projectId: project.id });
    expect(scenarios.map((scenario) => scenario.name)).toContain("Next page: /:orgSlug/billing");
    const apiScenario = scenarios.find((scenario) => scenario.name === "Next API route: /api/v1/admin/users/:id")!;
    expect(apiScenario.requiresAuth).toBe(true);
    expect(apiScenario.tags).toContain("route:api");
    expect(apiScenario.metadata?.methods).toEqual(["DELETE"]);
    expect(apiScenario.metadata?.fixtureParams).toEqual(["id"]);
    expect(apiScenario.metadata?.actionCount).toBe(1);

    const billingScenario = scenarios.find((scenario) => scenario.name === "Next page: /:orgSlug/billing")!;
    expect(billingScenario.steps.some((step) => step.includes("Add credits"))).toBe(true);
    expect(billingScenario.metadata?.actionCount).toBeGreaterThan(0);

    const workflows = listTestingWorkflows({ projectId: project.id });
    expect(workflows.some((workflow) => workflow.name === "Next route inventory commerce page")).toBe(true);
    expect(workflows.every((workflow) => workflow.execution.target === "sandbox")).toBe(true);
    expect(workflows.every((workflow) => workflow.execution.env?.OPENAI_API_KEY === "$?OPENAI_API_KEY")).toBe(true);

    const second = importNextRouteInventory({
      rootDir: root,
      projectId: project.id,
      createScenarios: true,
      createWorkflows: true,
      workflowTarget: "sandbox",
      workflowProvider: "e2b",
    });

    expect(second.deduped).toBe(4);
    expect(listTestingWorkflows({ projectId: project.id }).length).toBe(4);
  });
});
