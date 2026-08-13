import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FIXTURE_ENTITY_RO, FIXTURE_ENTITY_UK, FIXTURE_ENTITY_US } from "../src/adapters/entities.js";
import { openStore } from "../src/db/database.js";
import { authenticateToken, type ApiPrincipal } from "../src/server/auth.js";
import { executeOp, SYSTEM_PRINCIPAL } from "../src/services/execute.js";
import { seedDemo } from "../src/services/fixtures-seed.js";
import { getOp } from "../src/services/registry.js";
import { registerDomainTools } from "../src/mcp/tools/domain.js";
import { cleanupTempDb, useTempDb } from "./helpers.js";

let dbPath: string;
beforeEach(() => {
  dbPath = useTempDb();
});
afterEach(() => {
  cleanupTempDb(dbPath);
  delete process.env["HASNA_CONSOLIDATIONS_API_CREDENTIALS"];
});

function principal(over: Partial<ApiPrincipal>): ApiPrincipal {
  return {
    actor_id: "test",
    credential_id: "test",
    credential_type: "api_key",
    roles: [],
    scopes: [],
    ...over,
  };
}

const viewerUs = principal({ roles: ["viewer"], scopes: ["consolidations:read"], entity_ids: [FIXTURE_ENTITY_US] });
const controllerUsOnly = principal({
  roles: ["controller"],
  scopes: ["consolidations:read", "consolidations:write", "consolidations:run", "consolidations:finalize"],
  entity_ids: [FIXTURE_ENTITY_US],
});
const controllerGroup = principal({
  roles: ["controller"],
  scopes: ["consolidations:read", "consolidations:write", "consolidations:run", "consolidations:finalize"],
  entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
});

const runOp = (op: string, p: ApiPrincipal, input: Record<string, unknown> = {}) => executeOp(getOp(op)!, p, input);

describe("bearer token authentication", () => {
  it("is timing-safe and honors expiry + revocation", () => {
    process.env["HASNA_CONSOLIDATIONS_API_CREDENTIALS"] = JSON.stringify([
      { id: "good", token: "secret-good", roles: ["controller"], entity_ids: [FIXTURE_ENTITY_US] },
      { id: "expired", token: "secret-expired", roles: ["controller"], expires_at: "2000-01-01T00:00:00Z" },
      { id: "revoked", token: "secret-revoked", roles: ["controller"], revoked: true },
    ]);
    expect(authenticateToken("secret-good")?.credential_id).toBe("good");
    expect(authenticateToken("wrong")).toBeNull();
    expect(authenticateToken("secret-expired")).toBeNull();
    expect(authenticateToken("secret-revoked")).toBeNull();
  });

  it("derives scopes from roles when scopes are not explicit", () => {
    process.env["HASNA_CONSOLIDATIONS_API_CREDENTIALS"] = JSON.stringify([
      { id: "v", token: "t-viewer", roles: ["viewer"] },
    ]);
    const p = authenticateToken("t-viewer")!;
    expect(p.scopes).toEqual(["consolidations:read"]);
  });
});

describe("scope enforcement (deny-by-default)", () => {
  it("denies a read-only principal a write op", async () => {
    await expect(
      runOp("run.create", viewerUs, { period: "2026-Q1", reporting_currency: "USD", entity_ids: [FIXTURE_ENTITY_US] }),
    ).rejects.toThrow(/Permission denied/);
  });

  it("denies a controller the finalize/export it lacks the scope for", async () => {
    const noExport = principal({ roles: ["integration"], scopes: ["consolidations:read", "consolidations:write"], entity_ids: [FIXTURE_ENTITY_US] });
    await expect(runOp("audit.list", noExport)).rejects.toThrow(/Permission denied/);
  });

  it("denies storage tools without storage:admin scope", async () => {
    await expect(runOp("storage.status", controllerGroup)).rejects.toThrow(/Permission denied/);
    await expect(runOp("storage.pull", controllerGroup)).rejects.toThrow(/Permission denied/);
  });
});

