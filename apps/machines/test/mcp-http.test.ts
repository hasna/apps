import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, createMcpServer, MACHINE_MCP_TOOL_NAMES } from "../src/mcp/server.js";
import {
  DEFAULT_HTTP_PORT,
  HTTP_NAME,
  authorizeHttpOrigin,
  authorizeHttpRequest,
  isHttpMode,
  isLoopbackHost,
  isTrustedHttpOrigin,
  resolveHttpPort,
  resolveHttpSecurityConfig,
  startHttpServer,
  type MachinesHttpSecurityConfig,
} from "../src/mcp/http.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { MUTATION_APPROVAL_FLAG_ENV, MUTATION_APPROVAL_TOKEN_ENV, createMutationApprovalToken } from "../src/commands/mutation-approval.js";

const API_KEY = "test-machines-api-key";

function httpSecurity(overrides: Partial<MachinesHttpSecurityConfig> = {}): MachinesHttpSecurityConfig {
  return {
    apiKey: API_KEY,
    allowUnauthenticated: false,
    allowedOrigins: [],
    maxBodyBytes: 1024 * 1024,
    ...overrides,
  };
}

function httpTransport(port: number): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: {
      headers: {
        authorization: `Bearer ${API_KEY}`,
      },
    },
  });
}

function boundPort(server: ReturnType<typeof startHttpServer>): number {
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

async function waitForHttpServer(server: ReturnType<typeof startHttpServer>): Promise<number> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      server.once("listening", onListening);
      server.once("error", onError);
    });
  }

  const port = boundPort(server);
  expect(port).toBeGreaterThan(0);
  return port;
}

async function closeHttpServer(server: ReturnType<typeof startHttpServer>): Promise<void> {
  if (!server.listening) return;
  server.closeIdleConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections?.();
  });
}

async function withHttpServer<T>(
  callback: (port: number, server: ReturnType<typeof startHttpServer>) => Promise<T>,
  security: MachinesHttpSecurityConfig = httpSecurity(),
): Promise<T> {
  const server = startHttpServer({ port: 0, host: "127.0.0.1", security });
  const port = await waitForHttpServer(server);
  try {
    return await callback(port, server);
  } finally {
    await closeHttpServer(server);
  }
}

