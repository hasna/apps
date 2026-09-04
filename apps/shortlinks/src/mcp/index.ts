#!/usr/bin/env bun
/**
 * `shortlinks-mcp` — Model Context Protocol server exposing the shortlinks core
 * operations (domains, links, click stats) to AI agents.
 *
 * Transports:
 *   shortlinks-mcp            stdio (default; for editor/agent clients)
 *   shortlinks-mcp --http     Streamable HTTP on 127.0.0.1:8851 (shared service)
 *
 * Every tool routes through the shared client {@link Store}: the cloud ApiStore
 * (HTTPS `/v1` + bearer key) when the client flip is on; otherwise the tool
 * FAILS CLOSED naming the required env (SHORTLINKS_LOCAL=1 opts into the
 * on-box LocalStore SQLite — never a silent default). No DSN, no direct
 * sqlite/fetch — same seam the CLI uses.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { withStore } from "../client-store.js";
import { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";

const TOOLS = [
  {
    name: "create_link",
    description: "Create a shortlink for a destination URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Destination URL (http/https)." },
        domain: { type: "string", description: "Hostname; defaults to the default domain." },
        slug: { type: "string", description: "Custom slug; generated when omitted." },
        title: { type: "string" },
        expires_at: { type: "string", description: "ISO date/time." },
        length: { type: "number", description: "Generated slug length." },
      },
      required: ["url"],
    },
  },
  {
    name: "list_links",
    description: "List shortlinks.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        active: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_link",
    description: "Get a shortlink by slug.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, domain: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "resolve_link",
    description: "Resolve a slug to its destination URL without recording a click.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, domain: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "enable_link",
    description: "Enable a shortlink.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, domain: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "disable_link",
    description: "Disable a shortlink.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, domain: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "delete_link",
    description: "Delete a shortlink.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, domain: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "link_stats",
    description: "Click stats for a shortlink.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, domain: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "list_domains",
    description: "List configured shortlink domains.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_domain",
    description: "Add or update a shortlink domain.",
    inputSchema: {
      type: "object",
      properties: {
        hostname: { type: "string" },
        provider: { type: "string" },
        default: { type: "boolean" },
        origin_url: { type: "string" },
        notes: { type: "string" },
      },
      required: ["hostname"],
    },
  },
  {
    name: "delete_domain",
    description: "Delete a shortlink domain and all of its links and clicks.",
    inputSchema: {
      type: "object",
      properties: { hostname: { type: "string", description: "Hostname or domain id." } },
      required: ["hostname"],
    },
  },
  {
    name: "stats",
    description: "Total domains/links/clicks counts.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function dispatch(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case "create_link":
      return withStore((s) =>
        s.createLink({
          destinationUrl: args.url,
          domain: args.domain,
          slug: args.slug,
          title: args.title,
          expiresAt: args.expires_at,
          slugLength: args.length,
        }),
      );
    case "list_links":
      return withStore((s) => s.listLinks({ domain: args.domain, activeOnly: args.active, limit: args.limit ?? 100 }));
    case "get_link":
      return withStore((s) => (args.domain ? s.getLink(args.domain, args.slug) : s.getLink(args.slug)));
    case "resolve_link":
      return withStore((s) => (args.domain ? s.getLink(args.domain, args.slug) : s.getLink(args.slug)));
    case "enable_link":
      return withStore((s) => (args.domain ? s.setLinkActive(args.domain, args.slug, true) : s.setLinkActive(args.slug, true)));
    case "disable_link":
      return withStore((s) => (args.domain ? s.setLinkActive(args.domain, args.slug, false) : s.setLinkActive(args.slug, false)));
    case "delete_link":
      return withStore((s) => (args.domain ? s.deleteLink(args.domain, args.slug) : s.deleteLink(args.slug)));
    case "link_stats":
      return withStore((s) => (args.domain ? s.getStats(args.domain, args.slug) : s.getStats(args.slug)));
    case "list_domains":
      return withStore((s) => s.listDomains());
    case "add_domain":
      return withStore((s) =>
        s.addDomain({
          hostname: args.hostname,
          provider: args.provider,
          defaultDomain: args.default,
          originUrl: args.origin_url,
          notes: args.notes,
        }),
      );
    case "delete_domain":
      return withStore((s) => s.deleteDomain(args.hostname));
    case "stats":
      return withStore((s) => s.totalStats());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function buildServer(): Server {
  const server = new Server({ name: "shortlinks", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await dispatch(name, (args ?? {}) as Record<string, any>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
    }
  });

  return server;
}

async function main(): Promise<void> {
  if (isHttpMode()) {
    await startMcpHttpServer(buildServer, { port: resolveMcpHttpPort() });
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    return;
  }
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[shortlinks-mcp] stdio ready");
}

main().catch((err) => {
  console.error("[shortlinks-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
