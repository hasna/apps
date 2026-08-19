import { afterEach, describe, expect, test } from "bun:test";
import { main, startChangelogServer } from "./index.js";

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
});
