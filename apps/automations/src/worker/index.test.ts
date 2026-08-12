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
      const worker = new TypedActionWorker({
        store,
        definitions: [definition("typed.partial", () => ({
          status: "partial",
          summary: "primary delivered; secondary failed",
          receipts,
        }))],
      });

      const receipt = await worker.run("typed.worker.demo@1.0.0");
      expect(receipt.status).toBe("failed");
      expect(receipt.run?.status).toBe("failed");
      expect(receipt.run?.error).toBe("partial delivery receipt requires replay");
      expect(receipt.partial).toEqual(receipts);
      expect(receipt.actions?.[0]?.status).toBe("succeeded");
      expect(receipt.actions?.[0]?.result?.metadata?.deliveryStatus).toBe("partial");
      expect(receipt.actions?.[0]?.result?.metadata?.deliveryReceipts).toEqual(receipts as unknown as JsonValue);
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
      expect(detached.status).toBe("enqueued");
      expect(detached.run).toBeUndefined();
      expect(store.requireRun(detached.runId).status).toBe("materialized");

      const timed = await worker.run("typed.worker.demo@1.0.0", { timeoutMs: 1, onSettled: () => { settled = true; } });
      expect(timed.status).toBe("running");
      expect(store.requireRun(timed.runId).status).toBe("running");
      await Bun.sleep(70);
      expect(store.requireRun(timed.runId).status).toBe("succeeded");
      expect(settled).toBe(true);
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
