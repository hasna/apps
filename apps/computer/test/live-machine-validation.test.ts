import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeLiveMachineValidationRoute,
  evidenceCheckFromReport,
  parseArgs,
  parseBrowserServer,
  redactText,
  summarizeReadiness,
} from "../scripts/validate-live-machine.js";
import { createWorkflowRun, listPolicyDecisions } from "../src/agent/runtime.js";
import { closeDb, listAuditEvents } from "../src/db/index.js";

const screenshotArtifact = {
  kind: "screenshot_hash",
  sha256: "a".repeat(64),
  bytes: 12_345,
  width: 1280,
  height: 720,
};
const beforeScreenshotArtifact = {
  ...screenshotArtifact,
  kind: "screenshot_before",
  sha256: "a".repeat(64),
};
const afterScreenshotArtifact = {
  ...screenshotArtifact,
  kind: "screenshot_after",
  sha256: "b".repeat(64),
};
const visualChecks = {
  before_sha256: beforeScreenshotArtifact.sha256,
  after_sha256: afterScreenshotArtifact.sha256,
  before_nonblank: true,
  after_nonblank: true,
  different_hashes: true,
  changed: true,
  pixel_difference_ratio: 0.12,
};
const samplerLeases = [
  { resource_type: "computer_display", lease_id: "lease-display", acquired: true, released: true },
  { resource_type: "browser_extension_session", lease_id: "lease-browser", acquired: true, released: true },
];
let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR", "OCCTRL_APPROVE_REMOTE_VALIDATION", "OCCTRL_LAB_ONLY_REMOTE_VALIDATION"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-live-validation-"));
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = join(tempDir, "computer.db");
}

