import { describe, expect, test } from "bun:test";
import type { JsonValue } from "@hasna/actions";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutomationRecord, AutomationSpec } from "../types.js";
import { AutomationsStore } from "../lib/store.js";
import {
  AutomationTemplateRegistry,
  compileAutomationTemplate,
  installAutomationTemplate,
  previewAutomationTemplate,
  previewAutomationTemplateExecution,
  validateAutomationTemplate,
  type AutomationTemplateDefinition,
  type AutomationTemplateInstaller,
} from "./core.js";

function validTemplate(version = "1.0.0"): AutomationTemplateDefinition {
  return {
    schemaVersion: "1.0",
    slug: "contact-followup",
    version,
    name: "Contact follow-up for ${{ inputs.recipient }}",
    description: "Resolve a contact and send a deterministic follow-up.",
    authority: {
      mode: "write",
      readPermissions: ["contacts:read"],
      writePermissions: ["emails:write"],
    },
    effects: [
      {
        id: "contact-read",
        stepId: "lookup",
        sink: "contacts",
        kind: "read",
        operation: "contacts.lookup",
        compensation: {
          kind: "not-applicable",
          reason: "The lookup is read-only.",
        },
      },
      {
        id: "email-write",
        stepId: "send",
        sink: "emails",
        kind: "write",
        operation: "emails.send",
        compensation: {
          kind: "not-applicable",
          reason: "The template creates no binding that can be rolled back.",
        },
      },
    ],
    inputs: {
      recipient: { type: "string", required: true },
      settings: { type: "object", required: true },
      urgent: { type: "boolean", default: false },
    },
    outputs: {
      contactId: {
        source: "${{ steps.lookup.outputs.contactId }}",
        description: "Resolved contact id.",
      },
    },
    automation: {
      status: "active",
      triggers: [
        {
          kind: "manual",
          metadata: { requestedFor: "${{ inputs.recipient }}" },
        },
      ],
      actions: [
        {
          id: "send",
          actionId: "emails.send",
          manifestVersion: "1.2.3",
          input: {
            contactId: "${{ steps.lookup.outputs.contactId }}",
            subject: "Follow up with ${{ inputs.recipient }}",
            urgent: "${{ inputs.urgent }}",
          },
        },
        {
          id: "lookup",
          actionId: "contacts.lookup",
          input: {
            recipient: "${{ inputs.recipient }}",
            settings: "${{ inputs.settings }}",
          },
          outputs: {
            contactId: { path: "/contact/id" },
          },
        },
      ],
    },
  };
}

class MemoryInstaller implements AutomationTemplateInstaller {
  readonly records = new Map<string, AutomationRecord>();
  writes = 0;

