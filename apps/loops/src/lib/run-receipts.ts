import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { boundedExcerpt, summarizeOutput } from "./run-envelope.js";
import type { Loop, LoopRun, RunReceipt, RunReceiptBundle, RunReceiptMachine, RunReceiptSummary, WriteRunReceiptInput } from "../types.js";

export const RUN_RECEIPT_SUMMARY_TEXT_CHARS = 4096;
export const RUN_RECEIPT_MAX_IDS = 100;
export const RUN_RECEIPT_MAX_EVIDENCE_PATHS = 100;
export const RUN_RECEIPT_MAX_PATH_CHARS = 1024;

export interface NormalizeRunReceiptOptions {
  now?: Date;
  loop?: Loop;
  run?: LoopRun;
  defaultMachine?: RunReceiptMachine;
  defaultRepo?: string;
  existing?: RunReceipt;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestReceipt(receipt: Omit<RunReceipt, "digest_id" | "created_at" | "updated_at">): string {
  return `sha256:${createHash("sha256").update(canonicalJson(receipt)).digest("hex")}`;
}

function isoOrNull(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid ISO date/time`);
  return date.toISOString();
}

function nonEmpty(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} must be non-empty`);
  return trimmed;
}

function normalizedStringArray(values: string[] | undefined, opts: { max: number; label: string; itemMax?: number }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const value = String(raw).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(opts.itemMax ? value.slice(0, opts.itemMax) : value);
    if (out.length >= opts.max) break;
  }
  if ((values?.length ?? 0) > opts.max) {
    out.push(`[truncated ${values!.length - opts.max} ${opts.label}]`);
  }
  return out;
}

function receiptMachine(input: WriteRunReceiptInput, opts: NormalizeRunReceiptOptions): RunReceiptMachine {
  if (typeof input.machine === "string") return nonEmpty(input.machine, "machine");
  if (input.machine && typeof input.machine === "object") return input.machine;
  if (opts.loop?.machine) return { ...opts.loop.machine };
  if (typeof opts.defaultMachine === "string") return nonEmpty(opts.defaultMachine, "machine");
  if (opts.defaultMachine && typeof opts.defaultMachine === "object") return opts.defaultMachine;
  return hostname();
}

function normalizeSummary(input: WriteRunReceiptInput, run?: LoopRun): RunReceiptSummary {
  const stdout = input.stdout ?? run?.stdout;
  const stderr = input.stderr ?? run?.stderr;
  const output = summarizeOutput(stdout, stderr);
  const summaryInput = input.summary;
  const provided = typeof summaryInput === "object" && summaryInput !== null ? summaryInput : {};
  const text = typeof summaryInput === "string"
    ? boundedExcerpt(summaryInput, Math.floor(RUN_RECEIPT_SUMMARY_TEXT_CHARS / 2))
    : typeof provided.text === "string"
      ? boundedExcerpt(provided.text, Math.floor(RUN_RECEIPT_SUMMARY_TEXT_CHARS / 2))
      : undefined;
  return {
    text,
    stdout_bytes: Number.isFinite(provided.stdout_bytes) ? Number(provided.stdout_bytes) : output.stdoutBytes,
    stderr_bytes: Number.isFinite(provided.stderr_bytes) ? Number(provided.stderr_bytes) : output.stderrBytes,
    stdout_excerpt: typeof provided.stdout_excerpt === "string" ? boundedExcerpt(provided.stdout_excerpt) : output.stdoutExcerpt,
    stderr_excerpt: typeof provided.stderr_excerpt === "string" ? boundedExcerpt(provided.stderr_excerpt) : output.stderrExcerpt,
    error: typeof provided.error === "string" ? boundedExcerpt(provided.error) : boundedExcerpt(input.error ?? run?.error),
    duration_ms: Number.isFinite(provided.duration_ms) ? Number(provided.duration_ms) : input.duration_ms ?? run?.durationMs,
  };
}

export function normalizeRunReceipt(input: WriteRunReceiptInput, opts: NormalizeRunReceiptOptions = {}): RunReceipt {
  const now = (opts.now ?? new Date()).toISOString();
  const run = opts.run;
  const loopId = input.loop_id ?? run?.loopId ?? opts.loop?.id;
  const normalized: Omit<RunReceipt, "digest_id" | "created_at" | "updated_at"> = {
    loop_id: nonEmpty(loopId, "loop_id"),
    run_id: nonEmpty(input.run_id ?? run?.id, "run_id"),
    machine: receiptMachine(input, opts),
    repo: nonEmpty(input.repo ?? opts.defaultRepo ?? targetRepo(opts.loop) ?? process.cwd(), "repo"),
    task_ids: normalizedStringArray(input.task_ids, { max: RUN_RECEIPT_MAX_IDS, label: "task_ids" }),
    knowledge_ids: normalizedStringArray(input.knowledge_ids, { max: RUN_RECEIPT_MAX_IDS, label: "knowledge_ids" }),
    started_at: isoOrNull(input.started_at ?? run?.startedAt, "started_at"),
    finished_at: isoOrNull(input.finished_at ?? run?.finishedAt, "finished_at"),
    status: nonEmpty(input.status ?? run?.status, "status"),
    exit_code: input.exit_code === undefined ? run?.exitCode ?? null : input.exit_code,
    summary: normalizeSummary(input, run),
    evidence_paths: normalizedStringArray(input.evidence_paths, {
      max: RUN_RECEIPT_MAX_EVIDENCE_PATHS,
      label: "evidence_paths",
      itemMax: RUN_RECEIPT_MAX_PATH_CHARS,
    }),
    bundle: normalizeReceiptBundle(input.bundle ?? opts.existing?.bundle ?? null),
  };
  return {
    ...normalized,
    digest_id: input.digest_id?.trim() || digestReceipt(normalized),
    created_at: opts.existing?.created_at ?? now,
    updated_at: now,
  };
}

/**
 * Accept a bundle stamp only when all three fields are well-formed.
 *
 * A partially-filled stamp would enter the receipt digest and make the receipt
 * look like it proved something it did not; `null` is the honest answer for an
 * unbundled loop.
 */
function normalizeReceiptBundle(value: RunReceiptBundle | null | undefined): RunReceiptBundle | null {
  if (!value || typeof value !== "object") return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const digest = typeof value.digest === "string" ? value.digest.trim() : "";
  const version = value.version;
  if (!name || !/^sha256:[0-9a-f]{64}$/.test(digest)) return null;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return null;
  return { name: name.slice(0, 128), version, digest };
}

function targetRepo(loop: Loop | undefined): string | undefined {
  if (!loop) return undefined;
  if (loop.target.type === "command") return loop.target.cwd;
  if (loop.target.type === "agent") return loop.target.cwd;
  return undefined;
}
