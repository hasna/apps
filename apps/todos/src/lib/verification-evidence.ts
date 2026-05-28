/**
 * Portable verification evidence records — commands, test results, CI links,
 * artifact refs, verifier identity, timestamps, confidence. Local-only storage.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { addArtifact } from "../db/artifacts.js";
import {
  VERIFICATION_SCHEMA_VERSION,
  type VerificationEvidenceRecord,
  type VerificationStatus,
  getVerificationRecord,
  listVerificationRecords,
} from "./verification-providers.js";

export const VERIFICATION_EVIDENCE_SCHEMA = "todos.verification_evidence.v1";

export interface VerificationCommandEntry {
  command: string;
  exit_code?: number;
  duration_ms?: number;
  stdout_ref?: string;
  stderr_ref?: string;
}

export interface VerificationTestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  duration_ms?: number;
  message?: string;
}

export interface VerificationLinkRef {
  label: string;
  url: string;
  kind?: "ci" | "deploy" | "pr" | "log" | "other";
}

export interface PortableVerificationEvidence {
  schema_version: typeof VERIFICATION_EVIDENCE_SCHEMA;
  id: string;
  task_id: string | null;
  run_record_id: string | null;
  agent_id: string | null;
  provider_name: string;
  provider_type: string;
  status: VerificationStatus;
  summary: string;
  confidence: number | null;
  commands: VerificationCommandEntry[];
  test_results: VerificationTestResult[];
  links: VerificationLinkRef[];
  artifact_ids: string[];
  log_excerpt: string | null;
  screenshot_paths: string[];
  verifier: {
    agent_id: string | null;
    session_id: string | null;
    machine_id: string | null;
  };
  started_at: string;
  completed_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface CreateVerificationEvidenceInput {
  task_id?: string;
  run_record_id?: string;
  agent_id?: string;
  session_id?: string;
  provider_name?: string;
  provider_type?: string;
  status: VerificationStatus;
  summary: string;
  confidence?: number;
  commands?: VerificationCommandEntry[];
  test_results?: VerificationTestResult[];
  links?: VerificationLinkRef[];
  artifact_ids?: string[];
  log_excerpt?: string;
  screenshot_paths?: string[];
  evidence_paths?: string[];
  metadata?: Record<string, unknown>;
}

export interface VerificationExportBundle {
  schema_version: typeof VERIFICATION_EVIDENCE_SCHEMA;
  exported_at: string;
  task_id: string | null;
  run_record_id: string | null;
  records: PortableVerificationEvidence[];
}

function getMachineId(): string {
  return process.env["TODOS_MACHINE_ID"] || require("node:os").hostname();
}

function evidencePayload(input: CreateVerificationEvidenceInput): Record<string, unknown> {
  return {
    commands: input.commands ?? [],
    test_results: input.test_results ?? [],
    links: input.links ?? [],
    artifact_ids: input.artifact_ids ?? [],
    log_excerpt: input.log_excerpt ?? null,
    screenshot_paths: input.screenshot_paths ?? [],
    verifier: {
      agent_id: input.agent_id ?? null,
      session_id: input.session_id ?? null,
      machine_id: getMachineId(),
    },
    metadata: input.metadata ?? {},
  };
}

export function toPortableEvidence(record: VerificationEvidenceRecord): PortableVerificationEvidence {
  const ev = record.evidence as Record<string, unknown>;
  const verifier = (ev.verifier as PortableVerificationEvidence["verifier"]) ?? {
    agent_id: null,
    session_id: null,
    machine_id: null,
  };
  return {
    schema_version: VERIFICATION_EVIDENCE_SCHEMA,
    id: record.id,
    task_id: record.task_id,
    run_record_id: (ev.run_record_id as string) ?? null,
    agent_id: (ev.agent_id as string) ?? verifier.agent_id ?? null,
    provider_name: record.provider_name,
    provider_type: record.provider_type,
    status: record.status,
    summary: record.summary,
    confidence: typeof ev.confidence === "number" ? ev.confidence : null,
    commands: (ev.commands as VerificationCommandEntry[]) ?? [],
    test_results: (ev.test_results as VerificationTestResult[]) ?? [],
    links: (ev.links as VerificationLinkRef[]) ?? [],
    artifact_ids: [
      ...(ev.artifact_ids as string[] ?? []),
      ...(record.artifact_id ? [record.artifact_id] : []),
    ],
    log_excerpt: (ev.log_excerpt as string) ?? (ev.stdout as string)?.slice(-2000) ?? null,
    screenshot_paths: (ev.screenshot_paths as string[]) ?? [],
    verifier,
    started_at: record.started_at,
    completed_at: record.completed_at,
    created_at: record.created_at,
    metadata: (ev.metadata as Record<string, unknown>) ?? {},
  };
}

export function createVerificationEvidence(
  input: CreateVerificationEvidenceInput,
  db?: Database,
): PortableVerificationEvidence {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  const artifactIds = [...(input.artifact_ids ?? [])];

  for (const path of input.evidence_paths ?? []) {
    const entityId = input.task_id ?? input.run_record_id ?? id;
    const artifact = addArtifact({
      entity_type: "verification",
      entity_id: entityId,
      source_path: path,
      storage_mode: "copy",
    }, d);
    artifactIds.push(artifact.id);
  }

  const payload = evidencePayload(input);
  payload.run_record_id = input.run_record_id ?? null;
  payload.agent_id = input.agent_id ?? null;
  payload.confidence = input.confidence ?? null;
  payload.artifact_ids = artifactIds;

  d.run(
    `INSERT INTO verification_records (
      id, task_id, provider_name, provider_type, status, summary, evidence,
      artifact_id, started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.task_id ?? null,
      input.provider_name ?? "manual",
      input.provider_type ?? "manual",
      input.status,
      input.summary,
      JSON.stringify(payload),
      artifactIds[0] ?? null,
      ts,
      ts,
      ts,
    ],
  );

  const record = getVerificationRecord(id, d)!;
  return toPortableEvidence(record);
}

export function listVerificationEvidence(
  filter: { task_id?: string; run_record_id?: string; agent_id?: string; limit?: number } = {},
  db?: Database,
): PortableVerificationEvidence[] {
  const records = listVerificationRecords(
    { task_id: filter.task_id, limit: filter.limit },
    db,
  );
  let portable = records.map(toPortableEvidence);
  if (filter.run_record_id) {
    portable = portable.filter((r) => r.run_record_id === filter.run_record_id);
  }
  if (filter.agent_id) {
    portable = portable.filter((r) => r.agent_id === filter.agent_id || r.verifier.agent_id === filter.agent_id);
  }
  return portable;
}

export function getVerificationEvidence(id: string, db?: Database): PortableVerificationEvidence | null {
  const record = getVerificationRecord(id, db);
  return record ? toPortableEvidence(record) : null;
}

export function exportVerificationEvidence(
  filter: { task_id?: string; run_record_id?: string } = {},
  db?: Database,
): VerificationExportBundle {
  const records = listVerificationEvidence(filter, db);
  return {
    schema_version: VERIFICATION_EVIDENCE_SCHEMA,
    exported_at: new Date().toISOString(),
    task_id: filter.task_id ?? null,
    run_record_id: filter.run_record_id ?? null,
    records,
  };
}

export function writeVerificationExport(bundle: VerificationExportBundle, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(bundle, null, 2), "utf8");
}