  listAutomations(): AutomationRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  createAutomation(spec: AutomationSpec): AutomationRecord {
    this.writes += 1;
    const record: AutomationRecord = {
      id: spec.id,
      spec: structuredClone(spec),
      status: spec.status ?? "active",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  ensureAutomation(spec: AutomationSpec): AutomationRecord {
    const existing = this.records.get(spec.id);
    if (existing) {
      if (JSON.stringify(existing.spec) !== JSON.stringify(spec)) {
        throw new Error(`installed automation ${spec.id} has different content; immutable template installs cannot overwrite it`);
      }
      return structuredClone(existing);
    }
    return this.createAutomation(spec);
  }
}

interface CollisionWorkerResult {
  label: string;
  outcome: "success" | "error";
  message?: string;
  result?: ReturnType<typeof installAutomationTemplate>;
}

async function runCollisionWorker(options: {
  dbPath: string;
  label: string;
  peerReadyPath: string;
  readyPath: string;
  recipient: string;
}): Promise<CollisionWorkerResult> {
  const storeModuleUrl = new URL("../lib/store.ts", import.meta.url).href;
  const coreModuleUrl = new URL("./core.ts", import.meta.url).href;
  const script = `
    import { existsSync, writeFileSync } from "node:fs";
    const { AutomationsStore } = await import(${JSON.stringify(storeModuleUrl)});
    const { AutomationTemplateRegistry, installAutomationTemplate } = await import(${JSON.stringify(coreModuleUrl)});
    const options = ${JSON.stringify(options)};
    const template = ${JSON.stringify(validTemplate())};
    const store = new AutomationsStore({ dbPath: options.dbPath });
    const installer = {
      listAutomations() {
        const observed = store.listAutomations();
        writeFileSync(options.readyPath, "ready", { mode: 0o600 });
        const deadline = Date.now() + 5000;
        while (!existsSync(options.peerReadyPath)) {
          if (Date.now() >= deadline) throw new Error("collision barrier timed out");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        return observed;
      },
      createAutomation(spec) {
        return store.createAutomation(spec);
      },
      ensureAutomation(spec) {
        return typeof store.ensureAutomation === "function"
          ? store.ensureAutomation(spec)
          : store.createAutomation(spec);
      },
    };
    try {
      const registry = new AutomationTemplateRegistry();
      registry.register(template);
      const result = installAutomationTemplate(registry, {
        slug: template.slug,
        version: template.version,
        inputs: { recipient: options.recipient, settings: { locale: "en" } },
      }, installer);
      console.log(JSON.stringify({ label: options.label, outcome: "success", result }));
    } catch (error) {
      console.log(JSON.stringify({
        label: options.label,
        outcome: "error",
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      store.close();
    }
  `;
  const worker = Bun.spawn(["bun", "-e", script], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    worker.exited,
    new Response(worker.stdout).text(),
    new Response(worker.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`collision worker ${options.label} exited ${exitCode}: ${stderr.trim()}`);
  }
  return JSON.parse(stdout.trim()) as CollisionWorkerResult;
}

describe("automation template compiler", () => {
  test("compiles typed inputs and declared step outputs into a deterministic AutomationSpec DAG", () => {
    const template = validTemplate();
    const inputs = {
      recipient: "owner@example.test",
      settings: { locale: "en", retries: 2 },
    };

    const first = compileAutomationTemplate(template, inputs);
    const second = compileAutomationTemplate(template, structuredClone(inputs));

    expect(first).toEqual(second);
    expect(first.id).toBe("template:contact-followup:1.0.0");
    expect(first.version).toBe("1.0.0");
    expect(first.name).toBe("Contact follow-up for owner@example.test");
    expect(first.actions.map((action) => action.id)).toEqual(["lookup", "send"]);
    expect(first.actions[0]?.input).toEqual({
      recipient: "owner@example.test",
      settings: { locale: "en", retries: 2 },
    });
    expect(first.actions[1]).toMatchObject({
      id: "send",
      actionId: "emails.send",
      manifestVersion: "1.2.3",
      dependsOn: ["lookup"],
      input: {
        contactId: "${{ steps.lookup.outputs.contactId }}",
        subject: "Follow up with owner@example.test",
        urgent: false,
      },
    });
    expect(first.triggers[0]?.metadata).toEqual({ requestedFor: "owner@example.test" });
    expect(first.metadata?.template).toEqual({
      authority: {
        mode: "write",
        readPermissions: ["contacts:read"],
        writePermissions: ["emails:write"],
      },
      effects: validTemplate().effects as unknown as JsonValue,
      publicOutputs: { contactId: "${{ steps.lookup.outputs.contactId }}" },
      schemaVersion: "1.0",
      slug: "contact-followup",
      stepOutputs: { lookup: { contactId: "/contact/id" } },
      version: "1.0.0",
    } as unknown as JsonValue);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.actions)).toBe(true);
  });

  test("rejects duplicate and unknown step ids plus explicit and inferred dependency cycles", () => {
    const duplicate = validTemplate();
    duplicate.automation.actions.push(structuredClone(duplicate.automation.actions[0]!));
    expect(() => validateAutomationTemplate(duplicate)).toThrow("duplicate automation template action step id: send");

    const unknownDependency = validTemplate();
    unknownDependency.automation.actions[0]!.dependsOn = ["missing"];
    expect(() => validateAutomationTemplate(unknownDependency)).toThrow("depends on unknown step: missing");

    const cycle = validTemplate();
    cycle.automation.actions[1]!.input = {
      sendId: "${{ steps.send.outputs.messageId }}",
    };
    cycle.automation.actions[0]!.outputs = { messageId: { path: "/message/id" } };
    expect(() => validateAutomationTemplate(cycle)).toThrow("dependency cycle detected");
  });

  test("rejects invalid schema, slug, semantic version, output paths, and unresolved references", () => {
    const badSchema = validTemplate();
    badSchema.schemaVersion = "2.0" as "1.0";
    expect(() => validateAutomationTemplate(badSchema)).toThrow("unsupported automation template schemaVersion: 2.0");

    const badSlug = validTemplate();
    badSlug.slug = "Contact Followup";
    expect(() => validateAutomationTemplate(badSlug)).toThrow("invalid automation template slug");

    const badVersion = validTemplate();
    badVersion.version = "v1";
    expect(() => validateAutomationTemplate(badVersion)).toThrow("must be a valid semantic version");

    const badPrereleaseVersion = validTemplate();
    badPrereleaseVersion.version = "1.0.0-01";
    expect(() => validateAutomationTemplate(badPrereleaseVersion)).toThrow("must be a valid semantic version");

    const badOutputPath = validTemplate();
    badOutputPath.automation.actions[1]!.outputs!.contactId!.path = "contact.~2id";
    expect(() => validateAutomationTemplate(badOutputPath)).toThrow("valid relative JSON Pointer path");

    const unresolved = validTemplate();
    unresolved.automation.actions[0]!.input = { value: "${{ inputs. }}" };
    expect(() => validateAutomationTemplate(unresolved)).toThrow("unresolved automation template reference");

    const malformedAutomation = validTemplate() as unknown as {
      automation: unknown;
    };
    malformedAutomation.automation = "invalid";
    expect(() => validateAutomationTemplate(
      malformedAutomation as unknown as AutomationTemplateDefinition,
    )).toThrow("automation template automation must be an object");
  });

  test("rejects caller interpolation in static actionId", () => {
    const dynamicActionId = validTemplate();
    dynamicActionId.automation.actions[0]!.actionId = "${{ inputs.recipient }}";
    expect(() => validateAutomationTemplate(dynamicActionId)).toThrow("automation action send actionId must be a static declared string");
  });

  test("rejects caller interpolation in static manifestVersion", () => {
    const dynamicManifestVersion = validTemplate();
    dynamicManifestVersion.automation.actions[0]!.manifestVersion = "${{ inputs.recipient }}";
    expect(() => validateAutomationTemplate(dynamicManifestVersion)).toThrow("automation action send manifestVersion must be a static declared string");
  });

  test("rejects undeclared inputs, unknown output steps, and undeclared step outputs", () => {
    const undeclaredInput = validTemplate();
    undeclaredInput.automation.actions[0]!.input = { value: "${{ inputs.missing }}" };
    expect(() => validateAutomationTemplate(undeclaredInput)).toThrow("undeclared automation template input missing");

    const unknownStep = validTemplate();
    unknownStep.outputs!.contactId!.source = "${{ steps.missing.outputs.contactId }}";
    expect(() => validateAutomationTemplate(unknownStep)).toThrow("unknown automation template step missing");

    const undeclaredOutput = validTemplate();
    undeclaredOutput.automation.actions[0]!.input = { value: "${{ steps.lookup.outputs.email }}" };
    expect(() => validateAutomationTemplate(undeclaredOutput)).toThrow("undeclared output email on automation template step lookup");

    expect(() => compileAutomationTemplate(validTemplate(), {
      recipient: "owner@example.test",
      settings: {},
      unknown: true,
    })).toThrow("undeclared automation template input: unknown");
  });
});

