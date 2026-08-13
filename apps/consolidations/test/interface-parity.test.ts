import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { FIXTURE_ENTITY_RO, FIXTURE_ENTITY_US } from "../src/adapters/entities.js";
import { openStore } from "../src/db/database.js";
import { createApp } from "../src/server/app.js";
import { authenticateToken } from "../src/server/auth.js";
import { registerDomainTools } from "../src/mcp/tools/domain.js";
import { registerStandardTools } from "../src/mcp/tools/standard.js";
import { executeOp, SYSTEM_PRINCIPAL } from "../src/services/execute.js";
import { seedDemo } from "../src/services/fixtures-seed.js";
import { getOp, parityOps } from "../src/services/registry.js";
import type { OpDef } from "../src/services/op-types.js";
import { cleanupTempDb, useTempDb } from "./helpers.js";

// The interface-parity harness is IDENTICAL across apps; the op TABLE is
// generated from this app's registry. Every parity read op is driven through
// CLI (--json), MCP (captured handler), and /v1 (app.fetch) WITH the SAME scoped
// credential, normalized, and asserted equal — including structured errors.

const PARITY_TOKEN = "parity-token";
// A single-entity (US-only) credential used to prove that scoped reads are
// identically FILTERED across CLI/MCP/API, not just identical for an all-entity owner.
const US_TOKEN = "parity-us-token";
const CREDENTIALS = JSON.stringify([
  { id: "parity", token: PARITY_TOKEN, roles: ["owner"], entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO] },
  { id: "parity-us", token: US_TOKEN, roles: ["owner"], entity_ids: [FIXTURE_ENTITY_US] },
]);

