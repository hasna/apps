import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { OPERATIONS } from "../src/services/registry.js";
import { getIdentity } from "../src/services/identities.js";
import { buildApp } from "../src/server/app.js";
import { authorizeMcpRequest } from "../src/mcp/http.js";
import { registerIdentityTools } from "../src/mcp/tools/identities.js";
import type { AuthorizationContext } from "../src/services/authorization.js";
import { resetDatabase } from "../src/db/database.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

/**
 * Interface-parity harness (BUILD-SPEC §7). The load-bearing convention: the
 * network surfaces are driven under a REAL, NARROWLY-SCOPED, NON-BYPASS
 * credential — not a SYSTEM/bypass context — so this asserts AUTHORIZATION parity,
 * not merely value parity. ONE scoped bearer token is threaded through the SAME
 * `authenticateApiRequest` path for BOTH /v1 (Authorization header) and MCP
 * (authorizeMcpRequest → per-caller context). The local CLI is the local trust
 * boundary and runs as system against the authoritative SQLite store (§CLI).
 */

const cwd = process.cwd();
const TOKEN = "parity-scoped-token";
let dbPath: string;

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

/** A narrowly-scoped, non-bypass serve credential scoped to exactly `entityIds`. */
function configureScopedCredential(entityIds: string[], token = TOKEN): void {
  process.env["HASNA_ACCESS_API_CREDENTIALS"] = JSON.stringify([
    { id: "parity-viewer", token, type: "api_key", roles: ["auditor"], scopes: ["access:read"], entity_ids: entityIds },
  ]);
}

