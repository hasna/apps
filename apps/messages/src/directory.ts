import type { AgentDiscovery, AgentPresence, DiscoveredAgent } from "./types";

export const PRESENCE_TTL_MS = 90_000;
export const HEARTBEAT_BATCH_LIMIT = 500;

export class MessagesInputError extends Error {}
export class MessagesConflictError extends Error {}

export function label(value: unknown, field: string, max = 128): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new MessagesInputError(
      `${field} must be a nonempty string of at most ${max} characters without control characters`,
    );
  return value.trim();
}

export function boundedLimit(
  value: unknown,
  fallback = 100,
  max = 500,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw new MessagesInputError(`limit must be an integer from 1 to ${max}`);
  return value;
}

export function discoveryQuery(
  input: AgentDiscovery,
  now: string,
  postgres: boolean,
) {
  const args: unknown[] = [];
  const bind = (value: unknown) => {
    args.push(value);
    return postgres ? `$${args.length}` : "?";
  };
  const live = `p.expires_at > ${bind(now)}`;
  const where: string[] = [];
  if (input.search !== undefined) {
    const search = label(input.search, "search", 200)
      .toLowerCase()
      .replace(/[\\%_]/g, "\\$&");
    where.push(
      `(LOWER(a.name) LIKE ${bind(`%${search}%`)} ESCAPE '\\' OR LOWER(COALESCE(a.display_name, '')) LIKE ${bind(`%${search}%`)} ESCAPE '\\')`,
    );
  }
  if (input.station !== undefined)
    where.push(`p.station = ${bind(label(input.station, "station"))}`);
  if (input.application !== undefined)
    where.push(
      `p.application = ${bind(label(input.application, "application"))}`,
    );
  if (input.online !== undefined) {
    if (typeof input.online !== "boolean")
      throw new MessagesInputError("online must be a boolean");
    where.push(
      input.online
        ? `p.expires_at > ${bind(now)}`
        : `(p.expires_at IS NULL OR p.expires_at <= ${bind(now)})`,
    );
  }
  if (input.cursor !== undefined) {
    let cursor: unknown;
    try {
      cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
    } catch {
      throw new MessagesInputError("invalid directory cursor");
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 2 ||
      cursor[0] !== 1 ||
      typeof cursor[1] !== "string"
    )
      throw new MessagesInputError("invalid directory cursor");
    where.push(`a.name ${postgres ? 'COLLATE "C" ' : ""}> ${bind(cursor[1])}`);
  }
  const limit = boundedLimit(input.limit);
  return {
    sql: `SELECT a.id, a.name, a.display_name, a.created_at, a.last_seen_at,
      p.station, p.application, p.runtime_id, p.heartbeat_at, p.expires_at,
      CASE WHEN ${live} THEN 1 ELSE 0 END AS online
      FROM agents a LEFT JOIN agent_presence p ON p.agent = a.name
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.name ${postgres ? 'COLLATE "C"' : ""} ASC LIMIT ${bind(limit + 1)}`,
    args,
    limit,
  };
}

export function directoryPage(
  rows: Array<Omit<DiscoveredAgent, "online"> & { online: boolean | number }>,
  limit: number,
) {
  const agents = rows
    .slice(0, limit)
    .map((row) => ({ ...row, online: Boolean(row.online) }));
  return {
    agents,
    next_cursor:
      rows.length > limit
        ? Buffer.from(JSON.stringify([1, agents.at(-1)!.name])).toString(
            "base64url",
          )
        : null,
  };
}

export const PRESENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS message_requests (
  request_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  message_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_presence (
  agent TEXT PRIMARY KEY REFERENCES agents(name) ON DELETE CASCADE,
  runtime_id TEXT NOT NULL,
  station TEXT,
  application TEXT,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_runtime ON agent_presence(runtime_id, agent);
CREATE INDEX IF NOT EXISTS idx_presence_station ON agent_presence(station, agent);
CREATE INDEX IF NOT EXISTS idx_presence_expires ON agent_presence(expires_at, agent);
`;

export function presenceValues(row: AgentPresence) {
  return [
    row.agent,
    row.runtime_id,
    row.station,
    row.application,
    row.heartbeat_at,
    row.expires_at,
  ];
}
