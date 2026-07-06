import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import type { Hono } from "hono";
import { buildApp } from "../src/server/app.js";
import { registerDomainTools } from "../src/mcp/tools/domain.js";
import {
  REGISTRY,
  matchHttpRoute,
  opByCli,
  type OpDescriptor,
} from "../src/services/registry.js";
import { authenticateToken, type ApiPrincipal } from "../src/server/auth.js";
import { ACME_RO, HASNA_INC } from "../src/adapters/index.js";
import { configService } from "../src/services/index.js";
import { cleanupTestDatabase, ownerCtx, seededDb, useTestDatabase } from "./helpers/database.js";

// Interface parity (§7): the harness (drive CLI --json / MCP handler / HTTP route
// and normalize to a comparable value) is identical/copied; the op table is
// GENERATED from the shared registry. All three surfaces call the same services.
//
// Auth stance (hardening): MCP and /v1 are driven by a REAL, narrowly-scoped,
// NON-bypass bearer credential (editor role, fleet:read+fleet:write, scoped to a
// single entity) — NOT the localOwnerPrincipal() SYSTEM bypass. The serve tier is
// bound non-loopback so bearer auth is mandatory (fail-closed): every /v1 request
// carries the scoped token and is authenticated for real, matching how a client
// actually reaches these surfaces. The CLI remains the trusted local reference.

const cwd = process.cwd();
let dbPath: string;
let app: Hono<{ Variables: { principal: ApiPrincipal } }>;
let scopedPrincipal: ApiPrincipal;

// A genuine bearer credential (NOT a bypass). The scoped principal is entitled to
// exactly one entity (HASNA_INC) with read+write, mirroring a real least-privilege
// operator token. The unscoped credential holds the same scopes but NO entity set,
// so §1c deny-by-default must refuse it entity-bound config CRUD on every surface.
const SCOPED_TOKEN = "fleet-parity-scoped-cred-000000000000";
const UNSCOPED_TOKEN = "fleet-parity-unscoped-cred-0000000000";
const PARITY_CREDENTIALS = JSON.stringify([
  { id: "parity-scoped", token: SCOPED_TOKEN, type: "session", roles: ["editor"], scopes: ["fleet:read", "fleet:write"], entity_ids: [HASNA_INC] },
  { id: "parity-unscoped", token: UNSCOPED_TOKEN, type: "session", roles: ["editor"], scopes: ["fleet:read", "fleet:write"] },
]);

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
let mcpHandlers: Map<string, Handler>;

const VOLATILE = new Set(["id", "created_at", "updated_at", "version", "generated_at", "slo_id"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE.has(key)) continue;
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// Register the MCP domain tools bound to a specific caller principal, exactly as
// the HTTP transport does per request — so the MCP surface is exercised with the
// SAME non-bypass principal that drives /v1, never a SYSTEM bypass.
function captureMcpHandlers(principal: ApiPrincipal): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  registerDomainTools({ tool(name: string, _d: string, _s: unknown, h: Handler) { handlers.set(name, h); } } as never, principal, "full");
  return handlers;
}

