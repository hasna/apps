import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ApiKeyPrincipal } from "@hasna/contracts/auth";
import * as cloud from "./cloud.js";
import * as store from "../storage/cloud-store.js";
import { handleV1Request } from "./v1.js";
import { buildV1OpenApiDocument } from "./openapi.js";

const spies: Array<{ mockRestore(): void }> = [];
function track<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy);
  return spy;
}
afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore();
});

const principal: ApiKeyPrincipal = {
  kid: "writer-key",
  app: "instructions",
  scopes: ["instructions:write"],
  agent: "codex",
  tid: null,
  claims: {} as ApiKeyPrincipal["claims"],
};

function mockCloudBoundary() {
  track(spyOn(cloud, "ensureCloudSchema").mockResolvedValue(undefined));
  track(spyOn(cloud, "getCloudClient").mockReturnValue({} as never));
}

async function request(path: string, init?: RequestInit) {
  const req = new Request(`https://api.hasna.com${path}`, init);
  return handleV1Request(req, new URL(req.url), { principal });
}

describe("Instructions create error disclosure", () => {
  test.each([
    ["config", "/v1/configs", "createConfig"],
    ["profile", "/v1/profiles", "createProfile"],
  ] as const)("redacts unexpected %s backend errors", async (_label, path, method) => {
    mockCloudBoundary();
    track(spyOn(store, method).mockRejectedValue(new Error("duplicate key violates internal_constraint_name")));

    const response = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(method === "createConfig"
        ? { name: "Demo", category: "rules", content: "x" }
        : { name: "Demo" }),
    });

    expect(response?.status).toBe(500);
    expect(await response?.json()).toEqual({ error: "Instructions request failed", code: "INTERNAL_ERROR" });
  });

  test("retains an explicit stable validation 4xx without exposing arbitrary exceptions", async () => {
    mockCloudBoundary();
    track(spyOn(store, "createConfig").mockRejectedValue(
      new store.StoreValidationError("name is required", "NAME_REQUIRED"),
    ));

    const response = await request("/v1/configs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", category: "rules", content: "x" }),
    });

    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: "name is required", code: "NAME_REQUIRED" });
  });
});

describe("Instructions bounded collection HTTP envelopes", () => {
  test.each([
    ["configs", "/v1/configs?limit=2&cursor=4", "listConfigsPage"],
    ["snapshots", "/v1/configs/config-1/snapshots?limit=2&cursor=4", "listSnapshotsPage"],
    ["machines", "/v1/machines?limit=2&cursor=4", "listMachinesPage"],
  ] as const)("%s collection forwards bounds and returns compatibility aliases", async (alias, path, method) => {
    mockCloudBoundary();
    const page = {
      items: [{ id: `${alias}-item` }],
      total: 5,
      limit: 2,
      cursor: 4,
      next_cursor: null,
      has_more: false,
      complete: true,
      truncated: false as const,
      source_bounded: true,
    };
    const bounded = track(spyOn(store, method).mockResolvedValue(page as never));
    if (method === "listSnapshotsPage") {
      track(spyOn(store, "getConfig").mockResolvedValue({ id: "config-1" } as never));
    }

    const response = await request(path);
    const payload = await response?.json() as Record<string, unknown>;

    expect(response?.status).toBe(200);
    expect(bounded).toHaveBeenCalledWith(expect.anything(), ...(method === "listSnapshotsPage"
      ? ["config-1", { limit: "2", cursor: "4" }]
      : method === "listConfigsPage"
        ? [{}, { limit: "2", cursor: "4" }]
        : [{ limit: "2", cursor: "4" }]));
    expect(payload[alias]).toEqual(page.items);
    expect(payload.items).toEqual(page.items);
    expect(payload).toMatchObject({ total: 5, limit: 2, cursor: 4, complete: true, source_bounded: true });
  });
});

