import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mintApiKey } from "@hasna/contracts/auth";
import { createFetchHandler } from "./app.js";
import { buildOpenApiSpec } from "./openapi.js";
import type { ProjectsPgStore } from "./pg-store.js";
import type { Machine } from "../types/workspace.js";

const SIGNING_SECRET = "test-signing-secret-projects-machines";
const MACHINES: Machine[] = [
  { slug: "station01", status: "active", role: "mirror-hub" },
  { slug: "station03", status: "active", role: "assignable" },
];

function handler() {
  const store = {
    ping: async () => true,
    listMachines: async () => MACHINES,
  } as unknown as ProjectsPgStore;
  return createFetchHandler({
    store,
    version: "9.9.9",
    app: "projects",
    signingSecret: SIGNING_SECRET,
    allowUnregisteredKeys: true,
  });
}

function token(scopes: string[]): string {
  return mintApiKey({ app: "projects", scopes, signingSecret: SIGNING_SECRET }).token;
}

describe("projects machines OpenAPI and route parity", () => {
  test("documents every top-level /v1 resource family dispatched by the server", () => {
    const source = readFileSync(join(import.meta.dir, "app.ts"), "utf-8");
    const dispatched = [...source.matchAll(/resource === "([a-z-]+)"/g)].map((match) => match[1]!);
    const spec = buildOpenApiSpec("9.9.9") as { paths: Record<string, unknown> };
    const documented = new Set(
      Object.keys(spec.paths)
        .filter((path) => path.startsWith("/v1/"))
        .map((path) => path.split("/")[2]!),
    );
    expect(dispatched.length).toBeGreaterThan(0);
    expect([...new Set(dispatched)].filter((resource) => !documented.has(resource))).toEqual([]);
  });

  test("documents the read-only MachineList contract", () => {
    const spec = buildOpenApiSpec("9.9.9") as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(spec.paths["/v1/machines"]!)).toEqual(["get"]);
    expect(spec.paths["/v1/machines"]!.get?.operationId).toBe("listMachines");
    expect(spec.components.schemas.Machine).toEqual({
      type: "object",
      properties: {
        slug: { type: "string" },
        status: { type: "string" },
        role: { type: "string", enum: ["mirror-hub", "assignable", "avoid"] },
      },
      required: ["slug", "status", "role"],
    });
    expect(spec.components.schemas.MachineList).toEqual({
      type: "object",
      properties: {
        machines: { type: "array", items: { $ref: "#/components/schemas/Machine" } },
        count: { type: "integer" },
      },
      required: ["machines", "count"],
    });
  });

  test("GET /v1/machines returns the documented shape and POST is refused", async () => {
    const fetch = handler();
    const get = await fetch(new Request("http://projects.test/v1/machines", {
      headers: { "x-api-key": token(["projects:read"]) },
    }));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ machines: MACHINES, count: MACHINES.length });

    const post = await fetch(new Request("http://projects.test/v1/machines", {
      method: "POST",
      headers: { "x-api-key": token(["projects:write"]) },
    }));
    expect(post.status).toBe(405);
  });
});
