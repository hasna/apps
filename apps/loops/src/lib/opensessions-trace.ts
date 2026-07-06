import type {
  AgentProgressInfo,
  ExecutionMetadata,
  SpawnedProcessInfo,
} from "./executor.js";
import type { ExecutableTarget, Loop, LoopRun, WorkflowEvent, WorkflowRun, WorkflowSpec, WorkflowStep, WorkflowStepRun } from "../types.js";
import { publicWorkflowEvent, publicWorkflowStepRun } from "./format.js";
import { scrubSecrets, scrubSecretsDeep } from "./redact.js";

const TRACE_CONTENT_LIMIT = 4 * 1024;
const TRACE_RAW_LIMIT = 8 * 1024;
const SESSIONS_SOURCE = "codex";
const HIDDEN_REASONING_KEYS = ["reasoning", "thinking", "thought", "chainofthought", "chain_of_thought", "rawresponse"];
const SENSITIVE_TRACE_KEYS = [
  "authorization",
  "token",
  "apikey",
  "api_key",
  "secret",
  "password",
  "credential",
  "env",
  "prompt",
  "stdin",
];

export interface OpenSessionsTraceContext {
  workflow: WorkflowSpec;
  workflowRun: WorkflowRun;
  loop?: Loop;
  loopRun?: LoopRun;
}

export interface OpenSessionsTraceEntry {
  id: string;
  sessionId: string;
  sourceId: string;
  role: "assistant" | "info" | "tool";
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  toolCall?: {
    id: string;
    name: string;
    input?: string;
    output?: string;
    durationMs?: number;
    status?: "success" | "error" | "timeout";
  };
}

export interface OpenSessionsTraceWriter {
  write(entry: OpenSessionsTraceEntry, context: OpenSessionsTraceContext): Promise<void> | void;
}

export interface OpenSessionsTraceRun {
  readonly sessionId: string;
  readonly sourceId: string;
  emitWorkflowEvent(event: WorkflowEvent): Promise<void>;
  emitStepStarted(step: WorkflowStep, stepRun: WorkflowStepRun): Promise<void>;
  emitSpawn(step: WorkflowStep, pid: number | SpawnedProcessInfo): Promise<void>;
  emitAgentProgress(step: WorkflowStep, progress: AgentProgressInfo): Promise<void>;
  emitStepFinished(step: WorkflowStep, stepRun: WorkflowStepRun): Promise<void>;
  emitWorkflowFinished(run: WorkflowRun): Promise<void>;
}

export interface OpenSessionsTraceSink {
  attach(context: OpenSessionsTraceContext): Promise<OpenSessionsTraceRun>;
}

export function traceSessionIdForWorkflowRun(workflowRunId: string): string {
  return `openloops-workflow-${workflowRunId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function compactJson(value: unknown, limit: number): string {
  const text = scrubSecrets(JSON.stringify(value, null, 2));
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`;
}

function hiddenReasoningKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, "");
  return HIDDEN_REASONING_KEYS.some((hidden) => normalized.includes(hidden));
}

function sensitiveTraceKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, "");
  return SENSITIVE_TRACE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

