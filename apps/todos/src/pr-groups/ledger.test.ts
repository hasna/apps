import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { runMigrations } from "../db/schema.js";
import {
  PrGroupLedger,
  deterministicPrGroupId,
  deterministicPrGroupAttemptId,
} from "./ledger.js";
import {
  PostgresPrGroupLedgerPersistence,
  postgresPrGroupSchemaSql,
} from "./postgres.js";
import { SqlitePrGroupLedgerPersistence } from "./sqlite.js";
import type {
  AdmitPrGroupInput,
  AppendPrGroupEventInput,
  PrGroupAttemptRecord,
} from "./types.js";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const BASE_A = "c".repeat(40);
const T0 = "2026-07-23T10:00:00.000Z";
const PR_NUMBER = 78;
const RECEIPT_BINDING = {
  repository: "hasna/todos",
  pr_number: PR_NUMBER,
  base_sha: BASE_A,
  actor_id: "reviewer-1",
  actor_run_id: "review-run-1",
} as const;
const MERGE_OPERATOR = {
  actor_id: "merge-operator-1",
  actor_run_id: "merge-run-1",
} as const;

function ciProof(overrides: Record<string, unknown> = {}) {
  return {
    provider: "github",
    provider_run_id: "ci-run-1",
    status: "success",
    repository: "hasna/todos",
    pr_number: PR_NUMBER,
    base_sha: BASE_A,
    head_sha: HEAD_A,
    ...overrides,
  };
}

function admission(overrides: Partial<AdmitPrGroupInput> = {}): AdmitPrGroupInput {
  return {
    root_request_id: "request-root-1",
    repository: "hasna/todos",
    leaf_task_id: "leaf-task-1",
    dispatch_attempt: "dispatch-1",
    writer_generation: "generation-1",
    worktree: "/tmp/pr-group-ledger",
    branch: "feat/pr-group-ledger",
    pr_number: PR_NUMBER,
    base_sha: BASE_A,
    provider: "codewith",
    provider_run_id: "provider-run-1",
    profile_alias: "account012",
    admitted_at: T0,
    ...overrides,
  } as AdmitPrGroupInput;
}

function cleanupProof(overrides: Record<string, unknown> = {}) {
  return {
    worktree_clean: true,
    provider_reachable: true,
    provider_head_sha: HEAD_A,
    pr_policy_satisfied: true,
    terminal_disposition: "merged",
    writer_retired: true,
    review_receipt_key: "review-receipt-1",
    conditional_merge_receipt_key: "conditional-receipt-1",
    merge_receipt_key: "merge-receipt-1",
    ...overrides,
  };
}

