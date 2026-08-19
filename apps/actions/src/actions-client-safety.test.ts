import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ActionsClient, assertManifest, createTypeScriptAction, hasRequiredApprovals } from "./index.js";
import { JsonActionsStore } from "./storage.js";
import type { ActionAuditEvent, ActionManifest } from "./types.js";

function manifest(overrides: Partial<ActionManifest> = {}): ActionManifest {
  return {
    id: "safety.action",
    name: "Safety action",
    version: "1.0.0",
    description: "Exercises ActionsClient lifecycle and safety paths.",
    inputSchema: { type: "object", required: ["project"] },
    outputSchema: { type: "object", required: ["updated"] },
    actor: { types: ["human", "agent"], required: true },
    resource: { type: "project", identifiers: ["project"] },
    scope: { level: "workspace", permissions: ["project:update"] },
    riskLevel: "medium",
    requiredApprovals: [{ kind: "manual", count: 1, reason: "mutation" }],
    idempotency: { supported: true, required: false },
    dryRun: { supported: true, default: true },
    confirmation: { title: "Update project", summaryTemplate: "Update {{project}}" },
    audit: { eventTypes: ["action.planned", "action.previewed", "action.executed"], includeInput: true },
    evidence: { required: false },
    rollback: { strategy: "compensating-action", actionId: "safety.rollback" },
    executorBindings: [{ kind: "typescript", ref: "safety#execute" }],
    ...overrides,
  };
}