describe("automation template registry and installation", () => {
  test("keeps slug and version immutable while allowing versions to coexist", () => {
    const registry = new AutomationTemplateRegistry();
    const original = validTemplate("1.0.0");
    const registered = registry.register(original);
    const idempotent = registry.register(structuredClone(original));

    expect(idempotent).toBe(registered);
    original.name = "mutated outside registry";
    expect(registry.resolve("contact-followup", "1.0.0").name).toBe("Contact follow-up for ${{ inputs.recipient }}");
    expect(Object.isFrozen(registered)).toBe(true);

    const conflicting = validTemplate("1.0.0");
    conflicting.description = "different content";
    expect(() => registry.register(conflicting)).toThrow("immutable and already registered with different content");

    registry.register(validTemplate("2.0.0"));
    expect(registry.versions("contact-followup")).toEqual(["1.0.0", "2.0.0"]);
    const v1 = compileAutomationTemplate(registry.resolve("contact-followup", "1.0.0"), {
      recipient: "owner@example.test",
      settings: {},
    });
    const v2 = compileAutomationTemplate(registry.resolve("contact-followup", "2.0.0"), {
      recipient: "owner@example.test",
      settings: {},
    });
    expect(v1.id).not.toBe(v2.id);
  });

  test("previews with zero persistence and returns deterministic input-safe immutable receipts", () => {
    const registry = new AutomationTemplateRegistry();
    registry.register(validTemplate());
    const installer = new MemoryInstaller();
    const callerInputs: Record<string, JsonValue> = {
      recipient: "private-marker@example.test",
      settings: { locale: "en" },
    };

    const first = previewAutomationTemplate(registry, {
      slug: "contact-followup",
      version: "1.0.0",
      inputs: callerInputs,
    });
    const snapshot = structuredClone(first.receipt);
    callerInputs.recipient = "mutated@example.test";
    (callerInputs.settings as Record<string, JsonValue>).locale = "ro";
    const second = previewAutomationTemplate(registry, {
      slug: "contact-followup",
      version: "1.0.0",
      inputs: {
        recipient: "private-marker@example.test",
        settings: { locale: "en" },
      },
    });

    expect(installer.writes).toBe(0);
    expect(first.receipt).toEqual(snapshot);
    expect(first).toEqual(second);
    expect(JSON.stringify(first.receipt)).not.toContain("private-marker@example.test");
    expect(first.receipt.inputs.names).toEqual(["recipient", "settings"]);
    expect(first.receipt.effect).toEqual({ kind: "none" });
    expect(first.receipt.plan.authority.mode).toBe("write");
    expect(first.receipt.plan.effects.map((effect) => effect.id)).toEqual(["contact-read", "email-write"]);
    expect(Object.isFrozen(first.receipt)).toBe(true);
    expect(Object.isFrozen(first.receipt.inputs.names)).toBe(true);
    expect(() => ((first.receipt.effect as { kind: string }).kind = "changed")).toThrow();
  });

  test("previews runtime effects without invoking an executor, adapter, installer, or write", () => {
    const registry = new AutomationTemplateRegistry();
    registry.register(validTemplate());

    const preview = previewAutomationTemplateExecution(registry, {
      slug: "contact-followup",
      version: "1.0.0",
      inputs: {
        recipient: "preview@example.test",
        settings: { locale: "en" },
      },
    });

    expect(preview.operation).toBe("execution-preview");
    expect(preview.effect).toEqual({
      kind: "none",
      executorCalls: 0,
      adapterCalls: 0,
      writes: 0,
    });
    expect(preview.authority).toEqual({
      mode: "write",
      readPermissions: ["contacts:read"],
      writePermissions: ["emails:write"],
    });
    expect(preview.actionPlan).toEqual([
      {
        stepId: "lookup",
        actionId: "contacts.lookup",
        manifestVersion: "1.0.0",
        effects: ["contact-read"],
      },
      {
        stepId: "send",
        actionId: "emails.send",
        manifestVersion: "1.2.3",
        effects: ["email-write"],
      },
    ]);
  });

  test("installs once, makes identical reinstall a no-op, and refuses different content before upsert", () => {
    const registry = new AutomationTemplateRegistry();
    registry.register(validTemplate());
    const installer = new MemoryInstaller();
    const request = {
      slug: "contact-followup",
      version: "1.0.0",
      inputs: {
        recipient: "owner@example.test",
        settings: { locale: "en" },
      },
    };

    const first = installAutomationTemplate(registry, request, installer);
    const second = installAutomationTemplate(registry, structuredClone(request), installer);

    expect(installer.writes).toBe(1);
    expect(first).toEqual(second);
    expect(first.receipt.effect).toEqual({
      kind: "automation.ensure",
      automationId: "template:contact-followup:1.0.0",
    });

    expect(() => installAutomationTemplate(registry, {
      ...request,
      inputs: {
        recipient: "different@example.test",
        settings: { locale: "en" },
      },
    }, installer)).toThrow("immutable template installs cannot overwrite it");
    expect(installer.writes).toBe(1);
  });

  test("installs coexisting versions through the real AutomationsStore without using its overwrite path", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hasna-automation-templates-"));
    const store = new AutomationsStore({ dbPath: join(dataDir, "automations.db") });
    try {
      const registry = new AutomationTemplateRegistry();
      registry.register(validTemplate("1.0.0"));
      registry.register(validTemplate("2.0.0"));
      const inputs = {
        recipient: "owner@example.test",
        settings: { locale: "en" },
      };

      const v1 = installAutomationTemplate(registry, {
        slug: "contact-followup",
        version: "1.0.0",
        inputs,
      }, store);
      installAutomationTemplate(registry, {
        slug: "contact-followup",
        version: "1.0.0",
        inputs,
      }, store);
      const v2 = installAutomationTemplate(registry, {
        slug: "contact-followup",
        version: "2.0.0",
        inputs,
      }, store);

      expect(store.listAutomations().map((record) => record.id).sort()).toEqual([
        "template:contact-followup:1.0.0",
        "template:contact-followup:2.0.0",
      ]);
      expect(v1.spec.id).not.toBe(v2.spec.id);
      expect(() => installAutomationTemplate(registry, {
        slug: "contact-followup",
        version: "1.0.0",
        inputs: {
          recipient: "changed@example.test",
          settings: { locale: "en" },
        },
      }, store)).toThrow("immutable template installs cannot overwrite it");
      expect(store.requireAutomation(v1.spec.id).spec).toEqual(v1.spec);
    } finally {
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("atomically rejects conflicting installs across two real store connections and preserves the winner digest", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hasna-automation-template-collision-"));
    const dbPath = join(dataDir, "automations.db");
    const readyA = join(dataDir, "worker-a.ready");
    const readyB = join(dataDir, "worker-b.ready");
    try {
      const [left, right] = await Promise.all([
        runCollisionWorker({
          dbPath,
          label: "left",
          readyPath: readyA,
          peerReadyPath: readyB,
          recipient: "left@example.test",
        }),
        runCollisionWorker({
          dbPath,
          label: "right",
          readyPath: readyB,
          peerReadyPath: readyA,
          recipient: "right@example.test",
        }),
      ]);
      const results = [left, right];
      const successes = results.filter((result) => result.outcome === "success");
      const conflicts = results.filter((result) => result.outcome === "error");

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.message).toContain("immutable template installs cannot overwrite it");

      const winner = successes[0]!;
      const loser = conflicts[0]!;
      const expectedRegistry = new AutomationTemplateRegistry();
      expectedRegistry.register(validTemplate());
      const expectedByLabel = {
        left: previewAutomationTemplate(expectedRegistry, {
          slug: "contact-followup",
          version: "1.0.0",
          inputs: { recipient: "left@example.test", settings: { locale: "en" } },
        }),
        right: previewAutomationTemplate(expectedRegistry, {
          slug: "contact-followup",
          version: "1.0.0",
          inputs: { recipient: "right@example.test", settings: { locale: "en" } },
        }),
      };
      const expectedWinner = expectedByLabel[winner.label as "left" | "right"];
      const expectedLoser = expectedByLabel[loser.label as "left" | "right"];
      const persistedStore = new AutomationsStore({ dbPath });
      try {
        const persisted = persistedStore.requireAutomation("template:contact-followup:1.0.0");
        expect(winner.result!.spec).toEqual(expectedWinner.spec);
        expect(persisted.spec).toEqual(expectedWinner.spec);
        expect(winner.result!.receipt.automation.specDigest).toBe(
          expectedWinner.receipt.automation.specDigest,
        );
        expect(expectedLoser.receipt.automation.specDigest).not.toBe(expectedWinner.receipt.automation.specDigest);
        expect(persistedStore.listAutomations()).toHaveLength(1);
      } finally {
        persistedStore.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
