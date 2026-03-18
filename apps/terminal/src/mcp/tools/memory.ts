// Memory tools: remember, recall, project_note, store_secret, list_secrets

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";

// Fallback memory store when mementos SDK not available
function getLocalMemoryFile(): string {
  const { join } = require("path");
  return join(process.cwd(), ".terminal", "memories.json");
}

function loadLocalMemories(): { key: string; value: string; importance: number }[] {
  const { existsSync, readFileSync } = require("fs");
  const file = getLocalMemoryFile();
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return []; }
}

function saveLocalMemory(key: string, value: string, importance: number): void {
  const { existsSync, writeFileSync, mkdirSync } = require("fs");
  const { dirname } = require("path");
  const file = getLocalMemoryFile();
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const memories = loadLocalMemories().filter(m => m.key !== key); // dedup by key
  memories.push({ key, value, importance });
  writeFileSync(file, JSON.stringify(memories, null, 2));
}

export function registerMemoryTools(server: McpServer, h: ToolHelpers): void {

  // ── remember ──────────────────────────────────────────────────────────────

  server.tool(
    "remember",
    "Save a learning about this project for future sessions. Persists across restarts. Use for: project patterns, conventions, toolchain quirks, architectural decisions.",
    {
      key: z.string().describe("Short key (e.g., 'test-command', 'deploy-process', 'auth-pattern')"),
      value: z.string().describe("What to remember"),
      importance: z.number().optional().describe("1-10, default 7"),
    },
    async ({ key, value, importance }) => {
      const imp = importance ?? 7;
      // Try mementos SDK first, fall back to local file
      try {
        const mementos = require("@hasna/mementos");
        mementos.createMemory({ key, value, scope: "shared", category: "knowledge", importance: imp });
      } catch {
        saveLocalMemory(key, value, imp);
      }
      h.logCall("remember", { command: `remember: ${key}` });
      return { content: [{ type: "text" as const, text: JSON.stringify({ saved: key }) }] };
    }
  );

  // ── recall ────────────────────────────────────────────────────────────────

  server.tool(
    "recall",
    "Recall project memories from previous sessions. Returns all saved learnings, patterns, and decisions for this project.",
    {
      search: z.string().optional().describe("Search query to filter memories"),
      limit: z.number().optional().describe("Max memories to return (default: 20)"),
    },
    async ({ search, limit }) => {
      let items: { key: string; value: string; importance: number }[] = [];
      // Try mementos SDK first, fall back to local file
      try {
        const mementos = require("@hasna/mementos");
        const memories = search
          ? mementos.searchMemories(search, { limit: limit ?? 20 })
          : mementos.listMemories({ scope: "shared", limit: limit ?? 20 });
        items = (memories ?? []).map((m: any) => ({ key: m.key, value: m.value, importance: m.importance }));
      } catch {
        let local = loadLocalMemories();
        if (search) {
          const q = search.toLowerCase();
          local = local.filter(m => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q));
        }
        items = local.slice(0, limit ?? 20);
      }
      h.logCall("recall", { command: `recall${search ? `: ${search}` : ""}` });
      return { content: [{ type: "text" as const, text: JSON.stringify({ memories: items, total: items.length }) }] };
    }
  );

  // ── project_note ──────────────────────────────────────────────────────────

  server.tool(
    "project_note",
    "Save or recall notes about the current project. Persists across sessions. Agents pick up where they left off.",
    {
      save: z.string().optional().describe("Note to save"),
      recall: z.boolean().optional().describe("Return all saved notes"),
      clear: z.boolean().optional().describe("Clear all notes"),
    },
    async ({ save, recall, clear }) => {
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("fs");
      const { join } = await import("path");
      const notesDir = join(process.cwd(), ".terminal");
      const notesFile = join(notesDir, "notes.json");

      let notes: { text: string; timestamp: string }[] = [];
      if (existsSync(notesFile)) {
        try { notes = JSON.parse(readFileSync(notesFile, "utf8")); } catch {}
      }

      if (clear) {
        notes = [];
        if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
        writeFileSync(notesFile, "[]");
        return { content: [{ type: "text" as const, text: JSON.stringify({ cleared: true }) }] };
      }

      if (save) {
        notes.push({ text: save, timestamp: new Date().toISOString() });
        if (!existsSync(notesDir)) mkdirSync(notesDir, { recursive: true });
        writeFileSync(notesFile, JSON.stringify(notes, null, 2));
        h.logCall("project_note", { command: `save: ${save.slice(0, 80)}` });
        return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, total: notes.length }) }] };
      }

      return { content: [{ type: "text" as const, text: JSON.stringify({ notes, total: notes.length }) }] };
    }
  );

  // ── store_secret ──────────────────────────────────────────────────────────

  server.tool(
    "store_secret",
    "Store a secret for use in commands. Agent uses $NAME in commands, we resolve at execution and redact in output.",
    {
      name: z.string().describe("Secret name (e.g., JIRA_TOKEN)"),
      value: z.string().describe("Secret value"),
    },
    async ({ name, value }) => {
      const { existsSync, readFileSync, writeFileSync, chmodSync } = await import("fs");
      const { join } = await import("path");
      const secretsFile = join(process.env.HOME ?? "~", ".terminal", "secrets.json");
      let secrets: Record<string, string> = {};
      if (existsSync(secretsFile)) {
        try { secrets = JSON.parse(readFileSync(secretsFile, "utf8")); } catch {}
      }
      secrets[name] = value;
      writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));
      try { chmodSync(secretsFile, 0o600); } catch {}
      h.logCall("store_secret", { command: `store ${name}` });
      return { content: [{ type: "text" as const, text: JSON.stringify({ stored: name, hint: `Use $${name} in commands. Value will be resolved at execution and redacted in output.` }) }] };
    }
  );

  // ── list_secrets ──────────────────────────────────────────────────────────

  server.tool(
    "list_secrets",
    "List stored secret names (never values).",
    async () => {
      const { existsSync, readFileSync } = await import("fs");
      const { join } = await import("path");
      const secretsFile = join(process.env.HOME ?? "~", ".terminal", "secrets.json");
      let names: string[] = [];
      if (existsSync(secretsFile)) {
        try { names = Object.keys(JSON.parse(readFileSync(secretsFile, "utf8"))); } catch {}
      }
      // Also show env vars that look like secrets
      const envSecrets = Object.keys(process.env).filter(k => /API_KEY|TOKEN|SECRET|PASSWORD/i.test(k));
      return { content: [{ type: "text" as const, text: JSON.stringify({ stored: names, environment: envSecrets }) }] };
    }
  );
}
