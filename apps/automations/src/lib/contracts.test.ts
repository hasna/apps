import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_IDS } from "@hasna/contracts";
import type { AutomationRun, QueuedAction } from "../types.js";
import { AutomationsStore } from "./store.js";
import {
  approvalDecisionToDecisionEnvelope,
  automationRunToWorkRun,
  evidenceRefFromString,
  queuedActionDecisionEnvelopes,
} from "./contracts.js";

const createdAt = "2026-07-07T10:00:00.000Z";
const updatedAt = "2026-07-07T10:01:00.000Z";

function automationRun(status: AutomationRun["status"], extra: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: `run_${status}`,
    automationId: "tickets.escalate-critical",
    status,
    trigger: { kind: "event", source: "open-events", type: "ticket.created" },
    triggerEventId: "evt_contract",
    idempotencyKey: "tickets.escalate-critical:evt_contract",
    createdAt,
    updatedAt,
    metadata: { evidenceRefs: ["artifact://automations/evidence/evt_contract"] },
    ...extra,
  };
}

function queuedApprovalAction(status: "pending" | "approved" | "rejected" | "cancelled"): QueuedAction {
  return {
    id: `action_${status}`,
    automationRunId: "run_materialized",
    stepId: "needs-approval",
    actionId: "actions.external-write",
    idempotencyKey: `run_materialized:${status}`,
    status: status === "pending" ? "waiting_approval" : "queued",
    invocation: {
      id: `inv_${status}`,
      actionId: "actions.external-write",
      manifestVersion: "1.0.0",
      input: {},
      requestedAt: createdAt,
    },
    attempt: 0,
    maxAttempts: 1,
    availableAt: createdAt,
    createdAt,
    updatedAt,
    approvalGate: {
      requirement: { mode: "manual", requiresApproval: true, reason: "External write requires review." },
      blockedUntilApproved: status !== "approved",
      decision: {
        id: `decision_${status}`,
        status,
        requestedAt: createdAt,
        decidedAt: status === "pending" ? undefined : updatedAt,
        reason: status === "rejected" ? "change is not safe" : undefined,
        evidenceRef: "artifact://approvals/decision.txt",
      },
    },
  };
}

describe("contract adapters", () => {
  test("maps materialized automation runs to work_run pending and preserves original status", () => {
    const contract = automationRunToWorkRun(automationRun("materialized"));

    expect(contract.schema).toBe(SCHEMA_IDS.workRun);
    expect(contract.status).toBe("pending");
    expect(contract.metadata?.originalStatus).toBe("materialized");
    expect((contract.metadata?.statusMapping as Record<string, string>).materialized).toBe("pending");
    expect(contract.evidenceRefs.map((ref) => ref.uri)).toContain("artifact://automations/runs/run_materialized");
  });

  test("maps dead automation runs to work_run failed with terminal evidence", () => {
    const contract = automationRunToWorkRun(automationRun("dead", {
      error: "max attempts exceeded",
      completedAt: undefined,
    }));

    expect(contract.status).toBe("failed");
    expect(contract.finishedAt).toBe(updatedAt);
    expect(contract.metadata?.originalStatus).toBe("dead");
    expect(contract.evidenceRefs.some((ref) => ref.summary === "max attempts exceeded")).toBe(true);
  });

  test("maps approval decisions to decision_envelope and attaches evidence pointers", () => {
    const pending = queuedApprovalAction("pending");
    const pendingDecision = approvalDecisionToDecisionEnvelope(pending.approvalGate!.decision!, {
      action: pending,
      gate: pending.approvalGate,
    });
    expect(pendingDecision.schema).toBe(SCHEMA_IDS.decisionEnvelope);
    expect(pendingDecision.status).toBe("approval_required");
    expect(pendingDecision.obligations).toEqual(["approval required: manual"]);
    expect(pendingDecision.evidenceRefs[0]?.uri).toBe("artifact://approvals/decision.txt");

    const rejected = queuedApprovalAction("rejected");
    const rejectedDecision = queuedActionDecisionEnvelopes([rejected])[0]!;
    expect(rejectedDecision.status).toBe("denied");
    expect(rejectedDecision.obligations).toEqual(["change is not safe"]);
    expect(rejectedDecision.selected).toEqual([]);

    const approved = queuedApprovalAction("approved");
    const approvedDecision = queuedActionDecisionEnvelopes([approved])[0]!;
    expect(approvedDecision.status).toBe("allowed");
    expect(approvedDecision.selected[0]).toMatchObject({ kind: "action", id: "action_approved" });

    const cancelled = queuedApprovalAction("cancelled");
    const cancelledDecision = queuedActionDecisionEnvelopes([cancelled])[0]!;
    expect(cancelledDecision.status).toBe("skipped");
    expect(cancelledDecision.skipped[0]).toMatchObject({ kind: "action", id: "action_cancelled" });

    const directCancelled = approvalDecisionToDecisionEnvelope({
      id: "decision_direct_cancelled",
      status: "cancelled",
      requestedAt: createdAt,
      decidedAt: updatedAt,
    });
    expect(directCancelled.status).toBe("unknown");
    expect(directCancelled.skipped).toEqual([]);
  });

  test("maps persisted approval decidedBy metadata to a decision actor", () => {
    const previousDataDir = process.env.HASNA_AUTOMATIONS_DIR;
    const dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-contracts-"));
    process.env.HASNA_AUTOMATIONS_DIR = dataDir;
    const store = new AutomationsStore();
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "approval-contract-test",
        name: "Approval contract test",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "open-events", type: "approval.test" }],
        actions: [
          { id: "needs-approval", actionId: "actions.external-write", approval: { mode: "manual", requiresApproval: true } },
        ],
      });
      store.materializeEvent({
        id: "evt_approval_contract",
        source: "open-events",
        type: "approval.test",
        time: createdAt,
        data: {},
      });
      const waiting = store.listQueuedActions().find((action) => action.stepId === "needs-approval")!;
      const approved = store.approveAction(waiting.id, { now: updatedAt, decidedBy: "reviewer" });
      const decision = queuedActionDecisionEnvelopes([approved])[0]!;

      expect(decision.status).toBe("allowed");
      expect(decision.actor).toMatchObject({ kind: "human", id: "reviewer" });
      expect(decision.metadata?.decisionMetadata).toMatchObject({ decidedBy: "reviewer" });
    } finally {
      store.close();
      if (previousDataDir === undefined) {
        delete process.env.HASNA_AUTOMATIONS_DIR;
      } else {
        process.env.HASNA_AUTOMATIONS_DIR = previousDataDir;
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("converts evidence strings to evidence_ref contracts without exposing opaque refs", () => {
    const artifact = evidenceRefFromString("artifact://automations/evidence/evt_contract", {
      createdAt,
      summary: "Event evidence",
    });
    expect(artifact).toMatchObject({
      schema: SCHEMA_IDS.evidenceRef,
      uri: "artifact://automations/evidence/evt_contract",
      kind: "artifact",
      summary: "Event evidence",
    });

    const opaque = evidenceRefFromString("approval evidence row 42", { createdAt });
    expect(opaque.uri).toStartWith("artifact://automations/evidence/");
    expect(opaque.metadata?.originalRefStored).toBe(false);
  });
});