describe("authoritative PR-group ledger", () => {
  let db: Database;
  let ledger: PrGroupLedger;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);
    ledger = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(db));
  });

  afterEach(() => {
    setSystemTime();
    db.close();
  });

  test("creates deterministic lineage and idempotently adopts one active writer", async () => {
    expect(deterministicPrGroupId(
      "request-root-1",
      "HTTPS://github.com/Hasna/Todos.git",
      "leaf-task-1",
      "feat/pr-group-ledger",
      PR_NUMBER,
    )).toBe(deterministicPrGroupId(
      "request-root-1",
      "hasna/todos",
      "leaf-task-1",
      "feat/pr-group-ledger",
      PR_NUMBER,
    ));

    const results = await Promise.all(Array.from({ length: 8 }, () => ledger.admit(admission())));
    expect(results.filter((result) => result.appended)).toHaveLength(1);
    expect(results.filter((result) => result.adopted)).toHaveLength(7);

    const first = results[0]!;
    const groupId = deterministicPrGroupId(
      "request-root-1",
      "hasna/todos",
      "leaf-task-1",
      "feat/pr-group-ledger",
      PR_NUMBER,
    );
    const attemptId = deterministicPrGroupAttemptId(groupId, "leaf-task-1", "dispatch-1");
    expect(first.view.group).toMatchObject({
      id: groupId,
      root_request_id: "request-root-1",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task-1",
      branch: "feat/pr-group-ledger",
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
      active_attempt_id: attemptId,
      active_generation: "generation-1",
      repair_cycle_count: 0,
    });
    expect(first.view.attempts[0]).toMatchObject({
      id: attemptId,
      leaf_task_id: "leaf-task-1",
      dispatch_attempt: "dispatch-1",
      writer_generation: "generation-1",
      worktree: "/tmp/pr-group-ledger",
      branch: "feat/pr-group-ledger",
      provider_run_id: "provider-run-1",
      profile_alias: "account012",
    });
    expect(first.view.adapters.work_runs[0]).toMatchObject({
      kind: "WorkRun",
      id: attemptId,
      task_id: "leaf-task-1",
    });
    expect(first.view.adapters.decision_envelope.kind).toBe("DecisionEnvelope");

    await expect(ledger.admit(admission({
      dispatch_attempt: "dispatch-2",
      writer_generation: "generation-2",
    }))).rejects.toMatchObject({ code: "PR_GROUP_WRITER_FENCED" });
  });

  test("fresh admissions require concrete PR and base identity", async () => {
    await expect(ledger.admit(admission({
      root_request_id: "provisional-pr-identity",
      pr_number: null,
      base_sha: null,
    }))).rejects.toMatchObject({ code: "PR_GROUP_IDENTITY_CONFLICT" });
  });

  test("active writers cannot be recovered before the stale-writer lease expires", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "active-recovery-fence" }));
    await expect(ledger.recover({
      group_id: admitted.view.group.id,
      root_request_id: "active-recovery-fence",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task-1",
      expected_attempt_id: admitted.view.attempts[0]!.id,
      dispatch_attempt: "dispatch-too-early",
      expected_generation: "generation-1",
      writer_generation: "generation-2",
      worktree: "/tmp/recovery-too-early",
      branch: "feat/pr-group-ledger",
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
      provider: "codewith",
      provider_run_id: "provider-run-2",
      profile_alias: "account012",
      idempotency_key: "recovery-too-early",
      recovered_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_WRITER_ACTIVE" } as any);
  });

  test("conditional merge requires exact provider CI proof and an operator distinct from review", async () => {
    const prepareReviewed = async (root: string) => {
      const admitted = await ledger.admit(admission({ root_request_id: root }));
      const groupId = admitted.view.group.id;
      const attemptId = admitted.view.attempts[0]!.id;
      const append = (event: Record<string, unknown>) => ledger.append({
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: "generation-1",
        created_at: T0,
        ...event,
      } as AppendPrGroupEventInput);
      await append({ idempotency_key: `${root}-start`, event_type: "started" });
      await append({ idempotency_key: `${root}-handoff`, event_type: "handoff" });
      await append({
        idempotency_key: `${root}-request`,
        event_type: "review_requested",
        head_sha: HEAD_A,
        ...RECEIPT_BINDING,
        expected_reviewer_id: "reviewer-1",
        expected_reviewer_run_id: "review-run-1",
      });
      await append({
        idempotency_key: `${root}-review`,
        event_type: "review_receipt",
        head_sha: HEAD_A,
        receipt_key: `${root}-review-receipt`,
        outcome: "approved",
        ...RECEIPT_BINDING,
      });
      return { append, reviewReceipt: `${root}-review-receipt` };
    };

    const sameOperator = await prepareReviewed("same-review-merge-operator");
    await expect(sameOperator.append({
      idempotency_key: "same-operator-conditional",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "same-operator-conditional",
      review_receipt_key: sameOperator.reviewReceipt,
      ...RECEIPT_BINDING,
      ci_proof: ciProof(),
    })).rejects.toMatchObject({ code: "PR_GROUP_OPERATOR_SEPARATION_REQUIRED" } as any);

    const exactCi = await prepareReviewed("exact-ci-proof");
    await expect(exactCi.append({
      idempotency_key: "shared-run-conditional",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "shared-run-conditional",
      review_receipt_key: exactCi.reviewReceipt,
      ...RECEIPT_BINDING,
      actor_id: MERGE_OPERATOR.actor_id,
      actor_run_id: RECEIPT_BINDING.actor_run_id,
      ci_proof: ciProof(),
    })).rejects.toMatchObject({ code: "PR_GROUP_OPERATOR_SEPARATION_REQUIRED" } as any);

    await expect(exactCi.append({
      idempotency_key: "mismatched-ci-conditional",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "mismatched-ci-conditional",
      review_receipt_key: exactCi.reviewReceipt,
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof({ head_sha: HEAD_B }),
    })).rejects.toMatchObject({ code: "PR_GROUP_EXACT_HEAD_REQUIRED" });

    await exactCi.append({
      idempotency_key: "exact-ci-conditional",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "exact-ci-conditional",
      review_receipt_key: exactCi.reviewReceipt,
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof(),
    });
    await expect(exactCi.append({
      idempotency_key: "wrong-merge-operator",
      event_type: "merge_outcome",
      head_sha: HEAD_A,
      receipt_key: "wrong-merge-operator",
      conditional_merge_receipt_key: "exact-ci-conditional",
      outcome: "merged",
      ...RECEIPT_BINDING,
    })).rejects.toMatchObject({ code: "PR_GROUP_OPERATOR_SEPARATION_REQUIRED" } as any);
  });

  test("receipt keys are globally unique across PR groups", async () => {
    const appendReview = async (root: string, receiptKey: string) => {
      const admitted = await ledger.admit(admission({ root_request_id: root }));
      const groupId = admitted.view.group.id;
      const attemptId = admitted.view.attempts[0]!.id;
      const append = (event: Record<string, unknown>) => ledger.append({
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: "generation-1",
        created_at: T0,
        ...event,
      } as AppendPrGroupEventInput);
      await append({ idempotency_key: `${root}-start`, event_type: "started" });
      await append({ idempotency_key: `${root}-handoff`, event_type: "handoff" });
      await append({
        idempotency_key: `${root}-request`,
        event_type: "review_requested",
        head_sha: HEAD_A,
        ...RECEIPT_BINDING,
        expected_reviewer_id: "reviewer-1",
        expected_reviewer_run_id: "review-run-1",
      });
      return append({
        idempotency_key: `${root}-review`,
        event_type: "review_receipt",
        head_sha: HEAD_A,
        receipt_key: receiptKey,
        outcome: "approved",
        ...RECEIPT_BINDING,
      });
    };

    await appendReview("global-receipt-a", "globally-unique-review-receipt");
    await expect(appendReview(
      "global-receipt-b",
      "globally-unique-review-receipt",
    )).rejects.toMatchObject({ code: "PR_GROUP_RECEIPT_REPLAY" });
  });

  test("serializes split-brain admission across persistence instances sharing one SQLite authority", async () => {
    const alternate = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(db));
    const results = await Promise.all([
      ledger.admit(admission()),
      alternate.admit(admission()),
      ledger.admit(admission()),
      alternate.admit(admission()),
    ]);
    expect(results.filter((result) => result.appended)).toHaveLength(1);
    expect(results.filter((result) => result.adopted)).toHaveLength(3);
    expect(db.query("SELECT COUNT(*) AS count FROM pr_group_events").get()).toEqual({ count: 1 });
  });

  test("binds review and conditional merge receipts to an exact head and preserves terminal history", async () => {
    const admitted = await ledger.admit(admission());
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const append = (event: Omit<AppendPrGroupEventInput, "group_id" | "attempt_id" | "writer_generation">) =>
      ledger.append({
        group_id: groupId,
        attempt_id: attemptId,
        writer_generation: "generation-1",
        created_at: T0,
        ...event,
      });

    await append({ idempotency_key: "started-1", event_type: "started" });
    await append({ idempotency_key: "progress-1", event_type: "progress", message: "implemented" });
    await append({ idempotency_key: "handoff-1", event_type: "handoff", head_sha: null });
    await append({
      idempotency_key: "review-request-1",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
    });

    await expect(append({
      idempotency_key: "wrong-review-head",
      event_type: "review_receipt",
      head_sha: HEAD_B,
      receipt_key: "review-wrong-head",
      outcome: "approved",
      ...RECEIPT_BINDING,
      base_sha: BASE_A,
    })).rejects.toMatchObject({ code: "PR_GROUP_EXACT_HEAD_REQUIRED" });

    await append({
      idempotency_key: "review-1",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "review-receipt-1",
      outcome: "approved",
      ...RECEIPT_BINDING,
    });
    await expect(append({
      idempotency_key: "late-heartbeat-after-review",
      event_type: "heartbeat",
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });
    await expect(append({
      idempotency_key: "conditional-wrong-head",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_B,
      receipt_key: "conditional-wrong",
      review_receipt_key: "review-receipt-1",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof({ head_sha: HEAD_B }),
    })).rejects.toMatchObject({ code: "PR_GROUP_REVIEW_REQUIRED" });

    await append({
      idempotency_key: "conditional-1",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "conditional-receipt-1",
      review_receipt_key: "review-receipt-1",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof(),
    });
    await expect(append({
      idempotency_key: "receipt-replay",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "conditional-receipt-1",
      review_receipt_key: "review-receipt-1",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof(),
    })).rejects.toMatchObject({ code: "PR_GROUP_RECEIPT_REPLAY" });

    const merged = await append({
      idempotency_key: "merge-1",
      event_type: "merge_outcome",
      head_sha: HEAD_A,
      receipt_key: "merge-receipt-1",
      conditional_merge_receipt_key: "conditional-receipt-1",
      outcome: "merged",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
    });
    expect(merged.view.group).toMatchObject({
      state: "merged",
      terminal_outcome: "merged",
      terminal_head_sha: HEAD_A,
      active_generation: null,
    });
    await expect(append({
      idempotency_key: "late-progress",
      event_type: "progress",
    })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });

    const cleanup = await append({
      idempotency_key: "cleanup-1",
      event_type: "cleanup_eligible",
      cleanup_proof: cleanupProof(),
    });
    expect(cleanup.view).toMatchObject({ cleanup_eligible: true });
    expect(cleanup.view.group.terminal_outcome).toBe("merged");
    expect(cleanup.view.review_receipts).toHaveLength(1);
    expect(cleanup.view.conditional_merge_receipts).toHaveLength(1);
    expect(cleanup.view.adapters.proof_bundle).toMatchObject({
      kind: "ProofBundle",
      exact_head: HEAD_A,
      complete: true,
    });
    await expect(append({
      idempotency_key: "cleanup-2",
      event_type: "cleanup_eligible",
      cleanup_proof: cleanupProof(),
    })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });
  });

  test("recovery fences stale generations while preserving all prior attempt evidence", async () => {
    const admitted = await ledger.admit(admission());
    const groupId = admitted.view.group.id;
    const firstAttempt = admitted.view.attempts[0]!.id;
    await ledger.append({
      group_id: groupId,
      attempt_id: firstAttempt,
      writer_generation: "generation-1",
      idempotency_key: "first-progress",
      event_type: "progress",
      message: "before recovery",
      created_at: T0,
    });

    const recoveryInput = {
      group_id: groupId,
      root_request_id: "request-root-1",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task-1",
      expected_attempt_id: firstAttempt,
      dispatch_attempt: "dispatch-2",
      expected_generation: "generation-1",
      writer_generation: "generation-2",
      worktree: "/tmp/pr-group-ledger-2",
      branch: "feat/pr-group-ledger",
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
      provider: "codewith",
      provider_run_id: "provider-run-2",
      profile_alias: "account012",
      idempotency_key: "recovery-1",
      recovered_at: "2026-07-23T10:01:00.000Z",
    };
    const recovered = await ledger.recover(recoveryInput);
    const secondAttempt = recovered.view.attempts.at(-1)!.id;
    expect(recovered.view.attempts).toEqual([
      expect.objectContaining({ id: firstAttempt, status: "fenced" }),
      expect.objectContaining({
        id: secondAttempt,
        writer_generation: "generation-2",
        previous_attempt_id: firstAttempt,
      }),
    ]);
    expect((await ledger.recover(recoveryInput)).adopted).toBe(true);

    await expect(ledger.append({
      group_id: groupId,
      attempt_id: firstAttempt,
      writer_generation: "generation-1",
      idempotency_key: "stale-completion",
      event_type: "handoff",
    })).rejects.toMatchObject({ code: "PR_GROUP_WRITER_FENCED" });

    await ledger.append({
      group_id: groupId,
      attempt_id: secondAttempt,
      writer_generation: "generation-2",
      idempotency_key: "second-progress",
      event_type: "heartbeat",
      created_at: "2026-07-23T10:02:00.000Z",
    });
    const history = await ledger.events(groupId, { limit: 20 });
    expect(history.events.map((event) => event.event_type)).toEqual([
      "admission",
      "progress",
      "recovery",
      "heartbeat",
    ]);
    expect(history.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  test("redacts provider identity and credentials and rejects unsafe profile references", async () => {
    await expect(ledger.admit(admission({ profile_alias: "person@example.test" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.admit(admission({ provider_run_id: "/tmp/auth.json" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.admit(admission({ worktree: "/tmp/.ssh/private-worktree" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.admit(admission({ branch: "feat/auth.json" })))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });

    const admitted = await ledger.admit(admission());
    const event = await ledger.append({
      group_id: admitted.view.group.id,
      attempt_id: admitted.view.attempts[0]!.id,
      writer_generation: "generation-1",
      idempotency_key: "redaction-1",
      event_type: "progress",
      metadata: {
        provider_email: "person@example.test",
        token: "not-a-credential",
        nested: { auth_path: "/tmp/auth.json", safe: "kept" },
      },
      message: "credential path /tmp/auth.json must not survive",
      created_at: T0,
    });
    expect(event.event.message).toBe("[REDACTED]");
    expect(event.event.metadata).toEqual({
      provider_email: "[REDACTED]",
      token: "[REDACTED]",
      nested: { auth_path: "[REDACTED]", safe: "kept" },
    });
    expect(JSON.stringify(event.view)).not.toContain("person@example.test");
    expect(JSON.stringify(event.view)).not.toContain("/tmp/auth.json");
  });

  test("rejects events and recovery that would regress authoritative timestamps", async () => {
    const admitted = await ledger.admit(admission());
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    await ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      idempotency_key: "future-progress",
      event_type: "progress",
      created_at: "2026-07-23T11:00:00.000Z",
    });
    await expect(ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      idempotency_key: "backdated-progress",
      event_type: "progress",
      created_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });
    await expect(ledger.recover({
      group_id: groupId,
      root_request_id: "request-root-1",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task-1",
      expected_attempt_id: attemptId,
      dispatch_attempt: "dispatch-backdated",
      expected_generation: "generation-1",
      writer_generation: "generation-backdated",
      worktree: "/tmp/pr-group-ledger-backdated",
      branch: "feat/pr-group-ledger",
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
      provider: "codewith",
      profile_alias: "account012",
      idempotency_key: "recovery-backdated",
      recovered_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });
  });

  test("fails and cancels terminal attempts without allowing history to reopen", async () => {
    for (const [eventType, outcome] of [["failure", "failed"], ["cancellation", "cancelled"]] as const) {
      const isolatedDb = new Database(":memory:");
      isolatedDb.exec("PRAGMA foreign_keys = ON");
      runMigrations(isolatedDb);
      const isolated = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(isolatedDb));
      const admitted = await isolated.admit(admission({
        root_request_id: `root-${eventType}`,
        dispatch_attempt: `dispatch-${eventType}`,
      }));
      const terminal = await isolated.append({
        group_id: admitted.view.group.id,
        attempt_id: admitted.view.attempts[0]!.id,
        writer_generation: "generation-1",
        idempotency_key: `terminal-${eventType}`,
        event_type: eventType,
        created_at: T0,
      });
      expect(terminal.view.group.terminal_outcome).toBe(outcome);
      await expect(isolated.recover({
        group_id: admitted.view.group.id,
        root_request_id: `root-${eventType}`,
        repository: "hasna/todos",
        leaf_task_id: "leaf-task-1",
        expected_attempt_id: admitted.view.attempts[0]!.id,
        dispatch_attempt: `recovery-${eventType}`,
        expected_generation: "generation-1",
        writer_generation: "generation-2",
        worktree: "/tmp/recovery",
        branch: "feat/pr-group-ledger",
        pr_number: PR_NUMBER,
        base_sha: BASE_A,
        provider: "codewith",
        profile_alias: "account012",
        idempotency_key: `recover-${eventType}`,
      })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });
      await expect(isolated.append({
        group_id: admitted.view.group.id,
        attempt_id: admitted.view.attempts[0]!.id,
        writer_generation: "generation-1",
        idempotency_key: `cleanup-${eventType}`,
        event_type: "cleanup_eligible",
        cleanup_proof: cleanupProof({
          terminal_disposition: outcome,
          review_receipt_key: null,
          conditional_merge_receipt_key: null,
          merge_receipt_key: null,
        }),
        created_at: T0,
      })).rejects.toMatchObject({ code: "PR_GROUP_CLEANUP_BLOCKED" });
      isolatedDb.close();
    }
  });

  test("returns bounded event pages with explicit continuation state", async () => {
    const admitted = await ledger.admit(admission());
    for (let index = 0; index < 4; index++) {
      await ledger.append({
        group_id: admitted.view.group.id,
        attempt_id: admitted.view.attempts[0]!.id,
        writer_generation: "generation-1",
        idempotency_key: `heartbeat-${index}`,
        event_type: "heartbeat",
        created_at: T0,
      });
    }
    const first = await ledger.events(admitted.view.group.id, { limit: 2 });
    expect(first).toMatchObject({ count: 2, has_more: true, next_sequence: 2 });
    const second = await ledger.events(admitted.view.group.id, {
      limit: 2,
      after_sequence: first.next_sequence!,
    });
    expect(second.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(second.has_more).toBe(true);
    await expect(ledger.events(admitted.view.group.id, { after_sequence: -1 }))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    await expect(ledger.events(admitted.view.group.id, { after_sequence: 1.5 }))
      .rejects.toMatchObject({ code: "PR_GROUP_INVALID_INPUT" });
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'pr_group_events'").get()).not.toBeNull();
  });

  test("terminal facts are append-once and cancellation cannot claim a merged outcome", async () => {
    const admitted = await ledger.admit(admission());
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const failed = await ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      idempotency_key: "terminal-failed",
      event_type: "failure",
      outcome: "failed",
      created_at: T0,
    });
    const terminalFacts = {
      terminal_at: failed.view.group.terminal_at,
      terminal_head_sha: failed.view.group.terminal_head_sha,
      terminal_outcome: failed.view.group.terminal_outcome,
      terminal_attempt_id: failed.view.group.terminal_attempt_id,
      terminal_generation: failed.view.group.terminal_generation,
      cleanup_eligible_at: failed.view.group.cleanup_eligible_at,
    };
    await expect(ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      idempotency_key: "terminal-failed-again",
      event_type: "terminal_outcome",
      outcome: "failed",
      created_at: "2026-07-23T10:05:00.000Z",
    })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });
    expect((await ledger.get(groupId)).group).toMatchObject(terminalFacts);

    const cancelled = await ledger.admit(admission({
      root_request_id: "root-cancellation-outcome",
      leaf_task_id: "leaf-cancellation-outcome",
    }));
    await expect(ledger.append({
      group_id: cancelled.view.group.id,
      attempt_id: cancelled.view.attempts[0]!.id,
      writer_generation: "generation-1",
      idempotency_key: "cancel-merged",
      event_type: "cancellation",
      outcome: "merged",
      created_at: T0,
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });
  });

  test("a later non-approving exact-head review revokes an earlier approval", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "review-revocation" }));
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const append = (event: Record<string, unknown>) => ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      created_at: T0,
      ...event,
    } as AppendPrGroupEventInput);
    await append({ idempotency_key: "start", event_type: "started" });
    await append({ idempotency_key: "handoff", event_type: "handoff" });
    await append({
      idempotency_key: "request",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    await append({
      idempotency_key: "approved",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "approval-1",
      outcome: "approved",
      ...RECEIPT_BINDING,
    });
    await append({
      idempotency_key: "changes-requested",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "changes-1",
      outcome: "changes_requested",
      ...RECEIPT_BINDING,
    });
    await expect(append({
      idempotency_key: "conditional-after-revocation",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "conditional-after-revocation",
      review_receipt_key: "approval-1",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof(),
    })).rejects.toMatchObject({ code: "PR_GROUP_REVIEW_REQUIRED" });
  });

  test("a newer review request globally revokes obsolete-head review authority", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "global-review-revocation" }));
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const append = (event: Record<string, unknown>) => ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      created_at: T0,
      ...event,
    } as AppendPrGroupEventInput);

    await append({ idempotency_key: "start", event_type: "started" });
    await append({ idempotency_key: "handoff-a", event_type: "handoff" });
    await append({
      idempotency_key: "request-a",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    await append({
      idempotency_key: "approval-a",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "approval-a",
      outcome: "approved",
      ...RECEIPT_BINDING,
    });
    await append({
      idempotency_key: "changes-a",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "changes-a",
      outcome: "changes_requested",
      ...RECEIPT_BINDING,
    });
    await append({
      idempotency_key: "repair-a",
      event_type: "repair_accepted",
      outcome: "accepted",
      repair_cycle: 1,
    });
    await append({ idempotency_key: "handoff-b", event_type: "handoff" });
    await append({
      idempotency_key: "request-b",
      event_type: "review_requested",
      head_sha: HEAD_B,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    await append({
      idempotency_key: "changes-b",
      event_type: "review_receipt",
      head_sha: HEAD_B,
      receipt_key: "changes-b",
      outcome: "changes_requested",
      ...RECEIPT_BINDING,
    });

    await expect(append({
      idempotency_key: "late-approval-a",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "late-approval-a",
      outcome: "approved",
      ...RECEIPT_BINDING,
    })).rejects.toMatchObject({ code: "PR_GROUP_EXACT_HEAD_REQUIRED" });

    await append({
      idempotency_key: "approval-b",
      event_type: "review_receipt",
      head_sha: HEAD_B,
      receipt_key: "approval-b",
      outcome: "approved",
      ...RECEIPT_BINDING,
    });
    const mergeReady = await append({
      idempotency_key: "conditional-b",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_B,
      receipt_key: "conditional-b",
      review_receipt_key: "approval-b",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof({ head_sha: HEAD_B }),
    });
    expect(mergeReady.view.group.state).toBe("merge_ready");
  });

  test("recovery replay binds the complete immutable request envelope before adoption", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "complete-recovery-envelope" }));
    const groupId = admitted.view.group.id;
    const firstAttempt = admitted.view.attempts[0]!.id;
    const input = {
      group_id: groupId,
      root_request_id: "complete-recovery-envelope",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task-1",
      expected_attempt_id: firstAttempt,
      dispatch_attempt: "dispatch-2",
      expected_generation: "generation-1",
      writer_generation: "generation-2",
      worktree: "/tmp/pr-group-ledger-recovered",
      branch: "feat/pr-group-ledger",
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
      provider: "codewith",
      provider_run_id: "provider-run-2",
      profile_alias: "account012",
      idempotency_key: "recovery-complete",
      recovered_at: "2026-07-23T10:01:00.000Z",
    };
    expect((await ledger.recover(input as any)).appended).toBe(true);

    const conflicts: Array<[string, unknown]> = [
      ["root_request_id", "another-root"],
      ["repository", "hasna/other"],
      ["leaf_task_id", "another-leaf"],
      ["expected_attempt_id", "pra_another"],
      ["dispatch_attempt", "dispatch-3"],
      ["expected_generation", "generation-stale"],
      ["writer_generation", "generation-3"],
      ["worktree", "/tmp/another-worktree"],
      ["branch", "feat/another-branch"],
      ["pr_number", 79],
      ["base_sha", HEAD_B],
      ["provider", "another-provider"],
      ["provider_run_id", "another-provider-run"],
      ["profile_alias", "account013"],
    ];
    for (const [field, value] of conflicts) {
      await expect(ledger.recover({ ...input, [field]: value } as any))
        .rejects.toMatchObject({
          code: expect.stringMatching(/^PR_GROUP_(?:IDENTITY_CONFLICT|RECEIPT_REPLAY|WRITER_FENCED)$/),
        });
    }
  });

  test("enforces the repair graph, cycle limit, and explicit exhausted NO-GO disposition", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "repair-accounting" }));
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    let timestamp = 0;
    const append = (event: Record<string, unknown>) => ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      created_at: `2026-07-23T10:${String(timestamp++).padStart(2, "0")}:00.000Z`,
      ...event,
    } as AppendPrGroupEventInput);
    expect(admitted.view.group.repair_cycle_count).toBe(0);
    await expect(append({
      idempotency_key: "repair-before-review",
      event_type: "repair_accepted",
      outcome: "accepted",
      repair_cycle: 1,
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });

    await append({ idempotency_key: "start", event_type: "started" });
    await append({ idempotency_key: "handoff-0", event_type: "handoff" });
    await append({
      idempotency_key: "request-0",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    await append({
      idempotency_key: "review-fail-0",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "review-fail-0",
      outcome: "changes_requested",
      ...RECEIPT_BINDING,
    });
    const repairOne = await append({
      idempotency_key: "repair-1",
      event_type: "repair_accepted",
      outcome: "accepted",
      repair_cycle: 1,
    });
    expect(repairOne.view.group.repair_cycle_count).toBe(1);
    await expect(append({
      idempotency_key: "started-after-repair",
      event_type: "started",
    })).rejects.toMatchObject({ code: "PR_GROUP_INVALID_TRANSITION" });

    await append({ idempotency_key: "handoff-1", event_type: "handoff" });
    await append({
      idempotency_key: "request-1",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    await append({
      idempotency_key: "review-fail-1",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "review-fail-1",
      outcome: "changes_requested",
      ...RECEIPT_BINDING,
    });
    const repairTwo = await append({
      idempotency_key: "repair-2",
      event_type: "repair_accepted",
      outcome: "accepted",
      repair_cycle: 2,
    });
    expect(repairTwo.view.group.repair_cycle_count).toBe(2);

    await append({ idempotency_key: "handoff-2", event_type: "handoff" });
    await append({
      idempotency_key: "request-2",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    const exhausted = await append({
      idempotency_key: "review-fail-2",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "review-fail-2",
      outcome: "changes_requested",
      ...RECEIPT_BINDING,
    });
    expect(exhausted.view.group).toMatchObject({
      repair_cycle_count: 2,
      state: "no_go",
      terminal_outcome: "no_go",
      active_attempt_id: null,
      active_generation: null,
    });
    await expect(append({
      idempotency_key: "cleanup-no-go-unbound",
      event_type: "cleanup_eligible",
      cleanup_proof: cleanupProof({
        terminal_disposition: "no_go",
        review_receipt_key: null,
        conditional_merge_receipt_key: null,
        merge_receipt_key: null,
      }),
    })).rejects.toMatchObject({ code: "PR_GROUP_CLEANUP_BLOCKED" });
    const cleanup = await append({
      idempotency_key: "cleanup-no-go-exact",
      event_type: "cleanup_eligible",
      cleanup_proof: cleanupProof({
        terminal_disposition: "no_go",
        review_receipt_key: "review-fail-2",
        conditional_merge_receipt_key: null,
        merge_receipt_key: null,
      }),
    });
    expect(cleanup.view.cleanup_eligible).toBe(true);
    await expect(append({
      idempotency_key: "repair-3",
      event_type: "repair_accepted",
      outcome: "accepted",
      repair_cycle: 3,
    })).rejects.toMatchObject({ code: "PR_GROUP_TERMINAL" });
  });

  test("cleanup eligibility fails closed when any required safety proof is absent", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "cleanup-proof" }));
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const append = (event: Record<string, unknown>) => ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      created_at: T0,
      ...event,
    } as AppendPrGroupEventInput);
    await append({ idempotency_key: "start", event_type: "started" });
    await append({ idempotency_key: "handoff", event_type: "handoff" });
    await append({
      idempotency_key: "review-request",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    await append({
      idempotency_key: "review",
      event_type: "review_receipt",
      head_sha: HEAD_A,
      receipt_key: "review-receipt-1",
      outcome: "approved",
      ...RECEIPT_BINDING,
    });
    await append({
      idempotency_key: "conditional",
      event_type: "conditional_merge_receipt",
      head_sha: HEAD_A,
      receipt_key: "conditional-receipt-1",
      review_receipt_key: "review-receipt-1",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
      ci_proof: ciProof(),
    });
    await append({
      idempotency_key: "merged",
      event_type: "merge_outcome",
      head_sha: HEAD_A,
      receipt_key: "merge-receipt-1",
      conditional_merge_receipt_key: "conditional-receipt-1",
      outcome: "merged",
      ...RECEIPT_BINDING,
      ...MERGE_OPERATOR,
    });

    for (const field of [
      "worktree_clean",
      "provider_reachable",
      "provider_head_sha",
      "pr_policy_satisfied",
      "terminal_disposition",
      "writer_retired",
      "review_receipt_key",
      "conditional_merge_receipt_key",
      "merge_receipt_key",
    ]) {
      const proof = cleanupProof();
      delete proof[field as keyof typeof proof];
      await expect(append({
        idempotency_key: `cleanup-missing-${field}`,
        event_type: "cleanup_eligible",
        cleanup_proof: proof,
      })).rejects.toMatchObject({ code: "PR_GROUP_CLEANUP_BLOCKED" });
    }
    expect((await append({
      idempotency_key: "cleanup-complete",
      event_type: "cleanup_eligible",
      cleanup_proof: cleanupProof(),
    })).view.cleanup_eligible).toBe(true);
  });

  test("one root and repository admit multiple leaf PR groups without collision", async () => {
    const first = await ledger.admit(admission({
      root_request_id: "multi-leaf-root",
      leaf_task_id: "leaf-a",
      branch: "feat/leaf-a",
      pr_number: 101,
    }));
    const second = await ledger.admit(admission({
      root_request_id: "multi-leaf-root",
      leaf_task_id: "leaf-b",
      branch: "feat/leaf-b",
      pr_number: 102,
      dispatch_attempt: "dispatch-2",
      writer_generation: "generation-2",
    }));
    expect(first.view.group.id).not.toBe(second.view.group.id);
    expect(first.view.group).toMatchObject({ leaf_task_id: "leaf-a", pr_number: 101 });
    expect(second.view.group).toMatchObject({ leaf_task_id: "leaf-b", pr_number: 102 });
  });

  test("receipt lineage and authenticated actor identity cannot drift", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "receipt-lineage" }));
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const append = (event: Record<string, unknown>) => ledger.append({
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      created_at: T0,
      ...event,
    } as AppendPrGroupEventInput);
    await append({ idempotency_key: "start", event_type: "started" });
    await append({ idempotency_key: "handoff", event_type: "handoff" });
    await append({
      idempotency_key: "request",
      event_type: "review_requested",
      head_sha: HEAD_A,
      ...RECEIPT_BINDING,
      expected_reviewer_id: "reviewer-1",
      expected_reviewer_run_id: "review-run-1",
    });
    const invalidBindings = [
      { repository: "hasna/other" },
      { pr_number: 79 },
      { base_sha: HEAD_B },
      { head_sha: HEAD_B },
      { actor_id: "reviewer-2" },
      { actor_run_id: "review-run-2" },
      { authenticated_actor_id: "reviewer-2" },
      { authenticated_actor_run_id: "review-run-2" },
    ];
    for (const [index, drift] of invalidBindings.entries()) {
      await expect(append({
        idempotency_key: `drift-${index}`,
        event_type: "review_receipt",
        head_sha: HEAD_A,
        receipt_key: `drift-receipt-${index}`,
        outcome: "approved",
        ...RECEIPT_BINDING,
        authenticated_actor_id: "reviewer-1",
        authenticated_actor_run_id: "review-run-1",
        ...drift,
      })).rejects.toMatchObject({
        code: expect.stringMatching(/^PR_GROUP_(?:IDENTITY_CONFLICT|EXACT_HEAD_REQUIRED|WRITER_FENCED)$/),
      });
    }
  });

  test("the actual PostgreSQL adapter normalizes every attempt conflict and transaction failure", async () => {
    const attempt = {
      schema_version: 1,
      id: "pra_test",
      group_id: "prg_test",
      leaf_task_id: "leaf-test",
      dispatch_attempt: "dispatch-test",
      writer_generation: "generation-test",
      previous_attempt_id: null,
      worktree: "/tmp/test",
      branch: "feat/test",
      repository: "hasna/todos",
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
      provider: "codewith",
      provider_run_id: "run-test",
      profile_alias: "account012",
      status: "admitted",
      admitted_at: T0,
      started_at: null,
      last_heartbeat_at: null,
      handed_off_at: null,
      fenced_at: null,
      terminal_at: null,
      created_at: T0,
      updated_at: T0,
    } as PrGroupAttemptRecord;

    for (const constraint of [
      "todos_pr_group_attempts_pkey",
      "todos_pr_group_attempts_group_id_leaf_task_id_dispatch_attempt_key",
      "todos_pr_group_attempts_group_id_writer_generation_key",
    ]) {
      const queryClient = {
        query: async (sql: string) => {
          if (sql.includes("INSERT INTO todos_pr_group_attempts")) {
            throw Object.assign(new Error("synthetic unique violation"), {
              code: "23505",
              constraint,
            });
          }
          return { rows: [] };
        },
        transaction: async <T>(fn: (client: any) => Promise<T>) => fn(queryClient),
      };
      const persistence = new PostgresPrGroupLedgerPersistence(queryClient as any);
      await expect(persistence.transaction((tx) => tx.insertAttempt(attempt)))
        .rejects.toMatchObject({ code: "PR_GROUP_IDENTITY_CONFLICT" });
    }

    const failedClient = {
      query: async () => ({ rows: [] }),
      transaction: async () => { throw new Error("synthetic transaction failure"); },
    };
    const persistence = new PostgresPrGroupLedgerPersistence(failedClient as any);
    await expect(persistence.transaction(async () => true))
      .rejects.toMatchObject({ code: "PR_GROUP_ATOMICITY_UNAVAILABLE" });
  });

  test("timestamp-omitted append retries adopt the first server-assigned authoritative timestamp", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "timestamp-replay" }));
    const groupId = admitted.view.group.id;
    const attemptId = admitted.view.attempts[0]!.id;
    const progressInput = {
      group_id: groupId,
      attempt_id: attemptId,
      writer_generation: "generation-1",
      idempotency_key: "timestamp-free-progress",
      event_type: "progress",
    } as const;

    setSystemTime(new Date("2026-07-23T11:00:00.000Z"));
    const progress = await ledger.append(progressInput);
    setSystemTime(new Date("2026-07-23T11:01:00.000Z"));
    const progressRetry = await ledger.append(progressInput);
    expect(progressRetry).toMatchObject({
      adopted: true,
      appended: false,
      event: { id: progress.event.id, created_at: "2026-07-23T11:00:00.000Z" },
    });
  });

  test("an exact terminal retry replays before terminal transition rejection", async () => {
    const admitted = await ledger.admit(admission({ root_request_id: "terminal-replay" }));
    const terminalInput = {
      group_id: admitted.view.group.id,
      attempt_id: admitted.view.attempts[0]!.id,
      writer_generation: "generation-1",
      idempotency_key: "exact-terminal",
      event_type: "failure",
      outcome: "failed",
      created_at: "2026-07-23T11:02:00.000Z",
    } as const;
    const terminal = await ledger.append(terminalInput);
    const terminalRetry = await ledger.append(terminalInput);
    expect(terminalRetry).toMatchObject({
      adopted: true,
      appended: false,
      event: { id: terminal.event.id, created_at: "2026-07-23T11:02:00.000Z" },
    });
  });

  test("an exact admission retry replays after terminal failure while changed identity conflicts", async () => {
    const input = admission({ root_request_id: "terminal-admission-replay" });
    const admitted = await ledger.admit(input);
    await ledger.append({
      group_id: admitted.view.group.id,
      attempt_id: admitted.view.attempts[0]!.id,
      writer_generation: "generation-1",
      idempotency_key: "terminal-admission-failure",
      event_type: "failure",
      outcome: "failed",
      created_at: "2026-07-23T11:03:00.000Z",
    });

    const replay = await ledger.admit(input);
    expect(replay).toMatchObject({
      adopted: true,
      appended: false,
      event: { id: admitted.event.id },
    });
    await expect(ledger.admit({
      ...input,
      worktree: "/tmp/changed-terminal-admission",
    })).rejects.toMatchObject({ code: "PR_GROUP_IDENTITY_CONFLICT" });
  });

  test("recovery retries omit recovered_at without changing stable request identity", async () => {
    const recoverable = await ledger.admit(admission({
      root_request_id: "timestamp-recovery",
      dispatch_attempt: "dispatch-recovery-1",
      writer_generation: "generation-recovery-1",
    }));
    const recoveryInput = {
      group_id: recoverable.view.group.id,
      root_request_id: "timestamp-recovery",
      repository: "hasna/todos",
      leaf_task_id: "leaf-task-1",
      expected_attempt_id: recoverable.view.attempts[0]!.id,
      dispatch_attempt: "dispatch-recovery-2",
      expected_generation: "generation-recovery-1",
      writer_generation: "generation-recovery-2",
      worktree: "/tmp/pr-group-ledger-recovery",
      branch: "feat/pr-group-ledger",
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
      provider: "codewith",
      provider_run_id: "provider-run-recovery-2",
      profile_alias: "account012",
      idempotency_key: "timestamp-free-recovery",
    };
    setSystemTime(new Date("2026-07-23T11:04:00.000Z"));
    const recovered = await ledger.recover(recoveryInput);
    setSystemTime(new Date("2026-07-23T11:05:00.000Z"));
    const recoveryRetry = await ledger.recover(recoveryInput);
    expect(recoveryRetry).toMatchObject({
      adopted: true,
      appended: false,
      event: { id: recovered.event.id, created_at: "2026-07-23T11:04:00.000Z" },
    });
  });

  test("bounded state projections never expose events for omitted attempts", async () => {
    let current = await ledger.admit(admission({
      root_request_id: "bounded-attempt-projection",
      dispatch_attempt: "projection-dispatch-0",
      writer_generation: "projection-generation-0",
    }));
    for (let index = 1; index <= 101; index += 1) {
      const previous = current.view.attempts.at(-1)!;
      current = await ledger.recover({
        group_id: current.view.group.id,
        root_request_id: "bounded-attempt-projection",
        repository: "hasna/todos",
        leaf_task_id: "leaf-task-1",
        expected_attempt_id: previous.id,
        dispatch_attempt: `projection-dispatch-${index}`,
        expected_generation: previous.writer_generation,
        writer_generation: `projection-generation-${index}`,
        worktree: `/tmp/projection-${index}`,
        branch: "feat/pr-group-ledger",
        pr_number: PR_NUMBER,
        base_sha: BASE_A,
        provider: "codewith",
        provider_run_id: `projection-provider-${index}`,
        profile_alias: "account012",
        idempotency_key: `projection-recovery-${index}`,
        recovered_at: new Date(Date.parse(T0) + index * 60_000).toISOString(),
      });
    }

    const view = await ledger.get(current.view.group.id);
    const visibleAttempts = new Set(view.attempts.map((attempt) => attempt.id));
    expect(view.attempts).toHaveLength(100);
    expect(view.diagnostics).toMatchObject({
      attempts_omitted: true,
      receipt_history_complete: false,
      event_count: view.group.revision,
    });
    expect(view.adapters.evidence_refs.every(
      (evidence) => visibleAttempts.has(evidence.work_run_id),
    )).toBe(true);
    expect(view.adapters.proof_bundle.evidence_ref_ids).toEqual(
      view.adapters.evidence_refs.map((evidence) => evidence.id),
    );
  });

  test("migration 67 backfills and safely reopens rejected-head SQLite identity", async () => {
    const upgradeDb = new Database(":memory:");
    runMigrations(upgradeDb);
    const legacyRoot = "legacy-root";
    const legacyRepository = "hasna/todos";
    const legacyLeaf = "legacy-leaf";
    const legacyBranch = "feat/legacy";
    const legacyDispatch = "legacy-dispatch";
    const legacyGeneration = "legacy-generation";
    const legacyIdentity = createHash("sha256")
      .update(`pr-group:v1\0${legacyRoot}\0${legacyRepository}`)
      .digest("hex");
    const legacyGroupId = `prg_${legacyIdentity.slice(0, 32)}`;
    const legacyAttemptId = deterministicPrGroupAttemptId(
      legacyGroupId,
      legacyLeaf,
      legacyDispatch,
    );
    upgradeDb.exec(`
      PRAGMA foreign_keys = ON;
      DROP TABLE pr_group_events;
      DROP TABLE pr_group_attempts;
      DROP TABLE pr_groups;
      DELETE FROM _migrations WHERE id > 65;
      CREATE TABLE pr_groups (
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL UNIQUE,
        root_request_id TEXT NOT NULL,
        repository TEXT NOT NULL,
        state TEXT NOT NULL,
        active_attempt_id TEXT,
        active_generation TEXT,
        terminal_attempt_id TEXT,
        terminal_generation TEXT,
        terminal_outcome TEXT,
        terminal_head_sha TEXT,
        terminal_at TEXT,
        cleanup_eligible_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pr_group_attempts (
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES pr_groups(id) ON DELETE CASCADE,
        leaf_task_id TEXT NOT NULL,
        dispatch_attempt TEXT NOT NULL,
        writer_generation TEXT NOT NULL,
        previous_attempt_id TEXT REFERENCES pr_group_attempts(id) ON DELETE SET NULL,
        worktree TEXT NOT NULL,
        branch TEXT NOT NULL,
        provider TEXT,
        provider_run_id TEXT,
        profile_alias TEXT,
        status TEXT NOT NULL,
        admitted_at TEXT NOT NULL,
        started_at TEXT,
        last_heartbeat_at TEXT,
        handed_off_at TEXT,
        fenced_at TEXT,
        terminal_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pr_group_events (
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES pr_groups(id) ON DELETE CASCADE,
        attempt_id TEXT NOT NULL REFERENCES pr_group_attempts(id) ON DELETE CASCADE,
        writer_generation TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        state TEXT NOT NULL,
        message TEXT,
        head_sha TEXT,
        receipt_key TEXT,
        outcome TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO pr_groups (
        id, identity_key, root_request_id, repository, state,
        active_attempt_id, active_generation, created_at, updated_at
      ) VALUES (
        '${legacyGroupId}', '${legacyIdentity}', '${legacyRoot}', '${legacyRepository}', 'admitted',
        '${legacyAttemptId}', '${legacyGeneration}', '${T0}', '${T0}'
      );
      INSERT INTO pr_group_attempts (
        id, group_id, leaf_task_id, dispatch_attempt, writer_generation,
        worktree, branch, provider, status, admitted_at, created_at, updated_at
      ) VALUES (
        '${legacyAttemptId}', '${legacyGroupId}', '${legacyLeaf}', '${legacyDispatch}', '${legacyGeneration}',
        '/tmp/legacy', '${legacyBranch}', 'codewith', 'admitted', '${T0}', '${T0}', '${T0}'
      );
      INSERT INTO pr_group_events (
        id, group_id, attempt_id, writer_generation, sequence, idempotency_key,
        event_type, state, payload_hash, created_at
      ) VALUES (
        'legacy-event', '${legacyGroupId}', '${legacyAttemptId}', '${legacyGeneration}', 1,
        'admission:${legacyAttemptId}', 'admission', 'admitted', '${"d".repeat(64)}', '${T0}'
      );
    `);
    runMigrations(upgradeDb);

    expect(upgradeDb.query(`
      SELECT leaf_task_id, branch, pr_number, base_sha
      FROM pr_groups WHERE id = ?
    `).get(legacyGroupId)).toEqual({
      leaf_task_id: legacyLeaf,
      branch: legacyBranch,
      pr_number: null,
      base_sha: null,
    });
    expect(upgradeDb.query(`
      SELECT repository, pr_number, base_sha
      FROM pr_group_attempts WHERE id = ?
    `).get(legacyAttemptId)).toEqual({ repository: legacyRepository, pr_number: null, base_sha: null });
    expect(upgradeDb.query(`
      SELECT repository, pr_number, base_sha
      FROM pr_group_events WHERE id = 'legacy-event'
    `).get()).toEqual({ repository: "hasna/todos", pr_number: null, base_sha: null });
    expect(upgradeDb.query("SELECT MAX(id) AS id FROM _migrations").get()).toEqual({ id: 68 });

    const upgradedLedger = new PrGroupLedger(new SqlitePrGroupLedgerPersistence(upgradeDb));
    const legacyAdmission = admission({
      root_request_id: legacyRoot,
      repository: legacyRepository,
      leaf_task_id: legacyLeaf,
      dispatch_attempt: legacyDispatch,
      writer_generation: legacyGeneration,
      worktree: "/tmp/legacy",
      branch: legacyBranch,
      pr_number: null,
      base_sha: null,
      provider: "codewith",
      provider_run_id: null,
      profile_alias: null,
    });
    const reopened = await upgradedLedger.admit(legacyAdmission);
    expect(reopened).toMatchObject({
      adopted: true,
      appended: false,
      view: { group: { id: legacyGroupId } },
    });
    await expect(upgradedLedger.admit({
      ...legacyAdmission,
      pr_number: PR_NUMBER,
      base_sha: BASE_A,
    })).rejects.toMatchObject({ code: "PR_GROUP_IDENTITY_CONFLICT" });
    expect(upgradeDb.query("SELECT COUNT(*) AS count FROM pr_groups").get()).toEqual({ count: 1 });

    const recovery = {
      group_id: legacyGroupId,
      root_request_id: legacyRoot,
      repository: legacyRepository,
      leaf_task_id: legacyLeaf,
      expected_attempt_id: legacyAttemptId,
      dispatch_attempt: "legacy-recovery",
      expected_generation: legacyGeneration,
      writer_generation: "legacy-generation-2",
      worktree: "/tmp/legacy-recovery",
      branch: legacyBranch,
      pr_number: null,
      base_sha: null,
      provider: "codewith",
      provider_run_id: null,
      profile_alias: null,
      idempotency_key: "legacy-recovery",
      recovered_at: "2026-07-23T10:01:00.000Z",
    };
    const recovered = await upgradedLedger.recover(recovery);
    expect(recovered).toMatchObject({
      appended: true,
      view: { group: { id: legacyGroupId, active_generation: "legacy-generation-2" } },
    });
    expect(await upgradedLedger.recover(recovery)).toMatchObject({
      adopted: true,
      appended: false,
      event: { id: recovered.event.id },
    });
    for (const [table, columns] of [
      ["pr_groups", ["leaf_task_id", "branch"]],
      ["pr_group_attempts", ["repository"]],
      ["pr_group_events", ["repository"]],
    ] as const) {
      const info = upgradeDb.query(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        notnull: number;
      }>;
      for (const column of columns) {
        expect(info.find((entry) => entry.name === column)?.notnull).toBe(1);
      }
    }
    expect(upgradeDb.query("PRAGMA foreign_key_check").all()).toEqual([]);
    upgradeDb.close();
  });

  test("PostgreSQL publishes the rejected-head lineage repair statements", () => {
    const postgresSql = postgresPrGroupSchemaSql().join("\n");
    expect(postgresSql).toContain("UPDATE todos_pr_groups");
    expect(postgresSql).toContain("FROM todos_pr_group_attempts");
    expect(postgresSql).toContain("UPDATE todos_pr_group_attempts");
    expect(postgresSql).toContain("UPDATE todos_pr_group_events");
    expect(postgresSql).toContain("ADD COLUMN IF NOT EXISTS ci_proof jsonb");
    expect(postgresSql).toContain("todos_pr_group_events_receipt_global_uidx");
    expect(postgresSql).toContain("WHERE receipt_key IS NOT NULL");
  });
});
