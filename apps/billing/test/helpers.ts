import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "../src/db/database.js";
import { buildApp } from "../src/server/app.js";
import { registerDomainTools } from "../src/mcp/tools/domain.js";
import { registerStorageTools } from "../src/mcp/tools/storage.js";
import { registerStandardTools } from "../src/mcp/tools/standard.js";
import type { ToolResult } from "../src/mcp/compact.js";
import { authenticateToken, type ApiPrincipal, type ApiCredentialConfig } from "../src/server/auth.js";
import { makeContext } from "../src/services/context.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../src/services/authorization.js";
import { cliInvoke } from "../src/cli/dispatch.js";

export const TEST_ENTITY_A = "11111111-1111-4111-8111-111111111111";
export const TEST_ENTITY_B = "22222222-2222-4222-8222-222222222222";

/** Fresh file-backed DB shared by all surfaces (singleton), cleared each call. */
export function freshDb(): Database {
  closeDatabase();
  resetDatabase();
  const dir = mkdtempSync(join(tmpdir(), "billing-test-"));
  process.env["HASNA_BILLING_DB_PATH"] = join(dir, "billing.db");
  delete process.env["HASNA_BILLING_STORAGE_MODE"];
  delete process.env["HASNA_BILLING_DATABASE_URL"];
  return getDatabase();
}

/** Configure API credentials in the environment (as a deployment would). */
export function setCredentials(creds: ApiCredentialConfig[]): void {
  process.env["HASNA_BILLING_API_CREDENTIALS"] = JSON.stringify(creds);
}

export function clearCredentials(): void {
  delete process.env["HASNA_BILLING_API_CREDENTIALS"];
  delete process.env["HASNA_BILLING_API_KEY"];
}

export function principalFor(token: string): ApiPrincipal {
  const p = authenticateToken(token);
  if (!p) throw new Error(`no principal for token ${token}`);
  return p;
}

/** Minimal MCP tool recorder — captures handlers so tests can invoke them directly. */
export class ToolRecorder {
  handlers = new Map<string, (args: Record<string, unknown>) => Promise<ToolResult>>();
  tool(name: string, _desc: string, _shape: unknown, handler: (args: Record<string, unknown>) => Promise<ToolResult>): void {
    this.handlers.set(name, handler);
  }
}

/** Build a recorder with all tools registered under the given caller principal. */
export function buildRecorder(principal: ApiPrincipal | undefined): ToolRecorder {
  const rec = new ToolRecorder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerStandardTools(rec as any);
  registerStorageTools(rec as any, principal);
  registerDomainTools(rec as any, principal, () => true);
  return rec;
}

/** Drive the MCP surface: call a tool handler, parse its JSON text payload. */
export async function driveMcp(
  rec: ToolRecorder,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; value: unknown }> {
  const handler = rec.handlers.get(toolName);
  if (!handler) throw new Error(`tool not registered: ${toolName}`);
  const result = await handler(args);
  const text = result.content[0]?.text ?? "null";
  return { ok: !result.isError, value: JSON.parse(text) };
}

/** Drive the HTTP surface via Hono app.request with a bearer token. */
export async function driveHttp(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; value: unknown }> {
  const app = buildApp();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  const value = await res.json().catch(() => null);
  return { status: res.status, value };
}

/** Drive the CLI surface via the shared normalized dispatch, with a principal. */
export async function driveCli(
  db: Database,
  opName: string,
  input: unknown,
  principal: ApiPrincipal,
): Promise<{ ok: boolean; value: unknown }> {
  const ctx = makeContext(db, principal);
  const result = await cliInvoke(opName, input, ctx);
  return { ok: result.ok, value: result.ok ? result.data : result.error };
}

/** Seed a row via the service layer under the SYSTEM context. */
export function systemContext(db: Database) {
  return makeContext(db, SYSTEM_AUTHORIZATION_CONTEXT);
}

/** Deep sort object keys for canonical comparison. */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
