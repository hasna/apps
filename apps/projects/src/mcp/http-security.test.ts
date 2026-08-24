import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSpawnEnv } from "../testing/spawn-env.js";

const BEARER = "projects-mcp-sec-test-bearer-f0158a75";

// The MCP server runs as a SUBPROCESS with an isolated environment, so this
// test file never mutates the shared test process's env or its SQLite
// singleton — sibling test files are unaffected.
const work = mkdtempSync(join(tmpdir(), "projects-mcp-sec-"));

// Collect stdout/stderr lines incrementally; the server never exits, so the
// streams must be consumed rather than drained to EOF.
async function collectLines(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  lines: string[],
): Promise<void> {
  const reader = stream.getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      lines.push(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer) lines.push(buffer);
}


async function nextFreePort(): Promise<number> {
  return new Promise<number>((resolvePort) => {
    const probe = createNetServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

const freePort = await nextFreePort();
const serverProcess = Bun.spawn({
  cmd: ["bun", "run", "src/mcp/index.ts", "--http", "--port", String(freePort)],
  cwd: join(import.meta.dir, "../.."),
  env: testSpawnEnv({
    HASNA_PROJECTS_DB_PATH: join(work, "projects.db"),
    PROJECTS_MCP_TOKEN: BEARER,
  }),
  stdout: "pipe",
  stderr: "pipe",
});

const baseUrl = `http://127.0.0.1:${freePort}`;

const stdoutLines: string[] = [];
void collectLines(serverProcess.stdout, stdoutLines);
const stderrLines: string[] = [];
void collectLines(serverProcess.stderr, stderrLines);

// The bind banner is written to stderr by the server.
async function waitForLine(needle: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = stderrLines.find((line) => line.includes(needle));
    if (found) return found;
    await Bun.sleep(50);
  }
  throw new Error(`projects-mcp subprocess never printed a line containing: ${needle}; stderr: ${stderrLines.join("\n")}`);
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "projects-sec-test", version: "1.0.0" },
  },
};

// Second fixture: the DEFAULT configuration (no PROJECTS_MCP_TOKEN) — the
// shipped loopback-only mode. Local processes must still be served, but a
// DNS-rebinding request (hostile Host header) must be rejected on /mcp.
const defaultPort = await nextFreePort();
const defaultServer = Bun.spawn({
  cmd: ["bun", "run", "src/mcp/index.ts", "--http", "--port", String(defaultPort)],
  cwd: join(import.meta.dir, "../.."),
  env: testSpawnEnv({
    HASNA_PROJECTS_DB_PATH: join(work, "projects-default.db"),
  }),
  stdout: "pipe",
  stderr: "pipe",
});

const defaultBaseUrl = `http://127.0.0.1:${defaultPort}`;

const defaultStdoutLines: string[] = [];
void collectLines(defaultServer.stdout, defaultStdoutLines);
const defaultStderrLines: string[] = [];
void collectLines(defaultServer.stderr, defaultStderrLines);

// The bind banner is written to stderr by the server.
async function waitForDefaultLine(needle: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = defaultStderrLines.find((line) => line.includes(needle));
    if (found) return found;
    await Bun.sleep(50);
  }
  throw new Error(`default-config projects-mcp subprocess never printed a line containing: ${needle}; stderr: ${defaultStderrLines.join("\n")}`);
}

beforeAll(
  async () => {
    // Wait for the token-gated server to answer before any test hits it.
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        const res = await fetch(`${baseUrl}/health`, {
          headers: { Authorization: `Bearer ${BEARER}` },
        });
        if (res.status === 200) {
          await waitForLine(`http://127.0.0.1:${freePort}`);
          return;
        }
      } catch (e) { /* not up yet */ if (attempt < 3) console.log("ready probe err:", String(e).slice(0, 80)); }
      await Bun.sleep(100);
    }
    throw new Error(`projects-mcp subprocess did not become ready; stdout: ${stdoutLines.join("\n")} stderr: ${stderrLines.join("\n")}`);
  },
  { timeout: 30_000 },
);

beforeAll(
  async () => {
    // Wait for the default-config server to answer (no auth needed there).
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        const res = await fetch(`${defaultBaseUrl}/health`);
        if (res.status === 200) {
          await waitForDefaultLine(`http://127.0.0.1:${defaultPort}`);
          return;
        }
      } catch (e) { /* not up yet */ if (attempt < 3) console.log("default ready probe err:", String(e).slice(0, 80)); }
      await Bun.sleep(100);
    }
    throw new Error(`default-config projects-mcp subprocess did not become ready; stdout: ${defaultStdoutLines.join("\n")} stderr: ${defaultStderrLines.join("\n")}`);
  },
  { timeout: 30_000 },
);

afterAll(() => {
  serverProcess.kill();
  defaultServer.kill();
  rmSync(work, { recursive: true, force: true });
});

describe("projects MCP HTTP transport security hardening", () => {
  it("binds the loopback interface only", () => {
    // The startup banner (on stderr) reports the real bind address.
    expect(stderrLines.join("\n")).toContain(`http://127.0.0.1:${freePort}`);
    expect(stderrLines.join("\n")).not.toContain("0.0.0.0");
  });

  it("rejects POST /mcp without the bearer token (401)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(INITIALIZE),
    });
    expect(res.status).toBe(401);
  });

  it("rejects GET /health without the bearer token (401)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(401);
  });

  it("serves the MCP endpoint with the token and rejects a hostile Host header", async () => {
    const ok = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${BEARER}`,
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(ok.status).toBe(200);
    const body = await ok.text();
    const dataLine = body.split("\n").find((line) => line.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.slice("data:".length)) as { result?: unknown };
    expect(payload.result).toBeDefined();

    // DNS-rebinding: a browser-issued request to an attacker-resolved host
    // carries Host: <attacker-domain>, which the SDK transport must reject.
    const rebind = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Host: "evil.example:9999",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${BEARER}`,
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(rebind.status).toBe(403);
  });

  it("rejects a wrong bearer token (401)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(res.status).toBe(401);
  });
});

describe("projects MCP default config (loopback, no token)", () => {
  it("serves the MCP endpoint for local processes on loopback hosts", async () => {
    expect(defaultStderrLines.join("\n")).toContain(`http://127.0.0.1:${defaultPort}`);

    const ok = await fetch(`${defaultBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(ok.status).toBe(200);
    const body = await ok.text();
    const dataLine = body.split("\n").find((line) => line.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.slice("data:".length)) as { result?: unknown };
    expect(payload.result).toBeDefined();
  });

  it("rejects DNS-rebinding Host headers on /mcp even without a token", async () => {
    const rebind = await fetch(`${defaultBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        Host: "evil.example:9999",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(rebind.status).toBe(403);
  });
});
