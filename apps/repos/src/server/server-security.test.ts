import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, connect as tcpConnect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { isLoopbackHostname } from "./loopback.js";

const BEARER = "repos-serve-sec-test-bearer-4ba41137";

// The server runs as a SUBPROCESS with an isolated environment (the repro's
// shape), so this test file never mutates the shared test process's env or
// its SQLite singleton — sibling test files are unaffected.
const work = mkdtempSync(join(tmpdir(), "repos-serve-sec-"));
const home = join(work, "home");
const rootsDir = join(work, "roots");
const attackRoot = join(work, "attack-root");
mkdirSync(join(home, ".hasna", "repos"), { recursive: true });
mkdirSync(rootsDir, { recursive: true });
mkdirSync(join(attackRoot, "fakerepo"), { recursive: true });

// A real git repository the scanner would install a post-commit hook into,
// matching the repro's attacker-chosen root.
execFileSync("git", ["init", "-q", join(attackRoot, "fakerepo")]);

// A second real git repository used by the authorized local scan path in the
// default (no-token) configuration, kept separate from the attacker root so
// the "never touches the attacker-chosen roots" assertions stay independent.
const localRoot = join(work, "local-root");
mkdirSync(join(localRoot, "fakerepo"), { recursive: true });
execFileSync("git", ["init", "-q", join(localRoot, "fakerepo")]);

writeFileSync(join(work, "config.json"), JSON.stringify({ workspaceRoots: [rootsDir] }));

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
  cmd: ["bun", "run", "src/server/index.ts"],
  cwd: join(import.meta.dir, "../.."),
  env: {
    ...process.env,
    HOME: home,
    REPOS_PORT: String(freePort),
    REPOS_SERVE_TOKEN: BEARER,
    HASNA_REPOS_DB_PATH: join(work, "repos.db"),
    HASNA_REPOS_CONFIG_PATH: join(work, "config.json"),
    HASNA_REPOS_HOOK_QUEUE_PATH: join(work, "hook-events.tsv"),
  },
  stdout: "pipe",
  stderr: "pipe",
});

const baseUrl = `http://127.0.0.1:${freePort}`;

// Collect the subprocess's stdout line by line; the server never exits, so
// the stream must be consumed incrementally rather than drained to EOF.
const stdoutLines: string[] = [];
const stdoutReader = (async () => {
  let buffer = "";
  for await (const chunk of serverProcess.stdout) {
    buffer += new TextDecoder().decode(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      stdoutLines.push(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer) stdoutLines.push(buffer);
})();

async function waitForLine(needle: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = stdoutLines.find((line) => line.includes(needle));
    if (found) return found;
    await Bun.sleep(50);
  }
  throw new Error(`repos-serve subprocess never printed a line containing: ${needle}`);
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "repos-sec-test", version: "1.0.0" },
  },
};

// Second server fixture: the DEFAULT configuration (no REPOS_SERVE_TOKEN) —
// the shipped loopback-only mode. Local processes must still be served, but a
// DNS-rebinding request (hostile Host header) must be rejected on every route,
// /api included — not only on /mcp where the SDK provides the check.
const defaultPort = await nextFreePort();
const defaultServer = Bun.spawn({
  cmd: ["bun", "run", "src/server/index.ts"],
  cwd: join(import.meta.dir, "../.."),
  env: {
    ...process.env,
    HOME: home,
    REPOS_PORT: String(defaultPort),
    HASNA_REPOS_DB_PATH: join(work, "repos-default.db"),
    HASNA_REPOS_CONFIG_PATH: join(work, "config.json"),
    HASNA_REPOS_HOOK_QUEUE_PATH: join(work, "hook-events-default.tsv"),
  },
  stdout: "pipe",
  stderr: "pipe",
});

const defaultBaseUrl = `http://127.0.0.1:${defaultPort}`;

const defaultStdoutLines: string[] = [];
const defaultStdoutReader = (async () => {
  let buffer = "";
  for await (const chunk of defaultServer.stdout) {
    buffer += new TextDecoder().decode(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      defaultStdoutLines.push(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer) defaultStdoutLines.push(buffer);
})();

async function waitForDefaultLine(needle: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = defaultStdoutLines.find((line) => line.includes(needle));
    if (found) return found;
    await Bun.sleep(50);
  }
  throw new Error(`default-config repos-serve subprocess never printed a line containing: ${needle}`);
}

beforeAll(async () => {
  // Wait for the token-gated server to answer before any test hits it.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: `Bearer ${BEARER}` },
      });
      if (res.status === 200) {
        await waitForLine(`http://127.0.0.1:${freePort}`);
        return;
      }
    } catch { /* not up yet */ }
    await Bun.sleep(100);
  }
  throw new Error(`repos-serve subprocess did not become ready; stdout: ${stdoutLines.join("\n")}`);
});

