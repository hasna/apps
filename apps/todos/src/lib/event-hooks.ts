import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createConnection } from "node:net";
import { redactEvidenceText, redactValue } from "./redaction.js";
import { checkRunnerSandbox } from "./runner-sandbox.js";
import {
  loadConfig,
  saveConfig,
  type LocalEventHookConfig,
  type LocalEventHookTarget,
} from "./config.js";

export const LOCAL_EVENT_TYPES = [
  "task.assigned",
  "task.blocked",
  "task.started",
  "task.completed",
  "task.due",
  "task.due_soon",
  "task.failed",
  "task.sla_breached",
  "task.stale",
  "task.unblocked",
  "task.status_changed",
  "calendar.reminder",
  "plan.updated",
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "approval.decided",
  "import.finished",
  "export.finished",
] as const;

export type LocalEventType = typeof LOCAL_EVENT_TYPES[number] | string;

export interface LocalEventHookInput {
  name: string;
  events: string[];
  target: LocalEventHookTarget;
  enabled?: boolean;
  file_path?: string;
  socket_path?: string;
  command?: string;
  cwd?: string;
  sandbox?: string;
  env?: Record<string, string>;
  retry?: { attempts?: number; backoff_ms?: number };
}

export interface LocalEventEnvelope {
  id: string;
  type: LocalEventType;
  timestamp: string;
  payload: unknown;
  source: {
    package: "@hasna/todos";
    local_only: true;
  };
  integrity: {
    algorithm: "sha256";
    digest: string;
  };
}

export interface LocalEventHookDispatchInput {
  type: LocalEventType;
  payload?: unknown;
  hooks?: LocalEventHookConfig[];
  timestamp?: string;
}

export interface LocalEventHookDispatchResult {
  hook: string;
  event_id: string;
  event_type: LocalEventType;
  target: LocalEventHookTarget;
  status: "delivered" | "failed" | "skipped";
  attempts: number;
  integrity: LocalEventEnvelope["integrity"];
  output_summary?: string;
  error?: string;
}

const VALID_TARGETS = new Set<LocalEventHookTarget>(["stdout", "file", "socket", "script"]);

function safeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("event hook name is required");
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) throw new Error("event hook name may only contain letters, numbers, dot, underscore, or dash");
  return trimmed;
}

function normalizeEvents(events: string[]): string[] {
  const normalized = events.map((event) => event.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error("event hook requires at least one event");
  return Array.from(new Set(normalized)).sort();
}

function normalizeHook(input: LocalEventHookInput, existing?: LocalEventHookConfig): LocalEventHookConfig {
  if (!VALID_TARGETS.has(input.target)) throw new Error(`unsupported event hook target: ${input.target}`);
  if (input.target === "file" && !input.file_path && !existing?.file_path) throw new Error("file event hooks require file_path");
  if (input.target === "socket" && !input.socket_path && !existing?.socket_path) throw new Error("socket event hooks require socket_path");
  if (input.target === "script" && !input.command && !existing?.command) throw new Error("script event hooks require command");

  const timestamp = new Date().toISOString();
  return {
    ...existing,
    name: safeName(input.name),
    enabled: input.enabled ?? existing?.enabled ?? true,
    events: normalizeEvents(input.events.length > 0 ? input.events : existing?.events || []),
    target: input.target,
    file_path: input.file_path ?? existing?.file_path,
    socket_path: input.socket_path ?? existing?.socket_path,
    command: input.command ?? existing?.command,
    cwd: input.cwd ?? existing?.cwd,
    sandbox: input.sandbox ?? existing?.sandbox,
    env: input.env ?? existing?.env,
    retry: {
      attempts: clampAttempts(input.retry?.attempts ?? existing?.retry?.attempts ?? 1),
      backoff_ms: Math.max(0, input.retry?.backoff_ms ?? existing?.retry?.backoff_ms ?? 0),
    },
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
}

function clampAttempts(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.trunc(value)));
}

function eventMatches(hook: LocalEventHookConfig, eventType: LocalEventType): boolean {
  return hook.enabled !== false && (hook.events.includes("*") || hook.events.includes(eventType));
}

function canonicalEvent(input: Omit<LocalEventEnvelope, "integrity">): string {
  return JSON.stringify(input);
}

function buildEnvelope(type: LocalEventType, payload: unknown, timestamp = new Date().toISOString()): LocalEventEnvelope {
  const base: Omit<LocalEventEnvelope, "integrity"> = {
    id: randomUUID(),
    type,
    timestamp,
    payload: redactValue(payload ?? {}),
    source: { package: "@hasna/todos", local_only: true },
  };
  const digest = createHash("sha256").update(canonicalEvent(base)).digest("hex");
  return { ...base, integrity: { algorithm: "sha256", digest } };
}

