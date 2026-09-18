import { describe, expect, test } from "bun:test";
import type { Loop } from "../types.js";
import {
  importRequestDigest,
  LOOPS_IMPORT_RECEIPT_CONTRACT,
  validateImportReceipt,
} from "./import-contract.js";

const operationId = "11111111-1111-4111-8111-111111111111";
const loop = {
  id: "loop-1",
  name: "loop-1",
  labels: [],
  status: "paused",
  schedule: { type: "interval", everyMs: 60_000 },
  target: { type: "command", command: "true" },
  catchUp: "none",
  catchUpLimit: 1,
  overlap: "skip",
  maxAttempts: 1,
  retryDelayMs: 0,
  leaseMs: 60_000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Loop;

function request() {
  return { operationId, workflows: [], loops: [loop], runs: [], replace: false };
}

function response() {
  const input = request();
  return {
    ok: true,
    imported: { workflows: 0, loops: 1, runs: 0 },
    skippedRunning: 0,
    skippedExisting: { workflows: 0, loops: 0, runs: 0 },
    receipt: {
      contract: LOOPS_IMPORT_RECEIPT_CONTRACT,
      operationId,
      requestDigest: importRequestDigest(input),
      importedIds: { workflows: [], loops: [loop.id], runs: [] },
      skippedRunningIds: [],
      skippedExistingIds: { workflows: [], loops: [], runs: [] },
    },
  };
}

describe("loops import v2 receipt", () => {
  test("binds the exact operation, request digest, row ids, and counts", () => {
    expect(validateImportReceipt(response(), request())).toMatchObject({
      imported: { workflows: 0, loops: 1, runs: 0 },
      skippedRunning: 0,
      receipt: { contract: LOOPS_IMPORT_RECEIPT_CONTRACT, operationId },
    });
  });

  test("digest is deterministic across object key insertion order", () => {
    const left = request();
    const right = { replace: false, runs: [], loops: [{ ...loop }], workflows: [], operationId };
    expect(importRequestDigest(left)).toBe(importRequestDigest(right));
  });

  test("rejects stale or foreign operation, digest, identity, and count receipts", () => {
    const cases = [
      { ...response(), receipt: { ...response().receipt, operationId: "22222222-2222-4222-8222-222222222222" } },
      { ...response(), receipt: { ...response().receipt, requestDigest: "0".repeat(64) } },
      { ...response(), receipt: { ...response().receipt, importedIds: { workflows: [], loops: ["different"], runs: [] } } },
      { ...response(), imported: { workflows: 0, loops: 0, runs: 0 } },
      { ...response(), ok: false },
    ];
    for (const candidate of cases) {
      expect(() => validateImportReceipt(candidate, request())).toThrow("do not retry blindly");
    }
  });

  test("legacy control-plane pushes may accept exact skipped-existing ids while planned hosted import may not", () => {
    const candidate: any = response();
    candidate.imported.loops = 0;
    candidate.skippedExisting.loops = 1;
    candidate.receipt.importedIds.loops = [];
    candidate.receipt.skippedExistingIds.loops = [loop.id];
    expect(() => validateImportReceipt(candidate, request())).toThrow("destination changed after planning");
    expect(validateImportReceipt(candidate, request(), { allowSkippedExisting: true }).imported.loops).toBe(0);
  });
});
