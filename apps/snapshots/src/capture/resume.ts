import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CaptureDiagnostic, JsonValue } from "../types.js";

/**
 * Resume identity enrichment for captured tmux panes.
 *
 * A pane record alone says "a tmux pane ran in directory X". After the
 * 2026-08-24 fleet power outage destroyed tmux layouts, recovery relies on
 * directly resuming the coding-agent sessions that were live in each pane,
 * so every pane carries the identity of the newest resumable agent session
 * for its working directory:
 *
 * - opencode2 (OpenCode v2): latest `session_v2` row in
 *   `~/.local/share/opencode/opencode.db` whose `directory` equals the pane
 *   cwd (id, title, directory, model, agent, time_created/updated in ms
 *   since epoch).
 * - Claude Code: the newest `*.jsonl` under
 *   `~/.claude/projects/<slug>/` whose RECORDED cwd (the `cwd` field inside
 *   the file) matches the pane cwd — the slug is lossy, so matching happens
 *   on the file content, never on the slug alone.
 *
 * Both sources are optional: when a source is absent or unreadable the pane
 * simply carries a null identity and the resolver emits an info diagnostic
 * so the snapshot still explains what it could not see.
 */

export type OpenCode2SessionIdentity = {
  session_id: string;
  title: string | null;
  directory: string;
  model: string | null;
  model_id: string | null;
  agent: string | null;
  time_created_ms: number;
  time_updated_ms: number;
};

export type ClaudeSessionIdentity = {
  session_id: string | null;
  cwd: string;
  file: string;
  modified_at: string;
};

export type ResumeIdentity = {
  opencode2: OpenCode2SessionIdentity | null;
  claude: ClaudeSessionIdentity | null;
};

export interface ResumeIdentityOptions {
  opencodeDbPath?: string;
  claudeProjectsDir?: string;
}

export function defaultOpenCodeDbPath(): string {
  return process.env.HASNA_SNAPSHOTS_OPENCODE_DB ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
}

export function defaultClaudeProjectsDir(): string {
  return process.env.HASNA_SNAPSHOTS_CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
}

/** Claude Code project-folder slug: "-" + cwd with every non-alphanumeric char replaced by "-". */
export function claudeProjectSlug(cwd: string): string {
  return `-${cwd.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]/g, "-")}`;
}

