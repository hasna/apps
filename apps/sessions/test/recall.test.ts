import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../src/db/database.js";
import { saveParsedSession } from "../src/db/sessions.js";
import { embedSessions, type Embedder } from "../src/lib/embeddings.js";
import { recallSessions } from "../src/lib/recall.js";
import { resolveSessionStore } from "../src/storage.js";
import { mintApiKey } from "@hasna/contracts/auth";

const repoRoot = join(import.meta.dir, "..");

const fakeEmbedder: Embedder = async (texts) => {
  const vocab = ["stripe", "webhook", "payment", "auth", "storage"];
  return texts.map((text) => {
    const lower = text.toLowerCase();
    return vocab.map((word) => (lower.match(new RegExp(word, "g")) ?? []).length);
  });
};

function seedRecallFixtures() {
  const stripe = saveParsedSession({
    session: {
      source: "claude",
      source_id: "claude-stripe-001",
      title: "Stripe webhook implementation",
      project_path: "/repo/web",
      project_name: "web",
      model: "claude-sonnet-4-6",
      model_provider: "anthropic",
      git_branch: "feature/stripe-webhook",
      git_sha: "abc1234",
      git_origin_url: "https://github.com/example-org/web.git",
      started_at: "2026-05-01T10:00:00.000Z",
      machine: "test-machine",
    },
    messages: [
      {
        session_id: "",
        role: "user",
        content: "We need to implement the Stripe webhook payment handler and tests.",
        sequence_num: 0,
      },
      {
        session_id: "",
        role: "assistant",
        content: "Implemented signature verification in src/routes/stripe-webhook.ts and covered invoice events.",
        sequence_num: 1,
      },
    ],
    toolCalls: [
      {
        session_id: "",
        tool_name: "Edit",
        tool_input: JSON.stringify({
          file_path: "src/routes/stripe-webhook.ts",
          new_string: "export async function stripeWebhook() {}",
        }),
        tool_output: "updated src/routes/stripe-webhook.ts",
        status: "success",
      },
      {
        session_id: "",
        tool_name: "Bash",
        tool_input: JSON.stringify({
          command: "bun test test/stripe-webhook.test.ts",
        }),
        tool_output: "ok on branch feature/stripe-webhook",
        status: "success",
      },
    ],
  });

  const auth = saveParsedSession({
    session: {
      source: "codex",
      source_id: "codex-auth-001",
      title: "Auth middleware cleanup",
      project_path: "/repo/web",
      project_name: "web",
      started_at: "2026-05-02T10:00:00.000Z",
      machine: "test-machine",
    },
    messages: [
      {
        session_id: "",
        role: "user",
        content: "Fix auth middleware redirect behavior.",
        sequence_num: 0,
      },
    ],
    toolCalls: [
      {
        session_id: "",
        tool_name: "Read",
        tool_input: JSON.stringify({ file_path: "src/auth/middleware.ts" }),
      },
    ],
  });

  return { stripe, auth };
}

beforeEach(() => {
  process.env.SESSIONS_DB_PATH = ":memory:";
  delete process.env.OPENAI_API_KEY;
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.SESSIONS_DB_PATH;
  delete process.env.OPENAI_API_KEY;
});

