import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ProjectPanelSchema } from "@hasna/contracts/schemas";
import { createProgram, runActionsCli } from "./index.js";
import { JsonActionsStore } from "../storage.js";
import type { ActionManifest, ActionRun } from "../types.js";

const longText = "x".repeat(220);

function manifest(id = "examples.local-shell.uppercase"): ActionManifest {
  return {
    id,
    name: "Uppercase local input",
    version: "1.0.0",
    description: `Demonstrates a local-shell action with a long description ${longText}`,
    inputSchema: { type: "object", required: ["name"] },
    outputSchema: { type: "object", required: ["message"] },
    actor: { types: ["human", "agent"], required: true },
    resource: { type: "local-process", identifiers: ["name"] },
    scope: { level: "local", permissions: ["shell:execute"] },
    riskLevel: "low",
    requiredApprovals: [],
    idempotency: { supported: true, required: false },
    dryRun: { supported: true, default: true },
    confirmation: { title: "Uppercase local input", summaryTemplate: "Uppercase {{name}}" },
    audit: { eventTypes: ["action.planned", "action.previewed"], includeInput: true },
    evidence: { required: false, fields: ["stdout", "stderr"] },
    rollback: { strategy: "none" },
    executorBindings: [{ kind: "local-shell", command: "bun" }],
  };
}

function runRecord(index: number): ActionRun {
  const id = `run-${String(index).padStart(2, "0")}`;
  const createdAt = `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`;
  return {
    id,
    actionId: "examples.local-shell.uppercase",
    actionVersion: "1.0.0",
    status: "previewed",
    actor: { id: "cli", type: "human" },
    input: { name: `open-actions-${index}`, payload: longText },
    output: { message: longText },
    plan: [{ id: "execute", kind: "execute", title: `Execute with ${longText}`, status: "planned" }],
    riskLevel: "low",
    requiredApprovals: [],
    approvals: [],
    guardrailResults: [{ decision: "allow" }],
    evidence: [],
    dryRun: true,
    confirmationSummary: `Uppercase open-actions-${index} ${longText}`,
    rollback: { strategy: "none" },
    events: [{
      id: `event-${index}`,
      runId: id,
      actionId: "examples.local-shell.uppercase",
      type: "action.previewed",
      time: createdAt,
      actor: { id: "cli", type: "human" },
      severity: "info",
      message: `Previewed ${longText}`,
      data: { summary: longText },
      metadata: {},
    }],
    metadata: {},
    createdAt,
    updatedAt: createdAt,
    preview: { summary: `Would run ${longText}`, warnings: [] },
  };
}

async function seedStore(dir: string, count: number): Promise<void> {
  const store = new JsonActionsStore(dir);
  await store.saveManifest(manifest());
  for (let index = 0; index < count; index += 1) {
    await store.createRun(runRecord(index));
  }
}

