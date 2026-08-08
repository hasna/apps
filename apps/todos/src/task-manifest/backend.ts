import type {
  TodosTaskManifestApplyResult,
  TodosTaskManifestCompensateRequest,
  TodosTaskManifestCompensationResult,
  TodosTaskManifestFaultPoint,
  TodosTaskManifestGraph,
  TodosTaskManifestReadback,
  TodosTaskManifestReceipt,
  TodosTaskManifest,
} from "./types.js";

export interface NormalizedTaskManifest {
  manifest: TodosTaskManifest;
  request_digest: string;
  result_digest: string;
  receipt_id: string;
  graph: TodosTaskManifestGraph;
  outbox: Array<{ id: string; topic: string; payload: Record<string, unknown>; digest: string }>;
  now: string;
}

export interface PreparedTaskManifestFaults {
  points: ReadonlySet<TodosTaskManifestFaultPoint>;
}

export interface TodosTaskManifestBackend {
  readonly kind: "sqlite" | "postgresql";
  apply(input: NormalizedTaskManifest, faults: PreparedTaskManifestFaults): Promise<TodosTaskManifestApplyResult>;
  readExact(receiptId: string): Promise<TodosTaskManifestApplyResult>;
  markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<void>;
  compensate(
    input: TodosTaskManifestCompensateRequest,
    receipt: TodosTaskManifestReceipt,
    compensationReceiptId: string,
    requestDigest: string,
    now: string,
  ): Promise<TodosTaskManifestCompensationResult>;
}

export function emptyReadback(): TodosTaskManifestReadback {
  return { plans: 0, tasks: 0, dependencies: 0, comments: 0, verifications: 0, complete: true };
}
