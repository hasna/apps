import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  authorizeRequest,
  corsHeadersForRequest,
  isAllowedCorsOrigin,
  isLoopbackHost,
  isSensitiveRequest,
  resolveSecurityConfig,
  resolveServeHost,
} from "../src/server/security.js";

const repoRoot = resolve(import.meta.dir, "..");

function request(path: string, headers?: HeadersInit): Request {
  return new Request(`http://127.0.0.1:19450${path}`, { headers });
}

function methodRequest(method: string, path: string, headers?: HeadersInit): Request {
  return new Request(`http://127.0.0.1:19450${path}`, { method, headers });
}

async function waitForHealth(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200) return true;
    } catch {}
    await Bun.sleep(50);
  }
  return false;
}

async function startTestServer(
  port: number,
  dir: string,
  envOverrides: Record<string, string | undefined> = {},
): Promise<ReturnType<typeof Bun.spawn>> {
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/server/index.ts"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      COMPUTER_HOST: "127.0.0.1",
      COMPUTER_PORT: String(port),
      COMPUTER_API_KEY: "test-computer-api-key",
      COMPUTER_ALLOW_UNAUTHENTICATED: "0",
      COMPUTER_DB_PATH: join(dir, "computer.db"),
      COMPUTER_DATA_DIR: dir,
      ...envOverrides,
    },
  });
  if (!(await waitForHealth(port))) {
    child.kill();
    await child.exited.catch(() => {});
    throw new Error(`test computer server did not become healthy on ${port}`);
  }
  return child;
}