describe("entity scoping", () => {
  beforeEach(async () => {
    const store = await openStore();
    await seedDemo(store);
    await store.close();
  });

  it("denies creating a run over an entity the principal cannot access", async () => {
    await expect(
      runOp("run.create", controllerUsOnly, {
        period: "2026-Q1",
        reporting_currency: "USD",
        entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
      }),
    ).rejects.toThrow(/Permission denied/);
  });

  it("allows a run over only the entities the principal can access", async () => {
    const created = (await runOp("run.create", controllerGroup, {
      period: "2026-Q1",
      reporting_currency: "USD",
      entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
    })) as { status: string };
    expect(created.status).toBe("draft");
  });

  it("threads the caller principal into MCP tools (authorize, not just authenticate)", async () => {
    // Capture the tool handlers a viewer principal would get on the MCP transport.
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>>();
    registerDomainTools(
      { tool: (name: string, _d: string, _s: unknown, h: unknown) => handlers.set(name, h as never) } as never,
      { principal: viewerUs, profile: "full" },
    );
    // A read the viewer is entitled to succeeds.
    const listed = await handlers.get("list_entities")!({});
    expect(JSON.parse(listed.content[0]!.text)).toHaveProperty("entities");
    // A privileged write is DENIED on the MCP path (no SYSTEM bypass).
    const denied = await handlers.get("create_run")!({
      period: "2026-Q1",
      reporting_currency: "USD",
      entity_ids: [FIXTURE_ENTITY_US],
    });
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0]!.text).code).toBe("PERMISSION_DENIED");
  });

  it("denies cross-entity reads (knowing an id is not authorization)", async () => {
    const roImports = (await runOp("gl_import.list", SYSTEM_PRINCIPAL, { entity_id: FIXTURE_ENTITY_RO })) as {
      gl_imports: Array<{ id: string }>;
    };
    const roId = roImports.gl_imports[0]!.id;
    await expect(runOp("gl_import.get", viewerUs, { id: roId })).rejects.toThrow(/Permission denied/);
  });
});

describe("elimination entity scoping (cross-entity leak regression)", () => {
  beforeEach(async () => {
    const store = await openStore();
    await seedDemo(store);
    await store.close();
  });

  async function createElim(from: string, to: string): Promise<string> {
    const created = (await runOp("elimination.create", SYSTEM_PRINCIPAL, {
      period: "2026-Q1",
      entity_id_from: from,
      entity_id_to: to,
      group_account_code: "1200",
      amount: 424242,
      currency: "USD",
      kind: "intercompany_balance",
      description: "CONFIDENTIAL intercompany",
    })) as { id: string };
    return created.id;
  }

  it("elimination.list excludes eliminations a scoped viewer cannot fully access", async () => {
    const usGroupId = await createElim(FIXTURE_ENTITY_US, "group");
    const usRoId = await createElim(FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO);
    const roGroupId = await createElim(FIXTURE_ENTITY_RO, "group");

    const listed = (await runOp("elimination.list", viewerUs)) as { eliminations: Array<{ id: string }> };
    const ids = listed.eliminations.map((e) => e.id);
    expect(ids).toContain(usGroupId); // US viewer may see a US<->group elimination
    expect(ids).not.toContain(usRoId); // needs RO access too — excluded
    expect(ids).not.toContain(roGroupId); // RO-only, no US involvement — excluded
  });

  it("elimination.get denies a cross-entity elimination to a scoped viewer", async () => {
    const roGroupId = await createElim(FIXTURE_ENTITY_RO, "group");
    await expect(runOp("elimination.get", viewerUs, { id: roGroupId })).rejects.toThrow(/Permission denied/);
  });

  it("elimination.get allows an in-scope elimination", async () => {
    const usGroupId = await createElim(FIXTURE_ENTITY_US, "group");
    const got = (await runOp("elimination.get", viewerUs, { id: usGroupId })) as { id: string };
    expect(got.id).toBe(usGroupId);
  });

  it("enforces the same elimination filtering on the MCP transport", async () => {
    const usGroupId = await createElim(FIXTURE_ENTITY_US, "group");
    const roGroupId = await createElim(FIXTURE_ENTITY_RO, "group");
    const handlers = new Map<
      string,
      (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>
    >();
    registerDomainTools(
      { tool: (name: string, _d: string, _s: unknown, h: unknown) => handlers.set(name, h as never) } as never,
      { principal: viewerUs, profile: "full" },
    );
    const listed = JSON.parse((await handlers.get("list_eliminations")!({})).content[0]!.text) as {
      eliminations: Array<{ id: string }>;
    };
    const ids = listed.eliminations.map((e) => e.id);
    expect(ids).toContain(usGroupId);
    expect(ids).not.toContain(roGroupId);
    const denied = await handlers.get("get_elimination")!({ id: roGroupId });
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0]!.text).code).toBe("PERMISSION_DENIED");
  });
});