describe("Instructions metadata-only identity pages", () => {
  test("config identity view forwards category, agent, kind, and bounded search filters", async () => {
    mockCloudBoundary();
    const read = track(spyOn(store, "listConfigIdentitiesPage").mockResolvedValue({
      items: [], total: 0, limit: 7, cursor: 9, next_cursor: null,
      has_more: false, complete: true, truncated: false, source_bounded: true,
    }));

    const response = await request("/v1/configs?view=identity&category=rules&agent=codex&kind=file&search=needle&limit=7&cursor=9");

    expect(response?.status).toBe(200);
    expect(read).toHaveBeenCalledWith(
      expect.anything(),
      { category: "rules", agent: "codex", kind: "file", search: "needle" },
      { limit: "7", cursor: "9" },
    );
  });

  test.each([
    ["configs", "/v1/configs?view=identity&limit=2&cursor=0", "listConfigIdentitiesPage"],
    ["profiles", "/v1/profiles?view=identity&limit=2&cursor=0", "listProfileIdentitiesPage"],
    ["machines", "/v1/machines?view=identity&limit=2&cursor=0", "listMachineIdentitiesPage"],
  ] as const)("%s identity view omits instruction content, paths, and private profile data", async (alias, path, method) => {
    mockCloudBoundary();
    const identity = alias === "configs"
      ? { id: "config-1", slug: "demo", name: "Demo", category: "rules", agent: "global", kind: "file", format: "markdown", version: 1, is_template: false, created_at: "", updated_at: "", synced_at: null }
      : alias === "profiles"
        ? { id: "profile-1", slug: "default", name: "Default", created_at: "", updated_at: "" }
        : { id: "machine-1", hostname: "station06", os: "darwin", arch: "arm64", last_applied_at: null, created_at: "" };
    track(spyOn(store, method).mockResolvedValue({
      items: [identity], total: 1, limit: 2, cursor: 0, next_cursor: null,
      has_more: false, complete: true, truncated: false, source_bounded: true,
    } as never));

    const response = await request(path);
    const payload = await response?.json() as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(response?.status).toBe(200);
    expect(payload[alias]).toEqual([identity]);
    expect(serialized).not.toContain('"content"');
    expect(serialized).not.toContain('"target_path"');
    expect(serialized).not.toContain('"outputs"');
    expect(serialized).not.toContain('"description"');
    expect(serialized).not.toContain('"selectors"');
    expect(serialized).not.toContain('"variables"');
  });
});

describe("Instructions idempotency HTTP authority", () => {
  test("binds a retryable create to the authenticated principal, operation, key, and body", async () => {
    mockCloudBoundary();
    track(spyOn(store, "createConfig").mockResolvedValue({ id: "config-1" } as never));
    const execute = track(spyOn(store, "executeIdempotentRequest").mockImplementation(
      async (client, input, perform) => ({ ...(await perform(client)), replayed: false }),
    ));
    const body = { name: "Demo", category: "rules", content: "x" };

    const response = await request("/v1/configs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "retry-123" },
      body: JSON.stringify(body),
    });

    expect(response?.status).toBe(201);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1]).toEqual({
      principal: "instructions|tenant:-|agent:codex|kid:writer-key",
      operation: "POST /v1/configs",
      key: "retry-123",
      body,
    });
  });

  test("returns a stable conflict when one key is reused with a different body", async () => {
    mockCloudBoundary();
    track(spyOn(store, "executeIdempotentRequest").mockRejectedValue(new store.IdempotencyConflictError()));

    const response = await request("/v1/profiles", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "reused" },
      body: JSON.stringify({ name: "Different" }),
    });

    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({
      error: "Idempotency-Key was already used for a different request body",
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  test("rejects an oversized key before any domain write", async () => {
    mockCloudBoundary();
    const create = track(spyOn(store, "createConfig").mockResolvedValue({ id: "should-not-run" } as never));

    const response = await request("/v1/configs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "x".repeat(256) },
      body: JSON.stringify({ name: "Demo", category: "rules", content: "x" }),
    });

    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
    expect(create).not.toHaveBeenCalled();
  });
});


describe("Instructions OpenAPI security and bounded-read contract", () => {
  test("documents bounded identity views and optional durable-idempotency headers", () => {
    const document = buildV1OpenApiDocument("0.7.0") as any;
    const configsGet = document.paths["/v1/configs"].get;
    const snapshotsGet = document.paths["/v1/configs/{id}/snapshots"].get;
    const machines = document.paths["/v1/machines"];

    expect(configsGet.parameters.map((parameter: any) => parameter.name)).toEqual(
      expect.arrayContaining(["limit", "cursor", "view"]),
    );
    expect(snapshotsGet.parameters.map((parameter: any) => parameter.name)).toEqual(
      expect.arrayContaining(["id", "limit", "cursor"]),
    );
    expect(machines.get.parameters.map((parameter: any) => parameter.name)).toEqual(
      expect.arrayContaining(["limit", "cursor", "view"]),
    );
    for (const path of ["/v1/profiles/{id}/bindings", "/v1/profiles/{id}/assets"]) {
      const operation = document.paths[path].get;
      expect(operation.parameters.map((parameter: any) => parameter.name)).toEqual(
        expect.arrayContaining(["id", "limit", "cursor"]),
      );
      expect(operation.responses["200"].content["application/json"].schema.$ref).toContain("BoundedProfile");
    }
    expect(configsGet.responses["200"].content["application/json"].schema.oneOf).toHaveLength(2);

    for (const operation of [
      document.paths["/v1/configs"].post,
      document.paths["/v1/configs/{id}/snapshots"].post,
      document.paths["/v1/profiles"].post,
      document.paths["/v1/profiles/{id}/configs"].post,
      document.paths["/v1/profiles/{id}/configs/{configId}"].put,
      document.paths["/v1/profiles/{id}/assets"].post,
      document.paths["/v1/profiles/{id}/assets/{assetKey}"].put,
      machines.post,
    ]) {
      const idempotency = operation.parameters.find((parameter: any) => parameter.name === "Idempotency-Key");
      expect(idempotency).toMatchObject({ in: "header", required: false });
      expect(operation.responses["409"]).toBeDefined();
    }
  });
});
