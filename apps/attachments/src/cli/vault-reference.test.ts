import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fixture = { bootstrap: "fixture-bootstrap", first: "fixture-first", rotated: "fixture-rotated", stale: "fixture-stale" };
let home: string;
let server: ReturnType<typeof Bun.serve>;
let mode: string;
let vaultRequests: number;
let attachmentRequests: number;
let correctKeys: boolean;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "attachments-surface-reference-"));
  mode = "ok"; vaultRequests = 0; attachmentRequests = 0; correctKeys = true;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/v1/secrets/get") {
      vaultRequests++;
      correctKeys &&= request.headers.get("x-api-key") === fixture.bootstrap;
      if (mode === "denied") return new Response(null, { status: 403 });
      return Response.json({ key: "fixture/attachments/api-key", value: mode === "rotate" ? fixture.rotated : fixture.first });
    }
    if (path === "/v1/attachments") {
      attachmentRequests++;
      correctKeys &&= request.headers.get("x-api-key") === (mode === "rotate" ? fixture.rotated : fixture.first);
      return Response.json([]);
    }
    return new Response(null, { status: 404 });
  } });
  for (const app of ["attachments", "secrets"]) mkdirSync(join(home, ".hasna", app, "config"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, ".hasna/attachments/config/credentials"),
    `HASNA_ATTACHMENTS_API_URL=${server.url.origin}\nHASNA_ATTACHMENTS_API_KEY_REF=fixture/attachments/api-key\n`, { mode: 0o600 });
  writeFileSync(join(home, ".hasna/secrets/config/credentials"),
    `HASNA_SECRETS_API_URL=${server.url.origin}\nHASNA_SECRETS_API_KEY=${fixture.bootstrap}\n`, { mode: 0o600 });
});

afterEach(() => { server.stop(true); rmSync(home, { recursive: true, force: true }); });

function environment(): Record<string, string> {
  return { HOME: home, PATH: process.env.PATH!, HASNA_STATION: "attachments-reference-fixture", HASNA_ATTACHMENTS_API_KEY: fixture.stale };
}

test("the real CLI resolves a durable reference and refuses vault denial without literal fallback", async () => {
  for (const next of ["ok", "denied"]) {
    mode = next; vaultRequests = 0; attachmentRequests = 0;
    const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "index.ts"), "status"], {
      env: environment(), stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(next === "ok" ? 0 : 1);
    expect(stdout + stderr).toContain(next === "ok" ? "authorized and reachable" : "BLOCKED");
    expect(stdout + stderr).not.toContain(fixture.bootstrap);
    expect(stdout + stderr).not.toContain(fixture.first);
    expect(vaultRequests).toBe(1);
    expect(attachmentRequests).toBe(next === "ok" ? 1 : 0);
    expect(correctKeys).toBe(true);
  }
}, 15_000);

test("a real MCP process refreshes durable references and stops on vault denial", async () => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--no-env-file", join(import.meta.dir, "../mcp/server.ts"), "--stdio"], env: environment(), stderr: "pipe" });
  const client = new Client({ name: "attachments-reference-test", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: 5_000 });
    for (const next of ["ok", "rotate", "denied"]) {
      mode = next; vaultRequests = 0; attachmentRequests = 0;
      const result = await client.callTool({ name: "list_attachments", arguments: { limit: 1 } }, undefined, { timeout: 5_000 });
      expect(Boolean(result.isError)).toBe(next === "denied");
      expect(vaultRequests).toBe(1);
      expect(attachmentRequests).toBe(next === "denied" ? 0 : 1);
      expect(correctKeys).toBe(true);
      expect(JSON.stringify(result)).not.toContain(fixture.bootstrap);
      expect(JSON.stringify(result)).not.toContain(fixture.rotated);
    }
  } finally { await client.close(); await transport.close(); }
}, 20_000);