function summarize(value: string): string | undefined {
  const redacted = redactEvidenceText(value.trim());
  if (!redacted) return undefined;
  return redacted.length > 1000 ? `${redacted.slice(0, 997)}...` : redacted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function writeSocket(socketPath: string, line: string): Promise<void> {
  await new Promise<void>((resolveWrite, rejectWrite) => {
    const socket = createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectWrite(new Error(`socket write timed out: ${socketPath}`));
    }, 1000);
    socket.on("error", (error) => {
      clearTimeout(timeout);
      rejectWrite(error);
    });
    socket.on("connect", () => {
      socket.end(line, () => {
        clearTimeout(timeout);
        resolveWrite();
      });
    });
  });
}

async function deliverScript(hook: LocalEventHookConfig, envelope: LocalEventEnvelope): Promise<{ exitCode: number; output?: string }> {
  const command = hook.command!;
  const cwd = hook.cwd || process.cwd();
  if (hook.sandbox) {
    const check = checkRunnerSandbox({ name: hook.sandbox, cwd, command, env: hook.env });
    if (!check.allowed) throw new Error(check.reasons.join("; "));
  }
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd,
    env: {
      ...process.env,
      ...(hook.env || {}),
      TODOS_EVENT_JSON: JSON.stringify(envelope),
      TODOS_EVENT_ID: envelope.id,
      TODOS_EVENT_TYPE: envelope.type,
      TODOS_EVENT_INTEGRITY: envelope.integrity.digest,
      TODOS_HOOK_NAME: hook.name,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: summarize([stdout, stderr].filter(Boolean).join("\n")) };
}

async function deliverHook(hook: LocalEventHookConfig, envelope: LocalEventEnvelope): Promise<LocalEventHookDispatchResult> {
  const line = `${JSON.stringify(envelope)}\n`;
  const maxAttempts = clampAttempts(hook.retry?.attempts ?? 1);
  const backoffMs = Math.max(0, hook.retry?.backoff_ms ?? 0);
  let lastError: string | undefined;
  let output: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (hook.target === "stdout") {
        output = line.trim();
      } else if (hook.target === "file") {
        const filePath = resolve(hook.file_path!);
        mkdirSync(dirname(filePath), { recursive: true });
        appendFileSync(filePath, line);
      } else if (hook.target === "socket") {
        await writeSocket(hook.socket_path!, line);
      } else {
        const result = await deliverScript(hook, envelope);
        output = result.output;
        if (result.exitCode !== 0) throw new Error(`script exited ${result.exitCode}${output ? `: ${output}` : ""}`);
      }
      return {
        hook: hook.name,
        event_id: envelope.id,
        event_type: envelope.type,
        target: hook.target,
        status: "delivered",
        attempts: attempt,
        integrity: envelope.integrity,
        output_summary: output,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && backoffMs > 0) await sleep(backoffMs);
    }
  }

  return {
    hook: hook.name,
    event_id: envelope.id,
    event_type: envelope.type,
    target: hook.target,
    status: "failed",
    attempts: maxAttempts,
    integrity: envelope.integrity,
    error: redactEvidenceText(lastError || "delivery failed"),
  };
}

export function upsertLocalEventHook(input: LocalEventHookInput): LocalEventHookConfig {
  const config = loadConfig();
  const existing = config.local_event_hooks?.[input.name];
  const hook = normalizeHook(input, existing);
  saveConfig({
    ...config,
    local_event_hooks: {
      ...(config.local_event_hooks || {}),
      [hook.name]: hook,
    },
  });
  return hook;
}

export function listLocalEventHooks(): LocalEventHookConfig[] {
  return Object.values(loadConfig().local_event_hooks || {}).sort((a, b) => a.name.localeCompare(b.name));
}

export function getLocalEventHook(name: string): LocalEventHookConfig | null {
  return loadConfig().local_event_hooks?.[safeName(name)] || null;
}

export function removeLocalEventHook(name: string): boolean {
  const config = loadConfig();
  const key = safeName(name);
  if (!config.local_event_hooks?.[key]) return false;
  const next = { ...config.local_event_hooks };
  delete next[key];
  saveConfig({ ...config, local_event_hooks: next });
  return true;
}

export async function emitLocalEventHooks(input: LocalEventHookDispatchInput): Promise<LocalEventHookDispatchResult[]> {
  const hooks = (input.hooks || listLocalEventHooks()).filter((hook) => eventMatches(hook, input.type));
  if (hooks.length === 0) return [];
  const envelope = buildEnvelope(input.type, input.payload, input.timestamp);
  return Promise.all(hooks.map((hook) => deliverHook(hook, envelope)));
}

export function emitLocalEventHooksQuiet(input: LocalEventHookDispatchInput): void {
  emitLocalEventHooks(input).catch(() => {});
}

export async function testLocalEventHook(name: string, input: Omit<LocalEventHookDispatchInput, "hooks">): Promise<LocalEventHookDispatchResult[]> {
  const hook = getLocalEventHook(name);
  if (!hook) throw new Error(`event hook not found: ${name}`);
  return emitLocalEventHooks({ ...input, hooks: [hook] });
}
