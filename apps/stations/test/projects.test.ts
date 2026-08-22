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
  "HASNA_STATIONS_MANIFEST_PATH",
  "HASNA_STATIONS_DB_PATH",
  "HASNA_STATIONS_MACHINE_ID",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

function setupTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  process.env.HASNA_STATIONS_MANIFEST_PATH = join(dir, "stations.json");
  process.env.HASNA_STATIONS_DB_PATH = join(dir, "stations.db");
  process.env.HASNA_STATIONS_MACHINE_ID = "demo-node-02";
  manifestInit();
  return dir;
}

describe("machine project assignments", () => {
  test("lists assignment metadata in an projects import-ready shape", () => {
    const dir = setupTemp("stations-project-assignments-");
    try {
      manifestAdd({
        id: "demo-node-01",
        hostname: "demo-node-01",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
        tags: ["trusted"],
        metadata: {
          project_assignments: {
            "stations": {
              path: "/home/operator/workspace/hasna/opensource/stations",
              workspace_id: "ws_open_machines",
              repo_name: "stations",
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
        id: "machine:demo-node-01:project:stations",
        project_type: "projects",
        project_id: "stations",
        workspace_id: "ws_open_machines",
        machine_id: "demo-node-01",
        path: "/home/operator/workspace/hasna/opensource/stations",
        is_primary: true,
        machine: {
          trust_status: "trusted",
          auth_status: "authenticated",
        },
        projects_location_input: {
          project: "ws_open_machines",
          machine_id: "demo-node-01",
          path: "/home/operator/workspace/hasna/opensource/stations",
          label: "demo-node-01",
          kind: "machine-local",
          primary: true,
          metadata: {
            source: "stations",
            machine_id: "demo-node-01",
            assignment_id: "machine:demo-node-01:project:stations",
            owner: "platform",
          },
        },
      });
      expect(result.projects[0]).toMatchObject({
        project_id: "stations",
        workspace_id: "ws_open_machines",
        primary_machine_id: "demo-node-01",
      });
      expect(result.stations[0]).toMatchObject({
        machine_id: "demo-node-01",
        project_ids: ["stations"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("assigns and removes projects while preserving workspace resolver compatibility", () => {
    const dir = setupTemp("stations-project-assign-write-");
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
        projectId: "stations",
        path: "/srv/projects/stations",
        openFilesRoot: "/srv/projects/open-files",
        label: "demo-node-01",
        kind: "machine-local",
        primary: true,
      });
      expect(assigned.assignments).toHaveLength(1);
      const afterAssign = readManifest().stations.find((machine) => machine.id === "demo-node-01");
      expect(afterAssign?.updatedAt).not.toBe("2026-06-01T00:00:00.000Z");
      expect(discoverMachineTopology({ includeTailscale: false }).stations[0]?.machine_id).toBe("demo-node-01");

      const resolved = resolveMachineWorkspace({
        machineId: "demo-node-01",
        projectId: "stations",
        repoName: "stations",
        includeTailscale: false,
      });
      expect(resolved.paths.project_root).toEqual({
        path: "/srv/projects/stations",
        source: "manifest_metadata",
      });
      expect(resolved.paths.open_files_root).toEqual({
        path: "/srv/projects/open-files",
        source: "manifest_metadata",
      });

      const removed = removeMachineProjectAssignment({
        machineId: "demo-node-01",
        projectId: "stations",
      });
      expect(removed.assignments).toEqual([]);
      const afterRemove = readManifest().stations.find((machine) => machine.id === "demo-node-01");
      expect(afterRemove?.updatedAt).not.toBe("2026-06-01T00:00:00.000Z");
      expect(listMachineProjectAssignments().assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("assigns and filters project metadata through a retained machine alias", () => {
    const dir = setupTemp("stations-project-alias-");
    try {
      manifestAdd({
        id: "station03",
        aliases: ["apple03"],
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      });

      const assigned = assignMachineProject({
        machineId: "apple03",
        projectId: "stations",
        path: "/srv/projects/stations",
        label: "station03",
        kind: "machine-local",
      });
      expect(assigned.filters.machine_id).toBe("station03");
      expect(assigned.assignments[0]?.machine_id).toBe("station03");
      expect(listMachineProjectAssignments({ machineId: "apple03" }).assignments[0]?.machine_id).toBe("station03");

      removeMachineProjectAssignment({ machineId: "apple03", projectId: "stations" });
      expect(listMachineProjectAssignments({ machineId: "station03" }).assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removes supported array-form project assignments", () => {
    const dir = setupTemp("stations-project-array-remove-");
    try {
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/workspace",
        metadata: {
          project_assignments: [{
            project_id: "stations",
            path: "/workspace/stations",
            label: "array-form",
            kind: "machine-local",
          }],
        },
      });

      expect(listMachineProjectAssignments().assignments).toHaveLength(1);
      const removed = removeMachineProjectAssignment({
        machineId: "demo-node-01",
        projectId: "stations",
      });
      expect(removed.assignments).toEqual([]);
      expect(listMachineProjectAssignments().assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upserts preserve metadata and primary when omitted", () => {
    const dir = setupTemp("stations-project-preserve-upsert-");
    try {
      manifestAdd({
        id: "demo-node-01",
        platform: "linux",
        workspacePath: "/workspace",
        metadata: {
          project_assignments: {
            "stations": {
              path: "/workspace/stations",
              is_primary: true,
              metadata: { owner: "platform" },
            },
          },
          primary_projects: ["stations"],
        },
      });

      const updated = assignMachineProject({
        machineId: "demo-node-01",
        projectId: "stations",
        path: "/workspace/stations-v2",
      });
      expect(updated.assignments[0]).toMatchObject({
        path: "/workspace/stations-v2",
        is_primary: true,
        metadata: { owner: "platform" },
        projects_location_input: {
          primary: true,
          metadata: { owner: "platform" },
        },
      });

      const demoted = assignMachineProject({
        machineId: "demo-node-01",
        projectId: "stations",
        path: "/workspace/stations-v2",
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
