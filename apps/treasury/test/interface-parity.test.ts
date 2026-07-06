import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OPS, type OpDef } from "../src/services/registry.js";
import { registerDomainTools } from "../src/mcp/tools/domain.js";
import { createApp } from "../src/server/app.js";
import { openApiDocument } from "../src/api/index.js";
import { seedFixture, scopedPrincipal, configureCredential, clearCredentials, normalize, type Fixture } from "./helpers.js";
import type { ApiPrincipal } from "../src/server/auth.js";

const TOKEN = "parity-token";
let fx: Fixture;
afterEach(() => {
  fx?.cleanup();
  clearCredentials();
});

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function captureMcpHandlers(principal: ApiPrincipal): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fake = {
    tool(name: string, _d: string, _s: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  registerDomainTools(fake, principal, "full");
  return handlers;
}

function parseMcp(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

function valueForField(name: string, fixture: Fixture): unknown {
  const map: Record<string, unknown> = {
    entity_id: fixture.usId,
    id: fixture.sweepId,
    us_entity_id: fixture.usId,
    ro_entity_id: fixture.roId,
    base: "USD",
    base_currency: "USD",
    quote_currency: "GBP",
    rate: 0.8,
    account_ref: "parity-acct",
    account_kind: "bank",
    currency: "USD",
    amount_minor: 12345,
    monthly_burn_minor: 9999,
    name: "Parity Co",
    status: "acknowledged",
    horizon_months: 3,
  };
  return map[name];
}

function inputFor(op: OpDef, fixture: Fixture): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const f of op.fields) {
    const v = valueForField(f.name, fixture);
    if (v !== undefined) input[f.name] = v;
  }
  return input;
}

function httpPath(op: OpDef, input: Record<string, unknown>): string {
  let path = op.http.path;
  for (const f of op.fields) {
    if (f.location === "path") path = path.replace(`:${f.name}`, String(input[f.name]));
  }
  if (op.http.method === "GET") {
    const qs = op.fields
      .filter((f) => f.location === "query" && input[f.name] !== undefined)
      .map((f) => `${f.name}=${encodeURIComponent(String(input[f.name]))}`)
      .join("&");
    if (qs) path += `?${qs}`;
  }
  return path;
}

async function callHttp(op: OpDef, input: Record<string, unknown>): Promise<unknown> {
  const app = createApp();
  const path = httpPath(op, input);
  const init: RequestInit = { method: op.http.method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } };
  if (op.http.method === "POST" || op.http.method === "PATCH") {
    const body: Record<string, unknown> = {};
    for (const f of op.fields) if (f.location === "body" && input[f.name] !== undefined) body[f.name] = input[f.name];
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://treasury.local${path}`, init));
  return res.json();
}

/** Drive the real CLI bin in --json with the scoped token, exactly like a user would. */
function callCli(op: OpDef, input: Record<string, unknown>): unknown {
  const args = ["run", "src/cli/index.tsx", ...op.cli];
  for (const f of op.fields) {
    if (input[f.name] !== undefined) args.push(`--${f.name}`, String(input[f.name]));
  }
  args.push("--json");
  const env = { ...process.env, TREASURY_API_TOKEN: TOKEN } as Record<string, string>;
  return JSON.parse(execFileSync("bun", args, { env, encoding: "utf8" }));
}

describe("interface parity (generated op table)", () => {
  for (const op of OPS) {
    it(`CLI/MCP/API agree for ${op.name}`, async () => {
      fx = await seedFixture();
      const principal = scopedPrincipal([fx.usId, fx.roId], TOKEN);
      configureCredential(principal, TOKEN);
      const input = inputFor(op, fx);

      // The IDENTICAL harness drives ALL THREE surfaces per op (BUILD-SPEC §7):
      // (a) CLI --json, (b) MCP tool handler, (c) /v1 HTTP route.
      const mcp = parseMcp(await captureMcpHandlers(principal).get(op.name)!(input));
      const http = await callHttp(op, input);
      const cli = callCli(op, input);

      // No surface should error on a valid, authorized request.
      expect(mcp, `MCP ${op.name}`).not.toHaveProperty("code");
      expect(http, `HTTP ${op.name}`).not.toHaveProperty("code");
      expect(cli, `CLI ${op.name}`).not.toHaveProperty("code");
      expect(normalize(mcp), `MCP vs HTTP ${op.name}`).toEqual(normalize(http));
      expect(normalize(cli), `CLI vs HTTP ${op.name}`).toEqual(normalize(http));
    });
  }

  it("drives the CLI bin end-to-end and matches the service result (read + write)", async () => {
    fx = await seedFixture();
    const principal = scopedPrincipal([fx.usId, fx.roId], TOKEN);
    configureCredential(principal, TOKEN);
    const env = { ...process.env, TREASURY_API_TOKEN: TOKEN } as Record<string, string>;

    const runway = JSON.parse(
      execFileSync("bun", ["run", "src/cli/index.tsx", "runway", "group", "--base", "USD", "--json"], { env, encoding: "utf8" }),
    );
    const httpRunway = await callHttp(OPS.find((o) => o.name === "group_runway")!, { base: "USD" });
    expect(normalize(runway)).toEqual(normalize(httpRunway));

    const created = JSON.parse(
      execFileSync("bun", ["run", "src/cli/index.tsx", "entities", "create", "--name", "CLI Co", "--base_currency", "USD", "--json"], { env, encoding: "utf8" }),
    );
    expect(created.name).toBe("CLI Co");
    expect(created.entity_id).toMatch(/[0-9a-f-]{36}/);
  });

  it("returns an identical { code, message, suggestion } error envelope across surfaces", async () => {
    fx = await seedFixture();
    const missingId = "00000000-0000-4000-8000-000000000000";
    // Authorize the (non-existent) id so both surfaces reach the NOT_FOUND path
    // rather than deny-by-default — proving error-envelope parity.
    const principal = scopedPrincipal([fx.usId, fx.roId, missingId], TOKEN);
    configureCredential(principal, TOKEN);
    const op = OPS.find((o) => o.name === "get_entity")!;
    const missing = { entity_id: missingId };

    const mcp = parseMcp(await captureMcpHandlers(principal).get("get_entity")!(missing));
    const http = await callHttp(op, missing);
    expect(mcp).toEqual({ code: "ENTITY_NOT_FOUND", message: expect.any(String), suggestion: expect.any(String) });
    expect(http).toEqual(mcp);
  });

  it("OpenAPI advertises every registry operationId", () => {
    const ids = Object.values(openApiDocument().paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    for (const op of OPS) expect(ids).toContain(op.operationId);
    expect(ids).toContain("getHealth");
  });

  it("all three surfaces dispatch through the shared service registry (no per-surface logic)", async () => {
    const { readFileSync } = await import("node:fs");
    const cli = readFileSync("src/cli/namespaces.ts", "utf8");
    const http = readFileSync("src/server/app.ts", "utf8");
    const mcp = readFileSync("src/mcp/tools/domain.ts", "utf8");
    for (const src of [cli, http, mcp]) expect(src).toContain("services/registry.js");
  });
});
