import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { getActionsDataDir, getActiveActionsDirEnv, HASNA_ACTIONS_DIR_ENV, HASNA_ACTIONS_HOME_ENV } from "./storage.js";
import { projectActionBoundaryBlockers, projectActionCapability } from "./project-dashboard.js";
import type { ActionManifest } from "./types.js";

function manifest(overrides: Partial<ActionManifest> = {}): ActionManifest {
  return {
    id: "projects.dashboard.refresh",
    name: "Refresh project dashboard",
    version: "1.0.0",
    description: "Refresh provider snapshots for one project.",
    inputSchema: { type: "object", required: ["projectId"] },
    outputSchema: { type: "object", required: ["snapshotId"] },
    actor: { types: ["human", "agent"], required: true },
    resource: { type: "project", identifiers: ["projectId"] },
    scope: { level: "project", permissions: ["projects:snapshot:refresh"] },
    riskLevel: "medium",
    requiredApprovals: [{ kind: "manual", count: 1 }],
    idempotency: { supported: true, required: true },
    dryRun: { supported: true, default: true },
    confirmation: { title: "Refresh project dashboard" },
    guardrail: { hook: "projects-dashboard-policy", failClosed: true },
    audit: { eventTypes: ["action.planned", "action.previewed", "action.executed"] },
    evidence: { required: true, fields: ["snapshotId"] },
    rollback: { strategy: "none" },
    executorBindings: [{ kind: "local-shell", command: "projects", args: ["snapshot"] }],
    ...overrides,
  };
}

describe("project dashboard boundary blockers", () => {
  test("a critical action without a fail-closed guardrail is blocked with the exact reason", () => {
    const blockers = projectActionBoundaryBlockers(manifest({
      riskLevel: "critical",
      guardrail: { hook: "policy", failClosed: false },
    }));
    expect(blockers).toContain("critical actions require a fail-closed guardrail");

    // Two-sided: critical with a fail-closed guardrail has no such blocker.
    const safe = projectActionBoundaryBlockers(manifest({
      riskLevel: "critical",
      guardrail: { hook: "policy", failClosed: true },
    }));
    expect(safe).not.toContain("critical actions require a fail-closed guardrail");
  });

  test("an empty confirmation title is blocked with the exact reason", () => {
    const blockers = projectActionBoundaryBlockers(manifest({ confirmation: { title: "   " } }));
    expect(blockers).toContain("confirmation title is required");

    // Two-sided: a present title contributes no such blocker.
    const ok = projectActionBoundaryBlockers(manifest({ confirmation: { title: "Refresh" } }));
    expect(ok).not.toContain("confirmation title is required");
  });
});

describe("project dashboard confirmation warnings", () => {
  test("high/critical risk warnings are prepended to confirmation warnings", () => {
    const high = projectActionCapability(manifest({
      riskLevel: "high",
      confirmation: { title: "T", warnings: ["custom warning"] },
    }));
    expect(high.preflight.warnings).toEqual([
      "high risk action requires explicit confirmation before execution.",
      "custom warning",
    ]);

    // Two-sided: a low-risk action keeps only its own warnings.
    const low = projectActionCapability(manifest({
      riskLevel: "low",
      confirmation: { title: "T", warnings: ["custom warning"] },
    }));
    expect(low.preflight.warnings).toEqual(["custom warning"]);
  });

  test("actions that do not advertise idempotency support gain a warning", () => {
    const capability = projectActionCapability(manifest({ idempotency: { supported: false } }));
    expect(capability.preflight.warnings).toContain("Action does not advertise idempotency support.");

    // Two-sided: a supported action has no such warning.
    const supported = projectActionCapability(manifest({ idempotency: { supported: true } }));
    expect(supported.preflight.warnings).not.toContain("Action does not advertise idempotency support.");
  });
});

describe("project dashboard link overrides", () => {
  test("actionBasePath and manifestRef overrides appear in emitted links", () => {
    const overridden = projectActionCapability(manifest(), {
      actionBasePath: "/custom/actions",
      manifestRef: "manifest://custom/1",
    });
    expect(overridden.links.manifestRef).toBe("manifest://custom/1");
    expect(overridden.links.actionRef).toBe(
      "/custom/actions/projects.dashboard.refresh/runs?version=1.0.0",
    );

    // Two-sided: defaults produce the canonical forms.
    const defaults = projectActionCapability(manifest());
    expect(defaults.links.manifestRef).toBe("action-manifest://projects.dashboard.refresh@1.0.0");
    expect(defaults.links.actionRef).toBe(
      "/api/actions/projects.dashboard.refresh/runs?version=1.0.0",
    );
  });
});

describe("actions data directory precedence", () => {
  const saved: Array<[string, string | undefined]> = [
    [HASNA_ACTIONS_DIR_ENV, process.env[HASNA_ACTIONS_DIR_ENV]],
    [HASNA_ACTIONS_HOME_ENV, process.env[HASNA_ACTIONS_HOME_ENV]],
  ];

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("an explicit override wins over every environment variable", () => {
    process.env[HASNA_ACTIONS_DIR_ENV] = "/env/dir";
    expect(getActionsDataDir("/explicit/dir")).toBe("/explicit/dir");
  });

  test("HASNA_ACTIONS_DIR wins over HASNA_ACTIONS_HOME, which wins over the default", () => {
    process.env[HASNA_ACTIONS_DIR_ENV] = "/env/dir";
    process.env[HASNA_ACTIONS_HOME_ENV] = "/env/home";
    expect(getActionsDataDir()).toBe("/env/dir");

    delete process.env[HASNA_ACTIONS_DIR_ENV];
    expect(getActionsDataDir()).toBe("/env/home");

    delete process.env[HASNA_ACTIONS_HOME_ENV];
    expect(getActionsDataDir()).toBe(join(homedir(), ".hasna", "actions"));
  });

  test("getActiveActionsDirEnv names the selected source and null when none is set", () => {
    process.env[HASNA_ACTIONS_DIR_ENV] = "/env/dir";
    process.env[HASNA_ACTIONS_HOME_ENV] = "/env/home";
    expect(getActiveActionsDirEnv()).toBe(HASNA_ACTIONS_DIR_ENV);

    delete process.env[HASNA_ACTIONS_DIR_ENV];
    expect(getActiveActionsDirEnv()).toBe(HASNA_ACTIONS_HOME_ENV);

    delete process.env[HASNA_ACTIONS_HOME_ENV];
    expect(getActiveActionsDirEnv()).toBeNull();
  });
});