export function sanitizeOpenSessionsTracePayload(value: unknown, limit = TRACE_RAW_LIMIT): unknown {
  if (typeof value === "string") {
    const scrubbed = scrubSecrets(value);
    return scrubbed.length <= limit ? scrubbed : `${scrubbed.slice(0, limit)}\n[truncated ${scrubbed.length - limit} chars]`;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeOpenSessionsTracePayload(entry, limit));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (hiddenReasoningKey(key)) continue;
    if (sensitiveTraceKey(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeOpenSessionsTracePayload(entry, limit);
  }
  return scrubSecretsDeep(output);
}

function traceContent(lines: string[]): string {
  const content = scrubSecrets(lines.filter(Boolean).join("\n"));
  if (content.length <= TRACE_CONTENT_LIMIT) return content;
  return `${content.slice(0, TRACE_CONTENT_LIMIT)}\n[truncated ${content.length - TRACE_CONTENT_LIMIT} chars]`;
}

function targetSummary(target: ExecutableTarget): Record<string, unknown> {
  if (target.type === "command") {
    return sanitizeOpenSessionsTracePayload({
      type: "command",
      command: target.shell ? "shell" : target.command,
      shellCommand: target.shell ? `[redacted ${target.command.length} chars]` : undefined,
      args: target.args?.length ? `[redacted ${target.args.length} args]` : undefined,
      cwd: target.cwd,
      shell: target.shell,
      timeoutMs: target.timeoutMs,
      idleTimeoutMs: target.idleTimeoutMs,
      accountProfile: target.account?.profile,
      accountTool: target.account?.tool,
      env: target.env ? "[redacted]" : undefined,
    }) as Record<string, unknown>;
  }
  return sanitizeOpenSessionsTracePayload({
    type: "agent",
    provider: target.provider,
    cwd: target.cwd,
    model: target.model,
    variant: target.variant,
    authProfile: target.authProfile,
    accountProfile: target.account?.profile,
    accountTool: target.account?.tool,
    worktree: target.worktree,
    routing: target.routing,
    prompt: "[redacted]",
  }) as Record<string, unknown>;
}

function baseMetadata(context: OpenSessionsTraceContext, step?: WorkflowStep): Record<string, unknown> {
  return sanitizeOpenSessionsTracePayload({
    traceKind: "openloops.workflow",
    workflowRunId: context.workflowRun.id,
    workflowId: context.workflow.id,
    workflowName: context.workflow.name,
    loopId: context.workflowRun.loopId ?? context.loop?.id,
    loopRunId: context.workflowRun.loopRunId ?? context.loopRun?.id,
    taskId: step?.target.type === "agent" ? step.target.routing?.taskId : undefined,
    eventId: step?.target.type === "agent" ? step.target.routing?.eventId : undefined,
    invocationId: context.workflowRun.invocationId,
    workItemId: context.workflowRun.workItemId,
    manifestPath: context.workflowRun.manifestPath,
    stepId: step?.id,
    provider: step?.target.type === "agent" ? step.target.provider : undefined,
    authProfile: step?.target.type === "agent" ? step.target.authProfile : undefined,
    accountProfile: step?.account?.profile ?? step?.target.account?.profile,
    accountTool: step?.account?.tool ?? step?.target.account?.tool,
    worktreePath: step?.target.type === "agent" ? (step.target.worktree?.path ?? step.target.worktree?.cwd) : undefined,
    cwd: step?.target.cwd,
  }) as Record<string, unknown>;
}

function toolStatus(status: WorkflowStepRun["status"]): "success" | "error" | "timeout" {
  if (status === "succeeded" || status === "skipped") return "success";
  if (status === "timed_out") return "timeout";
  return "error";
}

class WriterTraceRun implements OpenSessionsTraceRun {
  readonly sessionId: string;
  readonly sourceId: string;

  constructor(
    private readonly writer: OpenSessionsTraceWriter,
    private readonly context: OpenSessionsTraceContext,
  ) {
    this.sessionId = traceSessionIdForWorkflowRun(context.workflowRun.id);
    this.sourceId = this.sessionId;
  }

  async emitWorkflowEvent(event: WorkflowEvent): Promise<void> {
    const publicEvent = sanitizeOpenSessionsTracePayload(publicWorkflowEvent(event));
    await this.write({
      id: `${this.sessionId}-event-${event.sequence}`,
      role: "info",
      content: traceContent([
        `workflow event: ${event.eventType}`,
        event.stepId ? `step: ${event.stepId}` : "",
        compactJson(publicEvent, TRACE_CONTENT_LIMIT),
      ]),
      timestamp: event.createdAt,
      metadata: { ...baseMetadata(this.context), eventType: event.eventType, sequence: event.sequence, payload: publicEvent },
    });
  }

  async emitStepStarted(step: WorkflowStep, stepRun: WorkflowStepRun): Promise<void> {
    await this.write({
      id: `${this.sessionId}-step-${step.id}-started`,
      role: step.target.type === "agent" ? "assistant" : "tool",
      content: traceContent([`step started: ${step.id}`, compactJson(targetSummary(step.target), TRACE_CONTENT_LIMIT)]),
      timestamp: stepRun.startedAt ?? stepRun.updatedAt,
      metadata: { ...baseMetadata(this.context, step), eventType: "step_started", step: publicWorkflowStepRun(stepRun) },
      toolCall: step.target.type === "command" ? {
        id: `${this.sessionId}-tool-${step.id}`,
        name: step.target.shell ? "shell" : step.target.command,
        input: compactJson(targetSummary(step.target), TRACE_RAW_LIMIT),
        status: "success",
      } : undefined,
    });
  }

  async emitSpawn(step: WorkflowStep, pid: number | SpawnedProcessInfo): Promise<void> {
    const pidValue = typeof pid === "number" ? pid : pid.pid;
    await this.write({
      id: `${this.sessionId}-step-${step.id}-spawn-${pidValue}`,
      role: "tool",
      content: traceContent([`process spawned: pid=${pidValue}`, `step: ${step.id}`]),
      timestamp: typeof pid === "number" ? nowIso() : pid.processStartedAt,
      metadata: { ...baseMetadata(this.context, step), eventType: "process_spawned", pid: pidValue, process: pid },
    });
  }

  async emitAgentProgress(step: WorkflowStep, progress: AgentProgressInfo): Promise<void> {
    const payload = sanitizeOpenSessionsTracePayload(progress) as Record<string, unknown>;
    await this.write({
      id: `${this.sessionId}-step-${step.id}-agent-progress-${progress.lastEventSeq ?? Date.now()}`,
      role: "assistant",
      content: traceContent([
        `agent progress: ${progress.provider}`,
        progress.status ? `status: ${progress.status}` : "",
        progress.summary ? `summary: ${progress.summary}` : "",
        compactJson(payload, TRACE_CONTENT_LIMIT),
      ]),
      timestamp: nowIso(),
      metadata: { ...baseMetadata(this.context, step), eventType: "agent_progress", progress: payload },
    });
  }

  async emitStepFinished(step: WorkflowStep, stepRun: WorkflowStepRun): Promise<void> {
    const publicStep = sanitizeOpenSessionsTracePayload(publicWorkflowStepRun(stepRun));
    await this.write({
      id: `${this.sessionId}-step-${step.id}-${stepRun.status}`,
      role: step.target.type === "agent" ? "assistant" : "tool",
      content: traceContent([
        `step ${stepRun.status}: ${step.id}`,
        stepRun.exitCode !== undefined ? `exitCode: ${stepRun.exitCode}` : "",
        stepRun.error ? `error: ${stepRun.error}` : "",
        compactJson(publicStep, TRACE_CONTENT_LIMIT),
      ]),
      timestamp: stepRun.finishedAt ?? stepRun.updatedAt,
      metadata: { ...baseMetadata(this.context, step), eventType: `step_${stepRun.status}`, step: publicStep },
      toolCall: step.target.type === "command" ? {
        id: `${this.sessionId}-tool-${step.id}`,
        name: step.target.shell ? "shell" : step.target.command,
        input: compactJson(targetSummary(step.target), TRACE_RAW_LIMIT),
        output: compactJson(publicStep, TRACE_RAW_LIMIT),
        durationMs: stepRun.durationMs,
        status: toolStatus(stepRun.status),
      } : undefined,
    });
  }

  async emitWorkflowFinished(run: WorkflowRun): Promise<void> {
    const finalContext = { ...this.context, workflowRun: run };
    await this.write({
      id: `${this.sessionId}-workflow-${run.status}`,
      role: "info",
      content: traceContent([
        `workflow ${run.status}: ${run.workflowName}`,
        run.error ? `error: ${run.error}` : "",
      ]),
      timestamp: run.finishedAt ?? run.updatedAt,
      metadata: { ...baseMetadata(finalContext), eventType: run.status, status: run.status },
    }, finalContext);
  }

  private async write(
    input: Omit<OpenSessionsTraceEntry, "sessionId" | "sourceId">,
    context: OpenSessionsTraceContext = this.context,
  ): Promise<void> {
    await this.writer.write({
      ...input,
      sessionId: this.sessionId,
      sourceId: this.sourceId,
      content: scrubSecrets(input.content),
      metadata: sanitizeOpenSessionsTracePayload(input.metadata) as Record<string, unknown>,
    }, context);
  }
}

export class OpenSessionsTraceSinkImpl implements OpenSessionsTraceSink {
  constructor(private readonly writer: OpenSessionsTraceWriter) {}

  async attach(context: OpenSessionsTraceContext): Promise<OpenSessionsTraceRun> {
    return new WriterTraceRun(this.writer, context);
  }
}

interface SessionsDatabaseModule {
  getDatabase?: () => {
    prepare: (sql: string) => {
      run: (...args: unknown[]) => unknown;
    };
  };
}

let cachedSessionsModule: Promise<SessionsDatabaseModule | undefined> | undefined;

async function loadSessionsModule(): Promise<SessionsDatabaseModule | undefined> {
  cachedSessionsModule ??= import("@hasna/sessions")
    .then((mod) => mod as unknown as SessionsDatabaseModule)
    .catch(() => undefined);
  return cachedSessionsModule;
}

class PackageOpenSessionsWriter implements OpenSessionsTraceWriter {
  async write(entry: OpenSessionsTraceEntry, context: OpenSessionsTraceContext): Promise<void> {
    const sessions = await loadSessionsModule();
    if (!sessions?.getDatabase) throw new Error("@hasna/sessions package is not available");
    const db = sessions.getDatabase();
    const startedAt = context.workflowRun.startedAt ?? entry.timestamp;
    const endedAt = context.workflowRun.finishedAt ?? null;
    const metadata = sanitizeOpenSessionsTracePayload({
      ...baseMetadata(context),
      traceSessionId: entry.sessionId,
      source: "openloops",
    });
    db.prepare(
      `INSERT INTO sessions (
        id, source, source_id, source_path, title, project_path, project_name,
        model, model_provider, git_branch, git_sha, git_origin_url, cli_version,
        is_subagent, parent_session_id, total_input_tokens, total_output_tokens,
        total_cache_read_tokens, total_cache_write_tokens, total_thinking_tokens,
        message_count, tool_call_count, started_at, ended_at, duration_seconds,
        ingested_at, updated_at, source_modified_at, machine, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        title = excluded.title,
        project_path = excluded.project_path,
        ended_at = excluded.ended_at,
        duration_seconds = excluded.duration_seconds,
        updated_at = excluded.updated_at,
        metadata = excluded.metadata`,
    ).run(
      entry.sessionId,
      SESSIONS_SOURCE,
      entry.sourceId,
      context.workflowRun.manifestPath ?? null,
      `OpenLoops ${context.workflowRun.workflowName} ${context.workflowRun.id}`,
      context.workflowRun.manifestPath ?? null,
      "open-loops",
      null,
      "openloops",
      null,
      null,
      null,
      null,
      1,
      null,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      startedAt,
      endedAt,
      context.workflowRun.durationMs === undefined ? null : context.workflowRun.durationMs / 1000,
      entry.timestamp,
      null,
      JSON.stringify(metadata),
    );
    db.prepare(
      `INSERT INTO messages (
        id, session_id, source_id, parent_message_id, role, content, content_preview, model,
        is_sidechain, sequence_num, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, thinking_tokens, timestamp, metadata
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, 0, NULL, 0, 0, 0, 0, 0, ?, ?)
      ON CONFLICT(session_id, source_id) DO UPDATE SET
        role = excluded.role,
        content = excluded.content,
        content_preview = excluded.content_preview,
        timestamp = excluded.timestamp,
        metadata = excluded.metadata`,
    ).run(
      entry.id,
      entry.sessionId,
      entry.id,
      entry.role,
      entry.content,
      entry.content.slice(0, 240),
      entry.timestamp,
      JSON.stringify(entry.metadata),
    );
    if (entry.toolCall) {
      db.prepare(
        `INSERT INTO tool_calls (
          id, message_id, session_id, tool_name, tool_input, tool_output, duration_ms, status, timestamp, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          message_id = excluded.message_id,
          tool_input = excluded.tool_input,
          tool_output = excluded.tool_output,
          duration_ms = excluded.duration_ms,
          status = excluded.status,
          timestamp = excluded.timestamp,
          metadata = excluded.metadata`,
      ).run(
        entry.toolCall.id,
        entry.id,
        entry.sessionId,
        entry.toolCall.name,
        entry.toolCall.input ?? null,
        entry.toolCall.output ?? null,
        entry.toolCall.durationMs ?? null,
        entry.toolCall.status ?? null,
        entry.timestamp,
        JSON.stringify(entry.metadata),
      );
    }
    db.prepare("UPDATE sessions SET message_count = (SELECT COUNT(*) FROM messages WHERE session_id = ?), tool_call_count = (SELECT COUNT(*) FROM tool_calls WHERE session_id = ?) WHERE id = ?")
      .run(entry.sessionId, entry.sessionId, entry.sessionId);
  }
}

export function createOpenSessionsTraceSink(writer: OpenSessionsTraceWriter = new PackageOpenSessionsWriter()): OpenSessionsTraceSink {
  return new OpenSessionsTraceSinkImpl(writer);
}

export async function traceWorkflowEventBestEffort(
  trace: OpenSessionsTraceRun | undefined,
  event: WorkflowEvent | undefined,
  onError: (error: unknown) => void,
): Promise<void> {
  if (!trace || !event) return;
  try {
    await trace.emitWorkflowEvent(event);
  } catch (error) {
    onError(error);
  }
}

export function openSessionsTraceErrorMessage(error: unknown): string {
  return scrubSecrets(error instanceof Error ? error.message : String(error));
}

export type { ExecutionMetadata };
