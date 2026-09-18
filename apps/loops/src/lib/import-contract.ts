import { createHash, randomUUID } from "node:crypto";
import type { Loop, LoopRun, WorkflowSpec } from "../types.js";

export const LOOPS_IMPORT_RECEIPT_CONTRACT = "loops.import.v2" as const;

export type ImportWorkflowRow = WorkflowSpec;
export type ImportLoopRow = Loop;
export type ImportRunRow = LoopRun;

export interface ImportContractInput {
  operationId?: string;
  workflows?: ImportWorkflowRow[];
  loops?: ImportLoopRow[];
  runs?: ImportRunRow[];
  replace?: boolean;
  preserveLoopScheduling?: boolean;
  preserveWorkflowActivation?: boolean;
}

export interface ImportReceiptV2 {
  contract: typeof LOOPS_IMPORT_RECEIPT_CONTRACT;
  operationId: string;
  requestDigest: string;
  importedIds: {
    workflows: string[];
    loops: string[];
    runs: string[];
  };
  skippedRunningIds: string[];
  skippedExistingIds: {
    workflows: string[];
    loops: string[];
    runs: string[];
  };
}

export class ImportOperationReconciliationRequiredError extends Error {
  readonly code = "OPERATION_RECONCILIATION_REQUIRED";
  constructor(expectation: string) {
    super(
      `hosted Loops import completed without a trustworthy receipt: ${expectation}; ` +
        "do not retry blindly—re-read the authoritative rows and reconcile the operation",
    );
    this.name = "ImportOperationReconciliationRequiredError";
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

export function importOperationId(): string {
  return randomUUID();
}

export function validImportOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function importRequestDigest(input: ImportContractInput): string {
  const payload = canonical({
    workflows: input.workflows ?? [],
    loops: input.loops ?? [],
    runs: input.runs ?? [],
    replace: input.replace === true,
    preserveLoopScheduling: input.preserveLoopScheduling === true,
    preserveWorkflowActivation: input.preserveWorkflowActivation === true,
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImportOperationReconciliationRequiredError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ImportOperationReconciliationRequiredError(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new ImportOperationReconciliationRequiredError(`${label} must be an array of non-empty ids`);
  }
  const rows = value as string[];
  if (new Set(rows).size !== rows.length) {
    throw new ImportOperationReconciliationRequiredError(`${label} must not contain duplicate ids`);
  }
  return rows;
}

function exactIds(actual: string[], expected: string[], label: string): void {
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new ImportOperationReconciliationRequiredError(
      `${label} does not match the submitted row identities (expected ${expected.length} ordered ids)`,
    );
  }
}

export function validateImportReceipt(
  raw: unknown,
  request: Required<Pick<ImportContractInput, "operationId">> & ImportContractInput,
  options: { allowSkippedExisting?: boolean } = {},
): { imported: { workflows: number; loops: number; runs: number }; skippedRunning: number; receipt: ImportReceiptV2 } {
  const envelope = record(raw, "import response");
  if (envelope.ok !== true) {
    throw new ImportOperationReconciliationRequiredError("the import response must carry ok:true");
  }
  const imported = record(envelope.imported, "imported counts");
  const counts = {
    workflows: nonNegativeInteger(imported.workflows, "imported.workflows"),
    loops: nonNegativeInteger(imported.loops, "imported.loops"),
    runs: nonNegativeInteger(imported.runs, "imported.runs"),
  };
  const skippedRunning = nonNegativeInteger(envelope.skippedRunning, "skippedRunning");
  const skippedExistingCountsRow = record(envelope.skippedExisting, "skippedExisting counts");
  const skippedExistingCounts = {
    workflows: nonNegativeInteger(skippedExistingCountsRow.workflows, "skippedExisting.workflows"),
    loops: nonNegativeInteger(skippedExistingCountsRow.loops, "skippedExisting.loops"),
    runs: nonNegativeInteger(skippedExistingCountsRow.runs, "skippedExisting.runs"),
  };
  const receiptRow = record(envelope.receipt, "import receipt");
  if (receiptRow.contract !== LOOPS_IMPORT_RECEIPT_CONTRACT) {
    throw new ImportOperationReconciliationRequiredError(`receipt.contract must equal ${LOOPS_IMPORT_RECEIPT_CONTRACT}`);
  }
  if (receiptRow.operationId !== request.operationId) {
    throw new ImportOperationReconciliationRequiredError("receipt.operationId must equal the dispatched operation id");
  }
  const expectedDigest = importRequestDigest(request);
  if (receiptRow.requestDigest !== expectedDigest) {
    throw new ImportOperationReconciliationRequiredError("receipt.requestDigest must bind the exact submitted rows and flags");
  }
  const importedIdsRow = record(receiptRow.importedIds, "receipt.importedIds");
  const skippedExistingRow = record(receiptRow.skippedExistingIds, "receipt.skippedExistingIds");
  const receipt: ImportReceiptV2 = {
    contract: LOOPS_IMPORT_RECEIPT_CONTRACT,
    operationId: request.operationId,
    requestDigest: expectedDigest,
    importedIds: {
      workflows: stringArray(importedIdsRow.workflows, "receipt.importedIds.workflows"),
      loops: stringArray(importedIdsRow.loops, "receipt.importedIds.loops"),
      runs: stringArray(importedIdsRow.runs, "receipt.importedIds.runs"),
    },
    skippedRunningIds: stringArray(receiptRow.skippedRunningIds, "receipt.skippedRunningIds"),
    skippedExistingIds: {
      workflows: stringArray(skippedExistingRow.workflows, "receipt.skippedExistingIds.workflows"),
      loops: stringArray(skippedExistingRow.loops, "receipt.skippedExistingIds.loops"),
      runs: stringArray(skippedExistingRow.runs, "receipt.skippedExistingIds.runs"),
    },
  };
  const expected = {
    workflows: (request.workflows ?? []).map((row) => row.id),
    loops: (request.loops ?? []).map((row) => row.id),
    runs: (request.runs ?? []).filter((row) => row.status !== "running").map((row) => row.id),
    skippedRunning: (request.runs ?? []).filter((row) => row.status === "running").map((row) => row.id),
  };
  exactIds(receipt.skippedRunningIds, expected.skippedRunning, "receipt.skippedRunningIds");
  for (const key of ["workflows", "loops", "runs"] as const) {
    if (!options.allowSkippedExisting && receipt.skippedExistingIds[key].length !== 0) {
      throw new ImportOperationReconciliationRequiredError(
        `receipt.skippedExistingIds.${key} is non-empty, so the destination changed after planning`,
      );
    }
    if (options.allowSkippedExisting) {
      const represented = [...receipt.importedIds[key], ...receipt.skippedExistingIds[key]];
      if (new Set(represented).size !== represented.length || represented.length !== expected[key].length) {
        throw new ImportOperationReconciliationRequiredError(
          `receipt ${key} ids must partition the submitted identities without duplicates`,
        );
      }
      const representedSet = new Set(represented);
      if (expected[key].some((id) => !representedSet.has(id))) {
        throw new ImportOperationReconciliationRequiredError(`receipt ${key} ids do not bind every submitted identity`);
      }
    } else {
      exactIds(receipt.importedIds[key], expected[key], `receipt.importedIds.${key}`);
    }
    if (counts[key] !== receipt.importedIds[key].length) {
      throw new ImportOperationReconciliationRequiredError(`imported.${key} must equal the receipt id count`);
    }
    if (skippedExistingCounts[key] !== receipt.skippedExistingIds[key].length) {
      throw new ImportOperationReconciliationRequiredError(`skippedExisting.${key} must equal the receipt id count`);
    }
  }
  if (skippedRunning !== receipt.skippedRunningIds.length) {
    throw new ImportOperationReconciliationRequiredError("skippedRunning must equal receipt.skippedRunningIds.length");
  }
  return { imported: counts, skippedRunning, receipt };
}
