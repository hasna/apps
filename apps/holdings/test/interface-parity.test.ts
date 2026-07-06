import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import { openDatabase } from "../src/db/database.js";
import { createApp } from "../src/server/app.js";
import { systemContext, type ServiceContext } from "../src/services/runtime.js";
import { invokeOp, OP_REGISTRY } from "../src/services/registry.js";
import { seedEntity } from "../src/services/entities.js";
import { createAsset } from "../src/services/assets.js";
import { createRegistration } from "../src/services/registrations.js";
import { createRenewal } from "../src/services/renewals.js";
import { createClass } from "../src/services/classes.js";
import { createDocument } from "../src/services/documents.js";
import { authenticateBearer, type ApiPrincipal } from "../src/server/auth.js";
import { openApiDocument } from "../src/api/index.js";
import { captureMcpHandlers, parseMcp } from "./helpers/harness.js";

interface ErrEnvelope {
  code: string;
  message: string;
  suggestion: string;
}

// The parity harness runs under a REAL, NARROWLY-SCOPED, NON-BYPASS credential
// (BUILD-SPEC §7): the SAME token is threaded into every surface — MCP via a
// scoped ApiPrincipal, HTTP via `Authorization: Bearer`, CLI via HOLDINGS_API_TOKEN —
// scoped to ONLY the fixture entity (no bypass, no wildcard). So a deny-by-default
// regression (an unscoped principal leaking cross-entity rows, or one surface
// using SYSTEM bypass while another enforces scope) fails on ALL surfaces
// identically. The service call under systemContext is the reference oracle.
const SCOPED_TOKEN = "parity-scoped-token";
const UNSCOPED_TOKEN = "parity-unscoped-token";
const CRED_ENV = "HASNA_HOLDINGS_API_CREDENTIALS";

let tmp: string;
let dbPath: string;
let db: Database;
let ctx: ServiceContext;
let app: Hono;
let handlers: ReturnType<typeof captureMcpHandlers>;
let entityId: string;
let assetId: string;
let renewalId: string;
let savedCredEnv: string | undefined;

// Canonicalize a value: recursively sort object keys so structural equality holds.
function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canon((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function cliJson<T>(args: string[], token = SCOPED_TOKEN): T {
  const out = execFileSync("bun", ["run", "src/cli/index.tsx", "--json", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, HASNA_HOLDINGS_DB_PATH: dbPath, HOLDINGS_API_TOKEN: token },
    encoding: "utf8",
  });
  return JSON.parse(out.trim()) as T;
}

function cliError(args: string[], token = SCOPED_TOKEN): ErrEnvelope {
  try {
    cliJson(args, token);
  } catch (error) {
    const stdout = String((error as { stdout?: Buffer | string }).stdout ?? "").trim();
    const parsed = JSON.parse(stdout) as ErrEnvelope;
    return { code: parsed.code, message: parsed.message, suggestion: parsed.suggestion };
  }
  throw new Error("Expected CLI command to fail.");
}

async function rest<T>(method: string, path: string, token = SCOPED_TOKEN): Promise<{ status: number; data: T }> {
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, data: (await res.json()) as T };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "holdings-parity-"));
  dbPath = join(tmp, "holdings.db");
  db = openDatabase(dbPath);
  ctx = systemContext(db);
  const entity = seedEntity(ctx, { entity_slug: "parity-co", name: "Parity Co" });
  entityId = entity.entity_id;
  const asset = createAsset(ctx, { entity_id: entityId, kind: "trademark", name: "PARITY" });
  assetId = asset.id;
  createRegistration(ctx, { asset_id: assetId, jurisdiction: "US", office: "USPTO" });
  const renewal = createRenewal(ctx, { asset_id: assetId, due_date: "2026-08-01" });
  renewalId = renewal.id;
  createClass(ctx, { asset_id: assetId, nice_class: 9 });
  createDocument(ctx, { asset_id: assetId, title: "Filing" });

  // Mint a scoped (entity_ids = [entityId]), non-bypass credential and configure
  // it so ALL THREE surfaces resolve the SAME principal from the SAME token.
  savedCredEnv = process.env[CRED_ENV];
  process.env[CRED_ENV] = JSON.stringify([
    { id: "scoped", token: SCOPED_TOKEN, roles: ["holdings_manager"], entity_ids: [entityId] },
    { id: "unscoped", token: UNSCOPED_TOKEN, roles: ["holdings_manager"] },
  ]);

  app = createApp({ db, bindHost: "127.0.0.1", mode: "local" });
  const scopedPrincipal = authenticateBearer(SCOPED_TOKEN)!;
  handlers = captureMcpHandlers(db, scopedPrincipal);
});

afterEach(() => {
  if (savedCredEnv === undefined) delete process.env[CRED_ENV];
  else process.env[CRED_ENV] = savedCredEnv;
  rmSync(tmp, { recursive: true, force: true });
});