beforeAll(async () => {
  // Wait for the default-config server to answer (no auth needed there).
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`${defaultBaseUrl}/api/health`);
      if (res.status === 200) {
        await waitForDefaultLine(`http://127.0.0.1:${defaultPort}`);
        return;
      }
    } catch { /* not up yet */ }
    await Bun.sleep(100);
  }
  throw new Error(`default-config repos-serve subprocess did not become ready; stdout: ${defaultStdoutLines.join("\n")}`);
});

afterAll(() => {
  serverProcess.kill();
  defaultServer.kill();
  rmSync(work, { recursive: true, force: true });
});

describe("repos-serve security hardening", () => {
  it("binds the loopback interface only, never 0.0.0.0", () => {
    // The startup banner reports the real bind address.
    expect(stdoutLines.join("\n")).toContain(`http://127.0.0.1:${freePort}`);
    expect(stdoutLines.join("\n")).not.toContain("0.0.0.0");
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);

    // Where a non-loopback interface exists, a connect to the server's port
    // on the LAN address must be refused — proof the socket is loopback-only.
    const lanAddress = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry && !entry.internal && entry.family === "IPv4")?.address;
    if (lanAddress) {
      const refused = new Promise<boolean>((resolve) => {
        const socket = tcpConnect({ host: lanAddress, port: freePort, timeout: 1500 });
        socket.once("connect", () => {
          socket.destroy();
          resolve(false);
        });
        socket.once("timeout", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(true));
      });
      expect(refused).resolves.toBe(true);
    }
  });

  it("serves API responses without wildcard CORS headers", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${BEARER}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
    expect(res.headers.get("access-control-allow-headers")).toBeNull();

    const preflight = await fetch(`${baseUrl}/api/repos`, {
      method: "OPTIONS",
      headers: { Authorization: `Bearer ${BEARER}` },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects POST /api/scan without the bearer token and never touches the attacker-chosen roots", async () => {
    const res = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roots: [attackRoot] }),
    });
    expect(res.status).toBe(401);
    // The bootstrap never ran: no executable post-commit hook was installed
    // into the git repository the attacker named.
    expect(existsSync(join(attackRoot, "fakerepo", ".git", "hooks", "post-commit"))).toBe(false);
    expect(existsSync(join(work, "hook-events.tsv"))).toBe(false);
  });

  it("rejects POST /mcp without the bearer token (401)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(INITIALIZE),
    });
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

  it("rejects a hostile Host header on /api routes too (DNS rebinding)", async () => {
    // The same rebinding request against /api must not reach the route: the
    // server-level Host allowlist covers every route, not only /mcp.
    const health = await fetch(`${baseUrl}/api/health`, {
      headers: { Host: "evil.example:9999", Authorization: `Bearer ${BEARER}` },
    });
    expect(health.status).toBe(403);

    const scan = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: {
        Host: "evil.example:9999",
        "Content-Type": "application/json",
        Authorization: `Bearer ${BEARER}`,
      },
      body: JSON.stringify({ roots: [attackRoot] }),
    });
    expect(scan.status).toBe(403);
    // The attacker-chosen root was never touched.
    expect(existsSync(join(attackRoot, "fakerepo", ".git", "hooks", "post-commit"))).toBe(false);
  });
});

describe("repos-serve default config (loopback, no token)", () => {
  it("serves the API for local processes on loopback hosts", async () => {
    // The default config is the shipped loopback-only mode: the banner must
    // report the loopback bind.
    expect(defaultStdoutLines.join("\n")).toContain(`http://127.0.0.1:${defaultPort}`);

    const health = await fetch(`${defaultBaseUrl}/api/health`);
    expect(health.status).toBe(200);

    // A local process with the loopback Host may still scan — that is the
    // intended local tooling path.
    const scan = await fetch(`${defaultBaseUrl}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roots: [localRoot] }),
    });
    expect(scan.status).toBe(200);
    expect(existsSync(join(localRoot, "fakerepo", ".git", "hooks", "post-commit"))).toBe(true);
  });

  it("rejects DNS-rebinding Host headers on every route, /api included", async () => {
    // A rebinding page's same-origin request carries Host: <attacker-domain>
    // and bypasses CORS entirely; without a server-level Host check on /api,
    // it could read the registry and install executable hooks via /api/scan.
    const health = await fetch(`${defaultBaseUrl}/api/health`, {
      headers: { Host: "evil.example:9999" },
    });
    expect(health.status).toBe(403);

    const scan = await fetch(`${defaultBaseUrl}/api/scan`, {
      method: "POST",
      headers: { Host: "evil.example:9999", "Content-Type": "application/json" },
      body: JSON.stringify({ roots: [attackRoot] }),
    });
    expect(scan.status).toBe(403);
    expect(existsSync(join(attackRoot, "fakerepo", ".git", "hooks", "post-commit"))).toBe(false);
    expect(existsSync(join(work, "hook-events-default.tsv"))).toBe(false);

    const mcp = await fetch(`${defaultBaseUrl}/mcp`, {
      method: "POST",
      headers: {
        Host: "evil.example:9999",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(mcp.status).toBe(403);
  });
});
