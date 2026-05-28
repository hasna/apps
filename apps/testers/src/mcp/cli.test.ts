process.env.TESTERS_DB_PATH = ":memory:";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

describe("testers-mcp CLI", () => {
  test("--help exits cleanly without booting MCP runtime", () => {
    const entry = new URL("./index.ts", import.meta.url).pathname;
    const proc = spawnSync("bun", ["run", entry, "--help"], {
      env: {
        ...process.env,
        TESTERS_DB_PATH: ":memory:",
      },
      encoding: "utf8",
    });

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    expect(proc.status).toBe(0);
    expect(stdout).toContain("Usage: testers-mcp [options]");
    expect(stdout).toContain("--http");
    expect(stderr).not.toContain("Tool wait_for_run is already registered");
  });

  test("does not register duplicate tool names", () => {
    const entry = new URL("./server.ts", import.meta.url).pathname;
    const source = readFileSync(entry, "utf8");
    const names = [...source.matchAll(/server\.tool\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    expect(duplicates).toEqual([]);
  });

  test("responds to MCP initialize", () => {
    const entry = new URL("./index.ts", import.meta.url).pathname;
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "testers-test", version: "0.0.0" },
      },
    };
    const proc = spawnSync("bun", ["run", entry], {
      env: {
        ...process.env,
        TESTERS_DB_PATH: ":memory:",
      },
      input: `${JSON.stringify(init)}\n`,
      encoding: "utf8",
      timeout: 5000,
    });

    expect(proc.status).toBe(0);
    expect(proc.stderr).not.toContain("already registered");
    expect(proc.stdout).toContain("\"serverInfo\":{\"name\":\"testers\"");
  });
});
