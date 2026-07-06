import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { WorkflowRun, WorkflowSpec } from "../types.js";
import {
  createOpenSessionsTraceSink,
  sanitizeOpenSessionsTracePayload,
  traceSessionIdForWorkflowRun,
  type OpenSessionsTraceEntry,
  type OpenSessionsTraceWriter,
} from "./opensessions-trace.js";

class MemoryTraceWriter implements OpenSessionsTraceWriter {
  readonly entries: OpenSessionsTraceEntry[] = [];

  write(entry: OpenSessionsTraceEntry): void {
    this.entries.push(entry);
  }
}

const workflow: WorkflowSpec = {
  id: "workflow",
  name: "Trace Workflow",
  version: 1,
  status: "active",
  steps: [
    {
      id: "agent",
      target: {
        type: "agent",
        provider: "codewith",
        prompt: "SECRET_PROMPT_VALUE must not leak",
        authProfile: "worker-one",
        routing: { taskId: "task-123", role: "worker" },
        worktree: {
          mode: "required",
          enabled: true,
          originalCwd: "/repo",
          cwd: "/worktree",
          path: "/worktree",
          branch: "openloops/task-123",
        },
      },
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const workflowRun: WorkflowRun = {
  id: "run-123",
  workflowId: workflow.id,
  workflowName: workflow.name,
  loopId: "loop-123",
  loopRunId: "loop-run-123",
  workItemId: "work-item-123",
  invocationId: "invocation-123",
  manifestPath: "/runs/run-123/manifest.json",
  status: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("OpenSessions trace sink", () => {
  test("uses deterministic workflow trace session ids", () => {
    expect(traceSessionIdForWorkflowRun("abc123")).toBe("openloops-workflow-abc123");
  });

  test("scrubs secrets, drops hidden reasoning fields, and bounds raw payloads", () => {
    const payload = sanitizeOpenSessionsTracePayload({
      Authorization: "Bearer q7Rt2xVz9LpW4mKe8sYw",
      reasoning: "hidden model reasoning must not be stored",
      thinking_tokens: 100,
      safe: "visible",
      raw: "x".repeat(9000),
    });
    const json = JSON.stringify(payload);
    expect(json).not.toContain("q7Rt2xVz9LpW4mKe8sYw");
    expect(json).not.toContain("hidden model reasoning");
    expect(json).not.toContain("thinking_tokens");
    expect(json).toContain("[redacted]");
    expect(json).toContain("visible");
    expect(json).toContain("[truncated");
  });

  test("emits visible provider progress without prompt or hidden reasoning leakage", async () => {
    const writer = new MemoryTraceWriter();
    const trace = await createOpenSessionsTraceSink(writer).attach({ workflow, workflowRun });
    await trace.emitAgentProgress(workflow.steps[0]!, {
      provider: "codewith",
      status: "running",
      summary: "worker is editing files",
      statusReason: "visible scheduler status",
      threadId: "thread-123",
      lastEventSeq: 7,
      reasoning: "hidden chain",
    } as Parameters<typeof trace.emitAgentProgress>[1]);

    const json = JSON.stringify(writer.entries);
    expect(json).toContain("worker is editing files");
    expect(json).toContain("task-123");
    expect(json).toContain("worker-one");
    expect(json).not.toContain("SECRET_PROMPT_VALUE");
    expect(json).not.toContain("hidden chain");
  });

  test("package-backed writer marks completed workflow traces ended", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "openloops-sessions-trace-test-"));
    const previousDir = process.env.HASNA_SESSIONS_DIR;
    const previousDb = process.env.HASNA_SESSIONS_DB_PATH;
    process.env.HASNA_SESSIONS_DIR = sessionsDir;
    process.env.HASNA_SESSIONS_DB_PATH = join(sessionsDir, "sessions.db");
    try {
      const sessions = await import("@hasna/sessions");
      sessions.resetDatabase();
      const trace = await createOpenSessionsTraceSink().attach({ workflow, workflowRun });
      await trace.emitStepStarted(workflow.steps[0]!, {
        id: "step-run",
        workflowRunId: workflowRun.id,
        stepId: "agent",
        sequence: 0,
        status: "running",
        startedAt: "2026-01-01T00:00:01.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      });
      await trace.emitStepFinished(workflow.steps[0]!, {
        id: "step-run",
        workflowRunId: workflowRun.id,
        stepId: "agent",
        sequence: 0,
        status: "succeeded",
        startedAt: "2026-01-01T00:00:01.000Z",
        finishedAt: "2026-01-01T00:00:02.000Z",
        durationMs: 1000,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
      });
      await trace.emitWorkflowFinished({
        ...workflowRun,
        status: "succeeded",
        finishedAt: "2026-01-01T00:00:03.000Z",
        durationMs: 3000,
        updatedAt: "2026-01-01T00:00:03.000Z",
      });

      const db = new Database(process.env.HASNA_SESSIONS_DB_PATH);
      try {
        const row = db
          .query<{ ended_at: string | null; duration_seconds: number | null; message_count: number; tool_call_count: number }, [string]>(
            "SELECT ended_at, duration_seconds, message_count, tool_call_count FROM sessions WHERE id = ?",
          )
          .get(trace.sessionId);
        expect(row?.ended_at).toBe("2026-01-01T00:00:03.000Z");
        expect(row?.duration_seconds).toBe(3);
        expect(row?.message_count).toBe(3);
        expect(row?.tool_call_count).toBe(0);
      } finally {
        db.close();
        sessions.closeDatabase();
      }
    } finally {
      if (previousDir === undefined) delete process.env.HASNA_SESSIONS_DIR;
      else process.env.HASNA_SESSIONS_DIR = previousDir;
      if (previousDb === undefined) delete process.env.HASNA_SESSIONS_DB_PATH;
      else process.env.HASNA_SESSIONS_DB_PATH = previousDb;
    }
  });
});
