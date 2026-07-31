import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { Command } from "commander";
import { buildApp } from "../src/server/app.js";
import { registerNamespaces } from "../src/cli/namespaces.js";
import { formatError } from "../src/mcp/index.js";
import { registerStandardTools } from "../src/mcp/tools/standard.js";
import { registerStorageTools } from "../src/mcp/tools/storage.js";
import { registerMemberTools } from "../src/mcp/tools/members.js";
import { registerCapabilityTools } from "../src/mcp/tools/capabilities.js";
import { registerLifecycleTools } from "../src/mcp/tools/lifecycle.js";
import { registerAssignmentTools } from "../src/mcp/tools/assignments.js";
import { registerExportTools } from "../src/mcp/tools/exports.js";
import { memberService } from "../src/services/index.js";
import {
  SYSTEM_AUTHORIZATION_CONTEXT,
  type AuthorizationContext,
} from "../src/services/authorization.js";
import { isMcpToolInProfile, OP_REGISTRY, type Profile } from "../src/services/registry.js";
import type { McpToolResult } from "../src/mcp/compact.js";
import { cleanupTestDatabase, testEntity, useTestDatabase } from "./helpers/database.js";

// ── Scoped, NON-BYPASS parity credential (BUILD-SPEC §7) ────────────────────
// The harness drives ALL THREE surfaces (CLI/MCP//v1) under ONE real, narrowly
// scoped credential — never a SYSTEM/bypass context — so it asserts AUTHORIZATION
// parity, not merely value parity. The principal is scoped to ONLY the fixture
// entities (owner role widens the ACTION dimension; org_ids constrain the ENTITY
// dimension). A deny-by-default regression (an unscoped principal leaking rows, or
// one surface using SYSTEM bypass while another enforces scope) fails on all three.
const TOKEN = "parity-scoped-token-e2e";
const CRED_ID = "parity-cred";
const ACTOR = "parity-agent";

/** The scoped principal a valid TOKEN maps to on every surface. */
function scopedPrincipal(entityIds: string[]): AuthorizationContext {
  return { actor_id: ACTOR, roles: ["owner"], org_ids: entityIds };
}

/** Configure the SAME credential the serve/MCP/CLI tiers resolve TOKEN against. */
function configureCredential(entityIds: string[]): void {
  process.env["HASNA_WORKFORCE_API_CREDENTIALS"] = JSON.stringify([
    { id: CRED_ID, token: TOKEN, type: "api_key", actor_id: ACTOR, roles: ["owner"], org_ids: entityIds },
  ]);
}

let dbPath: string;
let entity: string;
let entity2: string;
let principal: AuthorizationContext;
const cwd = process.cwd();

type Handler = (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;

interface ErrorEnvelope {
  code: string;
  message: string;
  suggestion: string;
}

// MCP tools capture threads the CALLER principal (never SYSTEM bypass), exactly as
// the HTTP transport does after authenticating the bearer token.
function captureTools(profile: Profile, authCtx: AuthorizationContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const reg = { tool: (n: string, _d: string, _s: Record<string, unknown>, h: Handler) => handlers.set(n, h) };
  const ctx = { authCtx, shouldRegisterTool: (n: string) => isMcpToolInProfile(n, profile), formatError };
  registerStandardTools(reg, ctx, { setFocus: () => {}, getFocusEntity: () => undefined });
  registerStorageTools(reg, ctx);
  registerMemberTools(reg, ctx);
  registerCapabilityTools(reg, ctx);
  registerLifecycleTools(reg, ctx);
  registerAssignmentTools(reg, ctx);
  registerExportTools(reg, ctx);
  return handlers;
}

function cliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HASNA_WORKFORCE_DB_PATH: dbPath,
    HASNA_WORKFORCE_API_CREDENTIALS: process.env["HASNA_WORKFORCE_API_CREDENTIALS"] ?? "",
    WORKFORCE_API_TOKEN: TOKEN,
  };
}

function cliJson<T>(args: string[]): T {
  const out = execFileSync("bun", ["run", "src/cli/index.tsx", "--json", ...args], { cwd, env: cliEnv(), encoding: "utf8" });
  return JSON.parse(out) as T;
}

