// Regression tests for the local-only capability removal: the hosted (/v1 API)
// store must serve semantic search, hybrid search, embed, recompute-machines,
// and import-db instead of throwing "not available" / "local-only".
//
// Each test drives `resolveSessionStore` in cloud mode with a recording
// fetchImpl and asserts the transport call the capability should make.

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { resolveSessionStore } from "../src/storage.js";
import type { SearchHit } from "../src/lib/search.js";

const CLOUD_ENV = {
  HASNA_SESSIONS_STORAGE_MODE: "cloud",
  HASNA_SESSIONS_API_URL: "https://sessions.example.test",
  HASNA_SESSIONS_API_KEY: "test-key",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const HIT: SearchHit = {
  session_id: "hosted-session-1",
  source: "claude",
  title: "Stripe webhook implementation",
  project_name: "web",
  project_path: "/repo/web",
  started_at: "2026-05-01T10:00:00.000Z",
  snippet: "stripe webhook payment handler",
  rank: 0.9,
};

describe("hosted store: semantic / hybrid / embed / recompute", () => {
  it("serves semantic search through GET /v1/search/semantic", async () => {
    let requested: string | null = null;
    const store = resolveSessionStore(CLOUD_ENV, {
      fetchImpl: async (url: string | URL) => {
        requested = String(url);
        return jsonResponse({ query: "payment", count: 1, results: [HIT] });
      },
    });

    const hits = await store.semanticSearch("payment webhook", { limit: 5 });

    expect(requested).toContain("/v1/search/semantic");
    expect(requested).toContain("q=payment+webhook");
    expect(requested).toContain("limit=5");
    expect(hits).toHaveLength(1);
    expect(hits[0].session_id).toBe("hosted-session-1");
  });

  it("serves hybrid search through GET /v1/search/hybrid", async () => {
    let requested: string | null = null;
    const store = resolveSessionStore(CLOUD_ENV, {
      fetchImpl: async (url: string | URL) => {
        requested = String(url);
        return jsonResponse({ query: "stripe", count: 1, results: [HIT] });
      },
    });

    const hits = await store.hybridSearch("stripe webhook", { limit: 3 });

    expect(requested).toContain("/v1/search/hybrid");
    expect(requested).toContain("q=stripe+webhook");
    expect(hits[0].session_id).toBe("hosted-session-1");
  });

  it("serves embed through POST /v1/embed", async () => {
    let requested: string | null = null;
    let body: unknown = null;
    const store = resolveSessionStore(CLOUD_ENV, {
      fetchImpl: async (url: string | URL, init?: RequestInit) => {
        requested = String(url);
        body = init?.body ?? null;
        return jsonResponse({ messagesProcessed: 7, chunksEmbedded: 9 });
      },
    });

    const result = await store.embed({ limit: 50 });

    expect(requested).toBe("https://sessions.example.test/v1/embed");
    expect(JSON.parse(String(body))).toEqual({ limit: 50 });
    expect(result).toEqual({ messagesProcessed: 7, chunksEmbedded: 9 });
  });

  it("serves recompute-machines through POST /v1/machines/recompute", async () => {
    let requested: string | null = null;
    const store = resolveSessionStore(CLOUD_ENV, {
      fetchImpl: async (url: string | URL) => {
        requested = String(url);
        return jsonResponse({ ok: true });
      },
    });

    await store.recomputeMachines();

    expect(requested).toBe("https://sessions.example.test/v1/machines/recompute");
  });
});

describe("hosted store: import-db (mergeFromDb)", () => {
  it("imports a source sessions database through /v1/sessions/import", async () => {
    // Build a source DB file with the local sessions schema (one session +
    // one message + one tool call).
    const dir = mkdtempSync(join(tmpdir(), "sessions-merge-src-"));
    const srcPath = join(dir, "source.db");
    const src = new Database(srcPath);
    src.run(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT, source_id TEXT, source_path TEXT, title TEXT,
      project_path TEXT, project_name TEXT, model TEXT, model_provider TEXT,
      git_branch TEXT, git_sha TEXT, git_origin_url TEXT, cli_version TEXT,
      is_subagent INTEGER, parent_session_id TEXT, total_input_tokens INTEGER,
      total_output_tokens INTEGER, total_cache_read_tokens INTEGER,
      total_cache_write_tokens INTEGER, total_thinking_tokens INTEGER,
      message_count INTEGER, tool_call_count INTEGER, started_at TEXT, ended_at TEXT,
      duration_seconds INTEGER, ingested_at TEXT, updated_at TEXT,
      source_modified_at TEXT, machine TEXT, metadata TEXT
    )`);
    src.run(`CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT, source_id TEXT, parent_message_id TEXT,
      role TEXT, content TEXT, content_preview TEXT, model TEXT, is_sidechain INTEGER,
      sequence_num INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, cache_write_tokens INTEGER, thinking_tokens INTEGER,
      timestamp TEXT, metadata TEXT
    )`);
    src.run(`CREATE TABLE tool_calls (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, tool_name TEXT,
      tool_input TEXT, tool_output TEXT, duration_ms INTEGER, status TEXT,
      timestamp TEXT, metadata TEXT
    )`);
    src.run(`CREATE TABLE embeddings (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, chunk_index INTEGER,
      chunk_text TEXT, embedding BLOB, embedding_model TEXT, dimensions INTEGER,
      created_at TEXT, synced_to_s3 INTEGER
    )`);
    src.run(
      `INSERT INTO sessions (id, source, source_id, title, project_path, project_name, machine, is_subagent,
         message_count, tool_call_count, ingested_at, updated_at, total_input_tokens, total_output_tokens,
         total_cache_read_tokens, total_cache_write_tokens, total_thinking_tokens)
       VALUES ('src-session-1', 'claude', 'claude-src-001', 'Merged session', '/repo/x', 'x', 'other-machine', 0, 1, 1, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 0, 0, 0, 0, 0)`,
    );
    src.run(
      `INSERT INTO messages (id, session_id, role, content, sequence_num, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, thinking_tokens)
       VALUES ('src-msg-1', 'src-session-1', 'user', 'hello from the other machine', 0, 0, 0, 0, 0, 0)`,
    );
    src.run(
      `INSERT INTO tool_calls (id, session_id, tool_name, tool_input, tool_output, status)
       VALUES ('src-tool-1', 'src-session-1', 'Bash', 'echo hi', 'hi', 'success')`,
    );
    src.close();

    const importRequests: string[] = [];
    const store = resolveSessionStore(CLOUD_ENV, {
      fetchImpl: async (url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const target = `${method} ${url}`;
        if (method === "GET") {
          // Pre-existing session lookup -> 404 (the source session is new).
          return jsonResponse({ ok: false, error: "session not found" }, 404);
        }
        if (method === "POST" && String(url).endsWith("/v1/sessions/import")) {
          importRequests.push(target);
          const body = JSON.parse(String(init?.body));
          return jsonResponse({
            ok: true,
            session: body.session,
            imported: { messages: body.messages.length, toolCalls: body.toolCalls.length },
            backup: null,
          });
        }
        throw new Error(`unexpected request: ${target}`);
      },
    });

    const result = await store.mergeFromDb(srcPath);

    expect(importRequests).toHaveLength(1);
    expect(importRequests[0]).toContain("/v1/sessions/import");
    const pushed = importRequests.length;
    expect(pushed).toBe(1);
    expect(result.sessions).toBe(1);
    expect(result.messages).toBe(1);
    expect(result.tool_calls).toBe(1);
    expect(result.embeddings).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("skips sessions that already exist in the registry (INSERT OR IGNORE parity)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sessions-merge-skip-"));
    const srcPath = join(dir, "source.db");
    const src = new Database(srcPath);
    src.run(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT, source_id TEXT, source_path TEXT, title TEXT,
      project_path TEXT, project_name TEXT, model TEXT, model_provider TEXT,
      git_branch TEXT, git_sha TEXT, git_origin_url TEXT, cli_version TEXT,
      is_subagent INTEGER, parent_session_id TEXT, total_input_tokens INTEGER,
      total_output_tokens INTEGER, total_cache_read_tokens INTEGER,
      total_cache_write_tokens INTEGER, total_thinking_tokens INTEGER,
      message_count INTEGER, tool_call_count INTEGER, started_at TEXT, ended_at TEXT,
      duration_seconds INTEGER, ingested_at TEXT, updated_at TEXT,
      source_modified_at TEXT, machine TEXT, metadata TEXT
    )`);
    src.run(`CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT, source_id TEXT, parent_message_id TEXT,
      role TEXT, content TEXT, content_preview TEXT, model TEXT, is_sidechain INTEGER,
      sequence_num INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, cache_write_tokens INTEGER, thinking_tokens INTEGER,
      timestamp TEXT, metadata TEXT
    )`);
    src.run(`CREATE TABLE tool_calls (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, tool_name TEXT,
      tool_input TEXT, tool_output TEXT, duration_ms INTEGER, status TEXT,
      timestamp TEXT, metadata TEXT
    )`);
    src.run(
      `INSERT INTO sessions (id, source, source_id, title, project_name, is_subagent,
         message_count, tool_call_count, ingested_at, updated_at, total_input_tokens, total_output_tokens,
         total_cache_read_tokens, total_cache_write_tokens, total_thinking_tokens)
       VALUES ('existing-1', 'claude', 'claude-existing-001', 'Already there', 'x', 0, 0, 0, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 0, 0, 0, 0, 0)`,
    );
    src.close();

    let importCalls = 0;
    const store = resolveSessionStore(CLOUD_ENV, {
      fetchImpl: async (url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return jsonResponse({ ok: true, session: { id: "existing-1", source: "claude" } });
        }
        importCalls++;
        return jsonResponse({ ok: true });
      },
    });

    const result = await store.mergeFromDb(srcPath);

    expect(result).toEqual({ sessions: 0, messages: 0, tool_calls: 0, embeddings: 0 });
    expect(importCalls).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a missing source database as an error", async () => {
    const missing = join(tmpdir(), "definitely-missing-sessions-store.db");
    expect(existsSync(missing)).toBe(false);
    const store = resolveSessionStore(CLOUD_ENV, {
      fetchImpl: async () => {
        throw new Error("must not make a request for a missing file");
      },
    });

    await expect(store.mergeFromDb(missing)).rejects.toThrow(/No such database/);
  });
});
