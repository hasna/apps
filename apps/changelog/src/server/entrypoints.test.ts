import { afterEach, describe, expect, test } from "bun:test";
import { main, startChangelogServer } from "./index.js";

const HOST_ENV = "CHANGELOG_HOST";
const PORT_ENV = "CHANGELOG_PORT";

afterEach(() => {
  delete process.env[HOST_ENV];
  delete process.env[PORT_ENV];
});

/**
 * Defaults, port-string edge cases, and the no-listener paths of the server
 * entrypoint. Port-0 and env-precedence behavior is covered in index.test.ts;
 * this file covers what it does not: the documented defaults, invalid and
 * absent port strings, and proof that --help and plain import never open a
 * listener.
 */
describe("startChangelogServer defaults", () => {
  test("defaults to host 127.0.0.1 and port 8788 when no options and no environment are set", async () => {
    delete process.env[HOST_ENV];
    delete process.env[PORT_ENV];
    const server = startChangelogServer();
    try {
      expect(server.hostname).toBe("127.0.0.1");
      expect(server.port).toBe(8788);
      const response = await fetch("http://127.0.0.1:8788/health");
      expect(response.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("an invalid port string in the environment binds an ephemeral port instead of the default", async () => {
    // Number.parseInt("abc") is NaN and Bun.serve treats NaN as "ephemeral",
    // so an invalid port string silently escapes the documented default. This
    // documents the actual behavior as the two-sided counterpart of the
    // default-port test: unset -> 8788, set-but-invalid -> not 8788.
    process.env[PORT_ENV] = "abc";
    const server = startChangelogServer();
    try {
      expect(server.port).not.toBe(8788);
      expect(server.port).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  test("an empty port string in the environment also falls off the default", async () => {
    process.env[PORT_ENV] = "";
    const server = startChangelogServer();
    try {
      expect(server.port).not.toBe(8788);
      expect(server.port).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  test("a numeric port string in the environment is parsed and honored", async () => {
    process.env[PORT_ENV] = "0";
    const server = startChangelogServer();
    try {
      expect(server.port).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });
});

describe("server main", () => {
  async function captureHelp(args: string[]): Promise<string> {
    const logs: string[] = [];
    const original = console.log;
    console.log = (line: string) => {
      logs.push(String(line));
    };
    try {
      await main(args);
    } finally {
      console.log = original;
    }
    return logs.join("\n");
  }

  test("--help prints usage and opens no listener", async () => {
    const serve = Bun.serve;
    let calls = 0;
    (Bun as unknown as { serve: typeof Bun.serve }).serve = (() => {
      calls += 1;
      throw new Error("Bun.serve must not be called for --help");
    }) as typeof Bun.serve;
    try {
      const help = await captureHelp(["--help"]);
      expect(help).toContain("Usage: changelog-serve");
      expect(help).toContain("--host");
      expect(help).toContain("--port");
      expect(calls).toBe(0);
    } finally {
      (Bun as unknown as { serve: typeof Bun.serve }).serve = serve;
    }
  });

  test("-h prints usage and opens no listener", async () => {
    const serve = Bun.serve;
    let calls = 0;
    (Bun as unknown as { serve: typeof Bun.serve }).serve = (() => {
      calls += 1;
      throw new Error("Bun.serve must not be called for -h");
    }) as typeof Bun.serve;
    try {
      const help = await captureHelp(["-h"]);
      expect(help).toContain("Usage: changelog-serve");
      expect(calls).toBe(0);
    } finally {
      (Bun as unknown as { serve: typeof Bun.serve }).serve = serve;
    }
  });
});

describe("direct-run guard", () => {
  test("importing the server module does not trigger the direct-run path", async () => {
    const modulePath = new URL("./index.ts", import.meta.url).pathname;
    const proc = Bun.spawnSync(
      ["bun", "-e", `await import(${JSON.stringify(modulePath)}); console.log("IMPORTED-OK");`],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      },
    );
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("IMPORTED-OK");
    // A direct-run trigger would print the listening banner and block on the
    // event loop; neither happened.
    expect(proc.stdout.toString()).not.toContain("listening");
  });

  test("importing the MCP module does not trigger the direct-run path", async () => {
    const modulePath = new URL("../mcp/index.ts", import.meta.url).pathname;
    const proc = Bun.spawnSync(
      ["bun", "-e", `await import(${JSON.stringify(modulePath)}); console.log("MCP-IMPORTED-OK");`],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      },
    );
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("MCP-IMPORTED-OK");
    // A broken guard would connect stdio and hang until the timeout; the
    // process exited cleanly with no server banner.
    expect(proc.stdout.toString()).not.toContain("listening");
  });
});
