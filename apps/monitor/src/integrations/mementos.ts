/**
 * MON-V2-08 — Mementos native adapter.
 *
 * One exact package-owned surface: `@hasna/mementos/sdk` `MementosClient.saveMemory`
 * (POST /v1/memories). No direct HTTP, CLI, or MCP path exists in this adapter —
 * this file REPLACES the previous direct-HTTP implementation that posted a
 * content-only body to /api/memories.
 *
 * The memory key is derived deterministically from the definition's
 * `keyTemplate` rendered against the run context, so repeated effects with the
 * same bucket/key land on the same memory row: the mementos package's merge
 * dedupe upserts on (key, scope, agent, project, session), updating the value
 * in place instead of creating a duplicate.
 *
 * Failures are non-fatal by default. An integration marked `required: true`
 * makes a CONFIRMED failure affect the run outcome; an UNKNOWN outcome (the
 * write may have landed) is never immediately blocking — the stable key makes
 * retry/reconciliation safe.
 */
import { createHash } from "node:crypto";
import { MementosClient, MementosError, type Memory } from "@hasna/mementos/sdk";
import type { DoctorReport } from "../doctor/index.js";
import type { MementosIntegrationConfig } from "./index.js";

export interface MementosAdapterConfig {
  /** Namespace/bucket the memory belongs to; rendered into the key surface. */
  bucket: string;
  /** Template for the memory key; supports {bucket} {slug} {runId} {actionIndex} {target} {operation}. */
  keyTemplate: string;
  /** required:true makes a confirmed failure affect the run outcome. Default false. */
  required?: boolean;
}

/** Stable identity of one effect: what the design calls hash(slug, run_id, action_index, target, operation). */
export interface MementosEffectContext {
  slug: string;
  runId: string;
  actionIndex: number;
  target: string;
  operation: string;
  [extra: string]: string | number | undefined;
}

export interface MementosSavePayload {
  /** Memory value. The mementos package applies its own secret redaction. */
  value: string;
  summary?: string;
  tags?: string[];
}

export type MementosFailureClass = "confirmed" | "unknown";

export type MementosOutcome =
  | { ok: true; memory: Memory; memoryId: string; key: string }
  | {
      ok: false;
      required: boolean;
      /** true only when the integration is required AND the failure is confirmed. */
      runBlocking: boolean;
      failureClass: MementosFailureClass;
      key: string;
      error: string;
    };

/** Stable effect key per design §3: hash(slug, run_id, action_index, target, operation). */
export function effectKey(context: MementosEffectContext): string {
  const parts = [
    context.slug,
    context.runId,
    String(context.actionIndex),
    context.target,
    context.operation,
  ].join("|");
  return createHash("sha256").update(parts).digest("hex");
}

/** Renders {var} placeholders from the context; unresolvable variables render as "". */
export function renderKeyTemplate(
  template: string,
  config: MementosAdapterConfig,
  context: MementosEffectContext,
): string {
  const vars: Record<string, string | number> = {
    ...context,
    bucket: config.bucket,
  };
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? "" : String(value);
  });
}

export class MementosAdapter {
  private readonly client: Pick<MementosClient, "saveMemory">;
  private readonly config: MementosAdapterConfig;

  constructor(client: Pick<MementosClient, "saveMemory">, config: MementosAdapterConfig) {
    if (!config.bucket || config.bucket.trim() === "") {
      throw new Error("MementosAdapter: bucket must be a non-empty string");
    }
    if (!config.keyTemplate || config.keyTemplate.trim() === "") {
      throw new Error("MementosAdapter: keyTemplate must be a non-empty string");
    }
    this.client = client;
    this.config = config;
  }

  private deriveKey(context: MementosEffectContext): string {
    const rendered = renderKeyTemplate(this.config.keyTemplate, this.config, context);
    if (rendered.trim() !== "") {
      return rendered;
    }
    // Rendered empty — never save an empty key; fall back to a stable
    // bucket:effect-key memory key so retries stay idempotent.
    return `${this.config.bucket}:${effectKey(context)}`;
  }

