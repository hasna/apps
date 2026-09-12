import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import {
  connect as tcpConnect,
  createServer as createTcpServer,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MCP_HTTP_PORT,
  isHttpMode,
  resolveMcpHttpPort,
  startMcpHttpServer,
} from "./http.ts";
import { buildServer } from "./index.ts";

// buildServer() resolves its store from process.env and FAILS CLOSED without
// the fleet API env, so these in-process servers opt in explicitly with
// HASNA_LOGS_LOCAL=1. The machine's real HASNA_LOGS_API_* vars are scrubbed
// for the whole file so resolution stays hermetic (local, temp HOME).
const ORIG_ENV: Record<string, string | undefined> = {
  HASNA_LOGS_API_URL: process.env.HASNA_LOGS_API_URL,
  HASNA_LOGS_API_KEY: process.env.HASNA_LOGS_API_KEY,
  HASNA_LOGS_LOCAL: process.env.HASNA_LOGS_LOCAL,
  HOME: process.env.HOME,
};
beforeAll(() => {
  delete process.env.HASNA_LOGS_API_URL;
  delete process.env.HASNA_LOGS_API_KEY;
  process.env.HASNA_LOGS_LOCAL = "1";
  process.env.HOME = mkdtempSync(join(tmpdir(), "logs-mcp-http-home-"));
});
afterAll(() => {
  for (const [key, value] of Object.entries(ORIG_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("logs MCP HTTP transport", () => {
  test("defaults port to 8864", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8864);
    expect(resolveMcpHttpPort(["node"], {})).toBe(8864);
    expect(resolveMcpHttpPort(["node", "--port", "9001"], {})).toBe(9001);
    expect(resolveMcpHttpPort(["node"], { MCP_HTTP_PORT: "9002" })).toBe(9002);
  });

  test("isHttpMode detects flag and env", () => {
    expect(isHttpMode(["node"], {})).toBe(false);
    expect(isHttpMode(["node", "--http"], {})).toBe(true);
    expect(isHttpMode(["node"], { MCP_HTTP: "1" })).toBe(true);
  });
});

describe("logs buildServer stdio registration", () => {
  test("registers tools over in-memory transport", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "get_health")).toBe(true);

    await client.close();
    await server.close();
  });
});

describe("logs streamable HTTP server", () => {
  let handle: Awaited<ReturnType<typeof startMcpHttpServer>>;

  beforeAll(async () => {
    handle = await startMcpHttpServer(buildServer, { port: 0 });
  });

  afterAll(async () => {
    await handle.close();
  });

  test("GET /health returns ok", async () => {
    const res = await fetch(`http://${handle.host}:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "logs" });
  });

  test("initialize and call get_health over streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${handle.host}:${handle.port}/mcp`),
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);

    const result = await client.callTool({ name: "get_health", arguments: {} });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    await client.close();
  });

  test("serves three concurrent clients from one process", async () => {
    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://${handle.host}:${handle.port}/mcp`),
        );
        const client = new Client({ name: "test", version: "0.0.0" });
        await client.connect(transport);
        const tools = await client.listTools();
        return { client, count: tools.tools.length };
      }),
    );

    expect(clients.every((entry) => entry.count > 0)).toBe(true);
    await Promise.all(clients.map((entry) => entry.client.close()));
  });
});

// The listener factory is a public export: an embedder can reach it without
// the bin's startup gate. It must therefore run the authority preflight
// itself, before the harness creates a socket (hasna/apps#1720 validation,
// round 3 — 0.5.0 bound first and refused per session).
describe("logs streamable HTTP listener factory fails closed", () => {
  const SCRUB = [
    "HASNA_LOGS_LOCAL",
    "LOGS_LOCAL",
    "HASNA_LOGS_API_URL",
    "HASNA_LOGS_API_KEY",
    "LOGS_API_URL",
    "LOGS_API_KEY",
    "HASNA_LOGS_API_KEY_OVERRIDE",
    "HASNA_LOGS_API_KEY_REF",
    "HASNA_PROFILE",
    "HASNA_STATION",
    "HASNA_HOME",
  ];

  function reservePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createTcpServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });
  }

  function probePort(port: number): Promise<"open" | "refused"> {
    return new Promise((resolve) => {
      const socket = tcpConnect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve("open");
      });
      socket.once("error", () => resolve("refused"));
    });
  }

  test("startMcpHttpServer rejects with the remedy and binds nothing when no credential resolves", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of SCRUB) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // No opt-in, a Keychain account that exists on no station, an empty home.
    process.env.HASNA_STATION = "no-such-station";
    process.env.HASNA_HOME = mkdtempSync(
      join(tmpdir(), "logs-mcp-http-nocred-"),
    );
    const port = await reservePort();
    try {
      await expect(startMcpHttpServer(buildServer, { port })).rejects.toThrow(
        /hasna\.credentials\.logs\.api-key/,
      );
      expect(await probePort(port)).toBe("refused");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("a deliberate tier that cannot be honoured is refused by the factory too", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of SCRUB) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.HASNA_STATION = "no-such-station";
    process.env.HASNA_HOME = mkdtempSync(
      join(tmpdir(), "logs-mcp-http-profile-"),
    );
    process.env.HASNA_PROFILE = "no-such-profile";
    const port = await reservePort();
    try {
      await expect(startMcpHttpServer(buildServer, { port })).rejects.toThrow(
        /Profile 'no-such-profile'/,
      );
      expect(await probePort(port)).toBe("refused");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