async function withClient<T>(fn: (client: ActionsClient, dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "actions-safety-"));
  try {
    return await fn(new ActionsClient({ store: new JsonActionsStore(dir) }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("ActionsClient executor failure and rollback", () => {
  test("executor rejection leaves the run failed with the exact error and an action.failed audit event", async () => {
    await withClient(async (client, dir) => {
      const audit: string[] = [];
      const audited = new ActionsClient({
        store: new JsonActionsStore(dir),
        auditSinks: [(event: ActionAuditEvent) => {
          audit.push(event.type);
        }],
      });
      await audited.register(createTypeScriptAction({
        manifest: manifest({ requiredApprovals: [] }),
        execute: async () => {
          throw new Error("simulated executor crash");
        },
      }));

      const run = await audited.run({ actionId: "safety.action", input: { project: "x" }, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toBe("simulated executor crash");
      expect(run.output).toBeUndefined();
      expect(run.completedAt).toBeDefined();
      expect(audit).toContain("action.failed");

      // Two-sided: a working executor succeeds and records no error.
      await audited.register(createTypeScriptAction({
        manifest: manifest({ id: "safety.action.good", requiredApprovals: [] }),
        execute: async () => ({ updated: true }),
      }));
      const good = await audited.run(
        { actionId: "safety.action.good", input: { project: "y" }, dryRun: false, idempotencyKey: "good-executor" },
      );
      expect(good.status).toBe("succeeded");
      expect(good.error).toBeUndefined();
    });
  });

  test("rollbackOnFailure records rollback preview data and emits action.rolled_back", async () => {
    await withClient(async (client, dir) => {
      const audit: string[] = [];
      const audited = new ActionsClient({
        store: new JsonActionsStore(dir),
        auditSinks: [(event: ActionAuditEvent) => {
          audit.push(event.type);
        }],
      });
      await audited.register(createTypeScriptAction({
        manifest: manifest({ requiredApprovals: [] }),
        execute: async () => {
          throw new Error("boom");
        },
        rollback: async () => ({
          summary: "Rolled back to previous metadata",
          changes: [{ kind: "restore", target: "metadata", before: { stage: "old" }, after: { stage: "new" } }],
        }),
      }));

      const run = await audited.run({ actionId: "safety.action", input: { project: "x" }, dryRun: false }, { rollbackOnFailure: true });
      expect(run.status).toBe("rolled_back");
      expect(run.error).toBe("boom");
      expect(run.preview?.summary).toBe("Rolled back to previous metadata");
      expect(run.preview?.changes?.[0]).toMatchObject({ kind: "restore", target: "metadata" });
      expect(audit).toContain("action.failed");
      expect(audit).toContain("action.rolled_back");

      // Two-sided: without rollbackOnFailure the run stays failed and never rolls back.
      const second = await audited.run(
        { actionId: "safety.action", input: { project: "x" }, dryRun: false, idempotencyKey: "no-rollback" },
        { rollbackOnFailure: false },
      );
      expect(second.status).toBe("failed");
      // The preview phase always renders a default preview; "never rolls back" means
      // the rollback preview data (changes) is absent, not that preview is undefined.
      expect(second.preview?.changes).toBeUndefined();
    });
  });
});

describe("ActionsClient fail-closed guardrail", () => {
  test("a fail-closed guardrail with no hooks denies with the exact reason and never calls the executor", async () => {
    let executeCalls = 0;
    await withClient(async (client, dir) => {
      const audit: string[] = [];
      const audited = new ActionsClient({
        store: new JsonActionsStore(dir),
        auditSinks: [(event: ActionAuditEvent) => {
          audit.push(event.type);
        }],
      });
      await audited.register(createTypeScriptAction({
        manifest: manifest({
          requiredApprovals: [],
          guardrail: { hook: "org-policy", failClosed: true },
        }),
        execute: async () => {
          executeCalls += 1;
          return { updated: true };
        },
      }));

      const run = await audited.run({ actionId: "safety.action", input: { project: "x" }, dryRun: false });
      expect(run.status).toBe("denied");
      expect(run.error).toBe("Guardrail org-policy is fail-closed but no guardrail hook is configured");
      expect(executeCalls).toBe(0);

      // Executing the denied run returns the same run unchanged: no executor call,
      // no new audit event, identical status and error.
      const again = await audited.execute(run.id);
      expect(again.status).toBe("denied");
      expect(again.error).toBe(run.error);
      expect(again.id).toBe(run.id);
      expect(executeCalls).toBe(0);
      expect(audit.filter((type) => type === "action.executing" || type === "action.executed")).toEqual([]);
    });
  });

  test("a fail-open guardrail with no hooks allows execution (the opposite case)", async () => {
    let executeCalls = 0;
    await withClient(async (client) => {
      await client.register(createTypeScriptAction({
        manifest: manifest({
          requiredApprovals: [],
          guardrail: { hook: "org-policy", failClosed: false },
        }),
        execute: async () => {
          executeCalls += 1;
          return { updated: true };
        },
      }));
      const run = await client.run({ actionId: "safety.action", input: { project: "x" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect(executeCalls).toBe(1);
    });
  });

  test("with a guardrail hook configured, fail-closed does not block", async () => {
    let executeCalls = 0;
    const dir = mkdtempSync(join(tmpdir(), "actions-safety-hook-"));
    try {
      const client = new ActionsClient({
        store: new JsonActionsStore(dir),
        guardrailHooks: [async () => ({ decision: "allow" })],
      });
      await client.register(createTypeScriptAction({
        manifest: manifest({ requiredApprovals: [], guardrail: { hook: "org-policy", failClosed: true } }),
        execute: async () => {
          executeCalls += 1;
          return { updated: true };
        },
      }));
      const run = await client.run({ actionId: "safety.action", input: { project: "x" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect(executeCalls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ActionsClient dry-run", () => {
  test("a dry run becomes previewed with preview data and never calls execute", async () => {
    let executeCalls = 0;
    await withClient(async (client) => {
      await client.register(createTypeScriptAction({
        manifest: manifest({ requiredApprovals: [] }),
        preview: async ({ input }) => ({
          summary: `Would update ${(input as { project: string }).project}`,
          changes: [{ kind: "update", target: (input as { project: string }).project }],
        }),
        execute: async () => {
          executeCalls += 1;
          return { updated: true };
        },
      }));

      const run = await client.run({ actionId: "safety.action", input: { project: "x" }, dryRun: true });
      expect(run.status).toBe("previewed");
      expect(run.preview?.summary).toBe("Would update x");
      expect(run.preview?.changes).toHaveLength(1);
      expect(executeCalls).toBe(0);

      // Two-sided: a non-dry run executes exactly once.
      const executed = await client.run(
        { actionId: "safety.action", input: { project: "x" }, dryRun: false, idempotencyKey: "execute-dry-run" },
      );
      expect(executed.status).toBe("succeeded");
      expect(executeCalls).toBe(1);
    });
  });
});

describe("ActionsClient warn guardrail hook", () => {
  test("a warn hook allows execution while merging warnings and metadata into guardrailResults", async () => {
    await withClient(async (client) => {
      const warnHooks = [async () => ({
        decision: "warn" as const,
        warnings: ["requires review"],
        reason: "risk advisory",
        metadata: { lane: "audit" },
      })];
      const dir = mkdtempSync(join(tmpdir(), "actions-safety-warn-"));
      try {
        const warnClient = new ActionsClient({ store: new JsonActionsStore(dir), guardrailHooks: warnHooks });
        await warnClient.register(createTypeScriptAction({
          manifest: manifest({ requiredApprovals: [] }),
          execute: async () => ({ updated: true }),
        }));
        const run = await warnClient.run({ actionId: "safety.action", input: { project: "x" }, dryRun: false });
        expect(run.status).toBe("succeeded");
        const guardrail = run.guardrailResults.at(-1);
        expect(guardrail?.decision).toBe("warn");
        expect(guardrail?.warnings).toEqual(["requires review"]);
        expect(guardrail?.metadata).toMatchObject({ lane: "audit" });
        expect(guardrail?.reason).toBe("risk advisory");

        // Two-sided: a deny hook returns its own result verbatim and blocks execution.
        const deniedDir = mkdtempSync(join(tmpdir(), "actions-safety-deny-"));
        try {
          const deniedClient = new ActionsClient({
            store: new JsonActionsStore(deniedDir),
            guardrailHooks: [async () => ({ decision: "deny", reason: "hard stop", warnings: ["w"], metadata: { lane: "deny" } })],
          });
          await deniedClient.register(createTypeScriptAction({
            manifest: manifest({ id: "safety.deny.warn", requiredApprovals: [] }),
            execute: async () => ({ updated: true }),
          }));
          const denied = await deniedClient.run({ actionId: "safety.deny.warn", input: { project: "x" }, dryRun: false });
          expect(denied.status).toBe("denied");
          expect(denied.error).toBe("hard stop");
        } finally {
          rmSync(deniedDir, { recursive: true, force: true });
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("ActionsClient schema adapters", () => {
  test("input parsing rejects before a runnable run exists", async () => {
    await withClient(async (client, dir) => {
      await client.register(createTypeScriptAction({
        manifest: manifest({ requiredApprovals: [] }),
        input: z.object({ project: z.string(), count: z.number() }),
        execute: async () => ({ updated: true }),
      }));

      await expect(client.plan({ actionId: "safety.action", input: { project: "x", count: "not-a-number" } }))
        .rejects.toThrow(/count/);
      // The rejected parse must not leave a runnable run behind.
      expect(await new JsonActionsStore(dir).listRuns()).toEqual([]);

      // Two-sided: valid input plans into a runnable run.
      const planned = await client.plan({ actionId: "safety.action", input: { project: "x", count: 2 } });
      expect(planned.status).toBe("planned");
    });
  });

  test("an invalid executor output leaves the run failed with the parser error", async () => {
    await withClient(async (client, dir) => {
      const audit: string[] = [];
      const audited = new ActionsClient({
        store: new JsonActionsStore(dir),
        auditSinks: [(event: ActionAuditEvent) => {
          audit.push(event.type);
        }],
      });
      await audited.register(createTypeScriptAction({
        manifest: manifest({ requiredApprovals: [] }),
        output: z.object({ updated: z.boolean() }),
        execute: async (): Promise<unknown> => ({ updated: "yes" }),
      }));

      const run = await audited.run({ actionId: "safety.action", input: { project: "x" }, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toContain("updated");
      expect(run.output).toBeUndefined();
      expect(audit).toContain("action.failed");

      // Two-sided: a conforming output succeeds.
      await audited.register(createTypeScriptAction({
        manifest: manifest({ id: "safety.action.good-output", requiredApprovals: [] }),
        output: z.object({ updated: z.boolean() }),
        execute: async () => ({ updated: true }),
      }));
      const good = await audited.run(
        { actionId: "safety.action.good-output", input: { project: "y" }, dryRun: false, idempotencyKey: "good-output" },
      );
      expect(good.status).toBe("succeeded");
      expect(good.output).toEqual({ updated: true });
    });
  });
});

describe("assertManifest negative cases", () => {
  test("each missing manifest field is rejected with the exact reason", async () => {
    const cases: Array<[string, Partial<ActionManifest>, RegExp]> = [
      ["id", { id: "" }, /missing id/],
      ["name", { name: "" }, /missing name/],
      ["version", { version: "" }, /missing version/],
      ["description", { description: "" }, /missing description/],
      ["inputSchema", { inputSchema: undefined as never }, /must define inputSchema and outputSchema/],
      ["outputSchema", { outputSchema: undefined as never }, /must define inputSchema and outputSchema/],
      ["executorBindings", { executorBindings: [] }, /must define at least one executor binding/],
    ];
    for (const [field, overrides, pattern] of cases) {
      expect(() => assertManifest(manifest(overrides)), `missing ${field}`).toThrow(pattern);
    }

    // Two-sided: the full manifest validates without throwing.
    expect(() => assertManifest(manifest())).not.toThrow();
  });
});

describe("ActionsClient idempotency", () => {
  test("a required idempotency key with no key rejects the plan", async () => {
    await withClient(async (client) => {
      await client.register(createTypeScriptAction({
        manifest: manifest({ idempotency: { supported: true, required: true } }),
        execute: async () => ({ updated: true }),
      }));
      await expect(client.plan({ actionId: "safety.action", input: { project: "x" } }))
        .rejects.toThrow("Action safety.action requires an idempotency key");
      // Two-sided: supplying the key plans normally.
      const run = await client.plan({ actionId: "safety.action", input: { project: "x" }, idempotencyKey: "k-1" });
      expect(run.status).toBe("planned");
    });
  });

  test("a second plan deduplicates a non-terminal run but never a failed, denied, or cancelled one", async () => {
    await withClient(async (client, dir) => {
      const store = new JsonActionsStore(dir);
      const registerAction = async (id: string, execute: () => Promise<unknown>): Promise<void> => {
        await client.register(createTypeScriptAction({
          manifest: manifest({ id, requiredApprovals: [], guardrail: undefined }),
          execute,
        }));
      };
      await registerAction("safety.dedupe.live", async () => ({ updated: true }));
      await registerAction("safety.dedupe.fail", async () => {
        throw new Error("intentional failure");
      });
      await registerAction("safety.dedupe.deny", async () => ({ updated: true }));
      // The deny path needs a fail-closed guardrail: this client has no guardrail hooks,
      // so preview denies before the executor can run.
      await client.register(createTypeScriptAction({
        manifest: manifest({
          id: "safety.dedupe.deny",
          requiredApprovals: [],
          guardrail: { hook: "deny-hook", failClosed: true },
        }),
        execute: async () => ({ updated: true }),
      }));
      await registerAction("safety.dedupe.cancel", async () => ({ updated: true }));

      // Non-terminal prior run deduplicates.
      const first = await client.plan({ actionId: "safety.dedupe.live", input: { project: "x" }, idempotencyKey: "same-key" });
      const second = await client.plan({ actionId: "safety.dedupe.live", input: { project: "x" }, idempotencyKey: "same-key" });
      expect(second.id).toBe(first.id);
      expect(second.dedupedFromRunId).toBe(first.id);

      // Failed prior run does NOT deduplicate.
      const failed = await client.run(
        { actionId: "safety.dedupe.fail", input: { project: "x" }, idempotencyKey: "failed-key", dryRun: false },
      );
      expect(failed.status).toBe("failed");
      const failedAgain = await client.plan({ actionId: "safety.dedupe.fail", input: { project: "x" }, idempotencyKey: "failed-key" });
      expect(failedAgain.id).not.toBe(failed.id);
      expect(failedAgain.dedupedFromRunId).toBeUndefined();

      // Denied prior run does NOT deduplicate.
      const denied = await client.run(
        { actionId: "safety.dedupe.deny", input: { project: "x" }, idempotencyKey: "denied-key", dryRun: false },
      );
      expect(denied.status).toBe("denied");
      const deniedAgain = await client.plan({ actionId: "safety.dedupe.deny", input: { project: "x" }, idempotencyKey: "denied-key" });
      expect(deniedAgain.id).not.toBe(denied.id);

      // Cancelled prior run does NOT deduplicate.
      const cancelled = await client.plan({ actionId: "safety.dedupe.cancel", input: { project: "x" }, idempotencyKey: "cancelled-key" });
      await store.updateRun({ ...cancelled, status: "cancelled" });
      const cancelledAgain = await client.plan({ actionId: "safety.dedupe.cancel", input: { project: "x" }, idempotencyKey: "cancelled-key" });
      expect(cancelledAgain.id).not.toBe(cancelled.id);
      expect(cancelledAgain.dedupedFromRunId).toBeUndefined();
    });
  });
});

describe("ActionsClient approval denial", () => {
  test("denying a required approval leaves hasRequiredApprovals false and execution blocked", async () => {
    await withClient(async (client) => {
      await client.register(createTypeScriptAction({
        manifest: manifest({ requiredApprovals: [{ kind: "manual", count: 1 }] }),
        execute: async () => ({ updated: true }),
      }));
      const run = await client.run({ actionId: "safety.action", input: { project: "x" }, idempotencyKey: "approval-1", dryRun: false });
      expect(run.status).toBe("awaiting_approval");

      const denied = await client.deny(run.id, { actor: { id: "reviewer", type: "human" }, decision: "denied", reason: "out of policy" });
      expect(denied.status).toBe("denied");
      expect(hasRequiredApprovals(denied)).toBe(false);
      expect(denied.error).toBe("out of policy");

      const executed = await client.execute(run.id);
      expect(executed.status).toBe("denied");
      expect(executed.id).toBe(run.id);

      // Two-sided: a separately approved run has its requirement satisfied and executes.
      const approvedRun = await client.run(
        { actionId: "safety.action", input: { project: "y" }, idempotencyKey: "approval-2", dryRun: false },
      );
      const approved = await client.approve(approvedRun.id, { actor: { id: "reviewer", type: "human" }, decision: "approved" });
      expect(hasRequiredApprovals(approved)).toBe(true);
      const executed2 = await client.execute(approvedRun.id);
      expect(executed2.status).toBe("succeeded");
    });
  });
});

describe("confirmation summary rendering", () => {
  test("renders plain keys, dotted paths, missing paths as empty, non-object input, and absent templates", async () => {
    const base = manifest({ requiredApprovals: [] });
    const cases: Array<[string, ActionManifest, unknown, string]> = [
      ["plain key", { ...base, confirmation: { title: "T", summaryTemplate: "Update {{project}}" } }, { project: "alpha" }, "Update alpha"],
      ["dotted path", { ...base, confirmation: { title: "T", summaryTemplate: "{{org.name}} -> {{project}}" } }, { org: { name: "hasna" }, project: "beta" }, "hasna -> beta"],
      ["missing path becomes empty string", { ...base, confirmation: { title: "T", summaryTemplate: "[{{nope}}]" } }, { project: "gamma" }, "[]"],
      ["non-object input returns the template unchanged", { ...base, confirmation: { title: "T", summaryTemplate: "Update {{project}}" } }, "raw-string", "Update {{project}}"],
      ["absent template returns the title", { ...base, confirmation: { title: "Fallback title" } }, { project: "delta" }, "Fallback title"],
    ];
    for (const [label, manifestFixture, input, expected] of cases) {
      await withClient(async (client) => {
        await client.register(createTypeScriptAction({
          manifest: manifestFixture,
          execute: async () => ({ updated: true }),
        }));
        const run = await client.plan({ actionId: "safety.action", input, idempotencyKey: `summary-${label}` });
        expect(run.confirmationSummary, label).toBe(expected);
      });
    }
  });
});
