import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { connectorsHome } from "../lib/paths.js";
import { SERVE_TOKEN_FILE, SERVE_UNAUTHORIZED_CODE } from "./serve-auth.js";
import { startServer } from "./serve.js";

/**
 * The security property this file guards: `connectors-serve` NEVER answers a
 * `/api/*` or `/mcp` request without the bearer token, in particular
 * `GET /api/export`, which returns every configured vendor credential.
 *
 * The token here comes from the FILE tier (no env), so the test also proves
 * the server mints one owner-only under the connectors home on first start —
 * the path the CLI, the MCP server and the `./sdk` client read.
 */
describe("connectors-serve authentication gate", () => {
  const ORIGINAL_HOME = process.env.HOME;
  const ORIGINAL_TOKEN = process.env.HASNA_CONNECTORS_SERVE_TOKEN;
  const TEST_HOME = mkdtempSync(join(tmpdir(), "connectors-auth-gate-"));
  let port: number;
  let baseUrl: string;
  let tokenPath: string;
  let token: string;

  beforeAll(async () => {
    process.env.HOME = TEST_HOME;
    delete process.env.HASNA_CONNECTORS_SERVE_TOKEN;
    port = 30000 + Math.floor(Math.random() * 10000);
    port = await startServer(port);
    baseUrl = `http://127.0.0.1:${port}`;
    tokenPath = join(connectorsHome(), SERVE_TOKEN_FILE);
    token = (await Bun.file(tokenPath).text()).trim();
  });

  afterAll(() => {
    if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
    else delete process.env.HOME;
    if (ORIGINAL_TOKEN === undefined) delete process.env.HASNA_CONNECTORS_SERVE_TOKEN;
    else process.env.HASNA_CONNECTORS_SERVE_TOKEN = ORIGINAL_TOKEN;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  test("mints an owner-only token file under the connectors home on first start", () => {
    expect(tokenPath.startsWith(TEST_HOME)).toBe(true);
    expect(existsSync(tokenPath)).toBe(true);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("GET /api/export without a token is refused with 401 and returns no credentials", async () => {
    const res = await fetch(`${baseUrl}/api/export`);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error.startsWith(`${SERVE_UNAUTHORIZED_CODE}:`)).toBe(true);
    expect(body).not.toHaveProperty("connectors");
    expect(JSON.stringify(body)).not.toContain(token);
  });

  test("a wrong token is refused", async () => {
    const res = await fetch(`${baseUrl}/api/export`, { headers: { Authorization: "Bearer not-the-token" } });
    expect(res.status).toBe(401);
  });

  test("POST /api/import and /mcp are gated too", async () => {
    const imp = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectors: { zzz: { profiles: { default: { apiKey: "x" } } } } }),
    });
    expect(imp.status).toBe(401);
    const mcp = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(401);
    const list = await fetch(`${baseUrl}/api/connectors?compact=true`);
    expect(list.status).toBe(401);
  });

  test("the file-tier token is accepted as Bearer and as X-Connectors-Token", async () => {
    const bearer = await fetch(`${baseUrl}/api/export`, { headers: { Authorization: `Bearer ${token}` } });
    expect(bearer.status).toBe(200);
    const data = (await bearer.json()) as { connectors: Record<string, unknown>; exportedAt: string };
    expect(data).toHaveProperty("connectors");
    expect(data).toHaveProperty("exportedAt");

    const header = await fetch(`${baseUrl}/api/connectors?compact=true`, { headers: { "X-Connectors-Token": token } });
    expect(header.status).toBe(200);
  });

  test("/health and the OAuth browser routes stay public; preflights pass", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()) as { status: string; name: string }).toEqual({ status: "ok", name: "connectors" });

    // An unknown connector renders the OAuth error page (200 HTML), not a 401.
    const oauth = await fetch(`${baseUrl}/oauth/zzz-no-such-connector/start`, { redirect: "manual" });
    expect(oauth.status).not.toBe(401);

    const preflight = await fetch(`${baseUrl}/api/export`, { method: "OPTIONS" });
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  test("binds loopback: reachable on 127.0.0.1", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });
});