describe("computed elimination entity scoping (group/group leak regression)", () => {
  const viewerUk = principal({ roles: ["viewer"], scopes: ["consolidations:read"], entity_ids: [FIXTURE_ENTITY_UK] });

  beforeEach(async () => {
    const store = await openStore();
    await seedDemo(store);
    await store.close();
  });

  // Produce the real workflow output: run.compute stores intercompany
  // eliminations with entity_id_from="group"/entity_id_to="group" and a real
  // run_id. Returns the run id and the computed eliminations.
  async function computeUsRoRun(): Promise<{ runId: string; elimIds: string[] }> {
    const created = (await runOp("run.create", controllerGroup, {
      period: "2026-Q1",
      reporting_currency: "USD",
      entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
    })) as { id: string };
    const computed = (await runOp("run.compute", controllerGroup, { id: created.id })) as {
      eliminations: Array<{ id: string; entity_id_from: string; entity_id_to: string; run_id: string }>;
    };
    // Sanity: the workflow really does emit group/group sentinel rows.
    expect(computed.eliminations.length).toBeGreaterThan(0);
    for (const e of computed.eliminations) {
      expect(e.entity_id_from).toBe("group");
      expect(e.entity_id_to).toBe("group");
      expect(e.run_id).toBe(created.id);
    }
    return { runId: created.id, elimIds: computed.eliminations.map((e) => e.id) };
  }

  it("elimination.list hides a run's computed eliminations from a viewer without the run's entities", async () => {
    const { elimIds } = await computeUsRoRun();
    const listed = (await runOp("elimination.list", viewerUk)) as { eliminations: Array<{ id: string }> };
    const ids = listed.eliminations.map((e) => e.id);
    for (const id of elimIds) expect(ids).not.toContain(id);
  });

  it("elimination.list hides computed eliminations even from a viewer with only PART of the run's entities", async () => {
    const { elimIds } = await computeUsRoRun();
    // US-only viewer: run covers US+RO, so US-only access is not the full group.
    const listed = (await runOp("elimination.list", viewerUs)) as { eliminations: Array<{ id: string }> };
    const ids = listed.eliminations.map((e) => e.id);
    for (const id of elimIds) expect(ids).not.toContain(id);
  });

  it("elimination.get denies a run's computed elimination to a viewer without the run's entities", async () => {
    const { elimIds } = await computeUsRoRun();
    await expect(runOp("elimination.get", viewerUk, { id: elimIds[0]! })).rejects.toThrow(/Permission denied/);
    // Partial access (US only) is still denied — the FULL run group is required.
    await expect(runOp("elimination.get", viewerUs, { id: elimIds[0]! })).rejects.toThrow(/Permission denied/);
  });

  it("elimination.get allows a run's computed elimination to a viewer with the full run entity group", async () => {
    const { elimIds } = await computeUsRoRun();
    const got = (await runOp("elimination.get", controllerGroup, { id: elimIds[0]! })) as { id: string };
    expect(got.id).toBe(elimIds[0]);
  });

  it("enforces the same computed-elimination gating on the MCP transport", async () => {
    const { elimIds } = await computeUsRoRun();
    const handlers = new Map<
      string,
      (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>
    >();
    registerDomainTools(
      { tool: (name: string, _d: string, _s: unknown, h: unknown) => handlers.set(name, h as never) } as never,
      { principal: viewerUk, profile: "full" },
    );
    const listed = JSON.parse((await handlers.get("list_eliminations")!({})).content[0]!.text) as {
      eliminations: Array<{ id: string }>;
    };
    const ids = listed.eliminations.map((e) => e.id);
    for (const id of elimIds) expect(ids).not.toContain(id);
    const denied = await handlers.get("get_elimination")!({ id: elimIds[0]! });
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0]!.text).code).toBe("PERMISSION_DENIED");
  });

  it("denies a manual group/group elimination with no run (no authorizable entity)", async () => {
    // A group/group row with no run_id resolves to no real entity; it must be
    // denied by default, never treated as public.
    const created = (await runOp("elimination.create", SYSTEM_PRINCIPAL, {
      period: "2026-Q1",
      entity_id_from: "group",
      entity_id_to: "group",
      group_account_code: "9999",
      amount: 12345,
      currency: "USD",
      kind: "intercompany_balance",
    })) as { id: string };
    await expect(runOp("elimination.get", viewerUs, { id: created.id })).rejects.toThrow(/Permission denied/);
    const listed = (await runOp("elimination.list", viewerUs)) as { eliminations: Array<{ id: string }> };
    expect(listed.eliminations.map((e) => e.id)).not.toContain(created.id);
  });
});

describe("legacy owner key entity scoping", () => {
  afterEach(() => {
    delete process.env["HASNA_CONSOLIDATIONS_API_KEY"];
  });

  it("legacy owner key is still entity-scoped (fail-closed without explicit entity_ids)", async () => {
    process.env["HASNA_CONSOLIDATIONS_API_KEY"] = "legacy-secret";
    const p = authenticateToken("legacy-secret")!;
    expect(p.roles).toContain("owner");
    expect(p.entity_ids).toBeUndefined();
    expect(p.bypass).toBeFalsy();
    // Owner scopes pass the capability gate, but every entity-scoped op is denied
    // until the credential is granted explicit entity access.
    await expect(
      runOp("run.create", p, { period: "2026-Q1", reporting_currency: "USD", entity_ids: [FIXTURE_ENTITY_US] }),
    ).rejects.toThrow(/Permission denied/);
  });
});
