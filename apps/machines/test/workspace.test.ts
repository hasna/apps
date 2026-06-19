import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { MUTATION_APPROVAL_FLAG_ENV } from "../src/commands/mutation-approval.js";
import { repairWorkspaceManifestMappings } from "../src/commands/workspace.js";
import { readManifest } from "../src/manifests.js";
import { resolveMachineWorkspace } from "../src/topology.js";

const ENV_KEYS = [
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_MACHINE_ID",
  MUTATION_APPROVAL_FLAG_ENV,
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("workspace resolver CLI", () => {
  test("repairs inferred mappings through the SDK helper", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-repair-sdk-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      process.env.HASNA_MACHINES_MACHINE_ID = "demo-node-02";
      manifestInit();
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        metadata: {
          trusted: true,
          auth_status: "authenticated",
        },
      });

      const preview = repairWorkspaceManifestMappings({
        machineId: "demo-node-01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
      });
      expect(preview.ok).toBe(true);
      expect(preview.applied).toBe(false);
      expect(preview.patches.map((patch) => patch.status)).toEqual(["would_write", "would_write"]);
      expect(preview.warnings).toContain("project_root_inferred:open-knowledge");
      expect(preview.warnings).toContain("open_files_root_inferred:open-knowledge");
      expect(preview.resolution.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "project_root", status: "inferred", severity: "warn" }),
        expect.objectContaining({ id: "open_files_root", status: "inferred", severity: "warn" }),
      ]));
      expect(preview.resolution.repair_hints[0].shell_command).toContain("machines");
      expect(preview.resolution.repair_hints[0].shell_command).toContain("workspace");
      expect(preview.resolution.repair_hints[0].shell_command).toContain("repair");
      expect(readManifest().machines[0].metadata).not.toHaveProperty("workspace_paths");

      const applied = repairWorkspaceManifestMappings({
        machineId: "demo-node-01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
        apply: true,
      });
      expect(applied.ok).toBe(true);
      expect(applied.applied).toBe(true);
      expect(applied.patches.map((patch) => patch.status)).toEqual(["written", "written"]);

      const machine = readManifest().machines[0];
      expect(machine.metadata).toMatchObject({
        workspace_paths: {
          "open-knowledge": "/home/operator/workspace/hasna/opensource/open-knowledge",
        },
        open_files_roots: {
          "open-knowledge": "/home/operator/workspace/hasna/opensource/open-files",
        },
      });

      const resolved = resolveMachineWorkspace({
        machineId: "demo-node-01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
      });
      expect(resolved.paths.project_root.source).toBe("manifest_metadata");
      expect(resolved.paths.open_files_root.source).toBe("manifest_metadata");
      expect(resolved.warnings).not.toContain("project_root_inferred:open-knowledge");
      expect(resolved.warnings).not.toContain("open_files_root_inferred:open-knowledge");
      expect(resolved.repair_hints).toEqual([]);
      expect(resolved.diagnostics.filter((entry) => entry.severity !== "ok")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("diagnoses untrusted inferred workspace mappings", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-doctor-untrusted-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
      manifestInit();
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        metadata: {
          trusted: false,
        },
      });

      const resolved = resolveMachineWorkspace({
        machineId: "demo-node-01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
      });
      expect(resolved.ok).toBe(true);
      expect(resolved.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "project_root", status: "inferred", severity: "warn" }),
        expect.objectContaining({ id: "open_files_root", status: "inferred", severity: "warn" }),
        expect.objectContaining({ id: "trust", status: "untrusted", severity: "warn" }),
      ]));
      expect(resolved.repair_hints[0].command).toEqual([
        "machines",
        "workspace",
        "repair",
        "--machine",
        "demo-node-01",
        "--project",
        "open-knowledge",
        "--repo",
        "open-knowledge",
        "--open-files-repo",
        "open-files",
        "--json",
      ]);
      expect(resolved.repair_hints[0].apply_command).toContain("--apply");

      const blockedApply = repairWorkspaceManifestMappings({
        machineId: "demo-node-01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
        apply: true,
      });
      expect(blockedApply.ok).toBe(false);
      expect(blockedApply.warnings).toContain("manifest_repair_requires_trusted_machine:demo-node-01");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("diagnoses missing machine manifests as failed workspace readiness", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-doctor-missing-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
      manifestInit();

      const resolved = resolveMachineWorkspace({
        machineId: "missing-machine",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
      });
      expect(resolved.ok).toBe(false);
      expect(resolved.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "manifest", status: "missing_manifest", severity: "fail" }),
        expect.objectContaining({ id: "project_root", status: "missing", severity: "fail" }),
      ]));
      expect(resolved.repair_hints[0].shell_command).toContain("--machine");
      expect(resolved.repair_hints[0].shell_command).toContain("missing-machine");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints machine workspace mapping as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-cli-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      process.env.HASNA_MACHINES_MACHINE_ID = "demo-node-02";
      manifestInit();
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        metadata: {
          workspace_paths: {
            "open-knowledge": "/srv/open-knowledge",
          },
          open_files_root: "/srv/open-files",
          trusted: true,
        },
      });

      const result = spawnSync(process.execPath, [
        "run",
        "src/cli/index.ts",
        "workspace",
        "resolve",
        "--machine",
        "demo-node-01",
        "--project",
        "open-knowledge",
        "--repo",
        "open-knowledge",
        "--no-tailscale",
        "--json",
      ], {
        cwd: join(import.meta.dir, ".."),
        env: process.env,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.machine_id).toBe("demo-node-01");
      expect(output.paths.project_root.path).toBe("/srv/open-knowledge");
      expect(output.paths.open_files_root.path).toBe("/srv/open-files");
      expect(output.machine.trust_status).toBe("trusted");
      expect(output.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "auth", status: "unknown_auth", severity: "warn" }),
      ]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints workspace doctor diagnostics as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-doctor-cli-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      manifestInit();
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        metadata: {
          trusted: false,
        },
      });

      const result = spawnSync(process.execPath, [
        "run",
        "src/cli/index.ts",
        "workspace",
        "doctor",
        "--machine",
        "demo-node-01",
        "--project",
        "open-knowledge",
        "--repo",
        "open-knowledge",
        "--no-tailscale",
        "--json",
      ], {
        cwd: join(import.meta.dir, ".."),
        env: process.env,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "project_root", status: "inferred", severity: "warn" }),
        expect.objectContaining({ id: "trust", status: "untrusted", severity: "warn" }),
      ]));
      expect(output.repair_hints[0].shell_command).toContain("machines");
      expect(output.repair_hints[0].shell_command).toContain("workspace");
      expect(output.repair_hints[0].shell_command).toContain("repair");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repairs inferred mappings through the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-repair-cli-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      process.env[MUTATION_APPROVAL_FLAG_ENV] = "1";
      manifestInit();
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        metadata: {
          trusted: true,
          auth_status: "authenticated",
        },
      });

      const repair = spawnSync(process.execPath, [
        "run",
        "src/cli/index.ts",
        "workspace",
        "repair",
        "--machine",
        "demo-node-01",
        "--project",
        "open-knowledge",
        "--repo",
        "open-knowledge",
        "--no-tailscale",
        "--apply",
        "--json",
      ], {
        cwd: join(import.meta.dir, ".."),
        env: process.env,
        encoding: "utf8",
      });

      expect(repair.status).toBe(0);
      const repairOutput = JSON.parse(repair.stdout);
      expect(repairOutput.applied).toBe(true);
      expect(repairOutput.patches.map((patch: { status: string }) => patch.status)).toEqual(["written", "written"]);

      const resolve = spawnSync(process.execPath, [
        "run",
        "src/cli/index.ts",
        "workspace",
        "resolve",
        "--machine",
        "demo-node-01",
        "--project",
        "open-knowledge",
        "--repo",
        "open-knowledge",
        "--no-tailscale",
        "--json",
      ], {
        cwd: join(import.meta.dir, ".."),
        env: process.env,
        encoding: "utf8",
      });

      expect(resolve.status).toBe(0);
      const resolved = JSON.parse(resolve.stdout);
      expect(resolved.paths.project_root.source).toBe("manifest_metadata");
      expect(resolved.paths.open_files_root.source).toBe("manifest_metadata");
      expect(resolved.warnings).not.toContain("project_root_inferred:open-knowledge");
      expect(resolved.warnings).not.toContain("open_files_root_inferred:open-knowledge");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