let dbPath: string;
const app = createApp();
const mcpHandlers = new Map<string, (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>();
const usMcpHandlers = new Map<string, (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>();
const ids: Record<string, string> = {};

const VOLATILE = new Set(["imported_at"]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE.has(key)) continue;
      out[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function callCli(op: OpDef, input: Record<string, unknown>, token = PARITY_TOKEN): unknown {
  const args = ["run", "src/cli/index.tsx", "--json", ...op.cli.path, ...op.cli.toArgs(input)];
  try {
    const stdout = execFileSync("bun", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HASNA_CONSOLIDATIONS_DB_PATH: dbPath,
        HASNA_CONSOLIDATIONS_API_CREDENTIALS: CREDENTIALS,
        HASNA_CONSOLIDATIONS_CLI_TOKEN: token,
      },
      encoding: "utf8",
    });
    return JSON.parse(stdout.trim());
  } catch (error) {
    const stdout = String((error as { stdout?: Buffer | string }).stdout ?? "").trim();
    return JSON.parse(stdout);
  }
}

async function callMcp(
  op: OpDef,
  input: Record<string, unknown>,
  handlers = mcpHandlers,
): Promise<unknown> {
  const handler = handlers.get(op.mcpTool);
  if (!handler) throw new Error(`No MCP handler for ${op.mcpTool}`);
  const result = await handler(input);
  return JSON.parse(result.content[0]!.text);
}

async function callHttp(
  op: OpDef,
  input: Record<string, unknown>,
  token = PARITY_TOKEN,
): Promise<{ status: number; body: unknown }> {
  let path = op.http.toPath(input);
  const query = new URLSearchParams();
  for (const key of op.http.queryKeys ?? []) {
    if (input[key] !== undefined) query.set(key, String(input[key]));
  }
  const qs = query.toString();
  if (qs) path += `?${qs}`;
  const init: RequestInit = { method: op.http.method, headers: { Authorization: `Bearer ${token}` } };
  if (op.http.method === "POST" || op.http.method === "PATCH") {
    const body: Record<string, unknown> = {};
    for (const key of op.http.bodyKeys ?? []) if (input[key] !== undefined) body[key] = input[key];
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await app.fetch(new Request(`http://127.0.0.1${path}`, init));
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  dbPath = useTempDb();
  process.env["HASNA_CONSOLIDATIONS_API_CREDENTIALS"] = CREDENTIALS;
  const sys = SYSTEM_PRINCIPAL;
  const store = await openStore();
  await seedDemo(store);
  await store.close();
  const created = (await executeOp(getOp("run.create")!, sys, {
    period: "2026-Q1",
    reporting_currency: "USD",
    entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
  })) as { id: string };
  ids.run = created.id;
  await executeOp(getOp("run.compute")!, sys, { id: created.id });

  ids.fx = ((await executeOp(getOp("fx_rate.list")!, sys, {})) as { fx_rates: Array<{ id: string }> }).fx_rates[0]!.id;
  ids.gl = ((await executeOp(getOp("gl_import.list")!, sys, {})) as { gl_imports: Array<{ id: string }> }).gl_imports[0]!.id;
  ids.coa = ((await executeOp(getOp("coa_mapping.list")!, sys, {})) as { coa_mappings: Array<{ id: string }> }).coa_mappings[0]!.id;
  ids.statement = ((await executeOp(getOp("statement.list")!, sys, { run_id: ids.run })) as { statements: Array<{ id: string }> }).statements[0]!.id;
  ids.elimination = ((await executeOp(getOp("elimination.list")!, sys, { run_id: ids.run })) as { eliminations: Array<{ id: string }> }).eliminations[0]!.id;

  // Manual entity-referencing eliminations (run_id null → excluded from the
  // run-scoped parity loop) to prove scoped filtering: US<->group is visible to
  // the US-only credential; RO<->group is not.
  ids.usElim = ((await executeOp(getOp("elimination.create")!, sys, {
    period: "2026-Q1", entity_id_from: FIXTURE_ENTITY_US, entity_id_to: "group",
    group_account_code: "1200", amount: 1111, currency: "USD", kind: "intercompany_balance",
  })) as { id: string }).id;
  ids.roElim = ((await executeOp(getOp("elimination.create")!, sys, {
    period: "2026-Q1", entity_id_from: FIXTURE_ENTITY_RO, entity_id_to: "group",
    group_account_code: "1200", amount: 2222, currency: "USD", kind: "intercompany_balance",
  })) as { id: string }).id;

  const principal = authenticateToken(PARITY_TOKEN)!;
  registerStandardTools({ tool: (name: string, _d: string, _s: unknown, handler: unknown) => mcpHandlers.set(name, handler as never) } as never);
  registerDomainTools({ tool: (name: string, _d: string, _s: unknown, handler: unknown) => mcpHandlers.set(name, handler as never) } as never, {
    principal,
    profile: "full",
  });
  const usPrincipal = authenticateToken(US_TOKEN)!;
  registerDomainTools({ tool: (name: string, _d: string, _s: unknown, handler: unknown) => usMcpHandlers.set(name, handler as never) } as never, {
    principal: usPrincipal,
    profile: "full",
  });
});

afterAll(() => {
  cleanupTempDb(dbPath);
  delete process.env["HASNA_CONSOLIDATIONS_API_CREDENTIALS"];
});

function inputFor(op: OpDef): Record<string, unknown> | null {
  switch (op.op) {
    case "entity.get":
      return { id: FIXTURE_ENTITY_US };
    case "fx_rate.get":
      return { id: ids.fx };
    case "gl_import.get":
      return { id: ids.gl };
    case "coa_mapping.get":
      return { id: ids.coa };
    case "run.get":
      return { id: ids.run };
    case "statement.get":
      return { id: ids.statement };
    case "statement.list":
      return { run_id: ids.run };
    case "elimination.get":
      return { id: ids.elimination };
    case "elimination.list":
      return { run_id: ids.run };
    default:
      // list / no-arg read ops
      return op.mutating ? null : {};
  }
}

describe("interface parity (generated table, scoped credentials)", () => {
  const readOps = parityOps().filter((op) => !op.mutating);

  for (const op of readOps) {
    it(`${op.op} is identical across CLI, MCP, and /v1`, async () => {
      const input = inputFor(op);
      if (!input) return;
      const cli = normalize(callCli(op, input));
      const mcp = normalize(await callMcp(op, input));
      const http = await callHttp(op, input);
      expect(http.status).toBe(200);
      const httpBody = normalize(http.body);
      expect(mcp).toEqual(cli);
      expect(httpBody).toEqual(cli);
    });
  }

  it("elimination.list is identically FILTERED across CLI, MCP, and /v1 for a single-entity credential", async () => {
    const op = getOp("elimination.list")!;
    const input = {}; // list all eliminations across periods
    const cli = normalize(callCli(op, input, US_TOKEN)) as { eliminations: Array<{ id: string }> };
    const mcp = normalize(await callMcp(op, input, usMcpHandlers)) as { eliminations: Array<{ id: string }> };
    const http = await callHttp(op, input, US_TOKEN);
    expect(http.status).toBe(200);
    const httpBody = normalize(http.body) as { eliminations: Array<{ id: string }> };
    // All three surfaces must agree on the FILTERED set (not just the owner set).
    expect(mcp).toEqual(cli);
    expect(httpBody).toEqual(cli);
    const usIds = cli.eliminations.map((e) => e.id);
    expect(usIds).toContain(ids.usElim); // US<->group is in scope
    expect(usIds).not.toContain(ids.roElim); // RO<->group is filtered out
    // The all-entity owner sees strictly more (proves filtering actually removed rows).
    const owner = (await callMcp(op, input)) as { eliminations: Array<{ id: string }> };
    const ownerIds = owner.eliminations.map((e) => e.id);
    expect(ownerIds).toContain(ids.roElim);
    expect(owner.eliminations.length).toBeGreaterThan(cli.eliminations.length);
  });

  it("returns identical structured errors across surfaces", async () => {
    const op = getOp("entity.get")!;
    const input = { id: "00000000-0000-4000-8000-000000000000" };
    const cli = callCli(op, input) as { code: string };
    const mcp = (await callMcp(op, input)) as { code: string };
    const http = await callHttp(op, input);
    expect(cli.code).toBe("NOT_FOUND");
    expect(mcp).toEqual(cli);
    expect(http.status).toBe(404);
    expect(normalize(http.body)).toEqual(normalize(cli));
  });
});