describe("server security defaults", () => {
  test("binds to loopback by default", () => {
    expect(resolveServeHost({})).toBe("127.0.0.1");
    expect(resolveServeHost({ COMPUTER_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  test("requires authentication for sensitive endpoints by default", () => {
    const config = resolveSecurityConfig({}, 19450);
    const decision = authorizeRequest(request("/action"), config);

    expect(isSensitiveRequest("POST", "/action")).toBe(true);
    expect(isSensitiveRequest("POST", "/emergency-stop")).toBe(true);
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("treats every control-plane endpoint as sensitive", () => {
    const cases: Array<[string, string]> = [
      ["POST", "/run"],
      ["POST", "/action"],
      ["GET", "/screenshot"],
      ["GET", "/stats"],
      ["GET", "/sessions"],
      ["DELETE", "/sessions/session-id"],
      ["POST", "/sessions/session-id/cancel"],
      ["POST", "/emergency-stop"],
      ["POST", "/mcp"],
      ["POST", "/future-control-plane-route"],
    ];

    for (const [method, path] of cases) {
      expect(isSensitiveRequest(method, path), `${method} ${path}`).toBe(true);
    }
  });

  test("accepts bearer and explicit API key headers", () => {
    const config = resolveSecurityConfig({ COMPUTER_API_KEY: "secret" }, 19450);

    expect(authorizeRequest(request("/run", { Authorization: "Bearer secret" }), config).ok).toBe(true);
    expect(authorizeRequest(request("/run", { "X-Computer-API-Key": "secret" }), config).ok).toBe(true);
    expect(authorizeRequest(request("/run", { Authorization: "Bearer wrong" }), config).ok).toBe(false);
  });

  test("allows health checks without authentication", () => {
    const config = resolveSecurityConfig({}, 19450);
    expect(authorizeRequest(request("/health"), config).ok).toBe(true);
  });

  test("requires explicit opt-in for unauthenticated local development", () => {
    const config = resolveSecurityConfig({ COMPUTER_ALLOW_UNAUTHENTICATED: "1" }, 19450);
    expect(authorizeRequest(request("/mcp"), config).ok).toBe(true);
  });

  test("fails closed for unknown mutating routes", () => {
    const config = resolveSecurityConfig({ COMPUTER_API_KEY: "secret" }, 19450);
    const decision = authorizeRequest(methodRequest("POST", "/future-control-plane-route"), config);

    expect(isSensitiveRequest("POST", "/future-control-plane-route")).toBe(true);
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("rejects unauthenticated mode when bound to non-loopback", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);

    const config = resolveSecurityConfig(
      { COMPUTER_ALLOW_UNAUTHENTICATED: "1", COMPUTER_HOST: "0.0.0.0" },
      19450,
      "0.0.0.0",
    );
    const decision = authorizeRequest(request("/run"), config);

    expect(config.allowUnauthenticated).toBe(false);
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("does not emit wildcard CORS by default", () => {
    const config = resolveSecurityConfig({}, 19450);
    const allowed = request("/action", { Origin: "http://127.0.0.1:19450" });
    const denied = request("/action", { Origin: "https://example.com" });

    expect(isAllowedCorsOrigin("http://127.0.0.1:19450", config)).toBe(true);
    expect(isAllowedCorsOrigin("https://example.com", config)).toBe(false);
    expect(corsHeadersForRequest(allowed, config)).toEqual({
      Vary: "Origin",
      "Access-Control-Allow-Origin": "http://127.0.0.1:19450",
    });
    expect(corsHeadersForRequest(denied, config)).toEqual({ Vary: "Origin" });
  });

  test("rejects wildcard CORS origins even when configured", () => {
    const config = resolveSecurityConfig({ COMPUTER_CORS_ORIGINS: "*" }, 19450);
    const denied = request("/action", { Origin: "https://example.com" });

    expect(isAllowedCorsOrigin("https://example.com", config)).toBe(false);
    expect(corsHeadersForRequest(denied, config)).toEqual({ Vary: "Origin" });
  });

  test("running dashboard API rejects unauthenticated mutating browser requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "computer-server-security-"));
    const port = 23000 + Math.floor(Math.random() * 20000);
    const child = await startTestServer(port, dir);
    try {
      const origin = `http://127.0.0.1:${port}`;
      const cases: Array<{ method: string; path: string; body?: unknown }> = [
        { method: "POST", path: "/run", body: { task: "security test" } },
        { method: "POST", path: "/action", body: { type: "wait", ms: 1 } },
        { method: "POST", path: "/emergency-stop", body: { reason: "security test" } },
        { method: "POST", path: "/sessions/session-id/pause", body: { reason: "security test" } },
        { method: "POST", path: "/sessions/session-id/resume", body: {} },
        { method: "POST", path: "/sessions/session-id/cancel", body: { reason: "security test" } },
        { method: "DELETE", path: "/sessions/session-id" },
        { method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } },
      ];

      for (const current of cases) {
        const unauthenticated = await fetch(`${origin}${current.path}`, {
          method: current.method,
          headers: {
            "content-type": "application/json",
            origin,
          },
          body: current.body === undefined ? undefined : JSON.stringify(current.body),
        });
        expect(unauthenticated.status, `${current.method} ${current.path}`).toBe(401);
        expect(unauthenticated.headers.get("Access-Control-Allow-Origin")).toBe(origin);
        expect(await unauthenticated.json()).toMatchObject({ error: expect.stringContaining("Invalid or missing") });
      }

      const authenticated = await fetch(`${origin}/emergency-stop`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-computer-api-key",
          origin,
        },
        body: JSON.stringify({ reason: "security test" }),
      });
      expect(authenticated.status).toBe(200);
      expect(await authenticated.json()).toMatchObject({ active: true, reason: "security test" });
    } finally {
      child.kill();
      await child.exited.catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("local unauthenticated mode still rejects hostile browser origins before side effects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "computer-server-csrf-"));
    const port = 23000 + Math.floor(Math.random() * 20000);
    const child = await startTestServer(port, dir, {
      COMPUTER_ALLOW_UNAUTHENTICATED: "1",
      COMPUTER_API_KEY: "",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const hostile = await fetch(`${base}/emergency-stop`, {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ reason: "csrf" }),
      });
      expect(hostile.status).toBe(403);
      expect(hostile.headers.get("Access-Control-Allow-Origin")).toBeNull();

      const state = await fetch(`${base}/emergency-stop`, {
        headers: { origin: base },
      });
      expect(state.status).toBe(200);
      expect(await state.json()).toMatchObject({ active: false });
    } finally {
      child.kill();
      await child.exited.catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
