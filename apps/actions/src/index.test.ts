import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ActionsClient, createTypeScriptAction, hasRequiredApprovals, requiredApprovalCount } from "./index.js";
import { JsonActionsStore } from "./storage.js";
import type { ActionManifest } from "./types.js";

function manifest(overrides: Partial<ActionManifest> = {}): ActionManifest {
  return {
    id: "projects.metadata.update",
    name: "Update project metadata",
    version: "1.0.0",
    description: "Patch project metadata safely.",
    inputSchema: { type: "object", required: ["project", "metadata"] },
    outputSchema: { type: "object", required: ["updated"] },
    actor: { types: ["human", "agent"], required: true },
    resource: { type: "project", identifiers: ["project"] },
    scope: { level: "workspace", permissions: ["project:metadata:update"] },
    riskLevel: "medium",
    requiredApprovals: [{ kind: "manual", count: 1, reason: "metadata mutation" }],
    idempotency: { supported: true, required: true },
    dryRun: { supported: true, default: true },
    confirmation: { title: "Update project metadata", summaryTemplate: "Update {{project}}", fields: ["project"] },
    guardrail: { hook: "project-policy", failClosed: true },
    audit: { eventTypes: ["action.planned", "action.previewed", "action.executed"], includeInput: true },
    evidence: { required: false, fields: ["diff"] },
    rollback: { strategy: "compensating-action", actionId: "projects.metadata.restore" },
    executorBindings: [{ kind: "typescript", ref: "test#update" }],
    ...overrides,
  };
}

