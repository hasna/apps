import { getDb } from "./db.js";
import {
  normalizeCredentialRefs,
  normalizeLiteralEnv,
  parseCredentialRefs,
} from "./credentials.js";
import type { CredentialReference, McpServerEntry, AddServerOptions } from "../types.js";

function parseRow(row: Record<string, unknown>): McpServerEntry {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || null,
    command: row.command as string,
    args: safeJsonParse(row.args as string, []),
    env: safeJsonParse(row.env as string, {}),
    credentialRefs: parseCredentialRefs(safeJsonParse(row.credential_refs as string, {})),
    transport: row.transport as McpServerEntry["transport"],
    url: (row.url as string) || null,
    source: row.source as McpServerEntry["source"],
    enabled: (row.enabled as number) === 1,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    last_connected_at: (row.last_connected_at as string) ?? null,
    last_error: (row.last_error as string) ?? null,
  };
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCandidate(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function pickNameFromArgs(args?: string[]): string | undefined {
  if (!args || args.length === 0) return undefined;
  const ddIndex = args.indexOf("--");
  if (ddIndex >= 0 && ddIndex < args.length - 1) {
    const after = normalizeCandidate(args[ddIndex + 1]);
    if (after) return after;
  }
  for (const arg of args) {
    const candidate = normalizeCandidate(arg);
    if (!candidate) continue;
    if (candidate.startsWith("-")) continue;
    return candidate;
  }
  return undefined;
}

function pickId(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const id = generateId(candidate);
    if (id) return id;
  }
  return null;
}

export function addServer(opts: AddServerOptions): McpServerEntry {
  const db = getDb();
  const command = normalizeCandidate(opts.command);
  if (!command) {
    throw new Error("Command is required");
  }
  const argName = pickNameFromArgs(opts.args);
  const name = normalizeCandidate(opts.name) || argName || command;
  const id =
    pickId([normalizeCandidate(opts.name), argName, command]) ||
    null;
  if (!id) {
    throw new Error("Unable to generate a valid server ID");
  }

  const row = db
    .prepare(
      `INSERT INTO servers (id, name, description, command, args, env, credential_refs, transport, url, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      id,
      name,
      opts.description || null,
      command,
      JSON.stringify(opts.args || []),
      JSON.stringify(normalizeLiteralEnv(opts.env)),
      JSON.stringify(normalizeCredentialRefs(opts.credentialRefs)),
      opts.transport || "stdio",
      opts.url || null,
      opts.source || "local"
    ) as Record<string, unknown>;

  return parseRow(row);
}

export function removeServer(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM servers WHERE id = ?").run(id);
}

export function listServers(): McpServerEntry[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM servers ORDER BY name").all() as Record<string, unknown>[];
  return rows.map(parseRow);
}

export function getServer(id: string): McpServerEntry | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseRow(row) : null;
}

export function updateServer(
  id: string,
  updates: Partial<Pick<McpServerEntry, "name" | "description" | "command" | "args" | "env" | "credentialRefs" | "transport" | "url" | "enabled">>
): McpServerEntry {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    values.push(updates.description);
  }
  if (updates.command !== undefined) {
    sets.push("command = ?");
    values.push(updates.command);
  }
  if (updates.args !== undefined) {
    sets.push("args = ?");
    values.push(JSON.stringify(updates.args));
  }
  if (updates.env !== undefined) {
    sets.push("env = ?");
    values.push(JSON.stringify(normalizeLiteralEnv(updates.env)));
  }
  if (updates.credentialRefs !== undefined) {
    sets.push("credential_refs = ?");
    values.push(JSON.stringify(normalizeCredentialRefs(updates.credentialRefs)));
  }
  if (updates.transport !== undefined) {
    sets.push("transport = ?");
    values.push(updates.transport);
  }
  if (updates.url !== undefined) {
    sets.push("url = ?");
    values.push(updates.url);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }

  sets.push("updated_at = datetime('now')");
  values.push(id);

  const row = db
    .prepare(`UPDATE servers SET ${sets.join(", ")} WHERE id = ? RETURNING *`)
    .get(...values) as Record<string, unknown> | null;

  if (!row) {
    throw new Error(`Server "${id}" not found`);
  }

  return parseRow(row);
}

export function enableServer(id: string): McpServerEntry {
  return updateServer(id, { enabled: true });
}

export function disableServer(id: string): McpServerEntry {
  return updateServer(id, { enabled: false });
}

export function setServerEnv(id: string, key: string, value: string): void {
  const db = getDb();
  const server = getServer(id);
  if (!server) throw new Error(`Server "${id}" not found`);
  const env = { ...server.env, [key]: value };
  db.prepare("UPDATE servers SET env = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(normalizeLiteralEnv(env)), id);
}

export function unsetServerEnv(id: string, key: string): void {
  const db = getDb();
  const server = getServer(id);
  if (!server) throw new Error(`Server "${id}" not found`);
  const env = { ...server.env };
  delete env[key];
  db.prepare("UPDATE servers SET env = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(env), id);
}

export function setServerCredentialRef(id: string, key: string, ref: CredentialReference): void {
  const db = getDb();
  const server = getServer(id);
  if (!server) throw new Error(`Server "${id}" not found`);
  const credentialRefs = normalizeCredentialRefs({ ...(server.credentialRefs ?? {}), [key]: ref });
  db.prepare("UPDATE servers SET credential_refs = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(credentialRefs),
    id,
  );
}

export function unsetServerCredentialRef(id: string, key: string): void {
  const db = getDb();
  const server = getServer(id);
  if (!server) throw new Error(`Server "${id}" not found`);
  const credentialRefs = { ...(server.credentialRefs ?? {}) };
  delete credentialRefs[key];
  db.prepare("UPDATE servers SET credential_refs = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(normalizeCredentialRefs(credentialRefs)),
    id,
  );
}

export function cacheTools(
  serverId: string,
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
): void {
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO tool_cache (server_id, name, description, input_schema) VALUES (?, ?, ?, ?)"
  );

  const uniqueTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const name = tool.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    uniqueTools.push({
      name,
      description: tool.description || "",
      input_schema: tool.input_schema || {},
    });
  }

  const run = db.transaction((rows: typeof uniqueTools) => {
    db.prepare("DELETE FROM tool_cache WHERE server_id = ?").run(serverId);
    for (const tool of rows) {
      insert.run(serverId, tool.name, tool.description, JSON.stringify(tool.input_schema));
    }
  });

  run(uniqueTools);
}

export function getToolCounts(): Map<string, number> {
  const db = getDb();
  const rows = db
    .prepare("SELECT server_id, COUNT(*) as count FROM tool_cache GROUP BY server_id")
    .all() as Array<{ server_id: string; count: number }>;
  return new Map(rows.map((row) => [row.server_id, Number(row.count)]));
}

export function cloneServer(id: string, newName: string): McpServerEntry {
  const server = getServer(id);
  if (!server) throw new Error(`Server "${id}" not found`);
  return addServer({
    name: newName,
    description: server.description ?? undefined,
    command: server.command,
    args: server.args,
    env: server.env,
    credentialRefs: server.credentialRefs,
    transport: server.transport,
    url: server.url ?? undefined,
    source: server.source,
  });
}

export function getCachedTools(serverId: string): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const db = getDb();
  const rows = db
    .prepare("SELECT name, description, input_schema FROM tool_cache WHERE server_id = ? ORDER BY name")
    .all(serverId) as Array<{ name: string; description: string; input_schema: string }>;

  return rows.map((r) => ({
    name: r.name,
    description: r.description,
    input_schema: safeJsonParse(r.input_schema, {}),
  }));
}
