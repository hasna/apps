process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createSessionJob } from "../db/session-jobs.js";
import { enqueueSessionJob, getSessionQueueStats } from "./session-queue.js";
import { providerRegistry } from "./providers/registry.js";

/**
 * A hermetic provider so the async background worker can never reach a real
 * provider endpoint, regardless of which provider API keys are present in the
 * environment (CEREBRAS_API_KEY / XAI_API_KEY etc. on dev boxes).
 */
const hermeticProvider = {
  name: "anthropic" as const,
  config: { apiKey: "test", model: "test" },
  extractMemories: async () => [],
  extractEntities: async () => ({ entities: [], relations: [] }),
  scoreImportance: async () => 5,
};

/** Wait for the background worker to drain all queued session jobs. */
async function waitForSessionQueueIdle(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stats = getSessionQueueStats();
    if (stats.processing === 0 && stats.pending === 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("session queue did not drain within timeout");
}

describe("session-queue", () => {
  let originalGetAvailable: typeof providerRegistry.getAvailable;
  let originalGetFallbacks: typeof providerRegistry.getFallbacks;

  beforeEach(() => {
    resetDatabase();
    // The background worker (fired by enqueueSessionJob) processes jobs with
    // the currently-available provider. Mock the registry so the worker can
    // never reach a real provider, and restore it after each test.
    originalGetAvailable = providerRegistry.getAvailable.bind(providerRegistry);
    originalGetFallbacks = providerRegistry.getFallbacks.bind(providerRegistry);
    providerRegistry.getAvailable = () => hermeticProvider;
    providerRegistry.getFallbacks = () => [];
  });

  afterEach(() => {
    providerRegistry.getAvailable = originalGetAvailable;
    providerRegistry.getFallbacks = originalGetFallbacks;
  });

  it("reports job counts from database", () => {
    const db = getDatabase();
    createSessionJob({ session_id: "s1", transcript: "pending job" }, db);
    const completed = createSessionJob({ session_id: "s2", transcript: "done job" }, db);
    db.run("UPDATE session_memory_jobs SET status = 'completed' WHERE id = ?", [completed.id]);

    const stats = getSessionQueueStats();
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.completed).toBeGreaterThanOrEqual(1);
  });

  it("accepts enqueue without throwing", async () => {
    const job = createSessionJob({ session_id: "s3", transcript: "queued" });
    expect(() => enqueueSessionJob(job.id)).not.toThrow();
    // Drain the async worker while the hermetic provider is installed so no
    // straggler worker can reach a real provider after afterEach restores it.
    await waitForSessionQueueIdle();
  });

  it("never contacts a real provider endpoint when a session job is enqueued", async () => {
    // The background worker processes an enqueued job asynchronously using the
    // currently-available LLM provider. This test records any fetch call that
    // would reach a real provider host — the failure mode this suite previously
    // had was a live call to api.cerebras.ai when CEREBRAS_API_KEY is present.
    const realFetch = globalThis.fetch;
    const providerCalls: string[] = [];
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (
        /api\.(cerebras\.ai|anthropic\.com|openai\.com|x\.ai)/.test(url)
      ) {
        providerCalls.push(url);
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const job = createSessionJob({
        session_id: "hermetic-session",
        transcript: "queued",
      });
      enqueueSessionJob(job.id);

      // Wait for the async worker to finish so the assertion is deterministic.
      await waitForSessionQueueIdle();
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(providerCalls).toEqual([]);
  });
});