afterEach(() => {
  closeDb();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("live machine validation helpers", () => {
  test("redacts user paths, credential-bearing URLs, and key-value secrets", () => {
    const redacted = redactText(
      'ssh alice@machine001 vnc://bob@machine001 https://alice:secret@example.test /Users/alice/Workspace /home/hasna/workspace token=abc123 password=hunter2 Authorization: Bearer abc Cookie: sid=1\n"user": "alice", "passwordSecretKey": "machines/path", "access_token": "abc", "apiKey": "secret", "machine_id": "spark01", "hostname": "host.local"',
    );

    expect(redacted).toContain("ssh <user>@machine-<redacted>");
    expect(redacted).toContain("vnc://<user>@machine-<redacted>");
    expect(redacted).toContain("https://<user>:<redacted>@example.test");
    expect(redacted).toContain("/Users/<user>/Workspace");
    expect(redacted).toContain("/home/<user>/workspace");
    expect(redacted).not.toContain("/home/hasna");
    expect(redacted).toContain("token=<redacted>");
    expect(redacted).toContain("password=<redacted>");
    expect(redacted).toContain("Authorization: Bearer <redacted>");
    expect(redacted).toContain("Cookie: <redacted>");
    expect(redacted).toContain('"user": "<redacted>"');
    expect(redacted).toContain('"passwordSecretKey": "<redacted>"');
    expect(redacted).toContain('"access_token": "<redacted>"');
    expect(redacted).toContain('"apiKey": "<redacted>"');
    expect(redacted).toContain('"machine_id": "<redacted>"');
    expect(redacted).toContain('"hostname": "<redacted>"');
    expect(redacted).not.toContain("spark01");
    expect(redactText('"target_machine_id": "machine001", "targetMachineAlias": "machine-alias"')).toContain('"target_machine_id": "<redacted>"');
    expect(redactText("bun run src/cli/index.ts route --machine apple03 --json")).toContain("--machine <redacted>");
    expect(redactText("bun run src/cli/index.ts screen apple03 --print --json")).toContain("screen <redacted>");
    expect(redactText('"host": "apple03", "lanAddress": "192.168.50.230", "url": "vnc://bob@apple03"')).toContain('"host": "<redacted>"');
    expect(redactText('"host": "apple03", "lanAddress": "192.168.50.230", "url": "vnc://bob@apple03"')).toContain('"lanAddress": "<redacted>"');
    expect(redactText('"host": "apple03", "lanAddress": "192.168.50.230", "url": "vnc://bob@apple03"')).toContain('"url": "<redacted>"');
    expect(redactText("endpoint=http://10.0.0.5:5900 vnc://bob@spark01:5900 ssh bob@spark01 192.168.50.230")).toContain("endpoint=<redacted>");
    expect(redactText("endpoint=http://10.0.0.5:5900 vnc://bob@spark01:5900 ssh bob@spark01 192.168.50.230")).toContain("vnc://<user>@machine-<redacted>");
    expect(redactText("endpoint=http://10.0.0.5:5900 vnc://bob@spark01:5900 ssh bob@spark01 192.168.50.230")).toContain("ssh <user>@machine-<redacted>");
    expect(redactText("endpoint=http://10.0.0.5:5900 vnc://bob@spark01:5900 ssh bob@spark01 192.168.50.230")).not.toContain("192.168.50.230");
  });

  test("reports not ready when screenshot and visible-browser checks fail", () => {
    const readiness = summarizeReadiness([
      { id: "machines-topology", status: "passed", summary: "ok" },
      { id: "machine-selection", status: "passed", summary: "ok" },
      { id: "fleet-machine-lease", status: "passed", summary: "ok" },
      { id: "fleet-validation-route", status: "passed", summary: "ok" },
      { id: "machine-route", status: "passed", summary: "ok" },
      { id: "machine-screen-credentials", status: "failed", summary: "missing" },
      { id: "remote-capabilities", status: "passed", summary: "ok" },
      { id: "remote-screenshot", status: "failed", summary: "no display" },
      { id: "remote-visible-browser-query", status: "timed_out", summary: "hung" },
      { id: "fleet-machine-lease-release", status: "passed", summary: "ok" },
      { id: "browser-extension-status", status: "skipped", summary: "not connected" },
      { id: "safe-action-sampler-plan", status: "skipped", summary: "gated" },
    ]);

    expect(readiness.ready).toBe(false);
    expect(readiness.lab_ready).toBe(false);
    expect(readiness.live_smoke_ready).toBe(false);
    expect(readiness.p8_complete).toBe(false);
    expect(readiness.blockers).toContain("remote-screenshot did not pass (failed)");
    expect(readiness.blockers).toContain("remote-visible-browser-query did not pass (timed_out)");
    expect(readiness.blockers).toContain("browser extension bridge did not pass a live status check");
  });

  test("allows only loopback browser server URLs for live validation", () => {
    expect(parseBrowserServer("http://127.0.0.1:8802").ok).toBe(true);
    expect(parseBrowserServer("http://localhost:8802/").ok).toBe(true);
    expect(parseBrowserServer("https://example.com").ok).toBe(false);
    expect(parseBrowserServer("ftp://127.0.0.1:8802").ok).toBe(false);
  });

  test("does not treat approval alone as lab-only remote validation authority", () => {
    useTempDb();
    process.env.OCCTRL_APPROVE_REMOTE_VALIDATION = "1";
    delete process.env.OCCTRL_LAB_ONLY_REMOTE_VALIDATION;

    const fromEnv = parseArgs([]);
    expect(fromEnv.remoteValidationApproved).toBe(true);
    expect(fromEnv.labOnlyRemoteValidation).toBe(false);

    const explicitLab = parseArgs(["--approve-remote-validation", "--lab-only-remote-validation"]);
    expect(explicitLab.remoteValidationApproved).toBe(true);
    expect(explicitLab.labOnlyRemoteValidation).toBe(true);
  });

  test("routes live validation through fleet policy, policy rows, and redacted audit", async () => {
    useTempDb();
    const machineId = "machine-sensitive-live-001";
    const run = createWorkflowRun({ status: "running" });

    const blocked = await authorizeLiveMachineValidationRoute(machineId, {
      timeoutMs: 15_000,
      remoteValidationApproved: true,
      labOnlyRemoteValidation: false,
    }, run);
    expect(blocked.allowed).toBe(false);
    expect(blocked.check.status).toBe("failed");
    expect(blocked.check.summary).toContain("requires approval");

    const allowedRun = createWorkflowRun({ status: "running" });
    const allowed = await authorizeLiveMachineValidationRoute(machineId, {
      timeoutMs: 15_000,
      remoteValidationApproved: true,
      labOnlyRemoteValidation: true,
    }, allowedRun);
    expect(allowed.allowed).toBe(true);
    expect(allowed.check.status).toBe("passed");
    expect(allowed.check.data).toEqual(expect.objectContaining({
      route_status: "allowed",
      audit_event_present: true,
      validation_mode: "lab_only",
      source_checkout: true,
    }));

    const policies = listPolicyDecisions(allowedRun.id);
    expect(policies.some((policy) => policy.capability === "fleet.run_smoke" && policy.decision === "allowed")).toBe(true);
    const audits = listAuditEvents({ transport: "live-machine-validation", capability: "fleet.run_smoke", limit: 10 });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(machineId);
    expect(serialized).not.toContain("live-validation:");
    expect(serialized).toContain("capability_token_present");
    expect(serialized).toContain("explicit_opt_in");
    expect(serialized).toContain("machine_binding");
  });

  test("treats sampler and release evidence as P8 completion requirements, not lab-readiness blockers", () => {
    const readiness = summarizeReadiness([
      { id: "machines-topology", status: "passed", summary: "ok" },
      { id: "machine-selection", status: "passed", summary: "ok" },
      { id: "fleet-machine-lease", status: "passed", summary: "ok" },
      { id: "fleet-validation-route", status: "passed", summary: "ok" },
      { id: "machine-route", status: "passed", summary: "ok" },
      { id: "machine-screen-url", status: "passed", summary: "ok" },
      { id: "remote-capabilities", status: "passed", summary: "ok" },
      { id: "remote-screenshot", status: "passed", summary: "ok" },
      { id: "remote-visible-browser-query", status: "passed", summary: "ok" },
      { id: "fleet-machine-lease-release", status: "passed", summary: "ok" },
      { id: "browser-extension-status", status: "passed", summary: "ok" },
      { id: "safe-action-sampler-plan", status: "skipped", summary: "gated" },
    ]);

    expect(readiness.ready).toBe(false);
    expect(readiness.lab_ready).toBe(true);
    expect(readiness.live_smoke_ready).toBe(true);
    expect(readiness.p8_complete).toBe(false);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.pending_evidence).toContain("safe-action-sampler-result missing");
    expect(readiness.pending_evidence).toContain("visual-regression-review missing");
    expect(readiness.pending_evidence).toContain("installed-package-smoke missing");
  });

  test("only reports ready when lab, browser, sampler, review, and package evidence pass", () => {
    const readiness = summarizeReadiness([
      { id: "machines-topology", status: "passed", summary: "ok" },
      { id: "machine-selection", status: "passed", summary: "ok" },
      { id: "fleet-machine-lease", status: "passed", summary: "ok" },
      { id: "fleet-validation-route", status: "passed", summary: "ok" },
      { id: "machine-route", status: "passed", summary: "ok" },
      { id: "machine-screen-url", status: "passed", summary: "ok" },
      { id: "remote-capabilities", status: "passed", summary: "ok" },
      { id: "remote-screenshot", status: "passed", summary: "ok" },
      { id: "remote-visible-browser-query", status: "passed", summary: "ok" },
      { id: "fleet-machine-lease-release", status: "passed", summary: "ok" },
      { id: "browser-extension-status", status: "passed", summary: "ok" },
      { id: "safe-action-sampler-result", status: "passed", summary: "ok" },
      { id: "visual-regression-review", status: "passed", summary: "ok" },
      { id: "installed-package-smoke", status: "passed", summary: "ok" },
    ]);

    expect(readiness.ready).toBe(true);
    expect(readiness.lab_ready).toBe(true);
    expect(readiness.live_smoke_ready).toBe(true);
    expect(readiness.p8_complete).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.pending_evidence).toEqual([]);
  });

  test("accepts installed package smoke evidence with native tool and helper checks", () => {
    const check = evidenceCheckFromReport("installed-package-smoke", "/tmp/installed.json", {
      schema_version: "open-computer.installed-machine-smoke.v1",
      generated_at: "2026-06-18T00:00:00.000Z",
      package: { name: "@hasna/computer", version: "0.1.13" },
      checks: [
        { id: "local-headless-status", status: "passed" },
        { id: "native-tools", status: "passed" },
        { id: "packaged-helpers", status: "passed" },
        { id: "local-screenshot", status: "skipped", summary: "Screenshot skipped by --skip-screenshot." },
      ],
      readiness: { ready: false, blockers: ["Screenshot skipped by --skip-screenshot."] },
    });

    expect(check.id).toBe("installed-package-smoke");
    expect(check.status).toBe("passed");
  });

  test("rejects sampler evidence that touches external sites or secrets", () => {
    const check = evidenceCheckFromReport("safe-action-sampler-result", "/tmp/sampler.json", {
      schema_version: "open-computer.safe-action-sampler.v1",
      status: "passed",
      external_sites: true,
      secrets_touched: false,
      destructive_actions: false,
      fixture_only: true,
      actions: [{ type: "open_local_fixture", url: "http://127.0.0.1:8802/fixture.html" }],
      cleanup_completed: true,
      cleanup_actions: [{ type: "close_fixture_tab" }],
      artifacts: [screenshotArtifact],
      leftovers: { tabs: 0, files: 0, processes: 0 },
    });

    expect(check.status).toBe("failed");
  });

  test("accepts sampler evidence only with cleanup and no-leftover proof", () => {
    const check = evidenceCheckFromReport("safe-action-sampler-result", "/tmp/sampler.json", {
      schema_version: "open-computer.safe-action-sampler.v1",
      status: "passed",
      external_sites: false,
      secrets_touched: false,
      destructive_actions: false,
      fixture_only: true,
      actions: [
        { type: "open_local_fixture", url: "http://127.0.0.1:8802/occtrl-fixture/index.html", fixture_sha256: "b".repeat(64) },
        { type: "scroll_local_fixture" },
      ],
      cleanup_completed: true,
      cleanup_actions: [{ type: "close_fixture_tab" }],
      artifacts: [screenshotArtifact],
      leases: samplerLeases,
      leftovers: { tabs: 0, files: 0, processes: 0 },
    });

    expect(check.status).toBe("passed");
  });

  test("rejects sampler evidence with arbitrary files, admin loopback URLs, dangerous fields, or missing leases", () => {
    for (const action of [
      { type: "open_local_fixture", url: "file:///etc/passwd" },
      { type: "open_local_fixture", url: "http://127.0.0.1:631/admin" },
      { type: "open_empty_ghostty", command: "rm -rf /tmp/fixture" },
    ]) {
      const check = evidenceCheckFromReport("safe-action-sampler-result", "/tmp/sampler.json", {
        schema_version: "open-computer.safe-action-sampler.v1",
        status: "passed",
        external_sites: false,
        secrets_touched: false,
        destructive_actions: false,
        fixture_only: true,
        actions: [action],
        cleanup_completed: true,
        cleanup_actions: [{ type: "cleanup_test_tab" }],
        artifacts: [screenshotArtifact],
        leases: samplerLeases,
        leftovers: { tabs: 0, files: 0, processes: 0 },
      });
      expect(check.status).toBe("failed");
    }

    const missingLease = evidenceCheckFromReport("safe-action-sampler-result", "/tmp/sampler.json", {
      schema_version: "open-computer.safe-action-sampler.v1",
      status: "passed",
      external_sites: false,
      secrets_touched: false,
      destructive_actions: false,
      fixture_only: true,
      actions: [{ type: "open_local_fixture", url: "http://127.0.0.1:8802/occtrl-fixture/index.html" }],
      cleanup_completed: true,
      cleanup_actions: [{ type: "close_fixture_tab" }],
      artifacts: [screenshotArtifact],
      leases: [{ resource_type: "computer_display", lease_id: "lease-display", acquired: true, released: true }],
      leftovers: { tabs: 0, files: 0, processes: 0 },
    });
    expect(missingLease.status).toBe("failed");
  });

  test("rejects partial sampler and visual review evidence", () => {
    const sampler = evidenceCheckFromReport("safe-action-sampler-result", "/tmp/sampler.json", {
      schema_version: "open-computer.safe-action-sampler.v1",
      status: "passed",
      external_sites: false,
      secrets_touched: false,
      destructive_actions: false,
      fixture_only: true,
      actions: [{ type: "open_local_fixture", url: "https://example.com" }],
      artifacts: [screenshotArtifact],
      leases: samplerLeases,
    });
    const visual = evidenceCheckFromReport("visual-regression-review", "/tmp/visual.json", {
      schema_version: "open-computer.visual-review.v1",
      status: "passed",
    });

    expect(sampler.status).toBe("failed");
    expect(visual.status).toBe("failed");
  });

  test("accepts visual review only with selected machine alias, before/after artifacts, and pixel checks", () => {
    const check = evidenceCheckFromReport("visual-regression-review", "/tmp/visual.json", {
      schema_version: "open-computer.visual-review.v1",
      status: "passed",
      selected_machine_alias: "machine-123456abcd",
      reviewed_at: "2026-06-19T00:00:00.000Z",
      issues: [],
      artifacts: [beforeScreenshotArtifact, afterScreenshotArtifact],
      visual_checks: visualChecks,
    });

    expect(check.status).toBe("passed");
  });

  test("rejects unchanged or blank visual review evidence", () => {
    const unchanged = evidenceCheckFromReport("visual-regression-review", "/tmp/visual.json", {
      schema_version: "open-computer.visual-review.v1",
      status: "passed",
      selected_machine_alias: "machine-123456abcd",
      reviewed_at: "2026-06-19T00:00:00.000Z",
      issues: [],
      artifacts: [beforeScreenshotArtifact, { ...afterScreenshotArtifact, sha256: beforeScreenshotArtifact.sha256 }],
      visual_checks: {
        ...visualChecks,
        after_sha256: beforeScreenshotArtifact.sha256,
        after_nonblank: false,
        different_hashes: false,
        changed: false,
        pixel_difference_ratio: 0,
      },
    });

    expect(unchanged.status).toBe("failed");
  });

  test("rejects stale installed package smoke evidence", () => {
    const check = evidenceCheckFromReport("installed-package-smoke", "/tmp/installed.json", {
      schema_version: "open-computer.installed-machine-smoke.v1",
      package: { name: "@hasna/computer", version: "0.0.1" },
      generated_at: "2026-06-18T00:00:00.000Z",
      checks: [
        { id: "local-headless-status", status: "passed" },
        { id: "native-tools", status: "passed" },
        { id: "packaged-helpers", status: "passed" },
        { id: "local-screenshot", status: "skipped", summary: "Screenshot skipped by --skip-screenshot." },
      ],
    });

    expect(check.status).toBe("failed");
  });
});