async function captureCli(dir: string, args: string[]): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  };
  try {
    await runActionsCli(["--dir", dir, ...args], { programName: "actions-test" });
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

describe("actions CLI compact output", () => {
  test("registers the complete audited command inventory", () => {
    const commandPaths: string[] = [];
    const collect = (command: ReturnType<typeof createProgram>, parent: string[] = []): void => {
      for (const child of command.commands) {
        const path = [...parent, child.name()];
        commandPaths.push(path.join(" "));
        collect(child, path);
      }
    };

    collect(createProgram());

    expect(commandPaths).toEqual([
      "status",
      "project-panel",
      "manifests",
      "manifests validate",
      "manifests list",
      "manifests show",
      "manifests inspect",
      "run",
      "runs",
      "runs list",
      "runs show",
      "runs inspect",
      "approve",
      "deny",
      "execute",
    ]);
  });

  test("emits a bounded project dashboard panel contract", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-cli-panel-"));
    try {
      const store = new JsonActionsStore(dir);
      const projectManifest = {
        ...manifest("examples.project.refresh"),
        name: "Refresh project artifact",
        metadata: { projectId: "swiss-bank-account" },
        scope: { level: "project" as const, permissions: ["dashboard:write"], boundaries: ["swiss-bank-account"] },
        resource: { type: "dashboard", identifiers: ["swiss-bank-account"] },
      };
      await store.saveManifest(projectManifest);
      await store.saveManifest({ ...manifest("examples.other"), metadata: { projectId: "other-project" } });
      await store.createRun({
        ...runRecord(0),
        actionId: projectManifest.id,
        actionVersion: projectManifest.version,
        input: { name: "swiss-bank-account", payload: longText },
        output: { message: longText },
        metadata: { projectId: "swiss-bank-account" },
      });

      const json = await captureCli(dir, ["project-panel", "--project", "swiss-bank-account", "--contract"]);
      const panel = ProjectPanelSchema.parse(JSON.parse(json));

      expect(panel.schema).toBe("hasna.project_panel.v1");
      expect(panel.provider.kind).toBe("actions");
      expect(panel.projectId).toBe("swiss-bank-account");
      expect(panel.items.map((item) => item.id)).toEqual(expect.arrayContaining(["action:examples.project.refresh", "run:run-00"]));
      expect(panel.items.map((item) => item.id)).not.toContain("action:examples.other");
      expect(JSON.stringify(panel)).not.toContain(longText);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("caps runs list human output while keeping --json full fidelity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-cli-"));
    try {
      await seedStore(dir, 25);

      const human = await captureCli(dir, ["runs", "list"]);
      expect(human).toContain("showing 20 of 25 runs");
      expect(human).toContain("next: actions runs list --cursor 20 --limit 20");
      expect(human).toContain("hint: use actions runs show <id>");
      expect(human).not.toContain(longText);

      const json = await captureCli(dir, ["runs", "list", "--json"]);
      const parsed = JSON.parse(json) as ActionRun[];
      expect(parsed).toHaveLength(25);
      expect(JSON.stringify(parsed)).toContain(longText);

      const jsonPage = await captureCli(dir, ["runs", "list", "--json", "--limit", "2", "--cursor", "1"]);
      const parsedPage = JSON.parse(jsonPage) as ActionRun[];
      expect(parsedPage).toHaveLength(2);
      expect(parsedPage[0].id).toBe("run-23");

      await new JsonActionsStore(dir).saveManifest(manifest("examples.other"));
      const manifestPage = await captureCli(dir, ["manifests", "list", "--json", "--limit", "1"]);
      expect(JSON.parse(manifestPage)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("shows compact run details by default and expands with --verbose", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-cli-"));
    try {
      await seedStore(dir, 1);

      const compact = await captureCli(dir, ["runs", "show", "run-00"]);
      expect(compact).toContain("hint: use --verbose for input/output/events");
      expect(compact).not.toContain(longText);

      const verbose = await captureCli(dir, ["runs", "show", "run-00", "--verbose"]);
      expect(verbose).toContain("input:");
      expect(verbose).toContain("events:");
      expect(verbose).not.toContain(longText);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("supports role-gated run, approval, denial, and execution commands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-cli-lifecycle-"));
    const manifestPath = join(dir, "manifest.json");
    const roleManifest = {
      ...manifest("examples.local-shell.roles"),
      requiredApprovals: [{ kind: "manual" as const, count: 1, roles: ["maintainer"] }],
      dryRun: { supported: true, default: false },
      executorBindings: [{
        kind: "local-shell" as const,
        command: "bun",
        args: ["-e", "console.log(JSON.stringify({ message: 'ok' }))"],
      }],
    };
    writeFileSync(manifestPath, JSON.stringify(roleManifest));

    try {
      expect(JSON.parse(await captureCli(dir, ["status", "--json"]))).toMatchObject({ counts: { manifests: 0, runs: 0 } });
      expect(JSON.parse(await captureCli(dir, ["manifests", "validate", manifestPath, "--json"]))).toMatchObject({ ok: true });

      const autoApproved = JSON.parse(await captureCli(dir, [
        "run",
        manifestPath,
        "--input",
        '{"name":"automatic"}',
        "--approve",
        "--actor",
        "alice",
        "--actor-role",
        "maintainer",
        "--json",
      ])) as ActionRun;
      expect(autoApproved.status).toBe("succeeded");
      expect(autoApproved.approvals[0]?.actor).toMatchObject({ id: "alice", roles: ["maintainer"] });

      const awaitingApproval = JSON.parse(await captureCli(dir, [
        "run",
        manifestPath,
        "--input",
        '{"name":"manual"}',
        "--json",
      ])) as ActionRun;
      expect(awaitingApproval.status).toBe("awaiting_approval");

      const approved = JSON.parse(await captureCli(dir, [
        "approve",
        awaitingApproval.id,
        "--actor",
        "bob",
        "--actor-role",
        "maintainer",
        "--json",
      ])) as ActionRun;
      expect(approved.status).toBe("approved");
      expect(approved.approvals[0]?.actor).toMatchObject({ id: "bob", roles: ["maintainer"] });

      const executed = JSON.parse(await captureCli(dir, ["execute", approved.id, manifestPath, "--json"])) as ActionRun;
      expect(executed.status).toBe("succeeded");

      const denialCandidate = JSON.parse(await captureCli(dir, [
        "run",
        manifestPath,
        "--input",
        '{"name":"denied"}',
        "--json",
      ])) as ActionRun;
      const denied = JSON.parse(await captureCli(dir, [
        "deny",
        denialCandidate.id,
        "--actor-role",
        "security",
        "--reason",
        "audit regression",
        "--json",
      ])) as ActionRun;
      expect(denied).toMatchObject({ status: "denied", error: "audit regression" });
      expect(denied.approvals.at(-1)?.actor.roles).toEqual(["security"]);

      expect(JSON.parse(await captureCli(dir, ["manifests", "list", "--json"]))).toHaveLength(1);
      expect(JSON.parse(await captureCli(dir, ["manifests", "show", roleManifest.id, "--json"]))).toMatchObject({ id: roleManifest.id });
      expect(JSON.parse(await captureCli(dir, ["manifests", "inspect", roleManifest.id, "--json"]))).toMatchObject({ id: roleManifest.id });
      expect(JSON.parse(await captureCli(dir, ["runs", "list", "--json"]))).toHaveLength(3);
      expect(JSON.parse(await captureCli(dir, ["runs", "show", executed.id, "--json"]))).toMatchObject({ id: executed.id });
      expect(JSON.parse(await captureCli(dir, ["runs", "inspect", executed.id, "--json"]))).toMatchObject({ id: executed.id });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
