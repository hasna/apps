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
      dependsOn: ["lookup"],
      input: {
        contactId: "${{ steps.lookup.outputs.contactId }}",
        subject: "Follow up with owner@example.test",
        urgent: false,
      },
    });
    expect(first.metadata?.template).toEqual({
      publicOutputs: { contactId: "${{ steps.lookup.outputs.contactId }}" },
      schemaVersion: "1.0",
      slug: "contact-followup",
      stepOutputs: { lookup: { contactId: "/contact/id" } },
      version: "1.0.0",
    });
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
    expect(Object.isFrozen(first.receipt)).toBe(true);
    expect(Object.isFrozen(first.receipt.inputs.names)).toBe(true);
    expect(() => ((first.receipt.effect as { kind: string }).kind = "changed")).toThrow();
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
});