function execCli<T>(op: OpDescriptor, input: Record<string, unknown>): { ok: true; data: T } | { ok: false; error: unknown } {
  const positional = op.cli.positional ?? [];
  const args = ["run", "src/cli/index.tsx", "--json", op.cli.namespace, op.cli.command];
  for (const p of positional) args.push(String(input[p]));
  for (const [key, value] of Object.entries(input)) {
    if (positional.includes(key)) continue;
    args.push(`--${key.replace(/_/g, "-")}`, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  try {
    const out = execFileSync("bun", args, { cwd, env: { ...process.env, HASNA_FLEET_DB_PATH: dbPath }, encoding: "utf8" });
    return { ok: true, data: JSON.parse(out) as T };
  } catch (error) {
    const stdout = String((error as { stdout?: Buffer | string }).stdout ?? "").trim();
    return { ok: false, error: JSON.parse(stdout) };
  }
}

async function callMcp<T>(
  op: OpDescriptor,
  input: Record<string, unknown>,
  handlers: Map<string, Handler> = mcpHandlers,
): Promise<{ ok: boolean; data: T }> {
  const handler = handlers.get(op.mcpTool)!;
  const result = await handler(input);
  const data = JSON.parse(result.content[0]!.text) as T;
  return { ok: !result.isError, data };
}

async function callHttp<T>(
  op: OpDescriptor,
  input: Record<string, unknown>,
  token: string = SCOPED_TOKEN,
): Promise<{ status: number; data: T }> {
  let path = op.path;
  const params = op.path.split("/").filter((s) => s.startsWith(":")).map((s) => s.slice(1));
  for (const p of params) path = path.replace(`:${p}`, encodeURIComponent(String(input[p])));
  const url = new URL(`http://fleet.local${path}`);
  let body: string | undefined;
  const rest = Object.fromEntries(Object.entries(input).filter(([k]) => !params.includes(k)));
  if (op.method === "GET") {
    for (const [k, v] of Object.entries(rest)) url.searchParams.set(k, String(v));
  } else if (op.method === "POST" || op.method === "PATCH") {
    body = JSON.stringify(rest);
  }
  // Real bearer auth on every /v1 request (mandatory on the non-loopback bind).
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const init: RequestInit = { method: op.method, headers };
  if (body !== undefined) init.body = body;
  const res = await app.fetch(new Request(url.toString(), init));
  return { status: res.status, data: (await res.json()) as T };
}

beforeEach(() => {
  dbPath = useTestDatabase("fleet-parity");
  process.env["HASNA_FLEET_API_CREDENTIALS"] = PARITY_CREDENTIALS;
  seededDb();
  // Derive the driving principal from the real credential, so MCP and /v1 share
  // one non-bypass identity. Bind non-loopback so bearer auth is fail-closed.
  scopedPrincipal = authenticateToken(SCOPED_TOKEN)!;
  app = buildApp({ bindHost: "0.0.0.0" });
  mcpHandlers = captureMcpHandlers(scopedPrincipal);
});

afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["HASNA_FLEET_API_CREDENTIALS"];
});

describe("interface parity — generated coverage", () => {
  it("exposes every registry op on CLI, MCP, and API", () => {
    for (const op of REGISTRY) {
      expect(opByCli(op.cli.namespace, op.cli.command), `${op.op} CLI`).toBeDefined();
      expect(op.mcpTool, `${op.op} MCP`).toBeTruthy();
      const concrete = op.path.replace(/:(\w+)/g, "x");
      expect(matchHttpRoute(op.method, concrete), `${op.op} HTTP`).not.toBeNull();
    }
  });

  it("keeps fused observability resources GET-only", () => {
    for (const op of REGISTRY.filter((o) => o.kind === "fused")) {
      expect(op.method).toBe("GET");
      expect(op.mutates).toBe(false);
    }
  });

  it("drives MCP and /v1 with a real non-bypass, narrowly-scoped credential", () => {
    // Guard the whole harness: the principal exercising MCP + /v1 is a genuine
    // least-privilege bearer credential, never the localOwnerPrincipal() bypass.
    expect(scopedPrincipal.bypass).toBeFalsy();
    expect(scopedPrincipal.credential_id).toBe("parity-scoped");
    expect(scopedPrincipal.scopes).toEqual(["fleet:read", "fleet:write"]);
    expect(scopedPrincipal.scopes).not.toContain("fleet:admin");
    expect(scopedPrincipal.scopes).not.toContain("storage:admin");
    expect(scopedPrincipal.entity_ids).toEqual([HASNA_INC]);
    // Fail-closed: an unauthenticated /v1 request is rejected on this bind.
    // (Proves the parity results below come from the real credential, not a fallback.)
  });

  it("rejects an unauthenticated /v1 request (fail-closed)", async () => {
    const res = await app.fetch(new Request("http://fleet.local/v1/slos"));
    expect(res.status).toBe(401);
  });
});

