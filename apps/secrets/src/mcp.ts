import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  scanHistoryExposures,
  scanWorkspaceExposures,
} from "./scanner.js";
import { getStoreWithResolution } from "./store/index.js";
import { VERSION } from "./version.js";

const SECRET_TYPES = ["api_key", "password", "token", "credential", "other"] as const;
const VAULT_ITEM_KINDS = ["login", "address", "identity", "payment_card", "secure_note", "api_key", "custom"] as const;

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "secrets",
    version: VERSION,
  });

  // Every DATA tool routes through the resolved Store (LocalStore or ApiStore).
  // No tool touches sqlite or fetch directly. Resolution FAILS CLOSED when no
  // credential resolves from any @hasna/contracts tier, and a local run says so
  // once on stderr — stdout is the MCP protocol stream and stays untouched.
  const resolved = getStoreWithResolution();
  if (resolved.notice) console.error(resolved.notice);
  const store = resolved.store;

  server.tool(
    "get_secret",
    "Retrieve a secret value by key",
    { key: z.string().describe("The secret key (e.g. openai/api_key)") },
    async ({ key }) => {
      const entry = await store.getSecret(key);
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
      const entry = await store.setSecret(key, value, type ?? "other", label, expiresAt);
      return { content: [{ type: "text", text: `Stored: ${entry.key} [${entry.type}]` }] };
    }
  );

  server.tool(
    "delete_secret",
    "Delete a secret from the vault",
    { key: z.string() },
    async ({ key }) => {
      const ok = await store.deleteSecret(key);
      if (!ok) return { content: [{ type: "text", text: `Not found: ${key}` }], isError: true };
      return { content: [{ type: "text", text: `Deleted: ${key}` }] };
    }
  );

  server.tool(
    "list_secrets",
    "List secrets, optionally filtered by namespace",
    { namespace: z.string().optional().describe("Namespace prefix e.g. openai") },
    async ({ namespace }) => {
      const entries = await store.listSecretMetadata(namespace);
      const lines = entries.map((e) => `${e.key} [${e.type}]${e.label ? ` — ${e.label}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No secrets found." }] };
    }
  );

  server.tool(
    "search_secrets",
    "Search secrets by key, label, or type",
    { query: z.string() },
    async ({ query }) => {
      const entries = await store.searchSecretMetadata(query);
      const lines = entries.map((e) => `${e.key} [${e.type}]${e.label ? ` — ${e.label}` : ""}`);
      return { content: [{ type: "text", text: lines.join("\n") || "No results." }] };
    }
  );

  server.tool(
    "list_vault_items",
    "List structured vault item metadata, optionally filtered by kind",
    { kind: z.enum(VAULT_ITEM_KINDS).optional().describe("Vault item kind") },
    async ({ kind }) => {
      const entries = await store.listVaultItemMetadata(kind);
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
      const entries = await store.searchVaultItemMetadata(query);
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
      const item = await store.getVaultItem(id);
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
      const item = await store.setVaultItem({ id, kind, title, subtitle, domains, tags, favorite, data });
      return { content: [{ type: "text", text: `Stored vault item: ${item.id} [${item.kind}] ${item.title}` }] };
    }
  );

  server.tool(
    "delete_vault_item",
    "Delete a structured vault item",
    { id: z.string() },
    async ({ id }) => {
      const ok = await store.deleteVaultItem(id);
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
      const entries = await store.getAuditLog(key, limit ?? 50);
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
      const user = await store.registerUser(id, name, type ?? "human");
      return { content: [{ type: "text", text: `Registered: ${user.id} (${user.type})` }] };
    }
  );

  server.tool(
    "list_users",
    "List registered users and agents",
    { type: z.enum(["human", "agent"]).optional() },
    async ({ type }) => {
      const users = await store.listUsers(type);
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
      await store.sendFeedback(message, email || undefined, category || "general");
      return { content: [{ type: "text", text: "Feedback saved. Thank you!" }] };
    }
  );

  server.tool(
    "scan_workspace_exposures",
    "Scan a workspace for likely exposed credentials. Returns bounded redacted metadata only.",
    {
      root: z.string().optional().describe("Workspace root. Defaults to the MCP process working directory."),
      cursor: z.string().optional().describe("Opaque nextCursor from the preceding chunk."),
      limit: z.number().int().positive().optional().describe("Maximum findings to return. Capped by the server."),
      maxFileBytes: z.number().int().positive().optional().describe("Maximum bytes per file to inspect."),
      maxFiles: z.number().int().positive().optional().describe("Maximum files to scan. Capped by the server."),
      maxBytesScanned: z.number().int().positive().optional().describe("Maximum total bytes to scan. Capped by the server."),
      timeoutMs: z.number().int().positive().optional().describe("Maximum scan runtime in milliseconds. Capped by the server."),
    },
    async ({ root, cursor, limit, maxFileBytes, maxFiles, maxBytesScanned, timeoutMs }) => {
      const resolved = resolveMcpRoot(root);
      if (!resolved.ok) return mcpScanRootError("workspace", resolved.root, resolved.error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(scanWorkspaceExposures({
            root: resolved.root,
            cursor,
            limit,
            maxFileBytes,
            maxFiles,
            maxBytesScanned,
            timeoutMs,
          })),
        }],
      };
    }
  );

  server.tool(
    "scan_history_exposures",
    "Scan full git history in bounded chunks for likely exposed credentials. Returns bounded redacted metadata only.",
    {
      root: z.string().optional().describe("Git workspace root. Defaults to the MCP process working directory."),
      cursor: z.string().optional().describe("Opaque nextCursor from the preceding chunk."),
      limit: z.number().int().positive().optional().describe("Maximum findings to return. Capped by the server."),
      maxCommits: z.number().int().positive().optional().describe("Maximum commits to inspect. Capped by the server."),
      timeoutMs: z.number().int().positive().optional().describe("Maximum scan runtime in milliseconds. Capped by the server."),
    },
    async ({ root, cursor, limit, maxCommits, timeoutMs }) => {
      const resolved = resolveMcpRoot(root);
      if (!resolved.ok) return mcpScanRootError("history", resolved.root, resolved.error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(scanHistoryExposures({ root: resolved.root, cursor, limit, maxCommits, timeoutMs })),
        }],
      };
    }
  );

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

export function resolveMcpRoot(root?: string): { ok: true; root?: string } | { ok: false; root: string; error: string } {
  if (!root) return { ok: true };
  const resolved = resolve(root);

  let base: string;
  let realRoot: string;
  try {
    base = realpathSync(process.cwd());
    realRoot = realpathSync(resolved);
  } catch (error) {
    return {
      ok: false,
      root: resolved,
      error: `Unable to resolve MCP scan root: ${(error as Error).message}`,
    };
  }

  const rel = relative(base, realRoot);
  const outsideBase = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (rel === "" || !outsideBase) {
    return { ok: true, root: realRoot };
  }
  return {
    ok: false,
    root: realRoot,
    error: `MCP scan root must be inside the server working directory: ${base}`,
  };
}

function mcpScanRootError(source: "workspace" | "history", root: string, error: string) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        schema: "open-secrets.exposure-scan.v1",
        version: 1,
        source,
        root,
        redacted: true,
        limits: { findings: 0 },
        stats: {
          filesScanned: 0,
          filesSkipped: 0,
          bytesScanned: 0,
          ...(source === "history" ? { commitsScanned: 0 } : {}),
          errors: [error],
        },
        findings: [],
        findingCount: 0,
        truncated: false,
      }),
    }],
    isError: true,
  };
}
