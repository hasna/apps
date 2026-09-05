import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionManifest, ActorRef, JsonValue } from "@hasna/actions";
import {
  AutomationsStore,
  type AutomationSpec,
  type TypedActionDefinition,
  type TypedActionDeliveryReceipt,
  TypedActionWorker,
} from "../index.js";

let dataDir = "";

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-typed-worker-"));
  process.env.HASNA_AUTOMATIONS_DIR = dataDir;
});

afterEach(() => {
  delete process.env.HASNA_AUTOMATIONS_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

function manifest(id: string, overrides: Partial<ActionManifest> = {}): ActionManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: `Typed test action ${id}`,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    actor: { types: ["agent"], required: false },
    resource: { type: "automation" },
    scope: { level: "local" },
    riskLevel: "low",
    requiredApprovals: [],
    idempotency: { supported: true },
    dryRun: { supported: false },
    confirmation: { title: id },
    audit: { eventTypes: [] },
    evidence: {},
    rollback: { strategy: "none" },
    executorBindings: [{ kind: "typescript", ref: `test/${id}` }],
    ...overrides,
  };
}

function spec(actionId: string, version = "1.0.0"): AutomationSpec {
  return {
    schemaVersion: "1.0",
    id: "typed.worker.demo",
    name: "Typed worker demo",
    version,
    triggers: [{ kind: "manual" }],
    actions: [{ id: "step-1", actionId, manifestVersion: "1.0.0", input: { from: "spec" } }],
  };
}

function definition(
  actionId: string,
  execute: TypedActionDefinition["execute"],
  overrides: Partial<ActionManifest> = {},
): TypedActionDefinition {
  return { manifest: manifest(actionId, overrides), execute };
}