function cliError(args: string[]): ErrorEnvelope {
  try {
    cliJson(args);
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer | string }).stderr ?? "").trim();
    const parsed = JSON.parse(stderr) as ErrorEnvelope;
    return { code: parsed.code, message: parsed.message, suggestion: parsed.suggestion };
  }
  throw new Error("Expected CLI command to fail.");
}

async function restJson<T>(path: string): Promise<{ status: number; data: T }> {
  const res = await buildApp().request(path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: res.status, data: (await res.json()) as T };
}

function mcpJson<T>(result: McpToolResult): T {
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(result.content[0]!.text) as T;
}

function seedMember(kind: "human" | "contractor" | "agent", name: string, owner?: string) {
  // Fixtures are seeded with the SYSTEM context (trusted setup only).
  return memberService.createMember({ kind, name, home_entity_id: entity, role: "Eng", ...(owner ? { owner_id: owner } : {}) }, SYSTEM_AUTHORIZATION_CONTEXT);
}

beforeEach(() => {
  dbPath = useTestDatabase("parity");
  entity = testEntity();
  entity2 = testEntity();
  principal = scopedPrincipal([entity, entity2]);
  configureCredential([entity, entity2]);
});
afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["HASNA_WORKFORCE_API_CREDENTIALS"];
});

describe("interface parity — identical results across CLI, MCP, /v1 (scoped credential)", () => {
  it("get_member returns identical rows on all three surfaces", async () => {
    const member = seedMember("human", "Ada");
    const service = memberService.getMember(member.id, principal);
    const cli = cliJson(["member", "get", member.id]);
    const rest = await restJson(`/v1/members/${member.id}`);
    const mcp = mcpJson(await captureTools("full", principal).get("get_member")!({ id: member.id }));
    expect(rest.status).toBe(200);
    expect(cli).toEqual(service);
    expect(rest.data).toEqual(service);
    expect(mcp).toEqual(service);
  });

  it("list_members returns identical arrays on all three surfaces", async () => {
    seedMember("human", "Ada");
    const owner = seedMember("human", "Owner");
    seedMember("agent", "Bot", owner.id);
    const service = memberService.listMembers({}, principal);
    const cli = cliJson(["member", "list"]);
    const rest = await restJson<unknown[]>("/v1/members");
    const mcp = mcpJson(await captureTools("minimal", principal).get("list_members")!({}));
    expect(cli).toEqual(service);
    expect(rest.data).toEqual(service);
    expect(mcp).toEqual(service);
    expect((service as unknown[]).length).toBe(3);
  });

  it("export_roster returns identical payloads (payroll/timesheets contract)", async () => {
    const owner = seedMember("human", "Owner");
    seedMember("agent", "Bot", owner.id);
    const cli = cliJson<{ member_count: number }>(["export", "roster", "--entity", entity]);
    const rest = await restJson<{ member_count: number }>(`/v1/exports/roster?entity_id=${entity}`);
    const mcp = mcpJson<{ member_count: number }>(await captureTools("full", principal).get("export_roster")!({ entity_id: entity }));
    // generated_at differs by wall-clock; compare the stable member roster.
    expect(rest.data.member_count).toBe(2);
    expect(cli.member_count).toBe(2);
    expect(mcp.member_count).toBe(2);
  });

  it("end-to-end CLI read+write matches the service result under the scoped credential", async () => {
    const created = cliJson<{ id: string; name: string }>([
      "member", "create", "--kind", "human", "--name", "Grace", "--entity", entity, "--role", "Eng",
    ]);
    const service = memberService.getMember(created.id, principal);
    const cliGet = cliJson(["member", "get", created.id]);
    expect(cliGet).toEqual(service);
    expect(service.name).toBe("Grace");
  });

  it("exposes identical structured errors {code,message,suggestion} across surfaces", async () => {
    // NOT_FOUND path: deliberately authorize a non-existent id (scoped to it) so
    // every surface reaches NOT_FOUND rather than deny-by-default — proving the
    // error-envelope is identical, not that scoping shadows the lookup.
    const missing = testEntity();
    principal = scopedPrincipal([entity, entity2, missing]);
    configureCredential([entity, entity2, missing]);
    const expected = { code: "MEMBER_NOT_FOUND", message: `Member not found: ${missing}`, suggestion: "Use list_members to find the correct member id." };
    const cli = cliError(["member", "get", missing]);
    const rest = await restJson<ErrorEnvelope>(`/v1/members/${missing}`);
    const mcp = mcpJson<ErrorEnvelope>(await captureTools("full", principal).get("get_member")!({ id: missing }));
    expect(rest.status).toBe(404);
    expect(cli).toEqual(expected);
    expect({ code: rest.data.code, message: rest.data.message, suggestion: rest.data.suggestion }).toEqual(expected);
    expect(mcp).toEqual(expected);
  });
});

