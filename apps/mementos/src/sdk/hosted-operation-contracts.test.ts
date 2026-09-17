import { describe, expect, test } from "bun:test";
import { MementosClient, type ResourceLock } from "./index.js";

const jobReceipt = {
  id: "job-sdk-1",
  session_id: "session-sdk-1",
  agent_id: null,
  project_id: null,
  source: "manual",
  status: "pending",
  chunk_count: 0,
  memories_extracted: 0,
  error: null,
  metadata: {},
  created_at: "2026-09-17T00:00:00.000Z",
  started_at: null,
  completed_at: null,
};

const lock: ResourceLock = {
  id: "lock-sdk-1",
  resource_type: "memory",
  resource_id: "shared:key:",
  agent_id: "agent-sdk-1",
  lock_type: "exclusive",
  locked_at: "2026-09-17T00:00:00.000Z",
  expires_at: "2026-09-17T00:01:00.000Z",
};

describe("MementosClient hosted operation response contracts", () => {
  test("ingest requires the versioned receipt and validates its job identity", async () => {
    const client = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async () => Response.json({
        contract: "mementos.sessions.ingest.v2",
        job_id: jobReceipt.id,
        status: "queued",
        message: "queued",
        job: jobReceipt,
      }, { status: 202 })) as typeof fetch,
    });

    const receipt = await client.ingestSession({
      transcript: "private transcript",
      session_id: jobReceipt.session_id,
    });
    expect(receipt.job.transcript).toBe("private transcript");
    expect(receipt.job_id).toBe(jobReceipt.id);

    const oldServer = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async () => Response.json({ job_id: "old-job", status: "queued", message: "accepted" })) as typeof fetch,
    });
    await expect(oldServer.ingestSession({ transcript: "x", session_id: "s" }))
      .rejects.toMatchObject({ status: 502 });
  });

  test("session status and queue stats refuse malformed successful responses", async () => {
    const responses = [
      Response.json({ ...jobReceipt }),
      Response.json({ pending: "0", processing: 0, completed: 0, failed: 0 }),
    ];
    const client = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async () => responses.shift()!) as typeof fetch,
    });

    await expect(client.getSessionJob(jobReceipt.id)).rejects.toMatchObject({ status: 502 });
    await expect(client.getSessionQueueStats()).rejects.toMatchObject({ status: 502 });
  });

  test("lock methods decode objects, arrays, booleans and counts strictly", async () => {
    const conflict = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async () => Response.json({ error: "conflict" }, { status: 409 })) as typeof fetch,
    });
    await expect(conflict.acquireLock({
      agent_id: lock.agent_id,
      resource_type: lock.resource_type,
      resource_id: lock.resource_id,
    })).resolves.toBeNull();

    const responses = [
      Response.json([lock]),
      Response.json({ released: "yes" }),
      Response.json({ released: -1 }),
      Response.json({ cleaned: "zero" }),
    ];
    const client = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async () => responses.shift()!) as typeof fetch,
    });

    await expect(client.checkLock("memory", lock.resource_id)).resolves.toEqual([lock]);
    await expect(client.releaseLock(lock.id, lock.agent_id)).rejects.toMatchObject({ status: 502 });
    await expect(client.releaseAllAgentLocks(lock.agent_id)).rejects.toMatchObject({ status: 502 });
    await expect(client.cleanExpiredLocks()).rejects.toMatchObject({ status: 502 });
  });
});