  private classify(
    error: unknown,
    key: string,
  ): Extract<MementosOutcome, { ok: false }> {
    const required = this.config.required ?? false;
    if (error instanceof MementosError) {
      // 4xx: the server rejected the request — nothing was persisted.
      // 5xx: the server failed; the upsert may or may not have landed.
      const failureClass: MementosFailureClass = error.status < 500 ? "confirmed" : "unknown";
      return {
        ok: false,
        required,
        runBlocking: required && failureClass === "confirmed",
        failureClass,
        key,
        error: `HTTP ${error.status}: ${error.message}`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      required,
      runBlocking: false,
      failureClass: "unknown",
      key,
      error: message,
    };
  }

  /** Save or update a memory in the configured bucket/key through MementosClient.saveMemory. */
  async save(
    context: MementosEffectContext,
    payload: MementosSavePayload,
  ): Promise<MementosOutcome> {
    const key = this.deriveKey(context);
    try {
      const memory = await this.client.saveMemory({
        key,
        value: payload.value,
        summary: payload.summary,
        tags: payload.tags,
      });
      return { ok: true, memory, memoryId: memory.id, key };
    } catch (error) {
      return this.classify(error, key);
    }
  }
}

/** Adapter factory using the package's own env-resolved client unless one is supplied. */
export function createMementosAdapter(
  config: MementosAdapterConfig,
  client?: MementosClient,
): MementosAdapter {
  return new MementosAdapter(client ?? MementosClient.fromEnv(), config);
}

// ── Legacy dispatcher surface (kept; now routed through the SDK adapter) ──────

function buildMemoryContent(machineId: string, report: DoctorReport): string {
  const ts = new Date(report.ts).toISOString();
  const lines: string[] = [
    `Machine health snapshot for '${machineId}' at ${ts}`,
    `Overall status: ${report.overallStatus.toUpperCase()}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    lines.push(`  ${icon} ${check.name}: ${check.message}`);
  }

  if (report.recommendedActions.length > 0) {
    lines.push("", "Recommended actions:");
    for (const action of report.recommendedActions) {
      lines.push(`  → ${action}`);
    }
  }

  return lines.join("\n");
}

function adapterClient(config: MementosIntegrationConfig, client?: MementosClient): MementosClient {
  if (client) return client;
  if (config.base_url) {
    return new MementosClient({ baseUrl: config.base_url });
  }
  return MementosClient.fromEnv();
}

/**
 * Save a health snapshot as a memory. Compatible with the legacy dispatcher
 * signature; implemented over `MementosAdapter` (MementosClient.saveMemory).
 * The memory key is stable per machine (`health:{target}` by default), so
 * repeated snapshots for the same machine upsert one memory row instead of
 * duplicating. Throws on any failed outcome; the dispatcher keeps failures
 * non-fatal by catching.
 */
export async function saveHealthMemory(
  machineId: string,
  report: DoctorReport,
  config: MementosIntegrationConfig,
  client?: MementosClient,
): Promise<void> {
  const adapter = new MementosAdapter(adapterClient(config, client), {
    bucket: config.bucket ?? "monitor",
    keyTemplate: config.keyTemplate ?? "health:{target}",
    required: config.required ?? false,
  });

  const outcome = await adapter.save(
    {
      slug: "health",
      runId: machineId,
      actionIndex: 0,
      target: machineId,
      operation: "snapshot",
    },
    {
      value: buildMemoryContent(machineId, report),
      summary: `Machine health: ${report.overallStatus}`,
      tags: ["monitor", "health", machineId, report.overallStatus],
    },
  );

  if (!outcome.ok) {
    throw new Error(`mementos saveHealthMemory failed: ${outcome.error}`);
  }
  console.error(
    `[monitor:integrations:mementos] saved health memory for ${machineId} (status: ${report.overallStatus})`,
  );
}
