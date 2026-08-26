import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join } from "path";

const AUTH_FIXTURE = "test-api-key-123";

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP port allocated"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForStartup(child: ChildProcess, timeoutMs = 8_000): Promise<void> {
  const stderrChunks: string[] = [];
  child.stderr?.on("data", (c: Buffer) => stderrChunks.push(String(c)));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("REST test server did not start")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`REST test server exited early (${code}): ${stderrChunks.join("")}`));
    });
    child.stdout?.on("data", (chunk) => {
      if (String(chunk).includes("security dashboard")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function serverEnv(tempDir: string, port: number, extra: Record<string, string> = {}) {
  return {
    ...process.env,
    PORT: String(port),
    HOME: tempDir,
    USERPROFILE: tempDir,
    SECURITY_DB: join(tempDir, "shield.db"),
    CEREBRAS_API_KEY: "",
    ...extra,
  };
}

describe("REST API authentication and bind posture", () => {
  let tempDir: string;
  let child: ChildProcess | null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shield-api-auth-"));
    child = null;
  });

  afterEach(() => {
    child?.kill("SIGTERM");
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("POST /api/scans rejects requests without the configured API key and accepts it", async () => {
    const port = await availablePort();
    child = spawn("bun", ["run", "src/server/index.ts"], {
      cwd: process.cwd(),
      env: serverEnv(tempDir, port, { SECURITY_API_KEY: AUTH_FIXTURE, SECURITY_SCAN_ROOTS: tempDir }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForStartup(child);

    const body = JSON.stringify({ path: tempDir });

    const anonymous = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(anonymous.status).toBe(401);

    const wrongKey = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "wrong-key" },
      body,
    });
    expect(wrongKey.status).toBe(401);

    const xApiKey = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": AUTH_FIXTURE },
      body,
    });
    expect(xApiKey.status).toBe(202);

    const bearer = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${AUTH_FIXTURE}` },
      body,
    });
    expect(bearer.status).toBe(202);
  });

  test("list endpoints reject unauthenticated reads when a key is configured", async () => {
    const port = await availablePort();
    child = spawn("bun", ["run", "src/server/index.ts"], {
      cwd: process.cwd(),
      env: serverEnv(tempDir, port, { SECURITY_API_KEY: AUTH_FIXTURE }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForStartup(child);

    const anonymous = await fetch(`http://127.0.0.1:${port}/api/scans`);
    expect(anonymous.status).toBe(401);

    const authenticated = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      headers: { "x-api-key": AUTH_FIXTURE },
    });
    expect(authenticated.status).toBe(200);
  });

  test("refuses to bind beyond loopback while SECURITY_API_KEY is unset", async () => {
    const port = await availablePort();
    const stderrChunks: string[] = [];
    child = spawn("bun", ["run", "src/server/index.ts", "--host", "0.0.0.0"], {
      cwd: process.cwd(),
      env: serverEnv(tempDir, port),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(String(c)));

    const exit = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("server started without refusing the non-loopback bind")), 8_000);
      child!.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    expect(exit).not.toBe(0);
    expect(stderrChunks.join("")).toContain("SECURITY_API_KEY");
  });

  test("POST /api/scans allowlists scan roots and gates include_system", async () => {
    const port = await availablePort();
    child = spawn("bun", ["run", "src/server/index.ts"], {
      cwd: process.cwd(),
      env: serverEnv(tempDir, port, { SECURITY_API_KEY: AUTH_FIXTURE, SECURITY_SCAN_ROOTS: tempDir }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForStartup(child);

    const headers = { "content-type": "application/json", "x-api-key": AUTH_FIXTURE };

    const outsideRoots = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path: "/etc" }),
    });
    expect(outsideRoots.status).toBe(403);

    const systemScans = await fetch(`http://127.0.0.1:${port}/api/scans`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path: tempDir, include_system: true }),
    });
    expect(systemScans.status).toBe(403);
  });
});
