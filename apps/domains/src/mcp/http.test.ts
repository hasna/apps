import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";
import {
  MCP_SERVER_NAME,
  resetMcpHttpStateForTests,
  startHttpServer,
} from "./http.js";

const servers: Array<{ stop: () => void }> = [];
const tempDirs: string[] = [];

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

function useTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "domains-mcp-test-"));
  tempDirs.push(dir);
  process.env["DOMAINS_DIR"] = dir;
  return dir;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  resetMcpHttpStateForTests();

  delete process.env["DOMAINS_DIR"];
  delete process.env["DOMAINS_MCP_SAFE_MODE"];
  const { closeDatabase } = await import("../db/database.js");
  closeDatabase();

  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("MCP HTTP transport", () => {
  it("GET /health returns 200 with service name", async () => {
    useTempDb();

    const port = randomPort();
    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", name: MCP_SERVER_NAME });
  });

  it("supports MCP initialize and tool call over streamable HTTP", async () => {
    useTempDb();

    const port = randomPort();
    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));

    const result = await client.callTool({ name: "count_domains", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const body = JSON.parse(text) as { count: number };
    expect(typeof body.count).toBe("number");

    await client.close();
  });

  it("serves three concurrent MCP clients from one process", async () => {
    useTempDb();

    const port = randomPort();
    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const client = new Client({ name: "test-client", version: "1.0.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
        return client;
      }),
    );

    const results = await Promise.all(
      clients.map((client) => client.callTool({ name: "get_domain_stats", arguments: {} })),
    );

    for (const result of results) {
      expect(result.isError).not.toBe(true);
    }

    await Promise.all(clients.map((client) => client.close()));
  });
});

describe("stdio mode", () => {
  it("buildServer registers tools for in-memory transport", async () => {
    useTempDb();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "count_domains")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "list_domains")).toBe(true);

    await client.close();
  });

  it("list_domains returns compact pages by default and full records with verbose", async () => {
    useTempDb();
    const { createDomain } = await import("../db/domains.js");
    for (let i = 0; i < 25; i += 1) {
      createDomain({
        name: `mcp-compact-${String(i).padStart(2, "0")}.example`,
        registrar: "Example Registrar",
        expires_at: "2031-01-01T00:00:00Z",
        notes: `long MCP note ${i} ${"y".repeat(140)}`,
        metadata: { index: i },
      });
    }

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    const compactResult = await client.callTool({ name: "list_domains", arguments: {} });
    const compactText = (compactResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const compact = JSON.parse(compactText) as {
      domains: Array<{ name: string; metadata?: unknown; notes?: string }>;
      count: number;
      total: number;
      has_more: boolean;
      compact: boolean;
      hint: string;
    };

    expect(compact.count).toBe(20);
    expect(compact.total).toBe(25);
    expect(compact.has_more).toBe(true);
    expect(compact.compact).toBe(true);
    expect(compact.hint).toContain("Set verbose=true");
    expect(compact.domains[0]!.metadata).toBeUndefined();
    expect(compact.domains[0]!.notes).not.toContain("y".repeat(120));

    const verboseResult = await client.callTool({ name: "list_domains", arguments: { limit: 1, verbose: true } });
    const verboseText = (verboseResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const verbose = JSON.parse(verboseText) as {
      domains: Array<{ metadata?: unknown; notes?: string }>;
      count: number;
      compact: boolean;
    };
    expect(verbose.count).toBe(1);
    expect(verbose.compact).toBe(false);
    expect(verbose.domains[0]!.metadata).toEqual({ index: 0 });
    expect(verbose.domains[0]!.notes).toContain("y".repeat(120));

    await client.close();
  });

  it("safe mode omits mutating tools", async () => {
    useTempDb();
    process.env["DOMAINS_MCP_SAFE_MODE"] = "1";

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain("list_domains");
    expect(names).toContain("count_domains");
    expect(names).not.toContain("create_domain");
    expect(names).not.toContain("update_domain");
    expect(names).not.toContain("domain_setup");
    expect(names).not.toContain("dns_set");
    expect(names).not.toContain("r53_register_domain");
    expect(names).not.toContain("r53_upsert_record");
    expect(names).not.toContain("r53_delete_record");
    expect(names).not.toContain("sync_route53");

    await client.close();
  });

  it("rejects injected DNS helper arguments without running shell payloads", async () => {
    const dir = useTempDb();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const dnsDomainMarker = join(dir, "mcp-dns-domain-injected");
      const dnsDomainResult = await client.callTool({
        name: "check_dns_propagation",
        arguments: { domain: `example.com; touch ${dnsDomainMarker} #`, record_type: "A" },
      });
      expect(dnsDomainResult.isError).toBe(true);
      expect(existsSync(dnsDomainMarker)).toBe(false);

      const dnsRecordMarker = join(dir, "mcp-dns-record-injected");
      const dnsRecordResult = await client.callTool({
        name: "check_dns_propagation",
        arguments: { domain: "example.com", record_type: `A; touch ${dnsRecordMarker} #` },
      });
      expect(dnsRecordResult.isError).toBe(true);
      expect(existsSync(dnsRecordMarker)).toBe(false);

      const whoisMarker = join(dir, "mcp-whois-injected");
      const whoisResult = await client.callTool({
        name: "whois_lookup",
        arguments: { domain: `example.com; touch ${whoisMarker} #` },
      });
      expect(whoisResult.isError).toBe(true);
      expect(existsSync(whoisMarker)).toBe(false);

      const sslMarker = join(dir, "mcp-ssl-injected");
      const sslResult = await client.callTool({
        name: "check_ssl",
        arguments: { domain: `example.com; touch ${sslMarker} #` },
      });
      expect(sslResult.isError).toBe(true);
      expect(existsSync(sslMarker)).toBe(false);

      const ownerWhoisMarker = join(dir, "mcp-owner-whois-injected");
      const ownerWhoisResult = await client.callTool({
        name: "extract_domain_owner_from_whois",
        arguments: { domain_name: `example.com; touch ${ownerWhoisMarker} #` },
      });
      expect(ownerWhoisResult.isError).toBe(true);
      expect(existsSync(ownerWhoisMarker)).toBe(false);
    } finally {
      await client.close();
    }
  });
});