describe("interface parity — read equivalence", () => {
  const readCases: { name: string; op: OpDescriptor; input: Record<string, unknown> }[] = [
    { name: "health.agents", op: opByCli("health", "agents")!, input: { entity_id: HASNA_INC, window_days: 30 } },
    { name: "health.company", op: opByCli("health", "company")!, input: { entity_id: HASNA_INC, window_days: 30 } },
    { name: "token-burn", op: opByCli("burn", "list")!, input: { entity_id: HASNA_INC, window_days: 30 } },
    { name: "cost", op: opByCli("cost", "list")!, input: { entity_id: HASNA_INC, window_days: 30 } },
    { name: "traces.list", op: opByCli("trace", "list")!, input: { entity_id: HASNA_INC } },
    { name: "traces.get", op: opByCli("trace", "get")!, input: { entity_id: HASNA_INC, trace_id: "trace-researcher-0" } },
    { name: "slo-status", op: opByCli("slo-status", "list")!, input: { entity_id: HASNA_INC } },
    { name: "alerts", op: opByCli("alert", "list")!, input: { entity_id: HASNA_INC } },
  ];

  for (const { name, op, input } of readCases) {
    it(`CLI, MCP, and API agree on ${name}`, async () => {
      const cli = execCli(op, input);
      expect(cli.ok, JSON.stringify(cli)).toBe(true);
      const mcp = await callMcp(op, input);
      const http = await callHttp(op, input);
      expect(http.status).toBe(200);

      const c = canonical((cli as { data: unknown }).data);
      expect(canonical(mcp.data)).toEqual(c);
      expect(canonical(http.data)).toEqual(c);
    });
  }
});

describe("interface parity — write + error equivalence", () => {
  it("saved-view create returns the same shape on all three surfaces", async () => {
    const input = { entity_id: HASNA_INC, name: "Ops Board", kind: "dashboard", spec: { widgets: 3 } };
    const cli = execCli(opByCli("saved-view", "create")!, input);
    const mcp = await callMcp(opByCli("saved-view", "create")!, input);
    const http = await callHttp(opByCli("saved-view", "create")!, input);
    expect(cli.ok).toBe(true);
    expect(mcp.ok).toBe(true);
    expect(http.status).toBe(200);
    const c = canonical((cli as { data: unknown }).data);
    expect(canonical(mcp.data)).toEqual(c);
    expect(canonical(http.data)).toEqual(c);
  });

  it("produces an identical structured error for a missing id", async () => {
    const getOp = opByCli("slo", "get")!;
    const input = { id: "00000000-0000-4000-8000-000000000000" };
    const cli = execCli<{ code: string }>(getOp, input);
    const mcp = await callMcp<{ code: string; message: string; suggestion: string }>(getOp, input);
    const http = await callHttp<{ code: string; message: string; suggestion: string }>(getOp, input);

    expect(cli.ok).toBe(false);
    const cliErr = (cli as { error: { code: string; message: string; suggestion: string } }).error;
    expect(cliErr.code).toBe("SLO_NOT_FOUND");
    expect(mcp.data.code).toBe("SLO_NOT_FOUND");
    expect(http.data.code).toBe("SLO_NOT_FOUND");
    expect({ code: mcp.data.code, message: mcp.data.message, suggestion: mcp.data.suggestion }).toEqual(cliErr);
    expect({ code: http.data.code, message: http.data.message, suggestion: http.data.suggestion }).toEqual(cliErr);
  });

  it("config list stays in parity after a seeded write", async () => {
    configService.createSlo(ownerCtx(), {
      entity_id: HASNA_INC,
      target_type: "agent",
      target_ref: "researcher",
      name: "avail",
      objective: "availability",
      target_value: 99,
    });
    const listOp = opByCli("slo", "list")!;
    const cli = execCli(listOp, {});
    const mcp = await callMcp(listOp, {});
    const http = await callHttp(listOp, {});
    const c = canonical((cli as { data: unknown }).data);
    expect(canonical(mcp.data)).toEqual(c);
    expect(canonical(http.data)).toEqual(c);
  });
});

