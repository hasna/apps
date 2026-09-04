import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const SERVER_ENTRY = join(import.meta.dir, "..", "..", "bin", "serve.js");

async function waitForConnectors(port: number): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/connectors`);
      if (res.status === 200) {
        return res;
      }
      lastError = new Error(`Unexpected status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe("server entry (connectors-serve)", () => {
  test("prints help and exits without starting the server", async () => {
    const proc = Bun.spawn(["bun", SERVER_ENTRY, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Usage: connectors-serve");
    expect(stdout).toContain("--port");
  });

  test("prints version and exits", async () => {
    const proc = Bun.spawn(["bun", SERVER_ENTRY, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("starts and responds on default port when available", async () => {
    // Pick a random port to avoid conflicts
    const port = 40000 + Math.floor(Math.random() * 20000);
    const home = mkdtempSync(join(tmpdir(), "connectors-serve-home-"));

    const proc = Bun.spawn(["bun", SERVER_ENTRY, "--port", String(port), "--no-open"], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const res = await waitForConnectors(port);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    } finally {
      proc.kill();
      await proc.exited;
      rmSync(home, { recursive: true, force: true });
    }
  }, 10000);

  test("starts with --port= syntax", async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const home = mkdtempSync(join(tmpdir(), "connectors-serve-home-"));

    const proc = Bun.spawn(["bun", SERVER_ENTRY, `--port=${port}`, "--no-open"], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const res = await waitForConnectors(port);
      expect(res.status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
      rmSync(home, { recursive: true, force: true });
    }
  }, 10000);
});
