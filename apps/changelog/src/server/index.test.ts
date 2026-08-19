import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { main, startChangelogServer } from "./index.js";

const ENTRY = join(import.meta.dir, "index.ts");

async function startEntrypoint(args: string[]): Promise<{ child: ReturnType<typeof spawn>; port: number }> {
  const child = spawn("bun", [ENTRY, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server did not print a listening line")), 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/listening on http:\/\/(\S+?):(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number.parseInt(match[2]!, 10));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`entrypoint exited early with code ${code}`));
    });
  });
  return { child, port };
}

async function stopEntrypoint(child: ReturnType<typeof spawn>): Promise<void> {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
  });
}

const HOST_ENV = "CHANGELOG_HOST";
const PORT_ENV = "CHANGELOG_PORT";

async function withEnv(name: string, value: string | undefined, fn: () => void | Promise<void>): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

afterEach(() => {
  delete process.env[HOST_ENV];
  delete process.env[PORT_ENV];
});

describe("startChangelogServer", () => {
  test("serves the health endpoint on an ephemeral port", async () => {
    const server = startChangelogServer({ port: 0 });
    try {
      expect(server.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("reads host and port from environment when options are absent", async () => {
    withEnv(PORT_ENV, "0", () => {
      const server = startChangelogServer();
      try {
        expect(server.port).toBeGreaterThan(0);
      } finally {
        server.stop(true);
      }
    });
  });

  test("explicit options override environment values", async () => {
    await withEnv(HOST_ENV, "127.0.0.2", async () => {
      await withEnv(PORT_ENV, "0", async () => {
        const server = startChangelogServer({ host: "127.0.0.1", port: 0 });
        try {
          expect(server.hostname).toBe("127.0.0.1");
          expect(server.port).toBeGreaterThan(0);
          const response = await fetch(`http://127.0.0.1:${server.port}/health`);
          expect(response.status).toBe(200);
        } finally {
          server.stop(true);
        }
      });
    });
  });
});

describe("main", () => {
  test("prints help and returns without serving when --help is passed", async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (line: string) => {
      logs.push(String(line));
    };
    try {
      await main(["--help"]);
    } finally {
      console.log = original;
    }
    expect(logs.join("\n")).toContain("Usage: changelog-serve");
    expect(logs.join("\n")).toContain("--port");
  });

  test("forwards --host and --port to the server and serves health as a child process", async () => {
    const { child, port } = await startEntrypoint(["--host", "127.0.0.1", "--port", "0"]);
    try {
      expect(port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
    } finally {
      await stopEntrypoint(child);
    }
  });

  test("--help and -h exit 0 promptly without a listening line", () => {
    for (const flag of ["--help", "-h"]) {
      const result = spawnSync("bun", [ENTRY, flag], { encoding: "utf8", timeout: 30_000 });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: changelog-serve");
      expect(result.stdout).not.toContain("listening on");
    }
  });

  test("silently accepts a malformed --port as an ephemeral bind (current-behavior pin)", async () => {
    // Current contract: Number.parseInt("not-a-number") -> NaN, and Bun.serve binds an
    // ephemeral port for NaN. This pin documents that behavior; rejecting malformed
    // ports is a product decision (SOL consult 2026-08-19) that must change this test.
    const { child, port } = await startEntrypoint(["--port", "not-a-number"]);
    try {
      expect(port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
    } finally {
      await stopEntrypoint(child);
    }
  });
});
