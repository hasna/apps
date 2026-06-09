import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { repairWorkspaceManifestMappings } from "../src/commands/workspace.js";
import { readManifest } from "../src/manifests.js";
import { resolveMachineWorkspace } from "../src/topology.js";

const ENV_KEYS = [
  "HASNA_MACHINES_MANIFEST_PATH",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("workspace resolver CLI", () => {
  test("repairs inferred mappings through the SDK helper", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-repair-sdk-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      manifestInit();
      manifestAdd({
        id: "spark01",
        platform: "linux",
        workspacePath: "/home/hasna/workspace",
        metadata: {
          trusted: true,
          auth_status: "authenticated",
        },
      });

      const preview = repairWorkspaceManifestMappings({
        machineId: "spark01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
      });
      expect(preview.ok).toBe(true);
      expect(preview.applied).toBe(false);
      expect(preview.patches.map((patch) => patch.status)).toEqual(["would_write", "would_write"]);
      expect(preview.warnings).toContain("project_root_inferred:open-knowledge");
      expect(preview.warnings).toContain("open_files_root_inferred:open-knowledge");
      expect(readManifest().machines[0].metadata).not.toHaveProperty("workspace_paths");

      const applied = repairWorkspaceManifestMappings({
        machineId: "spark01",
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
          "open-knowledge": "/home/hasna/workspace/hasna/opensource/open-knowledge",
        },
        open_files_roots: {
          "open-knowledge": "/home/hasna/workspace/hasna/opensource/open-files",
        },
      });

      const resolved = resolveMachineWorkspace({
        machineId: "spark01",
        projectId: "open-knowledge",
        repoName: "open-knowledge",
        includeTailscale: false,
      });
      expect(resolved.paths.project_root.source).toBe("manifest_metadata");
      expect(resolved.paths.open_files_root.source).toBe("manifest_metadata");
      expect(resolved.warnings).not.toContain("project_root_inferred:open-knowledge");
      expect(resolved.warnings).not.toContain("open_files_root_inferred:open-knowledge");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints machine workspace mapping as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-cli-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      manifestInit();
      manifestAdd({
        id: "spark01",
        platform: "linux",
        workspacePath: "/home/hasna/workspace",
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
        "spark01",
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
      expect(output.machine_id).toBe("spark01");
      expect(output.paths.project_root.path).toBe("/srv/open-knowledge");
      expect(output.paths.open_files_root.path).toBe("/srv/open-files");
      expect(output.machine.trust_status).toBe("trusted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("repairs inferred mappings through the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-workspace-repair-cli-"));
    try {
      process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
      manifestInit();
      manifestAdd({
        id: "spark01",
        platform: "linux",
        workspacePath: "/home/hasna/workspace",
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
        "spark01",
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
        "spark01",
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
