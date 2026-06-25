import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  STORAGE_TABLES,
  getStorageStatus,
  getStorageSyncMetaAll,
  storagePull,
  storagePush,
  storageSync,
} from "./storage-sync.js";
import {
  setSecret,
  getSecret,
  deleteSecret,
  listSecretMetadata,
  searchSecretMetadata,
  setVaultItem,
  getVaultItem,
  deleteVaultItem,
  listVaultItemMetadata,
  searchVaultItemMetadata,
  getAuditLog,
  registerUser,
  listUsers,
} from "./store.js";

const SECRET_TYPES = ["api_key", "password", "token", "credential", "other"] as const;
const VAULT_ITEM_KINDS = ["login", "address", "identity", "payment_card", "secure_note", "api_key", "custom"] as const;
const STORAGE_TABLE_SCHEMA = z.enum(STORAGE_TABLES);

export async function startMcpServer(): Promise<void> {
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
    "List secrets, optionally filtered by namespace",
    { namespace: z.string().optional().describe("Namespace prefix e.g. openai") },
    async ({ namespace }) => {
      const entries = listSecretMetadata(namespace);
      const lines = entries.map((e) => `${e.key} [${e.type}]${e.label ? ` — ${e.label}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No secrets found." }] };
    }
  );

  server.tool(
    "search_secrets",
    "Search secrets by key, label, or type",
    { query: z.string() },
    async ({ query }) => {
      const entries = searchSecretMetadata(query);
      const lines = entries.map((e) => `${e.key} [${e.type}]${e.label ? ` — ${e.label}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No results." }] };
    }
  );

  server.tool(
    "list_vault_items",
    "List structured vault item metadata, optionally filtered by kind",
    { kind: z.enum(VAULT_ITEM_KINDS).optional().describe("Vault item kind") },
    async ({ kind }) => {
      const entries = listVaultItemMetadata(kind);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(entries, null, 2),
        }],
      };
    }
  );

  server.tool(
    "search_vault_items",
    "Search structured vault item metadata",
    { query: z.string() },
    async ({ query }) => {
      const entries = searchVaultItemMetadata(query);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(entries, null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_vault_item",
    "Retrieve a structured vault item, including decrypted payload",
    { id: z.string().describe("Vault item id") },
    async ({ id }) => {
      const item = getVaultItem(id);
      if (!item) return { content: [{ type: "text", text: `Not found: ${id}` }], isError: true };
      return {
        content: [{
          type: "text",
          text: JSON.stringify(item, null, 2),
        }],
      };
    }
  );

  server.tool(
    "set_vault_item",
    "Store a structured vault item for logins, addresses, identities, cards, notes, API keys, or custom data",
    {
      kind: z.enum(VAULT_ITEM_KINDS),
      title: z.string(),
      data: z.record(z.string(), z.unknown()).describe("Encrypted payload fields"),
      id: z.string().optional(),
      subtitle: z.string().optional(),
      domains: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      favorite: z.boolean().optional(),
    },
    async ({ kind, title, data, id, subtitle, domains, tags, favorite }) => {
      const item = setVaultItem({ id, kind, title, subtitle, domains, tags, favorite, data });
      return { content: [{ type: "text", text: `Stored vault item: ${item.id} [${item.kind}] ${item.title}` }] };
    }
  );

  server.tool(
    "delete_vault_item",
    "Delete a structured vault item",
    { id: z.string() },
    async ({ id }) => {
      const ok = deleteVaultItem(id);
      if (!ok) return { content: [{ type: "text", text: `Not found: ${id}` }], isError: true };
      return { content: [{ type: "text", text: `Deleted vault item: ${id}` }] };
    }
  );

  server.tool(
    "audit_log",
    "View audit log for a key or recent activity",
    {
      key: z.string().optional().describe("Filter by key"),
      limit: z.number().optional().describe("Max entries (default 50)"),
    },
    async ({ key, limit }) => {
      const entries = getAuditLog(key, limit ?? 50);
      const lines = entries.map(
        (e) => `[${e.timestamp}] ${e.action.toUpperCase()} ${e.key} by ${e.agent}`
      );
      return { content: [{ type: "text", text: lines.join("\n") || "No audit entries." }] };
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
    "List registered users and agents",
    { type: z.enum(["human", "agent"]).optional() },
    async ({ type }) => {
      const users = listUsers(type);
      const lines = users.map((u) => `${u.id} [${u.type}] — ${u.name}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No users registered." }] };
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

  server.tool(
    "storage_status",
    "Show open-secrets remote storage configuration and local sync metadata",
    {},
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          ...getStorageStatus(),
          sync: getStorageSyncMetaAll(),
        }, null, 2),
      }],
    })
  );

  server.tool(
    "storage_push",
    "Push local open-secrets tables to the configured remote Postgres storage",
    { tables: z.array(STORAGE_TABLE_SCHEMA).optional().describe("Tables to push") },
    async ({ tables }) => ({
      content: [{ type: "text", text: JSON.stringify(await storagePush({ tables }), null, 2) }],
    })
  );

  server.tool(
    "storage_pull",
    "Pull open-secrets tables from the configured remote Postgres storage",
    { tables: z.array(STORAGE_TABLE_SCHEMA).optional().describe("Tables to pull") },
    async ({ tables }) => ({
      content: [{ type: "text", text: JSON.stringify(await storagePull({ tables }), null, 2) }],
    })
  );

  server.tool(
    "storage_sync",
    "Push then pull open-secrets tables with the configured remote Postgres storage",
    { tables: z.array(STORAGE_TABLE_SCHEMA).optional().describe("Tables to sync") },
    async ({ tables }) => ({
      content: [{ type: "text", text: JSON.stringify(await storageSync({ tables }), null, 2) }],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function parseTtl(ttl: string): string {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid TTL: ${ttl}. Use e.g. 30d, 24h, 60m`);
  const [, num, unit] = match;
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as string]!;
  return new Date(Date.now() + parseInt(num) * ms).toISOString();
}
