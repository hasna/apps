import { getDb } from "./db.js";
import type { McpServerEntry, AddServerOptions } from "../types.js";

function parseRow(row: Record<string, unknown>): McpServerEntry {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || null,
    command: row.command as string,
    args: JSON.parse(row.args as string),
    env: JSON.parse(row.env as string),
    transport: row.transport as McpServerEntry["transport"],
    url: (row.url as string) || null,
    source: row.source as McpServerEntry["source"],
    enabled: (row.enabled as number) === 1,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function addServer(opts: AddServerOptions): McpServerEntry {
  const db = getDb();
  const name = opts.name || opts.args?.[0] || opts.command;
  const id = generateId(name);

  const row = db
    .prepare(
      `INSERT INTO servers (id, name, description, command, args, env, transport, url, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      id,
      name,
      opts.description || null,
      opts.command,
      JSON.stringify(opts.args || []),
      JSON.stringify(opts.env || {}),
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
  updates: Partial<Pick<McpServerEntry, "name" | "description" | "command" | "args" | "env" | "transport" | "url" | "enabled">>
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
    values.push(JSON.stringify(updates.env));
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
    .get(...values) as Record<string, unknown>;

  return parseRow(row);
}

export function enableServer(id: string): McpServerEntry {
  return updateServer(id, { enabled: true });
}

export function disableServer(id: string): McpServerEntry {
  return updateServer(id, { enabled: false });
}

export function cacheTools(
  serverId: string,
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
): void {
  const db = getDb();
  db.prepare("DELETE FROM tool_cache WHERE server_id = ?").run(serverId);

  const insert = db.prepare(
    "INSERT INTO tool_cache (server_id, name, description, input_schema) VALUES (?, ?, ?, ?)"
  );

  for (const tool of tools) {
    insert.run(serverId, tool.name, tool.description, JSON.stringify(tool.input_schema));
  }
}

export function getCachedTools(serverId: string): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const db = getDb();
  const rows = db
    .prepare("SELECT name, description, input_schema FROM tool_cache WHERE server_id = ?")
    .all(serverId) as Array<{ name: string; description: string; input_schema: string }>;

  return rows.map((r) => ({
    name: r.name,
    description: r.description,
    input_schema: JSON.parse(r.input_schema),
  }));
}
