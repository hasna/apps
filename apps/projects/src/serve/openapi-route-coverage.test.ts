/**
 * Route-to-spec coverage for projects-serve (fleet-alignment PORT-TO-API).
 *
 * `/v1/machines` has been dispatched by `route()` since the canonical-machine
 * registry landed, but it was missing from `src/serve/openapi.ts`, so every
 * generated client and every reader of the published spec believed the machine
 * registry had no hosted route. The gap was invisible because nothing asserted
 * that the dispatch table and the spec agree.
 *
 * This test reads the resource families `route()` actually dispatches out of
 * the source and requires each one to be documented, so the next family that
 * ships without a spec entry fails here instead of silently teaching clients
 * that a hosted route does not exist.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mintApiKey } from "@hasna/contracts/auth";
import { createFetchHandler } from "./app.js";
import type { ProjectsPgStore } from "./pg-store.js";
import { buildOpenApiSpec } from "./openapi.js";
import type { Machine } from "../types/workspace.js";

const SIGNING_SECRET = "test-signing-secret-projects-0000000000";

const MACHINES: Machine[] = [
  { slug: "station03", status: "active", role: "assignable" },
  { slug: "station01", status: "active", role: "mirror-hub" },
];

function machineStore(): ProjectsPgStore {
  return {
    async ping() {
      return true;
    },
    async listMachines() {
      return MACHINES;
    },
  } as unknown as ProjectsPgStore;
}

function handler(store: ProjectsPgStore = machineStore()) {
  return createFetchHandler({
    store,
    version: "9.9.9",
    app: "projects",
    signingSecret: SIGNING_SECRET,
    allowUnregisteredKeys: true,
  });
}

function readToken(): string {
  return mintApiKey({ app: "projects", scopes: ["projects:read"], signingSecret: SIGNING_SECRET }).token;
}

/** The `/v1/<resource>` families `route()` dispatches, read from the source. */
function dispatchedResourceFamilies(): string[] {
  const source = readFileSync(join(import.meta.dir, "app.ts"), "utf-8");
  return [...source.matchAll(/resource === "([a-z-]+)"/g)].map((match) => match[1]!);
}

describe("projects-serve openapi documents every dispatched /v1 family", () => {
  test("no dispatched resource family is missing from the spec", () => {
    const spec = buildOpenApiSpec("9.9.9") as { paths: Record<string, unknown> };
    const documented = new Set(
      Object.keys(spec.paths)
        .filter((path) => path.startsWith("/v1/"))
        .map((path) => path.split("/")[2]!),
    );
    const families = dispatchedResourceFamilies();

    expect(families.length).toBeGreaterThan(0);
    expect(families.filter((family) => !documented.has(family))).toEqual([]);
    // Explicit regression pin for the family that was missing.
    expect(families).toContain("machines");
    expect(documented.has("machines")).toBe(true);
  });

  test("/v1/machines is documented as a read-only listMachines route", () => {
    const spec = buildOpenApiSpec("9.9.9") as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: { schemas: Record<string, unknown> };
    };
    const entry = spec.paths["/v1/machines"]!;

    expect(Object.keys(entry)).toEqual(["get"]);
    expect(entry.get!.operationId).toBe("listMachines");
    expect(spec.components.schemas.MachineList).toEqual({
      type: "object",
      properties: {
        machines: { type: "array", items: { $ref: "#/components/schemas/Machine" } },
        count: { type: "integer" },
      },
      required: ["machines", "count"],
    });
  });

  test("GET /v1/machines returns the documented MachineList shape", async () => {
    const res = await handler()(
      new Request("http://x/v1/machines", { headers: { "x-api-key": readToken() } }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ machines: MACHINES, count: MACHINES.length });
  });

  test("POST /v1/machines is rejected — the registry is seeded by migrations, not the API", async () => {
    const writeToken = mintApiKey({
      app: "projects",
      scopes: ["projects:write"],
      signingSecret: SIGNING_SECRET,
    }).token;
    const res = await handler()(
      new Request("http://x/v1/machines", { method: "POST", headers: { "x-api-key": writeToken } }),
    );

    expect(res.status).toBe(405);
  });
});