describe("ActionsClient", () => {
  test("uses SQLite storage by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-client-default-"));
    try {
      const client = new ActionsClient({ dataDir: dir });
      await client.register(createTypeScriptAction({
        manifest: manifest({ guardrail: undefined }),
        execute: async () => ({ updated: true, project: "actions" }),
      }));

      expect(existsSync(join(dir, "actions.db"))).toBe(true);
      const reopened = new ActionsClient({ dataDir: dir });
      expect(await reopened.getManifest("projects.metadata.update")).toMatchObject({ id: "projects.metadata.update" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("plans, previews, approvals, execution, audit, and idempotency", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-client-"));
    try {
      const input = z.object({ project: z.string(), metadata: z.record(z.unknown()) });
      const output = z.object({ updated: z.boolean(), project: z.string() });
      const audit: string[] = [];
      const client = new ActionsClient({
        store: new JsonActionsStore(dir),
        guardrailHooks: [async () => ({ decision: "allow" })],
        auditSinks: [(event) => {
          audit.push(event.type);
        }],
      });
      await client.register(createTypeScriptAction({
        manifest: manifest(),
        input,
        output,
        preview: async ({ input }) => ({
          summary: `Would update ${input.project}`,
          changes: [{ kind: "metadata", target: input.project, after: input.metadata }],
        }),
        execute: async ({ input }) => ({ updated: true, project: input.project }),
      }));

      const dryRun = await client.run({
        actionId: "projects.metadata.update",
        input: { project: "actions", metadata: { stage: "active" } },
        actor: { id: "hasna", type: "human" },
        idempotencyKey: "preview-1",
        dryRun: true,
      });
      expect(dryRun.status).toBe("previewed");
      expect(dryRun.preview?.changes?.[0]?.target).toBe("actions");

      const planned = await client.run({
        actionId: "projects.metadata.update",
        input: { project: "actions", metadata: { stage: "active" } },
        actor: { id: "hasna", type: "human" },
        idempotencyKey: "execute-1",
        dryRun: false,
      });
      expect(planned.status).toBe("awaiting_approval");

      const approved = await client.approve(planned.id, {
        actor: { id: "hasna", type: "human" },
        decision: "approved",
        reason: "Preview is correct",
      });
      expect(approved.status).toBe("approved");

      const executed = await client.execute(planned.id);
      expect(executed.status).toBe("succeeded");
      expect(executed.output).toEqual({ updated: true, project: "actions" });
      expect(audit).toContain("action.executed");

      const deduped = await client.plan({
        actionId: "projects.metadata.update",
        input: { project: "actions", metadata: { stage: "active" } },
        idempotencyKey: "execute-1",
      });
      expect(deduped.id).toBe(executed.id);
      expect(deduped.dedupedFromRunId).toBe(executed.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("guardrail denial stops execution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-guardrail-"));
    try {
      const client = new ActionsClient({
        store: new JsonActionsStore(dir),
        guardrailHooks: [async () => ({ decision: "deny", reason: "blocked by policy" })],
      });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "dangerous.action", requiredApprovals: [], idempotency: { supported: true } }),
        execute: async () => ({ ok: true }),
      }));

      const run = await client.run({
        actionId: "dangerous.action",
        input: {},
        dryRun: false,
      });
      expect(run.status).toBe("denied");
      expect(run.error).toContain("blocked by policy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("approval requirements honor actor roles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-roles-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({
          id: "role.approved.action",
          requiredApprovals: [{ kind: "manual", count: 1, roles: ["maintainer"] }],
          idempotency: { supported: true },
          guardrail: undefined,
        }),
        execute: async () => ({ updated: true, project: "actions" }),
      }));
      const run = await client.run({
        actionId: "role.approved.action",
        input: { project: "actions", metadata: {} },
        dryRun: false,
      });
      expect(run.status).toBe("awaiting_approval");

      await client.approve(run.id, {
        actor: { id: "reviewer", type: "human", roles: ["reader"] },
        decision: "approved",
      });
      const stillWaiting = await client.execute(run.id);
      expect(stillWaiting.status).toBe("awaiting_approval");

      await client.approve(run.id, {
        actor: { id: "maintainer", type: "human", roles: ["maintainer"] },
        decision: "approved",
      });
      const executed = await client.execute(run.id);
      expect(executed.status).toBe("succeeded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// agent-authored test-gap additions (SOL consult unavailable: codewith exec with
// gpt-5.6-sol max reasoning timed out at the 570s window on two distinct accounts
// before producing a final answer; this spec was written from direct source analysis).
describe("ActionsClient failure and edge contracts", () => {
  test("executing a denied run is a no-op and never reaches the executor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-denied-execute-"));
    let executorCalls = 0;
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "denied.noop", requiredApprovals: [], idempotency: { supported: true }, guardrail: undefined }),
        execute: async () => {
          executorCalls += 1;
          return { ok: true };
        },
      }));

      const planned = await client.plan({ actionId: "denied.noop", input: {}, dryRun: false });
      await client.deny(planned.id, { actor: { id: "security", type: "human" }, decision: "denied", reason: "not authorized" });

      const reExecuted = await client.execute(planned.id);
      expect(reExecuted.status).toBe("denied");
      expect(reExecuted.error).toBe("not authorized");
      expect(executorCalls).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("executing a dry-run run returns the preview without invoking the executor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-dryrun-execute-"));
    let executorCalls = 0;
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "dryrun.preview", requiredApprovals: [], idempotency: { supported: true }, guardrail: undefined }),
        execute: async () => {
          executorCalls += 1;
          return { ok: true };
        },
      }));

      const dryRun = await client.plan({ actionId: "dryrun.preview", input: {}, dryRun: true });
      const executed = await client.execute(dryRun.id);
      expect(executed.status).toBe("previewed");
      expect(executorCalls).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rollbackOnFailure records a rolled_back run and its audit event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-rollback-"));
    const audit: string[] = [];
    try {
      const client = new ActionsClient({
        store: new JsonActionsStore(dir),
        auditSinks: [(event) => {
          audit.push(event.type);
        }],
      });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "rollback.atomic", requiredApprovals: [], idempotency: { supported: true }, guardrail: undefined }),
        execute: async () => {
          throw new Error("destination write failed");
        },
        rollback: async () => ({ summary: "Restored previous state", changes: [{ kind: "restore", target: "destination" }] }),
      }));

      const run = await client.run({ actionId: "rollback.atomic", input: {}, dryRun: false }, { rollbackOnFailure: true });
      expect(run.status).toBe("rolled_back");
      expect(run.error).toBe("destination write failed");
      expect(run.preview?.summary).toBe("Restored previous state");
      expect(run.preview?.changes?.[0]?.kind).toBe("restore");
      expect(audit).toContain("action.rolled_back");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fail-closed guardrail with no hooks configured denies before execution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-failclosed-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "failclosed.guard", requiredApprovals: [], idempotency: { supported: true } }),
        execute: async () => ({ ok: true }),
      }));

      const run = await client.run({ actionId: "failclosed.guard", input: {}, dryRun: false });
      expect(run.status).toBe("denied");
      expect(run.error).toContain("no guardrail hook is configured");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("planning without a required idempotency key is rejected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-idem-required-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "idem.required", idempotency: { supported: true, required: true }, guardrail: undefined }),
        execute: async () => ({ ok: true }),
      }));

      expect(client.plan({ actionId: "idem.required", input: {}, dryRun: true })).rejects.toThrow(
        "requires an idempotency key",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("executor failures mark the run failed with the error message and an audit event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-exec-fail-"));
    const audit: string[] = [];
    try {
      const client = new ActionsClient({
        store: new JsonActionsStore(dir),
        auditSinks: [(event) => {
          audit.push(event.type);
        }],
      });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "exec.fails", requiredApprovals: [], idempotency: { supported: true }, guardrail: undefined }),
        execute: async () => {
          throw new Error("boom");
        },
      }));

      const run = await client.run({ actionId: "exec.fails", input: {}, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toBe("boom");
      expect(run.completedAt).toBeDefined();
      expect(audit).toContain("action.failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("audit events carry includeOutput only when the manifest opts in", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-audit-flag-"));
    const auditData: Array<Record<string, unknown>> = [];
    try {
      const client = new ActionsClient({
        store: new JsonActionsStore(dir),
        auditSinks: [(event) => {
          if (event.type === "action.executed") auditData.push(event.data);
        }],
      });
      await client.register(createTypeScriptAction({
        manifest: manifest({
          id: "audit.with-output",
          requiredApprovals: [],
          idempotency: { supported: true },
          guardrail: undefined,
          audit: { eventTypes: ["action.planned", "action.executed"], includeOutput: true },
        }),
        execute: async () => ({ secret: "result" }),
      }));
      await client.register(createTypeScriptAction({
        manifest: manifest({
          id: "audit.without-output",
          requiredApprovals: [],
          idempotency: { supported: true },
          guardrail: undefined,
          audit: { eventTypes: ["action.planned", "action.executed"], includeOutput: false },
        }),
        execute: async () => ({ secret: "result" }),
      }));

      await client.run({ actionId: "audit.with-output", input: {}, dryRun: false });
      await client.run({ actionId: "audit.without-output", input: {}, dryRun: false });

      expect(auditData).toEqual([
        { includeOutput: true },
        { includeOutput: false },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("run with autoApprove completes the full lifecycle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-autoapprove-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "auto.approve", idempotency: { supported: true }, guardrail: undefined }),
        execute: async ({ input }) => ({ updated: true, project: (input as { project: string }).project }),
      }));

      const run = await client.run(
        { actionId: "auto.approve", input: { project: "actions", metadata: {} }, dryRun: false },
        { autoApprove: { actor: { id: "cli", type: "human" }, decision: "approved", reason: "auto" } },
      );
      expect(run.status).toBe("succeeded");
      expect(run.output).toEqual({ updated: true, project: "actions" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("confirmation summaries resolve nested template paths and blank missing keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-summary-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({
          id: "summary.template",
          confirmation: {
            title: "Templated",
            summaryTemplate: "{{a.b}}|{{missing}}|{{a.b.c}}",
          },
          requiredApprovals: [],
          idempotency: { supported: true },
          guardrail: undefined,
        }),
        execute: async () => ({ ok: true }),
      }));

      const planned = await client.plan({
        actionId: "summary.template",
        input: { a: { b: "nested-value" } },
        dryRun: true,
      });
      expect(planned.confirmationSummary).toBe("nested-value||");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("re-registering an action id replaces the definition and stored manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-reregister-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "reregister.me", requiredApprovals: [], idempotency: { supported: true }, guardrail: undefined }),
        execute: async () => ({ generation: "first" }),
      }));
      await client.register(createTypeScriptAction({
        manifest: manifest({ id: "reregister.me", version: "2.0.0", requiredApprovals: [], idempotency: { supported: true }, guardrail: undefined }),
        execute: async () => ({ generation: "second" }),
      }));

      const run = await client.run({ actionId: "reregister.me", input: {}, dryRun: false });
      expect(run.output).toEqual({ generation: "second" });
      expect(run.actionVersion).toBe("2.0.0");
      expect((await client.getManifest("reregister.me"))?.version).toBe("2.0.0");
      expect(await client.listManifests()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("approval helpers count none requirements as zero and reject denied sets", () => {
    expect(requiredApprovalCount([
      { kind: "none" },
      { kind: "manual", count: 2 },
      { kind: "none" },
    ])).toBe(2);

    const requirement = { kind: "manual" as const, count: 1, roles: ["maintainer"] };
    const runShape = {
      requiredApprovals: [requirement],
      approvals: [],
    };
    expect(hasRequiredApprovals({ ...runShape, approvals: [] })).toBe(false);
    expect(hasRequiredApprovals({
      ...runShape,
      approvals: [{ actor: { id: "other", type: "human" as const, roles: ["reader"] }, decision: "approved" as const }],
    })).toBe(false);
    expect(hasRequiredApprovals({
      ...runShape,
      approvals: [{ actor: { id: "admin", type: "human" as const, roles: ["maintainer"] }, decision: "approved" as const }],
    })).toBe(true);
    expect(hasRequiredApprovals({
      ...runShape,
      approvals: [{ actor: { id: "admin", type: "human" as const, roles: ["maintainer"] }, decision: "denied" as const }],
    })).toBe(false);
  });
});
