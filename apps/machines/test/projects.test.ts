import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { closeDb } from "../src/db.js";
import { readManifest } from "../src/manifests.js";
import {
  assignMachineProject,
  listMachineProjectAssignments,
  removeMachineProjectAssignment,
} from "../src/projects.js";
import { discoverMachineTopology, resolveMachineWorkspace } from "../src/topology.js";

const ENV_KEYS = [
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MACHINE_ID",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

function setupTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
  process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
  process.env.HASNA_MACHINES_MACHINE_ID = "demo-node-02";
  manifestInit();
  return dir;
}

describe("machine project assignments", () => {
  test("lists assignment metadata in an projects import-ready shape", () => {
    const dir = setupTemp("machines-project-assignments-");
    try {
      manifestAdd({
        id: "demo-node-01",
        hostname: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        tags: ["trusted"],
        metadata: {
          project_assignments: {
            "machines": {
              path: "/home/operator/workspace/hasna/opensource/machines",
              workspace_id: "ws_open_machines",
              repo_name: "machines",
              label: "demo-node-01",
              kind: "machine-local",
              is_primary: true,
              open_files_root: "/home/operator/workspace/hasna/opensource/open-files",
              metadata: { owner: "platform" },
            },
          },
          auth_status: "authenticated",
        },
      });

      const result = listMachineProjectAssignments({
        now: new Date("2026-06-22T00:00:00.000Z"),
      });
      expect(result.schema_version).toBe(1);
      expect(result.filters).toEqual({ machine_id: null, project_id: null });
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]).toMatchObject({
        id: "machine:demo-node-01:project:machines",
        project_type: "projects",
        project_id: "machines",
        workspace_id: "ws_open_machines",
        machine_id: "demo-node-01",
        path: "/home/operator/workspace/hasna/opensource/machines",
        is_primary: true,
        machine: {
          trust_status: "trusted",
          auth_status: "authenticated",
        },
        projects_location_input: {
          project: "ws_open_machines",
          machine_id: "demo-node-01",
          path: "/home/operator/workspace/hasna/opensource/machines",
          label: "demo-node-01",
          kind: "machine-local",
          primary: true,
          metadata: {
            source: "machines",
            machine_id: "demo-node-01",
            assignment_id: "machine:demo-node-01:project:machines",
            owner: "platform",
          },
        },
      });
      expect(result.projects[0]).toMatchObject({
        project_id: "machines",
        workspace_id: "ws_open_machines",
        primary_machine_id: "demo-node-01",
      });
      expect(result.machines[0]).toMatchObject({
        machine_id: "demo-node-01",
        project_ids: ["machines"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("assigns and removes projects while preserving workspace resolver compatibility", () => {
    const dir = setupTemp("machines-project-assign-write-");
    try {
      manifestAdd({
        id: "demo-node-01",
        hostname: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        updatedAt: "2026-06-01T00:00:00.000Z",
      });
      manifestAdd({
        id: "demo-node-02",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        updatedAt: "2026-06-20T00:00:00.000Z",
      });

      const assigned = assignMachineProject({
        machineId: "demo-node-01",
        projectId: "machines",
        path: "/srv/projects/machines",
        openFilesRoot: "/srv/projects/open-files",
        label: "demo-node-01",
        kind: "machine-local",
        primary: true,
      });
      expect(assigned.assignments).toHaveLength(1);
      const afterAssign = readManifest().machines.find((machine) => machine.id === "demo-node-01");
      expect(afterAssign?.updatedAt).not.toBe("2026-06-01T00:00:00.000Z");
      expect(discoverMachineTopology({ includeTailscale: false }).machines[0]?.machine_id).toBe("demo-node-01");

      const resolved = resolveMachineWorkspace({
        machineId: "demo-node-01",
        projectId: "machines",
        repoName: "machines",
        includeTailscale: false,
      });
      expect(resolved.paths.project_root).toEqual({
        path: "/srv/projects/machines",
        source: "manifest_metadata",
      });
      expect(resolved.paths.open_files_root).toEqual({
        path: "/srv/projects/open-files",
        source: "manifest_metadata",
      });

      const removed = removeMachineProjectAssignment({
        machineId: "demo-node-01",
        projectId: "machines",
      });
      expect(removed.assignments).toEqual([]);
      const afterRemove = readManifest().machines.find((machine) => machine.id === "demo-node-01");
      expect(afterRemove?.updatedAt).not.toBe("2026-06-01T00:00:00.000Z");
      expect(listMachineProjectAssignments().assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("assigns and filters project metadata through a retained machine alias", () => {
    const dir = setupTemp("machines-project-alias-");
    try {
      manifestAdd({
        id: "station03",
        aliases: ["apple03"],
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      });

      const assigned = assignMachineProject({
        machineId: "apple03",
        projectId: "machines",
        path: "/srv/projects/machines",
        label: "station03",
        kind: "machine-local",
      });
      expect(assigned.filters.machine_id).toBe("station03");
      expect(assigned.assignments[0]?.machine_id).toBe("station03");
      expect(listMachineProjectAssignments({ machineId: "apple03" }).assignments[0]?.machine_id).toBe("station03");

      removeMachineProjectAssignment({ machineId: "apple03", projectId: "machines" });
      expect(listMachineProjectAssignments({ machineId: "station03" }).assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removes supported array-form project assignments", () => {
    const dir = setupTemp("machines-project-array-remove-");
    try {
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/workspace",
        metadata: {
          project_assignments: [{
            project_id: "machines",
            path: "/workspace/machines",
            label: "array-form",
            kind: "machine-local",
          }],
        },
      });

      expect(listMachineProjectAssignments().assignments).toHaveLength(1);
      const removed = removeMachineProjectAssignment({
        machineId: "demo-node-01",
        projectId: "machines",
      });
      expect(removed.assignments).toEqual([]);
      expect(listMachineProjectAssignments().assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upserts preserve metadata and primary when omitted", () => {
    const dir = setupTemp("machines-project-preserve-upsert-");
    try {
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/workspace",
        metadata: {
          project_assignments: {
            "machines": {
              path: "/workspace/machines",
              is_primary: true,
              metadata: { owner: "platform" },
            },
          },
          primary_projects: ["machines"],
        },
      });

      const updated = assignMachineProject({
        machineId: "demo-node-01",
        projectId: "machines",
        path: "/workspace/machines-v2",
      });
      expect(updated.assignments[0]).toMatchObject({
        path: "/workspace/machines-v2",
        is_primary: true,
        metadata: { owner: "platform" },
        projects_location_input: {
          primary: true,
          metadata: { owner: "platform" },
        },
      });

      const demoted = assignMachineProject({
        machineId: "demo-node-01",
        projectId: "machines",
        path: "/workspace/machines-v2",
        primary: false,
        metadata: { owner: "security" },
      });
      expect(demoted.assignments[0]).toMatchObject({
        is_primary: false,
        metadata: { owner: "security" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