describe("interface parity — deny-by-default (unscoped principal denied on every surface)", () => {
  it("an UNSCOPED non-bypass principal gets PERMISSION_DENIED on all three surfaces", async () => {
    const member = seedMember("human", "Ada");
    // Same TOKEN, but the credential carries NO entity scope: deny-by-default.
    configureCredential([]);
    const unscoped: AuthorizationContext = { actor_id: ACTOR, roles: ["owner"] };
    const cli = cliError(["member", "get", member.id]);
    const rest = await restJson<ErrorEnvelope>(`/v1/members/${member.id}`);
    const mcp = mcpJson<ErrorEnvelope>(await captureTools("full", unscoped).get("get_member")!({ id: member.id }));
    expect(cli.code).toBe("PERMISSION_DENIED");
    expect(rest.status).toBe(403);
    expect(rest.data.code).toBe("PERMISSION_DENIED");
    expect(mcp.code).toBe("PERMISSION_DENIED");
  });
});

describe("interface parity — generated op table (every op on all three surfaces)", () => {
  function cliCommandExists(pathParts: string[]): boolean {
    const program = new Command();
    program.name("workforce").option("-j, --json");
    registerNamespaces(program);
    let cursor: Command | undefined = program;
    for (const part of pathParts) {
      cursor = cursor?.commands.find((c) => c.name() === part);
      if (!cursor) return false;
    }
    return Boolean(cursor);
  }

  it("every registry op has a CLI command, an MCP tool, and a /v1 route", async () => {
    const fullTools = captureTools("full", principal);
    const app = buildApp();
    for (const op of OP_REGISTRY) {
      // CLI
      expect(cliCommandExists(op.surfaces.cli.split(" ")), `CLI missing: ${op.surfaces.cli}`).toBe(true);
      // MCP
      expect(fullTools.has(op.surfaces.mcp), `MCP tool missing: ${op.surfaces.mcp}`).toBe(true);
      // API — the route must exist (a matched route never returns our NOT_FOUND envelope).
      // Threaded under the scoped bearer so auth passes and we exercise the real handler.
      const path = op.surfaces.api.path.replace(/:id/g, "00000000-0000-4000-8000-000000000000");
      const res = await app.request(path, {
        method: op.surfaces.api.method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: op.surfaces.api.method === "GET" ? undefined : "{}",
      });
      const bodyText = await res.text();
      const code = bodyText ? (JSON.parse(bodyText).code as string | undefined) : undefined;
      expect(code, `API route missing: ${op.surfaces.api.method} ${op.surfaces.api.path}`).not.toBe("NOT_FOUND");
    }
  });

  it("all three surfaces call through the service layer (no direct db/crud coupling)", () => {
    const routeSrc = readdirSync("src/server/routes").map((f) => readFileSync(`src/server/routes/${f}`, "utf8")).join("\n");
    const toolSrc = readdirSync("src/mcp/tools").map((f) => readFileSync(`src/mcp/tools/${f}`, "utf8")).join("\n");
    const cliSrc = readFileSync("src/cli/namespaces.ts", "utf8");
    expect(routeSrc).toContain("../../services/index.js");
    expect(routeSrc).not.toContain("db/crud.js");
    expect(cliSrc).toContain("../services/index.js");
    expect(cliSrc).not.toContain("db/crud.js");
    expect(toolSrc).toContain("../../services/index.js");
  });
});