describe("interface parity — unscoped principal is DENIED config CRUD (deny-by-default §1c)", () => {
  // Negative parity: an `entity_id` is an authorized REFERENCE, never a bearer
  // capability. A non-bypass principal that holds write scope but NO entity set
  // resolves to the EMPTY allowed set — knowing/guessing the id grants nothing.
  // Both credential-driven surfaces (MCP + /v1) MUST refuse entity-bound config
  // CRUD with ENTITY_ACCESS_DENIED, identically. The CLI is the trusted local
  // reference and is intentionally out of this cross-surface denial check.
  it("refuses create/get/update/delete on MCP and /v1 with ENTITY_ACCESS_DENIED", async () => {
    const unscoped = authenticateToken(UNSCOPED_TOKEN)!;
    expect(unscoped.bypass).toBeFalsy();
    expect(unscoped.entity_ids).toBeUndefined();
    expect(unscoped.scopes).toContain("fleet:write"); // has the scope, lacks the entity
    const unscopedHandlers = captureMcpHandlers(unscoped);

    // Seed a row owned by HASNA_INC through the trusted (bypass) context.
    const slo = configService.createSlo(ownerCtx(), {
      entity_id: HASNA_INC,
      target_type: "agent",
      target_ref: "researcher",
      name: "avail",
      objective: "availability",
      target_value: 99,
    }) as { id: string };

    // CREATE — denied on the input entity the caller is not scoped to.
    const createOp = opByCli("saved-view", "create")!;
    const createInput = { entity_id: HASNA_INC, name: "Should Not Exist", kind: "dashboard", spec: {} };
    const mcpCreate = await callMcp<{ code: string }>(createOp, createInput, unscopedHandlers);
    const httpCreate = await callHttp<{ code: string }>(createOp, createInput, UNSCOPED_TOKEN);
    expect(mcpCreate.ok).toBe(false);
    expect(mcpCreate.data.code).toBe("ENTITY_ACCESS_DENIED");
    expect(httpCreate.status).toBe(403);
    expect(httpCreate.data.code).toBe("ENTITY_ACCESS_DENIED");

    // READ (get by id) — resolving the id is NOT authorization.
    const getOp = opByCli("slo", "get")!;
    const mcpGet = await callMcp<{ code: string }>(getOp, { id: slo.id }, unscopedHandlers);
    const httpGet = await callHttp<{ code: string }>(getOp, { id: slo.id }, UNSCOPED_TOKEN);
    expect(mcpGet.ok).toBe(false);
    expect(mcpGet.data.code).toBe("ENTITY_ACCESS_DENIED");
    expect(httpGet.status).toBe(403);
    expect(httpGet.data.code).toBe("ENTITY_ACCESS_DENIED");

    // UPDATE — denied against the resolved row's owning entity.
    const updateOp = opByCli("slo", "update")!;
    const mcpUpd = await callMcp<{ code: string }>(updateOp, { id: slo.id, name: "hijacked" }, unscopedHandlers);
    const httpUpd = await callHttp<{ code: string }>(updateOp, { id: slo.id, name: "hijacked" }, UNSCOPED_TOKEN);
    expect(mcpUpd.ok).toBe(false);
    expect(mcpUpd.data.code).toBe("ENTITY_ACCESS_DENIED");
    expect(httpUpd.status).toBe(403);
    expect(httpUpd.data.code).toBe("ENTITY_ACCESS_DENIED");

    // DELETE — denied identically.
    const deleteOp = opByCli("slo", "delete")!;
    const mcpDel = await callMcp<{ code: string }>(deleteOp, { id: slo.id }, unscopedHandlers);
    const httpDel = await callHttp<{ code: string }>(deleteOp, { id: slo.id }, UNSCOPED_TOKEN);
    expect(mcpDel.ok).toBe(false);
    expect(mcpDel.data.code).toBe("ENTITY_ACCESS_DENIED");
    expect(httpDel.status).toBe(403);
    expect(httpDel.data.code).toBe("ENTITY_ACCESS_DENIED");

    // The seeded row survived every denied mutation across both surfaces.
    const survivor = configService.getSlo(ownerCtx(), slo.id) as { id: string };
    expect(survivor.id).toBe(slo.id);
  });

  it("denies a scoped principal cross-entity config CRUD (ACME_RO out of scope)", async () => {
    // The scoped credential (entity_ids: [HASNA_INC]) must not reach a different
    // entity even though it holds fleet:write — org/entity scoping, not id opacity.
    const createOp = opByCli("saved-view", "create")!;
    const input = { entity_id: ACME_RO, name: "cross-tenant", kind: "dashboard", spec: {} };
    const mcp = await callMcp<{ code: string }>(createOp, input);
    const http = await callHttp<{ code: string }>(createOp, input);
    expect(mcp.ok).toBe(false);
    expect(mcp.data.code).toBe("ENTITY_ACCESS_DENIED");
    expect(http.status).toBe(403);
    expect(http.data.code).toBe("ENTITY_ACCESS_DENIED");
  });
});