describe("MCP HTTP transport", () => {
  test("stdio mode still builds and registers tools", async () => {
    const server = buildServer("0.0.1");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "stdio-test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([...MACHINE_MCP_TOOL_NAMES].sort());

    await client.close();
    await server.close();
  });

  test("createMcpServer remains available for callers", () => {
    expect(createMcpServer("0.0.1")).toBeDefined();
  });

  test("resolves HTTP mode and default port", () => {
    expect(isHttpMode(["--http"])).toBe(true);
    expect(resolveHttpPort([])).toBe(DEFAULT_HTTP_PORT);
    expect(HTTP_NAME).toBe("machines");
  });

  test("resolves MCP HTTP security from API key or loopback-only unauthenticated opt-in", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(resolveHttpSecurityConfig({ MACHINES_ALLOW_UNAUTHENTICATED: "1" }, "127.0.0.1").allowUnauthenticated).toBe(true);
    expect(resolveHttpSecurityConfig({ MACHINES_ALLOW_UNAUTHENTICATED: "1" }, "0.0.0.0").allowUnauthenticated).toBe(false);
    expect(resolveHttpSecurityConfig({ MACHINES_HTTP_ALLOWED_ORIGINS: "https://ops.example, http://localhost:3000" }).allowedOrigins).toEqual([
      "https://ops.example",
      "http://localhost:3000",
    ]);
    expect(resolveHttpSecurityConfig({ MACHINES_HTTP_MAX_BODY_BYTES: "4096" }).maxBodyBytes).toBe(4096);
  });

  test("validates browser Origin headers before MCP HTTP auth", () => {
    expect(isTrustedHttpOrigin(undefined, "127.0.0.1")).toBe(true);
    expect(isTrustedHttpOrigin("http://localhost:5173", "127.0.0.1")).toBe(true);
    expect(isTrustedHttpOrigin("https://evil.example", "127.0.0.1")).toBe(false);
    expect(isTrustedHttpOrigin("https://ops.example", "0.0.0.0", ["https://ops.example"])).toBe(true);

    const badOriginReq = { headers: { origin: "https://evil.example" } };
    expect(authorizeHttpOrigin(badOriginReq as Parameters<typeof authorizeHttpOrigin>[0], "127.0.0.1", httpSecurity()).ok).toBe(false);
  });

  test("GET /health returns ok", async () => {
    await withHttpServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: "ok",
        name: "machines",
      });
    });
  });

  test("rejects unauthenticated MCP HTTP requests", async () => {
    await withHttpServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "Unauthorized" });
    });

    const fakeReq = { headers: { authorization: "Bearer wrong" } };
    expect(authorizeHttpRequest(fakeReq as Parameters<typeof authorizeHttpRequest>[0], httpSecurity()).ok).toBe(false);
  });

  test("rejects untrusted browser origins and oversized MCP HTTP bodies", async () => {
    await withHttpServer(async (port) => {
      const badOrigin = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${API_KEY}`,
          origin: "https://evil.example",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(badOrigin.status).toBe(403);
    });

    const limited = startHttpServer({ port: 0, host: "127.0.0.1", security: httpSecurity({ maxBodyBytes: 16 }) });
    const port = await waitForHttpServer(limited);
    try {
      const tooLarge = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(tooLarge.status).toBe(413);
    } finally {
      await closeHttpServer(limited);
    }
  });

  test("serves trusted browser preflight without requiring API auth", async () => {
    const cors = startHttpServer({ port: 0, host: "127.0.0.1", security: httpSecurity({ allowedOrigins: ["https://ops.example"] }) });
    const port = await waitForHttpServer(cors);
    try {
      const preflight = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "OPTIONS",
        headers: {
          origin: "https://ops.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://ops.example");
      expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

      const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          origin: "https://ops.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("access-control-allow-origin")).toBe("https://ops.example");
    } finally {
      await closeHttpServer(cors);
    }
  });

  test("handles MCP initialize and tool call over Streamable HTTP", async () => {
    await withHttpServer(async (port) => {
      const transport = httpTransport(port);
      const client = new Client({ name: "http-test", version: "0.0.1" });
      await client.connect(transport);

      try {
        const tools = await client.listTools();
        expect(tools.tools.some((tool) => tool.name === "machines_status")).toBe(true);

        const result = await client.callTool({ name: "machines_status", arguments: {} });
        const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
        expect(text).toBeTruthy();
        expect(JSON.parse(text)).toMatchObject({ machineId: expect.any(String) });
      } finally {
        await client.close();
      }
    });

  });

  test("HTTP MCP mutations require scoped tokens beyond HTTP API key auth", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-http-scoped-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
    process.env[MUTATION_APPROVAL_TOKEN_ENV] = "secret";
    manifestInit();
    manifestAdd({ id: "demo-node-01", platform: "linux", workspacePath: "/home/operator/workspace" });
    delete process.env[MUTATION_APPROVAL_FLAG_ENV];

    try {
      await withHttpServer(async (port) => {
        const client = new Client({ name: "http-mutation-token-test", version: "0.0.1" });
        const transport = httpTransport(port);
        await client.connect(transport);

        try {
          let staticFailure = "";
          try {
            const result = await client.callTool({
              name: "machines_manifest_remove",
              arguments: { machine_id: "demo-node-01", approval_token: "secret" },
            });
            staticFailure = JSON.stringify(result);
          } catch (error) {
            staticFailure = error instanceof Error ? error.message : String(error);
          }
          expect(staticFailure).toContain("scoped approval_token");
          expect(staticFailure).not.toContain("secret");

          const localTransportToken = createMutationApprovalToken({
            surface: "mcp",
            operation: "machines_manifest_remove",
            machineId: "demo-node-01",
            callerId: "mcp",
            runId: "mcp",
            transport: "mcp:stdio",
            args: { machine_id: "demo-node-01" },
          }, { env: process.env, now: Date.now(), nonce: "http-wrong-transport" });
          let transportFailure = "";
          try {
            const result = await client.callTool({
              name: "machines_manifest_remove",
              arguments: { machine_id: "demo-node-01", approval_token: localTransportToken },
            });
            transportFailure = JSON.stringify(result);
          } catch (error) {
            transportFailure = error instanceof Error ? error.message : String(error);
          }
          expect(transportFailure).toContain("requires operator approval");
          expect(transportFailure).not.toContain(localTransportToken);

          const token = createMutationApprovalToken({
            surface: "mcp",
            operation: "machines_manifest_remove",
            machineId: "demo-node-01",
            callerId: "mcp",
            runId: "mcp",
            transport: "mcp:http",
            args: { machine_id: "demo-node-01" },
          }, { env: process.env, now: Date.now(), nonce: "http-scoped" });
          const result = await client.callTool({
            name: "machines_manifest_remove",
            arguments: { machine_id: "demo-node-01", approval_token: token },
          });
          const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
          expect(JSON.parse(text).machines).toEqual([]);
        } finally {
          await client.close();
        }
      });
    } finally {
      delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
      delete process.env[MUTATION_APPROVAL_TOKEN_ENV];
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("serves multiple concurrent HTTP clients from one process", async () => {
    await withHttpServer(async (port) => {
      const clients = await Promise.all(
        Array.from({ length: 3 }, async (_, index) => {
          const transport = httpTransport(port);
          const client = new Client({ name: `http-test-${index}`, version: "0.0.1" });
          await client.connect(transport);
          return client;
        })
      );

      try {
        const results = await Promise.all(
          clients.map((client) => client.callTool({ name: "machines_status", arguments: {} }))
        );

        expect(results).toHaveLength(3);
        for (const result of results) {
          const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
          expect(JSON.parse(text)).toMatchObject({ machineId: expect.any(String) });
        }
      } finally {
        await Promise.all(clients.map((client) => client.close()));
      }
    });

  });
});

afterEach(() => {
  delete process.env[MUTATION_APPROVAL_FLAG_ENV];
  delete process.env[MUTATION_APPROVAL_TOKEN_ENV];
});
