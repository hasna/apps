import { describe, test, expect } from "bun:test";
import { join } from "path";

const SERVER_ENTRY = join(import.meta.dir, "..", "..", "bin", "serve.js");

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
    expect(stdout).toContain("--no-open");
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

    const proc = Bun.spawn(["bun", SERVER_ENTRY, "--port", String(port), "--no-open"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Wait for the server to start
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const res = await fetch(`http://localhost:${port}/api/connectors`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("starts with --port= syntax", async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);

    const proc = Bun.spawn(["bun", SERVER_ENTRY, `--port=${port}`, "--no-open"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const res = await fetch(`http://localhost:${port}/api/connectors`);
      expect(res.status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
