import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  HEARTBEAT_COLLECT_MUTATION_OPERATION,
  heartbeatCollectMutationArgs,
  heartbeatCollectResourceId,
} from "../src/commands/heartbeat.js";
import { MUTATION_APPROVAL_FLAG_ENV, MUTATION_APPROVAL_TOKEN_ENV, createMutationApprovalToken } from "../src/commands/mutation-approval.js";
import {
  clearMachineFriendlyNameMutationArgs,
  machineFriendlyNameResourceId,
  setMachineFriendlyNameMutationArgs,
} from "../src/commands/manifest.js";
import {
  projectAssignmentMutationArgs,
  projectAssignmentResourceId,
  removeProjectAssignmentMutationArgs,
} from "../src/projects.js";

const repoRoot = resolve(import.meta.dir, "..");
const cliPath = join(repoRoot, "src", "cli", "index.ts");

function runCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env,
    input,
    encoding: "utf8",
  });
}

describe("cli command handling", () => {
  test("heartbeat collect requires scoped approval before route execution", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-heartbeat-collect-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);

      const denied = runCli(["heartbeat", "collect", "--machine", "unknown", "--json"], baseEnv);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");

      const collectOptions = { machines: ["unknown"] };
      const token = createMutationApprovalToken({
        surface: "cli",
        operation: HEARTBEAT_COLLECT_MUTATION_OPERATION,
        transport: "cli",
        callerId: "cli",
        runId: "cli",
        resourceId: heartbeatCollectResourceId(collectOptions),
        args: heartbeatCollectMutationArgs(collectOptions),
      }, { env: baseEnv, now: Date.now(), nonce: "cli-heartbeat-collect" });
      const approved = runCli(["heartbeat", "collect", "--machine", "unknown", "--json", "--approval-token", token], baseEnv);
      expect(approved.stderr).toBe("");
      expect(approved.status).toBe(0);
      expect(JSON.parse(approved.stdout)[0]).toMatchObject({
        machineId: "unknown",
        status: "failed",
        error: "heartbeat collection requires a canonical manifest machine id",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("heartbeat collector-command emits the package-owned OpenLoops command without approval", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-heartbeat-collector-command-"));
    try {
      const manifestPath = join(dir, "machines.json");
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: manifestPath,
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "spark01",
        [MUTATION_APPROVAL_FLAG_ENV]: "",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      writeFileSync(manifestPath, `${JSON.stringify({
        version: 1,
        machines: [
          { id: "spark02", platform: "linux", workspacePath: "/home/hasna/workspace" },
          { id: "spark01", platform: "linux", workspacePath: "/home/hasna/workspace" },
        ],
      })}\n`, "utf8");

      const text = runCli(["heartbeat", "collector-command", "--machine", "spark01", "--machine", "spark02"], env);
      expect(text.stderr).toBe("");
      expect(text.status).toBe(0);
      expect(text.stdout.trim()).toBe("HASNA_MACHINES_ALLOW_MUTATIONS=1 machines heartbeat collect --machine spark01 --machine spark02 --timeout-ms 90000 --fail-on-error --json");
      expect(text.stdout).not.toContain("topology --all");

      const json = runCli(["heartbeat", "collector-command", "--machine", "spark01", "--machine", "spark02", "--json"], env);
      expect(json.stderr).toBe("");
      expect(json.status).toBe(0);
      expect(JSON.parse(json.stdout)).toMatchObject({
        kind: "heartbeat_collector_command",
        loopName: "machine-openmachines-heartbeat-collector",
        command: "HASNA_MACHINES_ALLOW_MUTATIONS=1 machines heartbeat collect --machine spark01 --machine spark02 --timeout-ms 90000 --fail-on-error --json",
        machines: ["spark01", "spark02"],
        timeoutMs: 90000,
        trustedLocalMutationEnv: "HASNA_MACHINES_ALLOW_MUTATIONS=1",
        warnings: [],
      });

      const defaulted = runCli(["heartbeat", "collector-command", "--json"], env);
      expect(defaulted.stderr).toBe("");
      expect(defaulted.status).toBe(0);
      expect(JSON.parse(defaulted.stdout)).toMatchObject({
        machines: ["spark01"],
        warnings: ["heartbeat_collector_defaulted_to_local_machine_only"],
      });

      const denied = runCli(["heartbeat", "collect", "--machine", "spark01", "--json"], env);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");

      const collectOptions = { machines: ["unknown"] };
      const token = createMutationApprovalToken({
        surface: "cli",
        operation: HEARTBEAT_COLLECT_MUTATION_OPERATION,
        transport: "cli",
        callerId: "cli",
        runId: "cli",
        resourceId: heartbeatCollectResourceId(collectOptions),
        args: heartbeatCollectMutationArgs(collectOptions),
      }, { env, now: Date.now(), nonce: "cli-heartbeat-collector-fail" });
      const failed = runCli(["heartbeat", "collect", "--machine", "unknown", "--json", "--fail-on-error", "--approval-token", token], env);
      expect(failed.status).toBe(1);
      expect(JSON.parse(failed.stdout)[0]).toMatchObject({
        machineId: "unknown",
        status: "failed",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manifest add --from-stdin bypasses option validation and writes the piped machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-stdin-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "demo-mac-001",
        hostname: "demo-mac-001",
        sshAddress: "operator@demo-mac-001",
        tailscaleName: "demo-mac-001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/operator/Workspace",
        metadata: { user: "operator" },
      };
      const added = runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine));
      expect(added.stderr).toBe("");
      expect(added.status).toBe(0);
      const listed = runCli(["manifest", "list"], env);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout).machines[0]).toMatchObject({ id: "demo-mac-001", metadata: { user: "operator" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manifest read subcommands accept -j/--json like the rest of the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-manifest-json-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);

      // Regression: manifest subcommands used to hard-fail with
      // "error: unknown option '--json'" before doing any work, breaking
      // uniform --json tooling. They must now accept the flag and emit JSON.
      for (const flag of ["--json", "-j"]) {
        const list = runCli(["manifest", "list", flag], env);
        expect(list.stderr).toBe("");
        expect(list.status).toBe(0);
        expect(Array.isArray(JSON.parse(list.stdout).machines)).toBe(true);

        const validate = runCli(["manifest", "validate", flag], env);
        expect(validate.stderr).toBe("");
        expect(validate.status).toBe(0);
        expect(JSON.parse(validate.stdout)).toHaveProperty("machines");

        const path = runCli(["manifest", "path", flag], env);
        expect(path.stderr).toBe("");
        expect(path.status).toBe(0);
        expect(JSON.parse(path.stdout)).toMatchObject({ manifest_path: env.HASNA_MACHINES_MANIFEST_PATH });
      }

      // Default (no flag) output for `path` stays plain text.
      const plainPath = runCli(["manifest", "path"], env);
      expect(plainPath.status).toBe(0);
      expect(plainPath.stdout.trim()).toBe(env.HASNA_MACHINES_MANIFEST_PATH);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manifest friendly-name CLI uses scoped approvals and topology display fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-friendly-name-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);
      expect(runCli(["manifest", "add", "--id", "demo-node-01", "--platform", "linux", "--workspace-path", "/workspace"], setupEnv).status).toBe(0);

      const input = { machineId: "demo-node-01", friendlyName: "Studio Linux" };
      const denied = runCli(["manifest", "friendly-name", "set", input.machineId, input.friendlyName, "--json"], baseEnv);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");

      const setToken = createMutationApprovalToken({
        surface: "cli",
        operation: "machines_friendly_name_set",
        transport: "cli",
        machineId: input.machineId,
        callerId: "cli",
        runId: "cli",
        resourceId: machineFriendlyNameResourceId(input.machineId),
        args: setMachineFriendlyNameMutationArgs(input),
      }, { env: baseEnv, now: Date.now(), nonce: "cli-friendly-name-set" });
      const set = runCli([
        "manifest",
        "friendly-name",
        "set",
        input.machineId,
        input.friendlyName,
        "--approval-token",
        setToken,
        "--json",
      ], baseEnv);
      expect(set.stderr).toBe("");
      expect(set.status).toBe(0);
      expect(JSON.parse(set.stdout)).toMatchObject({
        machine_id: "demo-node-01",
        friendly_name: "Studio Linux",
        display_name: "Studio Linux",
      });

      const topology = runCli(["topology", "--no-tailscale", "--json"], baseEnv);
      expect(topology.status).toBe(0);
      expect(JSON.parse(topology.stdout).machines[0]).toMatchObject({
        machine_id: "demo-node-01",
        friendly_name: "Studio Linux",
        display_name: "Studio Linux",
      });

      const clearInput = { machineId: input.machineId };
      const clearToken = createMutationApprovalToken({
        surface: "cli",
        operation: "machines_friendly_name_clear",
        transport: "cli",
        machineId: clearInput.machineId,
        callerId: "cli",
        runId: "cli",
        resourceId: machineFriendlyNameResourceId(clearInput.machineId),
        args: clearMachineFriendlyNameMutationArgs(clearInput),
      }, { env: baseEnv, now: Date.now(), nonce: "cli-friendly-name-clear" });
      const cleared = runCli([
        "manifest",
        "friendly-name",
        "clear",
        clearInput.machineId,
        "--approval-token",
        clearToken,
        "--json",
      ], baseEnv);
      expect(cleared.stderr).toBe("");
      expect(cleared.status).toBe(0);
      expect(JSON.parse(cleared.stdout)).toMatchObject({
        machine_id: "demo-node-01",
        friendly_name: null,
        display_name: "demo-node-01",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("topology CLI defaults to latest 10 and exposes view-more offsets", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-pagination-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "demo-node-02",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      for (let index = 0; index < 12; index += 1) {
        const machine = {
          id: `demo-node-${String(index).padStart(2, "0")}`,
          platform: "linux",
          workspacePath: `/workspace/${index}`,
          updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        };
        expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine)).status).toBe(0);
      }

      const first = runCli(["topology", "--no-tailscale", "--json"], env);
      expect(first.status).toBe(0);
      const payload = JSON.parse(first.stdout);
      expect(payload.pagination).toMatchObject({
        limit: 10,
        offset: 0,
        total: 12,
        count: 10,
        hasMore: true,
        nextOffset: 10,
      });
      expect(payload.machines[0].machine_id).toBe("demo-node-11");

      const second = runCli(["topology", "--no-tailscale", "--offset", "10", "--json"], env);
      expect(second.status).toBe(0);
      expect(JSON.parse(second.stdout).machines.map((machine: { machine_id: string }) => machine.machine_id)).toEqual(["demo-node-01", "demo-node-00"]);

      const zeroLimit = runCli(["topology", "--no-tailscale", "--limit", "0", "--json"], env);
      expect(zeroLimit.status).not.toBe(0);
      expect(zeroLimit.stderr).toContain("Expected >= 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("notes CLI exposes machine provenance context and trash policy metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-notes-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "origin-node",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify({
        id: "origin-node",
        friendlyName: "Desk Mac",
        platform: "macos",
        workspacePath: "/Users/hasna/Workspace",
        updatedAt: "2026-06-20T00:00:00.000Z",
      })).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify({
        id: "agent-node",
        friendlyName: "Agent Box",
        platform: "linux",
        workspacePath: "/srv/workspace",
        updatedAt: "2026-06-21T00:00:00.000Z",
        metadata: {
          notes_trash: {
            enabled: true,
            retention_days: 30,
            delete_after_days: 60,
            trash_path: "/srv/notes/.trash",
          },
        },
      })).status).toBe(0);

      const context = runCli([
        "notes",
        "context",
        "--origin-machine",
        "origin-node",
        "--source-machine",
        "agent-node",
        "--target-machine",
        "missing-target",
        "--sync-target",
        "missing-target",
        "--actor-type",
        "agent",
        "--agent-id",
        "notes-agent",
        "--agent-name",
        "Notes Agent",
        "--source",
        "agent",
        "--json",
      ], env);
      expect(context.stderr).toBe("");
      expect(context.status).toBe(0);
      const contextPayload = JSON.parse(context.stdout);
      expect(contextPayload.origin_machine).toMatchObject({ display_name: "Desk Mac" });
      expect(contextPayload.source_machine).toMatchObject({ display_name: "Agent Box" });
      expect(contextPayload.target_machine).toMatchObject({ machine_id: "missing-target", known: false });
      expect(contextPayload.actor).toMatchObject({ actor_type: "agent", display_name: "Notes Agent" });

      const trash = runCli(["notes", "trash-policies", "--machine", "agent-node", "--json"], env);
      expect(trash.stderr).toBe("");
      expect(trash.status).toBe(0);
      expect(JSON.parse(trash.stdout).policies[0]).toMatchObject({
        machine_id: "agent-node",
        display_name: "Agent Box",
        enabled: true,
        retention_days: 30,
        delete_after_days: 60,
        trash_path: "/srv/notes/.trash",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("details CLI exposes consumer-safe machine details", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-details-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "details-node",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify({
        id: "details-node",
        friendlyName: "Studio Laptop",
        platform: "macos",
        workspacePath: "/Users/hasna/Workspace",
        updatedAt: "2026-06-20T00:00:00.000Z",
        metadata: {
          machine_type: "laptop",
          role: "primary",
          capabilities: ["notes", "sync"],
          owner: "Hasna",
          api_key: "should-not-appear",
        },
      })).status).toBe(0);

      const details = runCli(["details", "--machine", "details-node", "--json"], env);
      expect(details.stderr).toBe("");
      expect(details.status).toBe(0);
      const payload = JSON.parse(details.stdout);
      expect(payload).toMatchObject({
        machine_id: "details-node",
        friendly_name: "Studio Laptop",
        display_name: "Studio Laptop",
        machine_type: "laptop",
        role: "primary",
        machine_capabilities: ["notes", "sync"],
        status: {
          state: "unknown",
          label: "Unknown",
          online: null,
        },
      });
      expect(JSON.stringify(payload)).not.toContain("should-not-appear");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("browserplan CLI exposes target fleet and excludes spark machines", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-browserplan-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify({
        id: "machine001",
        friendlyName: "Browser Rig 01",
        platform: "linux",
        workspacePath: "/home/hasna/Workspace",
        metadata: { user: "hasna" },
      })).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify({
        id: "spark01",
        friendlyName: "Spark Local",
        platform: "linux",
        workspacePath: "/home/hasna/Workspace",
      })).status).toBe(0);

      const result = runCli(["browserplan", "fleet", "--machine", "machine001,spark01", "--json"], env);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload).toMatchObject({
        kind: "browserplan_fleet",
        target: {
          name: "browserplan-machine001-machine011",
          owner: "open-chrome",
          install_target_excludes: ["spark01", "spark02"],
        },
        coverage: {
          expected: 1,
          returned: 1,
          known: 1,
          excluded_requested: ["spark01"],
        },
      });
      expect(payload.machines[0]).toMatchObject({
        machine_id: "machine001",
        display_name: "Browser Rig 01",
        friendly_name: "Browser Rig 01",
        install_state: { checked: false },
      });
      expect(payload.machines[0].operation_hooks.map((hook: { id: string }) => hook.id)).toContain("headed_launch");
      expect(JSON.stringify(payload)).not.toContain("Spark Local");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("screen-credentials reports secret references without printing secret values", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-screen-credentials-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        HASNA_MACHINES_REACHABLE_HOSTS: "operator@demo-mac-001",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      const fakeSecrets = join(dir, "fake-secrets");
      writeFileSync(fakeSecrets, "#!/bin/sh\n[ \"$1\" = get ] && [ \"$2\" = machines/screen-sharing/screen-demo-mac-001-vnc-password ] && { printf '%s\\n' super-secret-value; exit 0; }\nexit 1\n", { mode: 0o700 });
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "demo-mac-001",
        hostname: "demo-mac-001",
        sshAddress: "operator@demo-mac-001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/operator/Workspace",
        metadata: {
          user: "operator",
          screenPasswordSecret: "machines/screen-sharing/screen-demo-mac-001-vnc-password",
        },
      };
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine)).status).toBe(0);
      const checked = runCli([
        "screen-credentials",
        "--machine",
        "demo-mac-001",
        "--check-secret",
        "--secrets-command",
        fakeSecrets,
        "--json",
      ], env);
      expect(checked.stderr).toBe("");
      expect(checked.status).toBe(0);
      expect(checked.stdout).not.toContain("super-secret-value");
      expect(JSON.parse(checked.stdout)[0]).toMatchObject({
        ok: true,
        machineId: "demo-mac-001",
        user: "operator",
        passwordSecretKey: "machines/screen-sharing/screen-demo-mac-001-vnc-password",
        passwordSecret: { checked: true, present: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("screen-credentials exits non-zero in JSON mode when checked secrets are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-screen-missing-secret-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        HASNA_MACHINES_REACHABLE_HOSTS: "operator@demo-mac-001",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      const fakeSecrets = join(dir, "fake-secrets");
      writeFileSync(fakeSecrets, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      const machine = {
        id: "demo-mac-001",
        hostname: "demo-mac-001",
        sshAddress: "operator@demo-mac-001",
        platform: "macos",
        connection: "ssh",
        workspacePath: "/Users/operator/Workspace",
        metadata: { user: "operator" },
      };
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify(machine)).status).toBe(0);
      const checked = runCli([
        "screen-credentials",
        "--machine",
        "demo-mac-001",
        "--check-secret",
        "--secrets-command",
        fakeSecrets,
        "--json",
      ], env);
      expect(checked.status).toBe(1);
      expect(JSON.parse(checked.stdout)[0]).toMatchObject({
        ok: true,
        passwordSecret: { checked: true, present: false },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("screen-enable rejects direct VNC passwords", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-screen-enable-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
      };
      const rejected = runCli([
        "screen-enable",
        "--machine",
        "demo-mac-001",
        "--user",
        "operator",
        "--vnc-password",
        "super-secret-value",
      ], env);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("Direct --vnc-password values are not accepted");
      expect(rejected.stdout).not.toContain("super-secret-value");
      expect(rejected.stderr).not.toContain("super-secret-value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manifest remove requires a CLI-scoped mutation token", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-scoped-token-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      const machine = {
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], setupEnv, JSON.stringify(machine)).status).toBe(0);

      const denied = runCli(["manifest", "remove", "demo-node-01"], baseEnv);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");

      const wrongToken = createMutationApprovalToken({
        surface: "cli",
        operation: "manifest_remove",
        machineId: "other-node",
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: { machine_id: "demo-node-01" },
      }, { env: baseEnv, now: Date.now(), nonce: "wrong-cli" });
      const wrong = runCli(["manifest", "remove", "demo-node-01", "--approval-token", wrongToken], baseEnv);
      expect(wrong.status).not.toBe(0);

      const token = createMutationApprovalToken({
        surface: "cli",
        operation: "manifest_remove",
        machineId: "demo-node-01",
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: { machine_id: "demo-node-01" },
      }, { env: baseEnv, now: Date.now(), nonce: "right-cli" });
      const removed = runCli(["manifest", "remove", "demo-node-01", "--approval-token", token], baseEnv);
      expect(removed.stderr).toBe("");
      expect(removed.status).toBe(0);
      expect(JSON.parse(removed.stdout).machines).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("manifest add rejects same-id argument tampering", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-args-hash-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);

      const approvedMachine = {
        id: "demo-node-02",
        platform: "linux",
        workspacePath: "/home/operator/approved",
        metadata: { purpose: "approved" },
      };
      const tamperedMachine = {
        ...approvedMachine,
        workspacePath: "/home/operator/tampered",
        metadata: { purpose: "tampered" },
      };
      const token = createMutationApprovalToken({
        surface: "cli",
        operation: "manifest_add",
        machineId: "demo-node-02",
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: approvedMachine,
      }, { env: baseEnv, now: Date.now(), nonce: "manifest-add-args" });

      const denied = runCli(["manifest", "add", "--from-stdin", "--approval-token", token], baseEnv, JSON.stringify(tamperedMachine));
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");
      expect(denied.stderr).not.toContain(token);

      const added = runCli(["manifest", "add", "--from-stdin", "--approval-token", token], baseEnv, JSON.stringify(approvedMachine));
      expect(added.stderr).toBe("");
      expect(added.status).toBe(0);
      expect(JSON.parse(added.stdout).machines[0]).toMatchObject(approvedMachine);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("apps apply tokens are bound to the approved plan digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-plan-digest-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        HASNA_MACHINES_MUTATION_REPLAY_PATH: "",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      const machine = {
        id: "demo-node-03",
        platform: "linux",
        workspacePath: "/tmp/machines-plan-digest",
        apps: [],
      };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], setupEnv, JSON.stringify(machine)).status).toBe(0);

      const planned = runCli(["apps", "plan", "--machine", "demo-node-03"], baseEnv);
      expect(planned.status).toBe(0);
      const planDigest = JSON.parse(planned.stdout).planDigest;
      expect(planDigest).toMatch(/^[a-f0-9]{64}$/);
      const token = createMutationApprovalToken({
        surface: "cli",
        operation: "apps_apply",
        machineId: "demo-node-03",
        resourceId: `plan:apps_apply:demo-node-03:${planDigest}`,
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: { machine_id: "demo-node-03", yes: true, plan_digest: planDigest },
      }, { env: baseEnv, now: Date.now(), nonce: "apps-plan-digest-cli" });

      const applied = runCli(["apps", "apply", "--machine", "demo-node-03", "--yes", "--approval-token", token], baseEnv);
      expect(applied.stderr).toBe("");
      expect(applied.status).toBe(0);
      expect(JSON.parse(applied.stdout)).toMatchObject({ machineId: "demo-node-03", mode: "apply", executed: 0, planDigest });

      const mutated = {
        ...machine,
        apps: [{ name: "drifted-custom", manager: "custom", packageName: "printf cli-plan-drift-executed" }],
      };
      expect(runCli(["manifest", "add", "--from-stdin"], setupEnv, JSON.stringify(mutated)).status).toBe(0);
      const denied = runCli(["apps", "apply", "--machine", "demo-node-03", "--yes", "--approval-token", token], baseEnv);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");
      expect(denied.stderr).not.toContain(token);
      expect(denied.stdout).not.toContain("cli-plan-drift-executed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("projects assignments CLI writes manifest-backed locations with scoped approval", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-project-assignments-"));
    try {
      const baseEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
      };
      const setupEnv = { ...baseEnv, [MUTATION_APPROVAL_FLAG_ENV]: "1" };
      const machine = {
        id: "demo-node-01",
        hostname: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      };
      expect(runCli(["manifest", "init"], setupEnv).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], setupEnv, JSON.stringify(machine)).status).toBe(0);

      const input = {
        machineId: "demo-node-01",
        projectId: "open-machines",
        path: "/home/operator/workspace/hasna/opensource/open-machines",
        workspaceId: null,
        repoName: "open-machines",
        workspaceRoot: null,
        openFilesRoot: null,
        label: "demo-node-01",
        kind: "machine-local",
        primary: true,
      };
      const denied = runCli([
        "projects",
        "assignments",
        "assign",
        "--machine",
        input.machineId,
        "--project",
        input.projectId,
        "--path",
        input.path,
        "--repo",
        input.repoName,
        "--label",
        input.label,
        "--kind",
        input.kind,
        "--primary",
        "--json",
      ], baseEnv);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toContain("requires operator approval");

      const token = createMutationApprovalToken({
        surface: "cli",
        operation: "machines_projects_assign",
        transport: "cli",
        machineId: input.machineId,
        callerId: "cli",
        runId: "cli",
        resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
        args: projectAssignmentMutationArgs(input),
      }, { env: baseEnv, now: Date.now(), nonce: "project-assign-cli" });
      const assigned = runCli([
        "projects",
        "assignments",
        "assign",
        "--machine",
        input.machineId,
        "--project",
        input.projectId,
        "--path",
        input.path,
        "--repo",
        input.repoName,
        "--label",
        input.label,
        "--kind",
        input.kind,
        "--primary",
        "--approval-token",
        token,
        "--json",
      ], baseEnv);
      expect(assigned.stderr).toBe("");
      expect(assigned.status).toBe(0);
      expect(JSON.parse(assigned.stdout).assignments[0]).toMatchObject({
        machine_id: "demo-node-01",
        project_id: "open-machines",
        projects_location_input: {
          project: "open-machines",
          machine_id: "demo-node-01",
          path: "/home/operator/workspace/hasna/opensource/open-machines",
          metadata: { machine_id: "demo-node-01" },
        },
      });

      const listed = runCli(["projects", "assignments", "list", "--project", "open-machines", "--json"], baseEnv);
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout).assignments).toHaveLength(1);

      const removeInput = { machineId: input.machineId, projectId: input.projectId };
      const removeToken = createMutationApprovalToken({
        surface: "cli",
        operation: "machines_projects_unassign",
        transport: "cli",
        machineId: input.machineId,
        callerId: "cli",
        runId: "cli",
        resourceId: projectAssignmentResourceId(input.machineId, input.projectId),
        args: removeProjectAssignmentMutationArgs(removeInput),
      }, { env: baseEnv, now: Date.now(), nonce: "project-unassign-cli" });
      const removed = runCli([
        "projects",
        "assignments",
        "remove",
        "--machine",
        input.machineId,
        "--project",
        input.projectId,
        "--approval-token",
        removeToken,
        "--json",
      ], baseEnv);
      expect(removed.stderr).toBe("");
      expect(removed.status).toBe(0);
      expect(JSON.parse(removed.stdout).assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agent abstraction CLIs print compact JSON by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-agent-apis-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        HASNA_MACHINES_REACHABLE_HOSTS: "operator@worker",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify({
        id: "control",
        friendlyName: "Control Node",
        platform: "linux",
        workspacePath: "/home/hasna/Workspace",
        updatedAt: "2026-06-26T10:00:00.000Z",
      })).status).toBe(0);
      expect(runCli(["manifest", "add", "--from-stdin"], env, JSON.stringify({
        id: "worker",
        friendlyName: "Worker Node",
        platform: "linux",
        workspacePath: "/srv/workspace",
        sshAddress: "operator@worker",
        updatedAt: "2026-06-26T09:00:00.000Z",
      })).status).toBe(0);

      const preflight = runCli(["loop-preflight", "--machine", "control,worker", "--cmd", "echo loop", "--no-tailscale"], env);
      expect(preflight.stderr).toBe("");
      expect(preflight.status).toBe(0);
      const preflightPayload = JSON.parse(preflight.stdout);
      expect(preflightPayload).toMatchObject({
        kind: "loop_preflight",
        mode: "plan",
        pagination: { count: 2, total: 2 },
      });
      expect(preflightPayload.machines).toHaveLength(2);
      expect(JSON.stringify(preflightPayload)).not.toContain("operator@worker");

      const matrix = runCli(["command-matrix", "--machine", "worker", "--cmd", "echo loop", "--no-tailscale"], env);
      expect(matrix.stderr).toBe("");
      expect(matrix.status).toBe(0);
      expect(JSON.parse(matrix.stdout).commands[0]).toMatchObject({
        machine_id: "worker",
        command: {
          command_ref: {
            preview: "[redacted]",
            redacted: true,
          },
          private_shell_command: "[redacted]",
          cli: "machines ssh --machine 'worker' --cmd '<loop-command>'",
          mcp: { args: { remote_command: "<loop-command>", private_metadata: false } },
        },
      });
      expect(matrix.stdout).not.toContain("echo loop");
      expect(matrix.stdout).not.toContain("--private-metadata");

      const routing = runCli(["routing", "--machine", "worker", "--no-tailscale"], env);
      expect(routing.stderr).toBe("");
      expect(routing.status).toBe(0);
      expect(JSON.parse(routing.stdout).routes[0]).toMatchObject({
        machine_id: "worker",
        target: "[redacted]",
        command_target: "[redacted]",
      });

      const pageDir = mkdtempSync(join(tmpdir(), "machines-cli-agent-pagination-"));
      const pageEnv = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(pageDir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(pageDir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "demo-node-00",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      try {
        expect(runCli(["manifest", "init"], pageEnv).status).toBe(0);
        for (let index = 0; index < 12; index += 1) {
          expect(runCli(["manifest", "add", "--from-stdin"], pageEnv, JSON.stringify({
            id: `demo-node-${String(index).padStart(2, "0")}`,
            platform: "linux",
            workspacePath: `/workspace/${index}`,
            updatedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          })).status).toBe(0);
        }
        const firstPage = JSON.parse(runCli(["machine-health", "--no-tailscale"], pageEnv).stdout);
        expect(firstPage.pagination).toMatchObject({ total: 12, count: 10, hasMore: true, nextOffset: 10 });
        const secondPage = JSON.parse(runCli(["machine-health", "--no-tailscale", "--offset", "10"], pageEnv).stdout);
        expect(secondPage.pagination).toMatchObject({ total: 12, count: 2, hasMore: false });
      } finally {
        rmSync(pageDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("error and usage-validation paths emit structured JSON under --json", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cli-json-errors-"));
    try {
      const env = {
        ...process.env,
        HASNA_MACHINES_MANIFEST_PATH: join(dir, "machines.json"),
        HASNA_MACHINES_DB_PATH: join(dir, "machines.db"),
        HASNA_MACHINES_MACHINE_ID: "control",
        // Force the failing states deterministically regardless of host env.
        HASNA_MACHINES_S3_BUCKET: "",
        MACHINES_S3_BUCKET: "",
        HASNA_MACHINES_STORAGE_MODE: "cloud",
        HASNA_MACHINES_DATABASE_URL: "",
        MACHINES_DATABASE_URL: "",
        HASNA_MACHINES_DATABASE_URL_OWNER: "",
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      expect(runCli(["manifest", "init"], env).status).toBe(0);

      // 1) Explicit action-level guard (no --machine/--all).
      const screen = runCli(["screen-credentials", "--json"], env);
      expect(screen.status).toBe(1);
      expect(screen.stderr).toBe("");
      expect(JSON.parse(screen.stdout)).toMatchObject({
        ok: false,
        error: "Provide --machine <id> or --all",
      });

      // 2) Commander required-option usage errors (before the action runs).
      for (const sub of ["resolve", "doctor"]) {
        const result = runCli(["workspace", sub, "--json"], env);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toBe("");
        const payload = JSON.parse(result.stdout);
        expect(payload).toMatchObject({
          ok: false,
          code: "commander.missingMandatoryOptionValue",
        });
        expect(payload.error).toContain("--machine");
      }

      // 3) Business-logic throw surfaced from a helper (missing S3 bucket).
      const backup = runCli(["backup", "--json"], env);
      expect(backup.status).toBe(1);
      expect(backup.stderr).toBe("");
      expect(JSON.parse(backup.stdout)).toMatchObject({
        ok: false,
        error: expect.stringContaining("Missing S3 backup bucket"),
      });

      // 4) Async business-logic throw (cloud mode without a database URL).
      const migrate = runCli(["db", "migrate", "--dry-run", "--json"], env);
      expect(migrate.status).toBe(1);
      expect(migrate.stderr).toBe("");
      expect(JSON.parse(migrate.stdout)).toMatchObject({
        ok: false,
        error: expect.stringContaining("needs a database URL"),
      });

      // Non-JSON parity: plain text stays on stderr, stdout carries no JSON.
      const backupText = runCli(["backup"], env);
      expect(backupText.status).toBe(1);
      expect(backupText.stderr).toContain("Missing S3 backup bucket");
      expect(backupText.stdout).toBe("");

      const workspaceText = runCli(["workspace", "resolve"], env);
      expect(workspaceText.status).not.toBe(0);
      expect(workspaceText.stderr).toContain("required option '--machine <id>' not specified");
      expect(workspaceText.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