/** Normalize a path for identity matching (trailing slash only). */
function normalizeCwd(cwd: string): string {
  const trimmed = cwd.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

/** Bytes of JSONL content read per candidate file when looking for a recorded cwd. */
const CLAUDE_SCAN_FILE_CAP_BYTES = 16 * 1024 * 1024;
/** Newest candidate JSONL files scanned per project slug. */
const CLAUDE_SCAN_FILE_CAP = 24;

export interface ResumeIdentityResolver {
  resolve(cwd: string): ResumeIdentity;
  diagnostics: CaptureDiagnostic[];
  close(): void;
}

export function createResumeIdentityResolver(options: ResumeIdentityOptions = {}): ResumeIdentityResolver {
  const opencodeDbPath = options.opencodeDbPath ?? defaultOpenCodeDbPath();
  const claudeProjectsDir = options.claudeProjectsDir ?? defaultClaudeProjectsDir();
  const cache = new Map<string, ResumeIdentity>();
  const diagnostics: CaptureDiagnostic[] = [];
  let opencodeIndex: { db: Database; query: ReturnType<Database["query"]> } | null | undefined;
  let claudeRootChecked = false;

  function openOpenCodeIndex(): { db: Database; query: ReturnType<Database["query"]> } | null {
    if (opencodeIndex !== undefined) return opencodeIndex;
    if (!existsSync(opencodeDbPath)) {
      diagnostics.push({
        source: "resume-identity",
        level: "info",
        message: "opencode2 session database not found; opencode2 resume identity will not be captured.",
        detail: opencodeDbPath
      });
      opencodeIndex = null;
      return null;
    }
    try {
      const db = new Database(opencodeDbPath, { readonly: true, create: false });
      const query = db.query(
        `SELECT id, title, directory, model, agent, time_created, time_updated
         FROM session_v2
         WHERE directory = ?
         ORDER BY time_updated DESC, time_created DESC
         LIMIT 1`
      );
      opencodeIndex = { db, query };
      return opencodeIndex;
    } catch (error) {
      diagnostics.push({
        source: "resume-identity",
        level: "info",
        message: "opencode2 session database could not be read; opencode2 resume identity will not be captured.",
        detail: error instanceof Error ? error.message : String(error)
      });
      opencodeIndex = null;
      return null;
    }
  }

  function resolveOpenCode2(cwd: string): OpenCode2SessionIdentity | null {
    const index = openOpenCodeIndex();
    if (!index) return null;
    try {
      const row = index.query.get(normalizeCwd(cwd)) as
        | { id: string; title: string | null; directory: string; model: string | null; agent: string | null; time_created: number; time_updated: number }
        | null
        | undefined;
      if (!row) return null;
      const modelId = parseModelId(row.model);
      return {
        session_id: row.id,
        title: row.title ?? null,
        directory: row.directory,
        model: row.model ?? null,
        model_id: modelId,
        agent: row.agent ?? null,
        time_created_ms: Number(row.time_created),
        time_updated_ms: Number(row.time_updated)
      };
    } catch {
      return null;
    }
  }

  function resolveClaude(cwd: string): ClaudeSessionIdentity | null {
    if (!claudeRootChecked) {
      claudeRootChecked = true;
      if (!existsSync(claudeProjectsDir)) {
        diagnostics.push({
          source: "resume-identity",
          level: "info",
          message: "Claude Code projects directory not found; claude resume identity will not be captured.",
          detail: claudeProjectsDir
        });
        return null;
      }
    }
    const slugDir = join(claudeProjectsDir, claudeProjectSlug(cwd));
    if (!existsSync(slugDir)) return null;
    let entries: string[];
    try {
      entries = readdirSync(slugDir);
    } catch {
      return null;
    }
    const candidates = entries
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((name) => {
        const path = join(slugDir, name);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          return undefined;
        }
        return { name, path, mtimeMs };
      })
      .filter((candidate): candidate is { name: string; path: string; mtimeMs: number } => Boolean(candidate))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, CLAUDE_SCAN_FILE_CAP);

    for (const candidate of candidates) {
      const meta = readClaudeJsonlMeta(candidate.path);
      if (!meta || meta.cwd === null) continue;
      if (normalizeCwd(meta.cwd) === normalizeCwd(cwd)) {
        return {
          session_id: meta.sessionId,
          cwd: meta.cwd,
          file: candidate.name,
          modified_at: new Date(candidate.mtimeMs).toISOString()
        };
      }
    }
    return null;
  }

  return {
    resolve(cwd: string): ResumeIdentity {
      const normalized = normalizeCwd(cwd);
      const cached = cache.get(normalized);
      if (cached) return cached;
      const identity: ResumeIdentity = {
        opencode2: resolveOpenCode2(normalized),
        claude: resolveClaude(normalized)
      };
      cache.set(normalized, identity);
      return identity;
    },
    get diagnostics() {
      return diagnostics;
    },
    close(): void {
      if (opencodeIndex?.db) {
        try {
          opencodeIndex.db.close();
        } catch {
          // best-effort close
        }
        opencodeIndex = null;
      }
    }
  };
}

function parseModelId(model: string | null): string | null {
  if (!model) return null;
  try {
    const parsed = JSON.parse(model) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

interface ClaudeJsonlMeta {
  cwd: string | null;
  sessionId: string | null;
}

/**
 * Read the first CLAUDE_SCAN_FILE_CAP_BYTES of a Claude Code JSONL session
 * file and extract the first recorded `cwd` and `sessionId` fields. The cwd
 * of a session appears in its opening user turns, so a bounded head read is
 * sufficient and keeps capture cheap on multi-hundred-MB history files.
 */
function readClaudeJsonlMeta(path: string): ClaudeJsonlMeta | null {
  let fd: number | undefined;
  try {
    const size = statSync(path).size;
    const length = Math.min(size, CLAUDE_SCAN_FILE_CAP_BYTES);
    if (length <= 0) return null;
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const read = readSync(fd, buffer, offset, length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    const text = buffer.toString("utf8");
    let cwd: string | null = null;
    let sessionId: string | null = null;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed: JsonValue;
      try {
        parsed = JSON.parse(line) as JsonValue;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, JsonValue>;
      if (cwd === null && typeof record.cwd === "string") cwd = record.cwd;
      if (sessionId === null && typeof record.sessionId === "string") sessionId = record.sessionId;
      if (cwd !== null && sessionId !== null) break;
    }
    return { cwd, sessionId };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort close
      }
    }
  }
}
