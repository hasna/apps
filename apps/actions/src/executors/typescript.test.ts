import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ActionsClient, defineAction } from "../index.js";
import { JsonActionsStore } from "../storage.js";
import { createTypeScriptAction } from "./typescript.js";
import type { ActionManifest } from "../types.js";

function manifest(id = "ts.passthrough"): ActionManifest {
  return {
    id,
    name: "TypeScript action",
    version: "1.0.0",
    description: "Exercises the TypeScript executor.",
    inputSchema: { type: "object", required: ["project"] },
    outputSchema: { type: "object", required: ["updated"] },
    actor: { types: ["human", "agent"] },
    resource: { type: "project", identifiers: ["project"] },
    scope: { level: "workspace", permissions: ["project:update"] },
    riskLevel: "medium",
    requiredApprovals: [],
    idempotency: { supported: true, required: false },
    dryRun: { supported: true, default: false },
    confirmation: { title: "Update project", summaryTemplate: "Update {{project}}" },
    audit: { eventTypes: ["action.planned", "action.previewed", "action.executed"] },
    evidence: { required: false },
    rollback: { strategy: "none" },
    executorBindings: [{ kind: "typescript", ref: "ts#passthrough" }],
  };
}

describe("defineAction normalization", () => {
  test("the flat executor-function form normalizes into an executor object", () => {
    const plan = async (): Promise<never[]> => [];
    const preview = async () => ({ summary: "flat preview", warnings: [] as string[] });
    const execute = async () => ({ updated: true });
    const rollback = async () => ({ summary: "flat rollback", warnings: [] as string[] });

    const flat = defineAction({
      manifest: manifest(),
      input: z.object({ project: z.string() }),
      output: z.object({ updated: z.boolean() }),
      plan,
      preview,
      execute,
      rollback,
    });
    expect(flat.executor.plan).toBe(plan);
    expect(flat.executor.preview).toBe(preview);
    expect(flat.executor.execute).toBe(execute);
    expect(flat.executor.rollback).toBe(rollback);

    // Two-sided: the nested executor form passes through unchanged.
    const nested = defineAction({
      manifest: manifest("ts.nested"),
      executor: { execute, rollback },
    });
    expect(nested.executor).toEqual({ execute, rollback });
  });
});

describe("createTypeScriptAction", () => {
  test("plan, preview, execute, and rollback pass through and drive an end-to-end run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-ts-"));
    try {
      const calls: string[] = [];
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const input = z.object({ project: z.string() });
      const output = z.object({ updated: z.boolean(), project: z.string(), runId: z.string() });
      const definition = createTypeScriptAction({
        manifest: manifest(),
        input,
        output,
        plan: async ({ manifest: m }) => [{ id: "execute", kind: "execute", title: `Run ${m.id}`, status: "planned" }],
        preview: async ({ input: i }) => ({ summary: `Would update ${(i as { project: string }).project}`, warnings: [] }),
        execute: async ({ input: i, run }) => {
          calls.push("execute");
          return { updated: true, project: (i as { project: string }).project, runId: run.id };
        },
        rollback: async () => ({ summary: "rollback preview", warnings: [] }),
      });
      expect(definition.manifest.id).toBe("ts.passthrough");
      expect(definition.input).toBe(input);
      expect(definition.output).toBe(output);

      await client.register(definition);
      const run = await client.run({ actionId: "ts.passthrough", input: { project: "alpha" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect(run.plan[0]?.title).toBe("Run ts.passthrough");
      expect(run.preview?.summary).toBe("Would update alpha");
      expect(run.output).toEqual({ updated: true, project: "alpha", runId: run.id });
      expect(calls).toEqual(["execute"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a TypeScript executor needs no local-shell binding: the in-process executor is the binding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-ts-binding-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest("ts.no.shell.binding"),
        execute: async () => ({ updated: true }),
      }));
      const run = await client.run({ actionId: "ts.no.shell.binding", input: { project: "alpha" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect(run.output).toEqual({ updated: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a throwing TypeScript executor with rollbackOnFailure lands on rolled_back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-ts-rollback-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      await client.register(createTypeScriptAction({
        manifest: manifest("ts.rollback"),
        execute: async () => {
          throw new Error("ts boom");
        },
        rollback: async () => ({
          summary: "compensated",
          changes: [{ kind: "restore", target: "project" }],
        }),
      }));
      const run = await client.run(
        { actionId: "ts.rollback", input: { project: "alpha" }, dryRun: false },
        { rollbackOnFailure: true },
      );
      expect(run.status).toBe("rolled_back");
      expect(run.preview?.summary).toBe("compensated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("registering a typescript action is type-consistent with ActionDefinition", () => {
    const definition = createTypeScriptAction({
      manifest: manifest("ts.typed"),
      execute: async () => ({ ok: true }),
    });
    expect(definition.executor.execute).toBeTypeOf("function");
  });
});
