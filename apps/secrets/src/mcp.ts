import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import { join } from "path";
import { homedir } from "os";
import { z } from "zod";
import {
  setSecret,
  getSecret,
  getSecretMetadata,
  deleteSecret,
  listSecretMetadata,
  searchSecretMetadata,
  getAuditLog,
  countAuditLog,
  registerUser,
  listUsers,
} from "./store.js";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  createPage,
  formatAuditRows,
  formatSecretDetail,
  formatSecretRows,
  formatUserRows,
  pageItems,
} from "./output.js";

const SECRET_TYPES = ["api_key", "password", "token", "credential", "other"] as const;

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "open-secrets",
    version: "0.1.0",
  });

  server.tool(
    "get_secret",
    "Retrieve a secret value by key",
    { key: z.string().describe("The secret key (e.g. openai/api_key)") },
    async ({ key }) => {
      const entry = getSecret(key);
      if (!entry) return { content: [{ type: "text", text: `Not found: ${key}` }], isError: true };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ key: entry.key, value: entry.value, type: entry.type, label: entry.label }),
          },
        ],
      };
    }
  );

  server.tool(
    "set_secret",
    "Store a secret in the vault",
    {
      key: z.string().describe("The secret key (e.g. openai/api_key)"),
      value: z.string().describe("The secret value"),
      type: z.enum(SECRET_TYPES).optional().describe("Secret type"),
      label: z.string().optional().describe("Human-readable label"),
      ttl: z.string().optional().describe("TTL e.g. 30d, 24h"),
    },
    async ({ key, value, type, label, ttl }) => {
      const expiresAt = ttl ? parseTtl(ttl) : undefined;
      const entry = setSecret(key, value, type ?? "other", label, expiresAt);
      return { content: [{ type: "text", text: `Stored: ${entry.key} [${entry.type}]` }] };
    }
  );

  server.tool(
    "delete_secret",
    "Delete a secret from the vault",
    { key: z.string() },
    async ({ key }) => {
      const ok = deleteSecret(key);
      if (!ok) return { content: [{ type: "text", text: `Not found: ${key}` }], isError: true };
      return { content: [{ type: "text", text: `Deleted: ${key}` }] };
    }
  );

  server.tool(
    "list_secrets",
    "List secret metadata, compact by default. Use limit/cursor for pagination and inspect_secret or get_secret for details.",
    {
      namespace: z.string().optional().describe("Namespace prefix e.g. openai"),
      limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).optional().describe(`Max rows to return (default ${DEFAULT_PAGE_LIMIT}, max ${MAX_PAGE_LIMIT})`),
      cursor: z.number().int().min(0).optional().describe("Numeric cursor offset from a previous result"),
      verbose: z.boolean().optional().describe("Show wider metadata columns"),
    },
    async ({ namespace, limit, cursor, verbose }) => {
      const entries = listSecretMetadata(namespace);
      const page = pageItems(entries, { limit, cursor });
      if (entries.length === 0) return { content: [{ type: "text", text: "No secrets found." }] };
      return { content: [{ type: "text", text: formatSecretRows(page, { command: "list_secrets", detailCommand: "inspect_secret", verbose, mode: "mcp" }) }] };
    }
  );

  server.tool(
    "search_secrets",
    "Search secret metadata by key, label, or type. Compact by default; use limit/cursor for pagination.",
    {
      query: z.string(),
      limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).optional().describe(`Max rows to return (default ${DEFAULT_PAGE_LIMIT}, max ${MAX_PAGE_LIMIT})`),
      cursor: z.number().int().min(0).optional().describe("Numeric cursor offset from a previous result"),
      verbose: z.boolean().optional().describe("Show wider metadata columns"),
    },
    async ({ query, limit, cursor, verbose }) => {
      const entries = searchSecretMetadata(query);
      const page = pageItems(entries, { limit, cursor });
      if (entries.length === 0) return { content: [{ type: "text", text: "No results." }] };
      return { content: [{ type: "text", text: formatSecretRows(page, { command: "search_secrets", detailCommand: "inspect_secret", verbose, noun: "result", mode: "mcp" }) }] };
    }
  );

  server.tool(
    "inspect_secret",
    "Show metadata for one secret without returning the secret value. Use get_secret only when the raw value is needed.",
    { key: z.string().describe("The secret key to inspect") },
    async ({ key }) => {
      const entry = getSecretMetadata(key);
      if (!entry) return { content: [{ type: "text", text: `Not found: ${key}` }], isError: true };
      return { content: [{ type: "text", text: formatSecretDetail(entry, { mode: "mcp" }) }] };
    }
  );

  server.tool(
    "audit_log",
    "View compact audit history for a key or recent activity",
    {
      key: z.string().optional().describe("Filter by key"),
      limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).optional().describe(`Max entries (default ${DEFAULT_PAGE_LIMIT}, max ${MAX_PAGE_LIMIT})`),
      cursor: z.number().int().min(0).optional().describe("Numeric cursor offset from a previous result"),
      verbose: z.boolean().optional().describe("Show wider metadata columns"),
    },
    async ({ key, limit, cursor, verbose }) => {
      const requestedLimit = limit ?? DEFAULT_PAGE_LIMIT;
      const requestedCursor = cursor ?? 0;
      const entries = getAuditLog(key, requestedLimit, requestedCursor);
      const page = createPage(entries, countAuditLog(key), requestedLimit, requestedCursor);
      if (page.total === 0) return { content: [{ type: "text", text: "No audit entries." }] };
      return { content: [{ type: "text", text: formatAuditRows(page, { command: "audit_log", verbose, mode: "mcp" }) }] };
    }
  );

  server.tool(
    "register_user",
    "Register a human or agent user",
    {
      id: z.string().describe("Unique ID (e.g. agent name or email)"),
      name: z.string().describe("Display name"),
      type: z.enum(["human", "agent"]).optional(),
    },
    async ({ id, name, type }) => {
      const user = registerUser(id, name, type ?? "human");
      return { content: [{ type: "text", text: `Registered: ${user.id} (${user.type})` }] };
    }
  );

  server.tool(
    "list_users",
    "List registered users and agents, compact by default",
    {
      type: z.enum(["human", "agent"]).optional(),
      limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).optional().describe(`Max rows to return (default ${DEFAULT_PAGE_LIMIT}, max ${MAX_PAGE_LIMIT})`),
      cursor: z.number().int().min(0).optional().describe("Numeric cursor offset from a previous result"),
      verbose: z.boolean().optional().describe("Show wider metadata columns"),
    },
    async ({ type, limit, cursor, verbose }) => {
      const users = listUsers(type);
      const page = pageItems(users, { limit, cursor });
      if (users.length === 0) return { content: [{ type: "text", text: "No users registered." }] };
      return { content: [{ type: "text", text: formatUserRows(page, { command: "list_users", verbose, mode: "mcp" }) }] };
    }
  );

  server.tool(
    "send_feedback",
    "Send feedback about this service",
    {
      message: z.string().describe("Feedback message"),
      email: z.string().optional().describe("Contact email (optional)"),
      category: z.enum(["bug", "feature", "general"]).optional().describe("Feedback category"),
    },
    async ({ message, email, category }) => {
      const { getDb } = await import("./db.js");
      const db = getDb();
      db.run(
        "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
        [message, email || null, category || "general", "0.1.0"]
      );
      return { content: [{ type: "text", text: "Feedback saved. Thank you!" }] };
    }
  );

  const vaultPath = process.env.HASNA_SECRETS_DB_PATH ?? process.env.OPEN_SECRETS_DB ?? join(homedir(), ".hasna", "secrets", "vault.db");
  registerCloudTools(server, "secrets", { migrations: PG_MIGRATIONS, dbPath: vaultPath });
  return server;
}

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
}

function parseTtl(ttl: string): string {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid TTL: ${ttl}. Use e.g. 30d, 24h, 60m`);
  const [, num, unit] = match;
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as string]!;
  return new Date(Date.now() + parseInt(num) * ms).toISOString();
}