/** Derive the caller principal's context from a bearer token via the unified auth path. */
function contextFor(token = TOKEN): AuthorizationContext {
  const req = new Request("http://127.0.0.1/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const outcome = authorizeMcpRequest(req);
  expect(outcome.ok, "scoped credential should authenticate").toBe(true);
  return outcome.context!;
}

function captureIdentityHandlers(ctx?: AuthorizationContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  registerIdentityTools(
    {
      tool(name: string, _d: string, _s: unknown, handler: Handler) {
        handlers.set(name, handler);
      },
    } as never,
    ctx,
  );
  return handlers;
}

function cli<T>(args: string[]): T {
  const out = execFileSync("bun", ["run", "src/cli/index.tsx", "--json", ...args], {
    cwd,
    env: { ...process.env, HASNA_ACCESS_DB_PATH: dbPath, ACCESS_API_TOKEN: TOKEN },
    encoding: "utf8",
  });
  return JSON.parse(out) as T;
}

function cliError(args: string[]): Record<string, unknown> {
  try {
    cli(args);
  } catch (error) {
    return JSON.parse(String((error as { stdout?: Buffer | string }).stdout ?? "").trim());
  }
  throw new Error("Expected CLI command to fail.");
}

function parseMcp<T>(result: { content: Array<{ type: string; text: string }> }): T {
  return JSON.parse(result.content[0]!.text) as T;
}

function readSources(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
}

beforeEach(() => {
  dbPath = useTestDatabase("access-parity");
});
afterEach(() => {
  cleanupTestDatabase(dbPath);
  delete process.env["HASNA_ACCESS_API_CREDENTIALS"];
});

describe("interface parity", () => {
  it("every registry op is exposed on CLI, MCP, and REST surfaces (generated table)", () => {
    const cliSource = [readFileSync("src/cli/namespaces.ts", "utf8")].join("\n");
    const mcpSource = readSources("src/mcp/tools");
    const routesSource = readSources("src/server/routes");
    for (const { op } of OPERATIONS) {
      expect(cliSource, `${op} missing from CLI`).toContain(`"${op}"`);
      expect(mcpSource, `${op} missing from MCP tools`).toContain(`"${op}"`);
      expect(routesSource, `${op} missing from REST routes`).toContain(`"${op}"`);
    }
  });

  it("service, CLI, REST, and MCP return an equivalent identity read UNDER ONE SCOPED CREDENTIAL", async () => {
    const entityId = randomUUID();
    const created = cli<{ id: string }>(["identity", "create", "--entity-id", entityId, "--kind", "agent", "--name", "parity-bot"]);
    resetDatabase();

    // Same scoped, non-bypass credential threaded through every network surface.
    configureScopedCredential([entityId]);
    const scoped = contextFor();
    expect(scoped.entity_ids).toEqual([entityId]);

    const serviceRead = getIdentity(created.id);
    const cliRead = cli<Record<string, unknown>>(["identity", "get", "--id", created.id]);

    const app = buildApp();
    const restResponse = await app.request(`/v1/identities/${created.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(restResponse.status).toBe(200);
    const restRead = await restResponse.json();

    const mcpRead = parseMcp<Record<string, unknown>>(await captureIdentityHandlers(scoped).get("get_identity")!({ id: created.id }));

    expect(cliRead).toEqual(serviceRead as unknown as Record<string, unknown>);
    expect(restRead).toEqual(serviceRead as unknown as Record<string, unknown>);
    expect(mcpRead).toEqual(serviceRead as unknown as Record<string, unknown>);
  });

  it("service, CLI, REST, and MCP expose equivalent error metadata (NOT_FOUND, under a scoped credential)", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const expected = {
      code: "IDENTITY_NOT_FOUND",
      message: `Identity not found: ${missing}`,
      suggestion: "Use list_identities to find the correct identity id.",
    };
    resetDatabase();
    // Scope the credential to the (deliberately authorized) missing id's context so
    // both surfaces reach NOT_FOUND rather than deny-by-default (§7).
    configureScopedCredential([randomUUID()]);
    const scoped = contextFor();

    const cliErr = cliError(["identity", "get", "--id", missing]);

    const app = buildApp();
    const restResponse = await app.request(`/v1/identities/${missing}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(restResponse.status).toBe(404);
    const restErr = await restResponse.json();

    const mcpErr = parseMcp<Record<string, unknown>>(await captureIdentityHandlers(scoped).get("get_identity")!({ id: missing }));

    expect(restErr).toEqual(expected);
    expect(mcpErr).toEqual(expected);
    expect(cliErr).toEqual({ ...expected, error: expected.message });
  });

  it("an UNSCOPED non-bypass credential is denied on BOTH network surfaces (deny-by-default lock-in)", async () => {
    const entityId = randomUUID();
    const created = cli<{ id: string }>(["identity", "create", "--entity-id", entityId, "--kind", "agent", "--name", "locked"]);
    resetDatabase();

    // Same token, but scoped to NO entity — a valid read scope must NOT grant reach.
    process.env["HASNA_ACCESS_API_CREDENTIALS"] = JSON.stringify([
      { id: "unscoped", token: TOKEN, type: "api_key", roles: ["auditor"], scopes: ["access:read"], entity_ids: [] },
    ]);
    const unscoped = contextFor();
    // Canonical auth collapses an empty allowlist to an absent entity_ids set;
    // either representation is the deny-by-default "no entity reach" state.
    expect(unscoped.entity_ids ?? []).toEqual([]);

    const app = buildApp();
    const restResponse = await app.request(`/v1/identities/${created.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(restResponse.status).toBe(403);
    const restErr = (await restResponse.json()) as Record<string, unknown>;
    expect(restErr.code).toBe("PERMISSION_DENIED");

    const mcpErr = parseMcp<Record<string, unknown>>(await captureIdentityHandlers(unscoped).get("get_identity")!({ id: created.id }));
    expect(mcpErr.code).toBe("PERMISSION_DENIED");
  });

  it("a WRONG-ENTITY non-bypass credential is denied on BOTH network surfaces (knowing an id grants nothing)", async () => {
    const entityA = randomUUID();
    const created = cli<{ id: string }>(["identity", "create", "--entity-id", entityA, "--kind", "agent", "--name", "walled"]);
    resetDatabase();

    // Same valid read scope, but scoped to a DIFFERENT entity — resolving entity A's
    // id must never be sufficient to read entity A's row (§1c).
    configureScopedCredential([randomUUID()]);
    const wrongEntity = contextFor();

    const app = buildApp();
    const restResponse = await app.request(`/v1/identities/${created.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(restResponse.status).toBe(403);
    const restErr = (await restResponse.json()) as Record<string, unknown>;
    expect(restErr.code).toBe("PERMISSION_DENIED");

    const mcpErr = parseMcp<Record<string, unknown>>(await captureIdentityHandlers(wrongEntity).get("get_identity")!({ id: created.id }));
    expect(mcpErr.code).toBe("PERMISSION_DENIED");
  });
});
