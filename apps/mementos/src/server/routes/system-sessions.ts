import {
  SESSION_INGEST_CONTRACT,
  SESSION_JOBS_PAGE_CONTRACT,
  createSessionJob,
  getSessionJob,
  listSessionJobs,
} from "../../db/session-jobs.js";
import { enqueueSessionJob, getSessionQueueStats } from "../../lib/session-queue.js";
import { autoResolveAgentProject } from "../../lib/session-auto-resolve.js";
import { addRoute } from "../router.js";
import { json, errorResponse, readJson } from "../helpers.js";

function boundedIntegerQuery(
  url: URL,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function registerSystemSessionRoutes(): void {
  addRoute("POST", "/api/sessions/ingest", async (req) => {
    const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
    const { transcript, session_id, agent_id, project_id, source, metadata } = body;
    if (!transcript || typeof transcript !== "string") return errorResponse("transcript is required", 400);
    if (!session_id || typeof session_id !== "string") return errorResponse("session_id is required", 400);

    let resolvedAgentId = agent_id as string | undefined;
    let resolvedProjectId = project_id as string | undefined;
    if (!resolvedAgentId || !resolvedProjectId) {
      const resolved = autoResolveAgentProject((metadata ?? {}) as Record<string, string>);
      if (!resolvedAgentId && resolved.agentId) resolvedAgentId = resolved.agentId;
      if (!resolvedProjectId && resolved.projectId) resolvedProjectId = resolved.projectId;
    }

    const job = createSessionJob({
      session_id: session_id as string,
      transcript: transcript as string,
      source: (source as "claude-code" | "codex" | "manual" | "open-sessions") ?? "manual",
      agent_id: resolvedAgentId,
      project_id: resolvedProjectId,
      metadata: (metadata as Record<string, unknown>) ?? {},
    });
    enqueueSessionJob(job.id);
    const { transcript: _transcript, ...jobReceipt } = job;
    return json({
      contract: SESSION_INGEST_CONTRACT,
      job_id: job.id,
      status: "queued",
      message: "Session queued for memory extraction",
      job: jobReceipt,
    }, 202);
  });

  addRoute("GET", "/api/sessions/jobs", (_req, url) => {
    const agentId = url.searchParams.get("agent_id") ?? undefined;
    const projectId = url.searchParams.get("project_id") ?? undefined;
    const sessionId = url.searchParams.get("session_id") ?? undefined;
    const rawStatus = url.searchParams.get("status");
    const status = rawStatus ?? undefined;
    if (rawStatus !== null && !["pending", "processing", "completed", "failed"].includes(rawStatus)) {
      return errorResponse("status must be one of: pending, processing, completed, failed", 400);
    }
    let limit: number;
    let offset: number;
    try {
      limit = boundedIntegerQuery(url, "limit", 20, 1, 1000);
      offset = boundedIntegerQuery(url, "offset", 0, 0, Number.MAX_SAFE_INTEGER - 1001);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
    const page = listSessionJobs({
      agent_id: agentId,
      project_id: projectId,
      session_id: sessionId,
      status: status as "pending" | "processing" | "completed" | "failed" | undefined,
      limit: limit + 1,
      offset,
    });
    const hasMore = page.length > limit;
    const jobs = hasMore ? page.slice(0, limit) : page;
    return json({
      contract: SESSION_JOBS_PAGE_CONTRACT,
      jobs,
      count: jobs.length,
      limit,
      offset,
      has_more: hasMore,
      next_offset: hasMore ? offset + jobs.length : null,
    });
  });

  addRoute("GET", "/api/sessions/jobs/:id", (_req, _url, params) => {
    const job = getSessionJob(params["id"]!);
    if (!job) return errorResponse("Session job not found", 404);
    return json(job);
  });

  addRoute("GET", "/api/sessions/queue/stats", () => json(getSessionQueueStats()));
}