describe("TypedActionWorker", () => {
  test("executes a registered TypeScript action and settles its run", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(spec("typed.echo"));
      const worker = new TypedActionWorker({
        store,
        definitions: [definition("typed.echo", ({ input, actor }) => ({
          summary: "echoed",
          output: { input, actor: actor?.id ?? null },
        }))],
      });

      const receipt = await worker.run("typed.worker.demo@1.0.0", {
        input: { from: "caller" },
        actor: { id: "agent-1", type: "agent" },
      });

      expect(receipt.status).toBe("succeeded");
      expect(receipt.run?.status).toBe("succeeded");
      expect(receipt.actions?.[0]).toMatchObject({
        status: "succeeded",
        result: { summary: "echoed" },
      });
      expect(receipt.actions?.[0]?.result?.output).toEqual({
        input: { from: "caller" },
        actor: "agent-1",
      });
    } finally {
      store.close();
    }
  });

  test("materializes declared step outputs before invoking a dependent action", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation({
        schemaVersion: "1.0",
        id: "typed.outputs",
        name: "Typed output materialization",
        version: "1.0.0",
        triggers: [{ kind: "manual" }],
        actions: [
          {
            id: "lookup",
            actionId: "typed.lookup",
            manifestVersion: "1.0.0",
            input: {},
          },
          {
            id: "send",
            actionId: "typed.send",
            manifestVersion: "1.0.0",
            dependsOn: ["lookup"],
            input: {
              contactId: "${{ steps.lookup.outputs.contactId }}",
            },
          },
        ],
        metadata: {
          template: {
            stepOutputs: {
              lookup: {
                contactId: "/contact/id",
              },
            },
          },
        },
      });
      let received: JsonValue | undefined;
      const worker = new TypedActionWorker({
        store,
        definitions: [
          definition("typed.lookup", () => ({
            output: { contact: { id: "contact-1" } },
          })),
          definition("typed.send", ({ input }) => {
            received = input;
            return { output: { accepted: true } };
          }),
        ],
      });

      const receipt = await worker.run("typed.outputs@1.0.0");
      expect(receipt.status).toBe("succeeded");
      expect(received).toEqual({ contactId: "contact-1" });
    } finally {
      store.close();
    }
  });

  test("does not let an installed template shadow an exact automation reference", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(spec("typed.legacy"));
      store.createAutomation({
        ...spec("typed.template"),
        id: "template:typed.worker.demo:1.0.0",
        name: "Versioned template collision",
      });
      const observed: string[] = [];
      const worker = new TypedActionWorker({
        store,
        definitions: [
          definition("typed.legacy", () => {
            observed.push("legacy");
            return { output: {} };
          }),
          definition("typed.template", () => {
            observed.push("template");
            return { output: {} };
          }),
        ],
      });

      const exact = await worker.run("typed.worker.demo@1.0.0");
      const explicitTemplate = await worker.run("template:typed.worker.demo:1.0.0@1.0.0");

      expect(exact.status).toBe("succeeded");
      expect(exact.automationId).toBe("typed.worker.demo");
      expect(explicitTemplate.status).toBe("succeeded");
      expect(explicitTemplate.automationId).toBe("template:typed.worker.demo:1.0.0");
      expect(observed).toEqual(["legacy", "template"]);
    } finally {
      store.close();
    }
  });

  test("rejects non-TypeScript executor bindings before registration", () => {
    const store = new AutomationsStore();
    try {
      expect(() => new TypedActionWorker({
        store,
        definitions: [definition("typed.shell", () => ({ output: {} }), {
          executorBindings: [{ kind: "local-shell", command: "echo unsafe" }],
        })],
      })).toThrow("non-TypeScript executor");
    } finally {
      store.close();
    }
  });

  test("enforces actor and permission authority", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(spec("typed.protected"));
      const protectedManifest = manifest("typed.protected", {
        actor: { types: ["agent"], required: true },
        scope: { level: "local", permissions: ["automations:write"] },
      });
      const worker = new TypedActionWorker({
        store,
        definitions: [{ manifest: protectedManifest, execute: () => ({ output: { ok: true } }) }],
        authority: { actor: { id: "agent-1", type: "agent" }, permissions: [] },
      });

      const receipt = await worker.run("typed.worker.demo@1.0.0");
      expect(receipt.status).toBe("failed");
      expect(receipt.run?.error).toContain("authority lacks permission");
      expect(receipt.actions?.[0]?.error?.code).toBe("ACTION_AUTHORITY_DENIED");
    } finally {
      store.close();
    }
  });

  test("keeps partial delivery receipts and fails the run", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(spec("typed.partial"));
      const receipts: TypedActionDeliveryReceipt[] = [
        { sink: "primary", status: "succeeded" as const, receipt: { id: "primary-1" } },
        { sink: "secondary", status: "failed" as const, error: { code: "SECONDARY_DOWN", message: "secondary unavailable" } },
      ];
      let primaryEffects = 0;
      let secondaryEffects = 0;
      const worker = new TypedActionWorker({
        store,
        definitions: [definition("typed.partial", ({ action }) => {
          const prior = action.result?.metadata?.deliveryReceipts as unknown as TypedActionDeliveryReceipt[] | undefined;
          if (!prior) primaryEffects += 1;
          secondaryEffects += 1;
          return prior ? { status: "succeeded", receipts: [{ sink: "secondary", status: "succeeded" as const, receipt: { id: "secondary-2" } }] } : {
            status: "partial",
            summary: "primary delivered; secondary failed",
            receipts,
          };
        })],
      });

      const receipt = await worker.run("typed.worker.demo@1.0.0");
      expect(receipt.status).toBe("failed");
      expect(receipt.run?.status).toBe("failed");
      expect(receipt.run?.error).toBe("partial delivery receipt requires replay");
      expect(receipt.partial).toEqual(receipts);
      expect(receipt.actions?.[0]?.status).toBe("succeeded");
      expect(receipt.actions?.[0]?.result?.metadata?.deliveryStatus).toBe("partial");
      expect(receipt.actions?.[0]?.result?.metadata?.deliveryReceipts).toEqual(receipts as unknown as JsonValue);
      const sourceAction = receipt.actions![0]!;
      const replay = store.readmitPartialAction(sourceAction.id);
      expect(replay).toMatchObject({ status: "admitted", metadata: { partialReplayOf: sourceAction.id } });
      expect(store.readmitPartialAction(sourceAction.id).id).toBe(replay.id);
      const replayed = await worker.replayPartial(sourceAction.id);
      expect(replayed.status).toBe("succeeded");
      expect(replayed.run?.status).toBe("succeeded");
      expect(primaryEffects).toBe(1);
      expect(secondaryEffects).toBe(2);
      expect(store.requireQueueEntry(sourceAction.id).result?.metadata?.deliveryReceipts).toEqual(receipts as unknown as JsonValue);
    } finally {
      store.close();
    }
  });

  test("supports detach and timeout without reporting false success", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(spec("typed.slow"));
      let settled = false;
      const worker = new TypedActionWorker({
        store,
        definitions: [definition("typed.slow", async () => {
          await Bun.sleep(40);
          return { output: { ok: true } };
        })],
      });

      const detached = await worker.run("typed.worker.demo@1.0.0", { detach: true });
      expect(detached.status).toBe("admitted");
      expect(detached.run).toBeUndefined();
      expect(store.requireRun(detached.runId).status).toBe("materialized");

      const timed = await worker.run("typed.worker.demo@1.0.0", { timeoutMs: 1, leaseMs: 15, onSettled: () => { settled = true; } });
      expect(timed.status).toBe("running");
      expect(store.requireRun(timed.runId).status).toBe("running");
      // The 1ms caller timeout must not report false success: the 40ms action
      // is still in flight when run() returns, and the run only settles once
      // the worker actually finishes and persists the terminal receipt. Wait
      // for that settlement instead of sleeping a fixed 70ms — under CI load
      // the action's sleep can overshoot the window (measured flake, #1796),
      // and a poll keeps failing exactly when it should: a run that never
      // settles (deadline) or settles as anything but succeeded still reds.
      const deadline = Date.now() + 4_000;
      while (!settled && Date.now() < deadline) {
        await Bun.sleep(10);
      }
      expect(store.requireRun(timed.runId).status).toBe("succeeded");
      expect(settled).toBe(true);
    } finally {
      store.close();
    }
  });

  test("renews a short typed lease and fences stale settlement", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(spec("typed.lease"));
      const worker = new TypedActionWorker({
        store,
        definitions: [definition("typed.lease", async () => {
          // Keep enough scheduler margin for hosted CI while remaining short
          // relative to the worker's 30-second default lease.
          await Bun.sleep(800);
          return { output: { renewed: true } };
        })],
      });
      const receipt = await worker.run("typed.worker.demo@1.0.0", { leaseMs: 500 });
      expect(receipt.status).toBe("succeeded");
      expect(receipt.actions?.[0]?.status).toBe("succeeded");

      store.createAutomation(spec("typed.stale"));
      const staleWorker = new TypedActionWorker({
        store,
        runnerId: "stale-worker",
        definitions: [definition("typed.stale", async () => {
          await Bun.sleep(600);
          return { output: { stale: true } };
        })],
      });
      const staleRun = staleWorker.run("typed.worker.demo@1.0.0", { leaseMs: 300 });
      await Bun.sleep(450);
      const claimed = store.listQueueEntries().find((action) => action.status === "leased" && action.leasedBy === "stale-worker");
      expect(claimed).toBeDefined();
      store.db.query("UPDATE automation_actions SET leased_by = 'replacement', lease_generation = lease_generation + 1 WHERE id = $id").run({ $id: claimed!.id });
      await expect(staleRun).rejects.toThrow();
      expect(store.requireQueueEntry(claimed!.id).status).toBe("leased");
    } finally {
      store.close();
    }
  });

  test("does not bypass an approval gate", async () => {
    const store = new AutomationsStore();
    try {
      const approvalSpec = spec("typed.approval");
      approvalSpec.actions[0] = {
        ...approvalSpec.actions[0],
        approval: { mode: "manual", requiresApproval: true },
      };
      store.createAutomation(approvalSpec);
      const worker = new TypedActionWorker({
        store,
        definitions: [definition("typed.approval", () => ({ output: { ok: true } }))],
      });

      const receipt = await worker.run("typed.worker.demo@1.0.0");
      expect(receipt.status).toBe("running");
      expect(receipt.run?.status).toBe("running");
      expect(receipt.actions?.[0]?.status).toBe("waiting_approval");
      expect(receipt.actions?.[0]?.approvalGate?.decision?.status).toBe("pending");
    } finally {
      store.close();
    }
  });

  test("fails an unregistered typed action instead of succeeding", async () => {
    const store = new AutomationsStore();
    try {
      store.createAutomation(spec("typed.missing"));
      const worker = new TypedActionWorker({ store });
      const receipt = await worker.run("typed.worker.demo@1.0.0");
      expect(receipt.status).toBe("failed");
      expect(receipt.actions?.[0]?.error?.code).toBe("TYPED_ACTION_NOT_REGISTERED");
      expect(receipt.run?.status).toBe("failed");
    } finally {
      store.close();
    }
  });
});
