import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authenticate, corsHeaders, resolveSecurityConfig } from "./security.js";
import { extensionDispatchRequestSchema, videoStartRequestSchema } from "./schemas.js";

function request(headers?: HeadersInit): Request {
  return new Request("http://127.0.0.1:7030/api/sessions", { headers });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError instanceof Error ? lastError : new Error(`Server did not start: ${base}`);
}

async function withRealServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "browser-real-server-"));
  const dashboard = join(tmp, "dashboard");
  mkdirSync(join(dashboard, "assets"), { recursive: true });
  writeFileSync(join(dashboard, "index.html"), `<!doctype html><script type="module" src="/assets/app.js"></script><main>Dashboard</main>`);
  writeFileSync(join(dashboard, "assets", "app.js"), `window.__browserDashboardLoaded = true;`);

  const port = await getFreePort();
  const proc = Bun.spawn(["bun", "run", "src/server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER_SERVER_PORT: String(port),
      BROWSER_DASHBOARD_DIST: dashboard,
      BROWSER_DB_PATH: join(tmp, "test.db"),
      BROWSER_DATA_DIR: tmp,
      BROWSER_API_KEY: "secret",
      BROWSER_ALLOW_UNAUTHENTICATED: "0",
      BROWSER_AUTH: "1",
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(base);
    return await run(base);
  } finally {
    proc.kill();
    await proc.exited.catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("browser server security", () => {
  it("identifies the browser service on health checks", async () => {
    await withRealServer(async (base) => {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expect.objectContaining({
        status: "ok",
        name: "browser",
      }));
    });
  });

  it("requires explicit auth configuration by default", async () => {
    const config = resolveSecurityConfig({});
    const response = authenticate(request(), config);

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({
      error: "Unauthorized. Set BROWSER_API_KEY or explicitly set BROWSER_ALLOW_UNAUTHENTICATED=1 for local development.",
    });
  });

  it("allows unauthenticated mode only through explicit local-dev opt-in", () => {
    const config = resolveSecurityConfig({ BROWSER_ALLOW_UNAUTHENTICATED: "1" });

    expect(authenticate(request(), config)).toBeNull();
  });

  it("accepts bearer token when an API key is configured", () => {
    const config = resolveSecurityConfig({ BROWSER_API_KEY: "secret" });

    expect(authenticate(request({ Authorization: "Bearer secret" }), config)).toBeNull();
    expect(authenticate(request({ Authorization: "Bearer wrong" }), config)?.status).toBe(401);
  });

  it("does not reflect hostile CORS origins", () => {
    const config = resolveSecurityConfig({});

    expect(corsHeaders("http://127.0.0.1:7030", config)["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:7030");
    expect(corsHeaders("https://example.com", config)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("validates high-risk extension dispatch requests", () => {
    expect(extensionDispatchRequestSchema.safeParse({
      token_id: "token-1",
      job: { id: "job-1", type: "navigate", payload: { url: "https://example.test" } },
    }).success).toBe(true);

    const defaultConnectedExtension = extensionDispatchRequestSchema.safeParse({
      job: { id: "job-1", type: "navigate" },
    });
    expect(defaultConnectedExtension.success).toBe(true);
  });

  it("rejects invalid video start options before capture starts", () => {
    expect(videoStartRequestSchema.safeParse({
      session_id: "session-1",
      quality: "ultra",
      format: "mp4",
      fps: 60,
    }).success).toBe(true);

    expect(videoStartRequestSchema.safeParse({
      session_id: "session-1",
      format: "avi",
    }).success).toBe(false);

    expect(videoStartRequestSchema.safeParse({
      session_id: "session-1",
      capture_mode: "x11",
    }).success).toBe(false);
  });

  it("serves dashboard assets without API auth but keeps API routes protected and JSON-only", async () => {
    await withRealServer(async (base) => {
      const index = await fetch(`${base}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain("Dashboard");

      const asset = await fetch(`${base}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("__browserDashboardLoaded");

      const unauthApi = await fetch(`${base}/api/projects`);
      expect(unauthApi.status).toBe(401);

      const missingApi = await fetch(`${base}/api/nope`, {
        headers: { Authorization: "Bearer secret" },
      });
      expect(missingApi.status).toBe(404);
      expect(missingApi.headers.get("content-type")).toContain("application/json");
      expect(await missingApi.json()).toEqual({ error: "Route not found: GET /api/nope" });
    });
  });

  it("adds CORS headers to authenticated API responses", async () => {
    await withRealServer(async (base) => {
      const response = await fetch(`${base}/api/projects`, {
        headers: {
          Authorization: "Bearer secret",
          Origin: "http://127.0.0.1:3000",
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3000");
    });
  });

  it("returns 404 for missing raw video downloads instead of 500", async () => {
    await withRealServer(async (base) => {
      const response = await fetch(`${base}/api/videos/missing/raw`, {
        headers: { Authorization: "Bearer secret" },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Video not found" });
    });
  });
});
