import { describe, expect, test } from "bun:test";
import { MementosClient, type SessionMemoryJob } from "./index.js";

const job: SessionMemoryJob = {
  id: "job-sdk-1",
  session_id: "session-sdk-1",
  agent_id: "agent-sdk-1",
  project_id: "project-sdk-1",
  source: "manual",
  status: "pending",
  transcript: "hello",
  chunk_count: 0,
  memories_extracted: 0,
  error: null,
  metadata: {},
  created_at: "2026-09-17T00:00:00.000Z",
  started_at: null,
  completed_at: null,
};

describe("MementosClient session pagination", () => {
  test("preserves filters, limit and offset behind one /v1 prefix", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const client = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method });
        return Response.json({
          contract: "mementos.sessions.jobs.v2",
          jobs: [job],
          count: 1,
          limit: 5,
          offset: 7,
          has_more: true,
          next_offset: 8,
        });
      }) as typeof fetch,
    });

    const page = await client.listSessionJobs({
      agent_id: job.agent_id!,
      project_id: job.project_id!,
      session_id: job.session_id,
      status: job.status,
      limit: 5,
      offset: 7,
    });

    expect(page).toEqual({
      contract: "mementos.sessions.jobs.v2",
      jobs: [job],
      count: 1,
      limit: 5,
      offset: 7,
      has_more: true,
      next_offset: 8,
    });
    expect(calls).toEqual([{
      url: "https://api.hasna.com/mementos/v1/sessions/jobs?agent_id=agent-sdk-1&project_id=project-sdk-1&session_id=session-sdk-1&status=pending&limit=5&offset=7",
      method: "GET",
    }]);
  });

  test("refuses an older server that can silently ignore the new filters", async () => {
    const client = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async () => Response.json({ jobs: [job], count: 1 })) as typeof fetch,
    });

    await expect(client.listSessionJobs({ session_id: job.session_id, limit: 5, offset: 7 }))
      .rejects.toMatchObject({ status: 502 });
  });

  test("refuses malformed page and job fields", async () => {
    const client = new MementosClient({
      baseUrl: "https://api.hasna.com/mementos",
      apiKey: "test-only-key",
      fetch: (async () => Response.json({
        contract: "mementos.sessions.jobs.v2",
        jobs: [{ ...job, status: "unknown" }],
        count: 1,
        limit: 5,
        offset: 7,
        has_more: false,
        next_offset: null,
      })) as typeof fetch,
    });

    await expect(client.listSessionJobs({ limit: 5, offset: 7 }))
      .rejects.toThrow("malformed 2xx response");
  });

});
