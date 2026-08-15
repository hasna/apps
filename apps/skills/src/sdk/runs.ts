/**
 * Run protocol + atomic run services seam.
 *
 * The protocol declares the wire contract for skill runs: the lifecycle states
 * (admitted / leased / running / terminal), run_id, attempt_id, and lease_generation.
 * The zod schemas validate both admission and terminal payloads against
 * contractVersion 1 — the same version the shipped server emits on /api/v1/runs.
 *
 * The run services half is the atomic engine: admission, claim/lease, and transition.
 * The current implementation wraps the store's own atomic transitions (Postgres
 * `FOR UPDATE SKIP LOCKED`, SQLite `BEGIN IMMEDIATE` plus a conditional claim) — no
 * business logic is duplicated here.
 */
import { z } from "zod";
import {
  REMOTE_SKILL_RUN_CONTRACT_VERSION,
  normalizeRemoteSkillRunContract,
  type RemoteSkillRunContract,
} from "../lib/remote-run-contract.js";
import type {
  ApiPrincipal,
  ClaimRunInput,
  CreateRunInput,
  ServerRunRecord,
  ServerRunStatus,
  SkillsProductStore,
} from "../server/types.js";

/** Wire version shared by every run payload this SDK produces or consumes. */
export const RUN_PROTOCOL_VERSION = REMOTE_SKILL_RUN_CONTRACT_VERSION;

/** Lifecycle states of the run protocol (admitted → leased → running → terminal). */
export const RUN_PROTOCOL_STATES = ["admitted", "leased", "running", "terminal"] as const;
export type RunProtocolState = (typeof RUN_PROTOCOL_STATES)[number];

/** Stable run identifier (`run_id`). */
export type RunId = string;
/** Attempt identifier (`attempt_id`). */
export type AttemptId = string;
/** Fencing token for a claim (`lease_generation`). */
export type LeaseGeneration = number;

/** Admission: a run is accepted into the queue. */
export const runAdmissionSchema = z.object({
  contractVersion: z.literal(RUN_PROTOCOL_VERSION),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  leaseGeneration: z.number().int().nonnegative(),
  skill: z.string().min(1),
  status: z.literal("admitted"),
  createdAt: z.string().min(1),
});
export type RunAdmission = z.infer<typeof runAdmissionSchema>;

/** Lease: a worker has claimed the run. */
export const runLeaseSchema = z.object({
  contractVersion: z.literal(RUN_PROTOCOL_VERSION),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  leaseGeneration: z.number().int().nonnegative(),
  workerId: z.string().min(1),
  status: z.literal("leased"),
});
export type RunLease = z.infer<typeof runLeaseSchema>;

/** Terminal: the run reached a final state. */
export const runTerminalSchema = z.object({
  contractVersion: z.literal(RUN_PROTOCOL_VERSION),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  leaseGeneration: z.number().int().nonnegative(),
  skill: z.string().min(1),
  status: z.enum(["succeeded", "failed", "cancelled", "expired"]),
  completedAt: z.string().min(1),
});
export type RunTerminal = z.infer<typeof runTerminalSchema>;

/** Any single protocol message, discriminated by `status`. */
export const runProtocolSchema = z.discriminatedUnion("status", [
  runAdmissionSchema,
  runLeaseSchema,
  runTerminalSchema,
]);
export type RunProtocolMessage = z.infer<typeof runProtocolSchema>;

/** Map the store's status vocabulary onto the protocol lifecycle. */
export function protocolStateOf(status: ServerRunStatus): RunProtocolState {
  switch (status) {
    case "queued":
    case "waiting_for_approval":
    case "retrying":
      return "admitted";
    case "running":
    case "cancel_requested":
      return "leased";
    case "succeeded":
    case "failed":
    case "cancelled":
    case "expired":
    case "refunded":
      return "terminal";
  }
}

/** The current engine is single-attempt: the attempt id is the run id. */
export function attemptIdOf(run: Pick<ServerRunRecord, "id">): AttemptId {
  return run.id;
}

/** The current engine keeps no lease-generation counter; the first claim is generation 0. */
export function leaseGenerationOf(_run: Pick<ServerRunRecord, "id">): LeaseGeneration {
  return 0;
}

/** One atomic status transition on a run. */
export type RunTransition = Partial<
  Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">
>;

/** Atomic run services: admission, lease/claim, transition, and read. */
export interface RunService {
  admit(input: CreateRunInput): Promise<ServerRunRecord>;
  leaseNext(workerId: string): Promise<ServerRunRecord | null>;
  transition(runId: string, patch: RunTransition): Promise<ServerRunRecord | null>;
  get(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null>;
}

export interface RunServiceOptions {
  store: SkillsProductStore;
}

/** Current implementation: the store's own atomic transitions, unchanged. */
export function createRunService({ store }: RunServiceOptions): RunService {
  return {
    admit: (input) => store.createRun(input),
    leaseNext: (workerId) => store.claimNextRun({ workerId } satisfies ClaimRunInput),
    transition: (runId, patch) => store.updateRun(runId, patch),
    get: (principal, runId) => store.getRun(principal, runId),
  };
}

export { REMOTE_SKILL_RUN_CONTRACT_VERSION, normalizeRemoteSkillRunContract };
export type { RemoteSkillRunContract };
