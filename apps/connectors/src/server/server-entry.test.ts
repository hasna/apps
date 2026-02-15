import { describe, test, expect } from "bun:test";
import { join } from "path";

const SERVER_ENTRY = join(import.meta.dir, "..", "..", "bin", "serve.js");

describe("server entry (connectors-serve)", () => {
  test("starts and responds on default port when available", async () => {
    // Pick a random port to avoid conflicts
    const port = 40000 + Math.floor(Math.random() * 20000);

    const proc = Bun.spawn(["bun", SERVER_ENTRY, "--port", String(port)], {
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

    const proc = Bun.spawn(["bun", SERVER_ENTRY, `--port=${port}`], {
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
