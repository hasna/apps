import { describe, expect, test } from "bun:test";
import {
  projectActionBoundaryBlockers,
  projectActionCapability,
  projectActionCapabilities,
  PROJECT_ACTION_CAPABILITY_SCHEMA,
} from "./project-dashboard.js";
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
    resource: { type: "project", identifiers: ["projectId"], description: "Project dashboard snapshot" },
    scope: { level: "project", permissions: ["projects:snapshot:refresh"], boundaries: ["projectId"] },
    riskLevel: "medium",
    requiredApprovals: [{ kind: "manual", count: 1, reason: "refresh can invoke provider CLIs" }],
    idempotency: { supported: true, required: true, keyHint: "projectId + provider set" },
    dryRun: { supported: true, default: true },
    confirmation: { title: "Refresh project dashboard", fields: ["projectId"] },
    guardrail: { hook: "projects-dashboard-policy", failClosed: true },
    audit: {
      eventTypes: ["action.planned", "action.previewed", "action.executed"],
      redactedFields: ["input.privateNotes"],
    },
    evidence: { required: true, fields: ["snapshotId", "providers"] },
    rollback: { strategy: "none" },
    executorBindings: [{ kind: "local-shell", command: "projects", args: ["snapshot"] }],
    metadata: { owner: "open-projects" },
    ...overrides,
  };
}

describe("project dashboard action capabilities", () => {
  test("projects a manifest into a view-safe capability without executor bindings", () => {
    const capability = projectActionCapability(manifest(), { projectId: "swiss-bank-account" });

    expect(capability.schema).toBe(PROJECT_ACTION_CAPABILITY_SCHEMA);
    expect(capability.id).toBe("projects.dashboard.refresh");
    expect(capability.presentation.defaultMode).toBe("dry-run");
    expect(capability.presentation.executionPolicy).toBe("server-issued-run");
    expect(capability.presentation.approvalRequired).toBe(true);
    expect(capability.audit.evidenceFields).toEqual(["snapshotId", "providers"]);
    expect(capability.metadata.projectId).toBe("swiss-bank-account");
    expect(JSON.stringify(capability)).not.toContain("local-shell");
    expect(JSON.stringify(capability)).not.toContain("\"command\"");
  });

  test("marks unsafe manifests unavailable until dry-run and approval boundaries exist", () => {
    const blockers = projectActionBoundaryBlockers(manifest({
      riskLevel: "high",
      requiredApprovals: [],
      dryRun: { supported: false, default: false },
      audit: { eventTypes: ["action.planned"] },
    }));

    expect(blockers).toContain("dry-run preview is required before dashboard execution");
    expect(blockers).toContain("dashboard actions must default to dry-run/read-only");
    expect(blockers).toContain("preview audit event is required");
    expect(blockers).toContain("medium/high/critical actions require explicit approval policy");

    const [capability] = projectActionCapabilities([manifest({
      riskLevel: "high",
      requiredApprovals: [],
      dryRun: { supported: false, default: false },
      audit: { eventTypes: ["action.planned"] },
    })]);
    expect(capability.presentation.executionPolicy).toBe("unavailable");
    expect(capability.safety.blockers.length).toBeGreaterThan(0);
  });
});

// agent-authored test-gap additions (SOL consult unavailable: codewith exec with
// gpt-5.6-sol max reasoning timed out at the 570s window on two distinct accounts
// before producing a final answer; this spec was written from direct source analysis).
describe("project dashboard boundary blockers", () => {
  test("critical actions without a fail-closed guardrail are blocked", () => {
    expect(projectActionBoundaryBlockers(manifest({
      riskLevel: "critical",
      guardrail: undefined,
    }))).toContain("critical actions require a fail-closed guardrail");

    expect(projectActionBoundaryBlockers(manifest({
      riskLevel: "critical",
      guardrail: { hook: "critical-policy", failClosed: true },
    }))).not.toContain("critical actions require a fail-closed guardrail");
  });

  test("empty confirmation titles are blocked", () => {
    expect(projectActionBoundaryBlockers(manifest({ confirmation: { title: "  " } })))
      .toContain("confirmation title is required");
  });

  test("low-risk actions with no approval policy stay available", () => {
    const blockers = projectActionBoundaryBlockers(manifest({
      riskLevel: "low",
      requiredApprovals: [],
    }));
    expect(blockers).not.toContain("medium/high/critical actions require explicit approval policy");
    expect(projectActionCapability(manifest({ riskLevel: "low", requiredApprovals: [] })).presentation.executionPolicy)
      .toBe("server-issued-run");
  });

  test("action refs use the configured base path and URL-encode identifiers", () => {
    const capability = projectActionCapability(manifest({ id: "project one/refresh" }), {
      actionBasePath: "/custom/api/v2",
    });
    expect(capability.links.actionRef).toBe(
      "/custom/api/v2/project%20one%2Frefresh/runs?version=1.0.0",
    );
  });

  test("manifestRef override is honored", () => {
    const capability = projectActionCapability(manifest(), { manifestRef: "custom://authority/manifest" });
    expect(capability.links.manifestRef).toBe("custom://authority/manifest");
  });

  test("read-only is the default presentation mode when dry-run is not the default", () => {
    expect(projectActionCapability(manifest({ dryRun: { supported: true, default: false } })).presentation.defaultMode)
      .toBe("read-only");
  });

  test("preflight explains that execution is unavailable without dry-run support", () => {
    const capability = projectActionCapability(manifest({ dryRun: { supported: false, default: false } }));
    expect(capability.preflight.supported).toBe(false);
    expect(capability.preflight.summary).toContain("execution is unavailable until a dry-run is added");
  });

  test("high and critical risk manifests gain explicit confirmation warnings", () => {
    const high = projectActionCapability(manifest({ riskLevel: "high" }));
    expect(high.preflight.warnings[0]).toBe("high risk action requires explicit confirmation before execution.");

    const critical = projectActionCapability(manifest({ riskLevel: "critical", guardrail: { hook: "g", failClosed: true } }));
    expect(critical.preflight.warnings[0]).toBe("critical risk action requires explicit confirmation before execution.");
  });

  test("actions that do not advertise idempotency are warned", () => {
    const capability = projectActionCapability(manifest({ idempotency: { supported: false } }));
    expect(capability.preflight.warnings).toContain("Action does not advertise idempotency support.");
  });
});