describe("recallSessions", () => {
  it("ranks the coding thread for a natural-language implemented-X query", async () => {
    const { stripe } = seedRecallFixtures();

    const response = await recallSessions("find me the thread where we implemented stripe webhook", {
      limit: 5,
    });

    expect(response.count).toBeGreaterThan(0);
    expect(response.results[0].session_id).toBe(stripe.id);
    expect(response.results[0].rank).toBe(1);
    expect(response.results[0].reason).toContain("matched");
    expect(response.results[0].evidence.some((e) => e.snippet.toLowerCase().includes("stripe"))).toBe(true);
  });

  it("returns evidence, matching tool calls, touched files, graph context, and a Claude resume command", async () => {
    const { stripe } = seedRecallFixtures();

    const response = await recallSessions("stripe webhook", { limit: 1 });
    const result = response.results[0];

    expect(result.session_id).toBe(stripe.id);
    expect(result.matching_tool_calls.map((tool) => tool.tool_name)).toContain("Edit");
    expect(result.touched_file_paths).toContain("src/routes/stripe-webhook.ts");
    expect(result.coding_entities.commands).toContain("bun test test/stripe-webhook.test.ts");
    expect(result.coding_entities.branches).toContain("feature/stripe-webhook");
    expect(result.coding_entities.commits).toContain("abc1234");
    expect(result.related_graph_entities.project).toBe("web");
    expect(result.related_graph_entities.tools).toContain("Bash");
    expect(result.resume).toEqual({
      available: true,
      command: ["claude", "--resume", "claude-stripe-001"],
      shell_command: "claude --resume claude-stripe-001",
      reason: null,
    });
  });

  it("degrades gracefully when embeddings and OPENAI_API_KEY are absent", async () => {
    seedRecallFixtures();

    const response = await recallSessions("stripe webhook", { limit: 2 });

    expect(response.results.length).toBeGreaterThan(0);
    expect(response.metadata.semantic.status).toBe("skipped");
    expect(response.metadata.semantic.attempted).toBe(false);
    expect(response.metadata.semantic.reason).toContain("no stored embeddings");
  });

  it("falls back to recent sessions for vague resume-style prompts", async () => {
    const { auth } = seedRecallFixtures();

    const response = await recallSessions("resume building this thing", { limit: 2 });

    expect(response.results[0].session_id).toBe(auth.id);
    expect(response.results[0].evidence[0].signal).toBe("recent_fallback");
    expect(response.metadata.signals.recent).toBe(2);
    expect(response.metadata.query_variants).toHaveLength(0);
  });

  it("uses deterministic semantic search when embeddings and an injected embedder exist", async () => {
    seedRecallFixtures();
    await embedSessions({ embedder: fakeEmbedder });

    const response = await recallSessions("payment webhook", {
      limit: 2,
      embedder: fakeEmbedder,
    });

    expect(response.metadata.semantic.status).toBe("used");
    expect(response.metadata.signals.semantic).toBeGreaterThan(0);
    expect(response.results[0].title).toBe("Stripe webhook implementation");
  });

  it("explains unavailable resume commands for non-Claude sources", async () => {
    const { auth } = seedRecallFixtures();

    const response = await recallSessions("auth middleware", { limit: 1 });

    expect(response.results[0].session_id).toBe(auth.id);
    expect(response.results[0].resume.available).toBe(false);
    expect(response.results[0].resume.reason).toContain("codex");
  });
});