describe("interface parity — unscoped principal gets an EMPTY list (deny-by-default §1c)", () => {
  // Negative parity for LIST ops, mirroring the CRUD denial above. An `entity_id`
  // is an authorized REFERENCE, never a bearer capability, and holding fleet:read
  // does NOT widen the entity dimension. A non-bypass principal with NO entity set
  // resolves to the EMPTY allowed set and MUST see NO rows on any LIST surface —
  // never EVERY entity's rows (the leak this guards). The CLI is the trusted local
  // bypass reference and is intentionally out of this cross-surface denial check.
  it("returns an empty list on MCP and /v1 for every config LIST op", async () => {
    const unscoped = authenticateToken(UNSCOPED_TOKEN)!;
    expect(unscoped.bypass).toBeFalsy();
    expect(unscoped.entity_ids).toBeUndefined();
    expect(unscoped.scopes).toContain("fleet:read"); // has read scope, lacks any entity
    const unscopedHandlers = captureMcpHandlers(unscoped);

    // Seed real rows for HASNA_INC through the trusted (bypass) context, so a
    // regression (unconstrained → ALL rows) would surface as a NON-empty list.
    const slo = configService.createSlo(ownerCtx(), {
      entity_id: HASNA_INC,
      target_type: "agent",
      target_ref: "researcher",
      name: "avail",
      objective: "availability",
      target_value: 99,
    }) as { id: string };
    configService.createSavedView(ownerCtx(), { entity_id: HASNA_INC, name: "Ops Board", kind: "dashboard", spec: {} });
    configService.createErrorBudgetPolicy(ownerCtx(), { slo_id: slo.id, entity_id: HASNA_INC, budget_percent: 99 });
    configService.createAlertThreshold(ownerCtx(), { entity_id: HASNA_INC, metric: "error_rate", comparator: "gt", threshold_value: 1 });
    configService.createAnnotation(ownerCtx(), { entity_id: HASNA_INC, target_ref: "researcher", text: "deploy" });

    const listOps = [
      opByCli("saved-view", "list")!,
      opByCli("slo", "list")!,
      opByCli("error-budget", "list")!,
      opByCli("alert-threshold", "list")!,
      opByCli("annotation", "list")!,
    ];

    for (const op of listOps) {
      // Positive control: the SCOPED principal (entity_ids: [HASNA_INC]) DOES see
      // the seeded rows — so an empty UNSCOPED result is caused by entity scoping,
      // not by an empty table.
      const scopedMcp = await callMcp<unknown[]>(op, {});
      expect(Array.isArray(scopedMcp.data) && scopedMcp.data.length > 0, `${op.op} scoped MCP non-empty`).toBe(true);

      // UNSCOPED: empty on BOTH credential-driven surfaces — deny-by-default.
      const mcp = await callMcp<unknown[]>(op, {}, unscopedHandlers);
      expect(mcp.ok, `${op.op} unscoped MCP ok`).toBe(true);
      expect(mcp.data, `${op.op} unscoped MCP empty`).toEqual([]);

      const http = await callHttp<unknown[]>(op, {}, UNSCOPED_TOKEN);
      expect(http.status, `${op.op} unscoped HTTP status`).toBe(200);
      expect(http.data, `${op.op} unscoped HTTP empty`).toEqual([]);
    }
  });
});