describe("interface parity", () => {
  it("asset.get returns identical results across service, CLI, REST, and MCP", async () => {
    const svc = invokeOp(ctx, "asset.get", { id: assetId });
    const cli = cliJson(["asset", "get", "--id", assetId]);
    const restRes = await rest(`GET`, `/v1/assets/${assetId}`);
    const mcp = parseMcp(await handlers.get("get_asset")!({ id: assetId }));

    expect(restRes.status).toBe(200);
    const expected = canon(svc);
    expect(canon(cli)).toEqual(expected);
    expect(canon(restRes.data)).toEqual(expected);
    expect(canon(mcp)).toEqual(expected);
  });

  it("renewal.upcoming returns identical results across all four surfaces", async () => {
    const args = { within_days: 3650, as_of: "2026-07-06" };
    const svc = invokeOp(ctx, "renewal.upcoming", args);
    const cli = cliJson(["renewal", "upcoming", "--within-days", "3650", "--as-of", "2026-07-06"]);
    const restRes = await rest(`GET`, `/v1/renewals/upcoming?within_days=3650&as_of=2026-07-06`);
    const mcp = parseMcp(await handlers.get("upcoming_renewals")!(args));

    const expected = canon(svc);
    expect(canon(cli)).toEqual(expected);
    expect(canon(restRes.data)).toEqual(expected);
    expect(canon(mcp)).toEqual(expected);
  });

  it("entity.list returns identical results across all four surfaces", async () => {
    const svc = invokeOp(ctx, "entity.list", {});
    const cli = cliJson(["entity", "list"]);
    const restRes = await rest("GET", "/v1/entities");
    const mcp = parseMcp(await handlers.get("list_entities")!({}));
    const expected = canon(svc);
    expect(canon(cli)).toEqual(expected);
    expect(canon(restRes.data)).toEqual(expected);
    expect(canon(mcp)).toEqual(expected);
  });

  it("end-to-end CLI read+write under the scoped credential matches the service result", async () => {
    // Update via CLI (write scope) then read back via the service oracle.
    const updated = cliJson<{ id: string; status: string }>(["asset", "update", "--id", assetId, "--status", "registered"]);
    expect(updated.status).toBe("registered");
    const svc = invokeOp(ctx, "asset.get", { id: assetId }) as { status: string };
    expect(svc.status).toBe("registered");
  });

  it("exposes identical structured errors {code,message,suggestion} across all four surfaces", async () => {
    const missing = "99999999-9999-4999-8999-999999999999";
    const expected: ErrEnvelope = {
      code: "ASSET_NOT_FOUND",
      message: `asset not found: ${missing}`,
      suggestion: "Use the list command/tool to find a valid asset id.",
    };

    let svcErr: ErrEnvelope | undefined;
    try {
      invokeOp(ctx, "asset.get", { id: missing });
    } catch (e) {
      const err = e as { code: string; message: string; suggestion: string };
      svcErr = { code: err.code, message: err.message, suggestion: err.suggestion };
    }
    const cliErr = cliError(["asset", "get", "--id", missing]);
    const restErr = await rest<ErrEnvelope>("GET", `/v1/assets/${missing}`);
    const mcpErr = parseMcp<ErrEnvelope>(await handlers.get("get_asset")!({ id: missing }));

    expect(svcErr).toEqual(expected);
    expect(cliErr).toEqual(expected);
    expect(restErr.status).toBe(404);
    expect({ code: restErr.data.code, message: restErr.data.message, suggestion: restErr.data.suggestion }).toEqual(expected);
    expect(mcpErr).toEqual(expected);
  });

  it("deny-by-default: an UNSCOPED non-bypass principal is denied on ALL surfaces", async () => {
    // Same valid token model, but scoped to NO entity → must PERMISSION_DENY the
    // fixture asset on every surface (never leak, never bypass).
    const unscoped = authenticateBearer(UNSCOPED_TOKEN)!;
    const unscopedHandlers = captureMcpHandlers(db, unscoped);

    const cliErr = cliError(["asset", "get", "--id", assetId], UNSCOPED_TOKEN);
    expect(cliErr.code).toBe("PERMISSION_DENIED");

    const restErr = await rest<ErrEnvelope>("GET", `/v1/assets/${assetId}`, UNSCOPED_TOKEN);
    expect(restErr.status).toBe(403);
    expect(restErr.data.code).toBe("PERMISSION_DENIED");

    const mcpRes = await unscopedHandlers.get("get_asset")!({ id: assetId });
    expect(mcpRes.isError).toBe(true);
    expect(mcpRes.content[0]!.text).toContain("PERMISSION_DENIED");
  });

  it("generated table: every op is exposed on CLI, MCP, and REST with matching metadata", () => {
    for (const def of OP_REGISTRY) {
      // CLI: namespace + command present.
      expect(def.cli.length).toBe(2);
      // MCP: tool handler registered under the full profile.
      expect(handlers.has(def.mcpTool), `mcp tool ${def.mcpTool}`).toBe(true);
      // REST: path present in the OpenAPI document.
      const path = def.api.path.replace(/:([A-Za-z_]+)/g, "{$1}");
      expect(openApiDocument.paths[path]?.[def.api.method.toLowerCase()], `rest ${def.op}`).toBeDefined();
    }
  });

  it("all three surfaces dispatch through the shared service registry (never db/crud directly)", () => {
    const files = [
      "src/server/routes/shared.ts",
      "src/cli/namespaces.ts",
      "src/mcp/tools/domain.ts",
    ].map((f) => readFileSync(f, "utf8"));
    for (const source of files) {
      expect(source).toContain("services/registry.js");
      expect(source).not.toContain("db/crud.js");
    }
    void renewalId;
    void entityId;
  });
});