describe("@hasna/sessions/storage recall contract", () => {
  it("preserves recall in local mode", async () => {
    const { stripe } = seedRecallFixtures();
    const store = resolveSessionStore({ HASNA_SESSIONS_MODE: "local" });

    const response = await store.recall("stripe webhook", { limit: 1 });

    expect(store.mode).toBe("local");
    expect(response.results[0].session_id).toBe(stripe.id);
  });

  it("serves recall through the hosted /v1/recall endpoint", async () => {
    let requestedUrl: string | null = null;
    const store = resolveSessionStore(
      {
        HASNA_SESSIONS_STORAGE_MODE: "cloud",
        HASNA_SESSIONS_API_URL: "https://sessions.example.test",
        HASNA_SESSIONS_API_KEY: "test-key",
      },
      {
        fetchImpl: async (url: string | URL) => {
          requestedUrl = String(url);
          return new Response(
            JSON.stringify({
              query: "stripe webhook",
              count: 1,
              results: [
                {
                  session_id: "stripe-hosted-1",
                  source: "claude",
                  source_id: "claude-stripe-001",
                  source_path: null,
                  title: "Stripe webhook implementation",
                  project_name: "web",
                  project_path: "/repo/web",
                  started_at: "2026-05-01T10:00:00.000Z",
                  updated_at: "2026-05-01T10:00:00.000Z",
                  rank: 1,
                  score: 1,
                  reason: "matched message",
                  evidence: [
                    { kind: "message", signal: "message:original", snippet: "stripe webhook payment handler" },
                  ],
                  matching_tool_calls: [],
                  touched_file_paths: [],
                  coding_entities: { file_paths: [], tool_names: [], commands: [], repos: [], branches: [], commits: [] },
                  related_graph_entities: { project: "web", model: null, provider: null, repo: null, branch: null, commit: null, tools: [] },
                  resume: {
                    available: true,
                    command: ["claude", "--resume", "claude-stripe-001"],
                    shell_command: "claude --resume claude-stripe-001",
                    reason: null,
                  },
                },
              ],
              metadata: {
                query: "stripe webhook",
                query_variants: ["stripe webhook"],
                significant_terms: ["stripe", "webhook"],
                semantic: { attempted: false, status: "skipped", stored_embeddings: 0, openai_api_key_present: false, reason: "no stored embeddings" },
                signals: { message: 1, session: 0, tool_call: 0, semantic: 0, graph: 0, recent: 0 },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );

    expect(store.mode).toBe("cloud");
    const response = await store.recall("stripe webhook", { limit: 1 });

    expect(requestedUrl).toContain("/v1/recall");
    expect(requestedUrl).toContain("q=stripe+webhook");
    expect(response.count).toBe(1);
    expect(response.results[0].session_id).toBe("stripe-hosted-1");
    expect(response.results[0].resume.shell_command).toBe("claude --resume claude-stripe-001");
  });
});

const CLI_SIGNING_KEY = ["cli", "test", "signing", "fixture", "0123456789abcdef", "0123456789abcdef"].join("-");

describe("sessions recall CLI", () => {
  let dir: string;
  let dbPath: string;
  let originalSigningKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sessions-recall-cli-"));
    dbPath = join(dir, "sessions.db");
    process.env.SESSIONS_DB_PATH = dbPath;
    originalSigningKey = process.env.HASNA_SESSIONS_API_SIGNING_KEY;
    process.env.HASNA_SESSIONS_API_SIGNING_KEY = CLI_SIGNING_KEY;
    delete process.env.OPENAI_API_KEY;
    resetDatabase();
    getDatabase();
    seedRecallFixtures();
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SESSIONS_DB_PATH;
    if (originalSigningKey === undefined) {
      delete process.env.HASNA_SESSIONS_API_SIGNING_KEY;
    } else {
      process.env.HASNA_SESSIONS_API_SIGNING_KEY = originalSigningKey;
    }
    (async () => {
      const { resetAuth } = await import("../src/server/auth.js");
      resetAuth();
      const { resetDataSource } = await import("../src/server/data-source.js");
      resetDataSource();
    })();
  });

  it("prints the recall response as JSON", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "recall", "stripe webhook", "--json"],
      cwd: repoRoot,
      env: {
        ...process.env,
        SESSIONS_DB_PATH: dbPath,
        HASNA_SESSIONS_API_URL: "",
        HASNA_SESSIONS_API_KEY: "",
        HASNA_SESSIONS_MODE: "local",
        HASNA_SESSIONS_STORAGE_MODE: "local",
        SESSIONS_API_URL: "",
        SESSIONS_API_KEY: "",
        SESSIONS_MODE: "local",
        SESSIONS_STORAGE_MODE: "local",
        OPENAI_API_KEY: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(Buffer.from(result.stderr).toString("utf-8")).toBe("");
    const payload = JSON.parse(Buffer.from(result.stdout).toString("utf-8"));
    expect(payload.query).toBe("stripe webhook");
    expect(payload.results[0].resume.shell_command).toBe("claude --resume claude-stripe-001");
    expect(payload.results[0].touched_file_paths).toContain("src/routes/stripe-webhook.ts");
  });

  it("serves recall through the hosted /v1 API in self_hosted mode", async () => {
    // The server runs as its own child process: a spawnSync'd CLI child and an
    // in-process Bun.serve deadlock (spawnSync blocks the event loop the server
    // would answer on).
    const probe = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = probe.port;
    probe.stop(true);
    const serverChild = Bun.spawn({
      cmd: ["bun", "run", "src/server/index.ts"],
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        SESSIONS_DB_PATH: dbPath,
        HASNA_SESSIONS_API_SIGNING_KEY: CLI_SIGNING_KEY,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      let healthy = false;
      for (let i = 0; i < 50; i++) {
        try {
          const res = await fetch(`${base}/health`);
          if (res.ok) {
            healthy = true;
            break;
          }
        } catch {
          // not up yet
        }
        await Bun.sleep(100);
      }
      expect(healthy).toBe(true);

      const apiKey = mintApiKey({
        app: "sessions",
        scopes: ["sessions:read"],
        signingSecret: CLI_SIGNING_KEY,
        ttlSeconds: 3600,
      }).token;
      const result = Bun.spawnSync({
        cmd: ["bun", "run", "src/cli/index.tsx", "recall", "stripe webhook", "--json"],
        cwd: repoRoot,
        env: {
          ...process.env,
          HASNA_SESSIONS_STORAGE_MODE: "self_hosted",
          HASNA_SESSIONS_MODE: "self_hosted",
          HASNA_SESSIONS_API_URL: base,
          // The override tier outranks the disk credential tier
          // (~/.hasna/cloud/sessions.env on fleet machines) and the deprecated
          // env tier, and emits no deprecation warning on stderr — the test
          // asserts clean stderr.
          HASNA_SESSIONS_API_KEY_OVERRIDE: apiKey,
          SESSIONS_STORAGE_MODE: "self_hosted",
          SESSIONS_MODE: "self_hosted",
          SESSIONS_API_URL: base,
          SESSIONS_API_KEY: apiKey,
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60000,
      });

      const stderr = Buffer.from(result.stderr).toString("utf-8");
      expect(stderr).toBe("");
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(Buffer.from(result.stdout).toString("utf-8"));
      expect(payload.query).toBe("stripe webhook");
      expect(payload.results[0].resume.shell_command).toBe("claude --resume claude-stripe-001");
      expect(payload.results[0].touched_file_paths).toContain("src/routes/stripe-webhook.ts");
    } finally {
      serverChild.kill();
    }
  });
});
