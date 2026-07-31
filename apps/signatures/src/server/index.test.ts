import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

type TestServer = {
  baseUrl: string;
  stop(): Promise<void>;
};

const runningServers: TestServer[] = [];

afterEach(async () => {
  const servers = runningServers.splice(0);
  await Promise.all(servers.map((server) => server.stop()));
});

describe("server auth boundaries", () => {
  test("fails closed without an admin token while token signing routes stay public", async () => {
    const server = await startServer();

    const config = await fetch(`${server.baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "pandadoc_api_key", value: "probe" }),
    });
    expect(config.status).toBe(503);
    expect(config.headers.get("www-authenticate")).toContain("signatures-admin");

    const signApi = await fetch(`${server.baseUrl}/api/sign/not-a-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(signApi.status).toBe(404);

    const sameOriginSignApi = await fetch(`${server.baseUrl}/api/sign/not-a-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": server.baseUrl,
      },
      body: "{}",
    });
    expect(sameOriginSignApi.status).toBe(404);

    const signPage = await fetch(`${server.baseUrl}/sign/not-a-token`);
    expect(signPage.status).toBe(404);
  });

  test("requires admin credentials for config, document, and provider-send APIs", async () => {
    const token = "test-admin-token";
    const server = await startServer({ OPEN_SIGNATURES_ADMIN_TOKEN: token });

    const configWithoutAuth = await fetch(`${server.baseUrl}/api/config`);
    expect(configWithoutAuth.status).toBe(401);

    const documentsWithoutAuth = await fetch(`${server.baseUrl}/api/documents`);
    expect(documentsWithoutAuth.status).toBe(401);

    const providerSendWithoutAuth = await fetch(`${server.baseUrl}/api/documents/doc-1/provider-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { email: "ada@example.com" },
        signature_level: "ses",
        dry_run: true,
      }),
    });
    expect(providerSendWithoutAuth.status).toBe(401);

    const configWithAuth = await fetch(`${server.baseUrl}/api/config`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: "pandadoc_api_key", value: "probe" }),
    });
    expect(configWithAuth.status).toBe(200);

    const documentsWithAuth = await fetch(`${server.baseUrl}/api/documents`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    expect(documentsWithAuth.status).toBe(200);
    expect(await documentsWithAuth.json()).toEqual([]);

    const providerSendWithAuth = await fetch(`${server.baseUrl}/api/documents/doc-1/provider-send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { email: "ada@example.com" },
        signature_level: "ses",
        dry_run: true,
      }),
    });
    expect(providerSendWithAuth.status).toBe(404);
  });

  test("rejects untrusted CORS preflights and echoes configured allowed origins", async () => {
    const allowedOrigin = "http://localhost:5173";
    const server = await startServer({
      OPEN_SIGNATURES_ADMIN_TOKEN: "test-admin-token",
      OPEN_SIGNATURES_ALLOWED_ORIGINS: allowedOrigin,
    });

    const rejected = await fetch(`${server.baseUrl}/api/config`, {
      method: "OPTIONS",
      headers: {
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type, authorization",
      },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();

    const accepted = await fetch(`${server.baseUrl}/api/config`, {
      method: "OPTIONS",
      headers: {
        "Origin": allowedOrigin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type, authorization",
      },
    });
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(accepted.headers.get("access-control-allow-headers")).toContain("X-Open-Signatures-Admin-Token");

    const rejectedActual = await fetch(`${server.baseUrl}/api/config`, {
      headers: {
        "Authorization": "Bearer test-admin-token",
        "Origin": "https://evil.example",
      },
    });
    expect(rejectedActual.status).toBe(403);
    expect(rejectedActual.headers.get("access-control-allow-origin")).toBeNull();

    const acceptedActual = await fetch(`${server.baseUrl}/api/config`, {
      headers: {
        "Authorization": "Bearer test-admin-token",
        "Origin": allowedOrigin,
      },
    });
    expect(acceptedActual.status).toBe(200);
    expect(acceptedActual.headers.get("access-control-allow-origin")).toBe(allowedOrigin);

    const sameOrigin = await fetch(`${server.baseUrl}/api/config`, {
      method: "OPTIONS",
      headers: {
        "Origin": server.baseUrl,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(sameOrigin.status).toBe(204);
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBe(server.baseUrl);
  });
});

async function startServer(overrides: Record<string, string> = {}): Promise<TestServer> {
  const port = await getFreePort();
  const dir = mkdtempSync(join(tmpdir(), "signatures-server-"));
  const dbPath = join(dir, "signatures.db");
  const env = cleanEnv({
    PORT: String(port),
    HASNA_SIGNATURES_DB_PATH: dbPath,
    SIGNATURES_DB_PATH: dbPath,
    OPEN_SIGNATURES_ADMIN_TOKEN: "",
    SIGNATURES_ADMIN_TOKEN: "",
    OPEN_SIGNATURES_ALLOWED_ORIGINS: "",
    SIGNATURES_ALLOWED_ORIGINS: "",
    ...overrides,
  });
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "src/server/index.ts"],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const server: TestServer = {
    baseUrl,
    async stop() {
      proc.kill();
      await proc.exited.catch(() => {});
    },
  };
  runningServers.push(server);
  await waitForHealth(baseUrl);
  return server;
}

function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        server.close();
        reject(new Error("Could not allocate a test port"));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 5000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError instanceof Error ? lastError : new Error("Server did not become healthy");
}
