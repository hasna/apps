import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MACHINES_CONSUMER_SCHEMA_BUNDLE,
  MACHINES_CONSUMER_CAPABILITIES,
  MACHINES_CONSUMER_CONTRACT,
  MACHINES_CONSUMER_ENTRYPOINT,
  MACHINES_CONSUMER_CONTRACT_VERSION,
  createMachineResolverSnapshot,
  checkMachineCompatibility,
  discoverMachineTopology,
  getMachinesConsumerCapabilities,
  getMachinesConsumerSchemaBundle,
  getMachineDetails,
  listMachineProjectAssignments,
  listMachineTrashPolicies,
  resolveNoteMachineContext,
  resolveMachineRoute,
  resolveMachineWorkspace,
  validateMachinesConsumerEnvelope,
  type MachineTopology,
} from "../src/consumer.js";

describe("machines consumer SDK", () => {
  test("exports lightweight consumer contracts", () => {
    expect(MACHINES_CONSUMER_CONTRACT_VERSION).toBe(1);
    expect(MACHINES_CONSUMER_ENTRYPOINT).toBe("@hasna/machines/consumer");
    expect(MACHINES_CONSUMER_CAPABILITIES.workspace_path_mapping).toBe(true);
    expect(MACHINES_CONSUMER_CAPABILITIES.workspace_diagnostics).toBe(true);
    expect(MACHINES_CONSUMER_CAPABILITIES.friendly_machine_names).toBe(true);
    expect(MACHINES_CONSUMER_CAPABILITIES.machine_list_pagination).toBe(true);
    expect(MACHINES_CONSUMER_CAPABILITIES.note_machine_context).toBe(true);
    expect(MACHINES_CONSUMER_CAPABILITIES.machine_trash_policies).toBe(true);
    expect(MACHINES_CONSUMER_CAPABILITIES.machine_details).toBe(true);
    expect(getMachinesConsumerCapabilities()).toEqual(MACHINES_CONSUMER_CAPABILITIES);
    expect(MACHINES_CONSUMER_CONTRACT).toMatchObject({
      schema_version: 1,
      package_name: "@hasna/machines",
      entrypoint: "@hasna/machines/consumer",
      schema_artifact: "schemas/machines-consumer.schema.json",
      envelopes: ["topology", "route", "workspace", "compatibility", "resolver_snapshot", "project_assignments", "note_machine_context", "machine_trash_policies", "machine_details"],
    });
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("resolveMachineWorkspace");
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("createMachineResolverSnapshot");
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("listMachineProjectAssignments");
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("resolveNoteMachineContext");
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("listMachineTrashPolicies");
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("getMachineDetails");
    expect(MACHINES_CONSUMER_CONTRACT.stable_exports).toContain("validateMachinesConsumerEnvelope");
    expect(MACHINES_CONSUMER_CONTRACT.field_capabilities.workspace.trust_auth).toBe(true);
    expect(MACHINES_CONSUMER_CONTRACT.field_capabilities.topology.display_name_fallback).toBe(true);
    expect(MACHINES_CONSUMER_CONTRACT.field_capabilities.topology.pagination).toBe(true);
    expect(MACHINES_CONSUMER_CONTRACT.field_capabilities.project_assignments.open_projects_compatibility).toBe(true);
    expect(MACHINES_CONSUMER_CONTRACT.field_capabilities.note_machine_context.actor_context).toBe(true);
    expect(MACHINES_CONSUMER_CONTRACT.field_capabilities.machine_trash_policies.retention_metadata).toBe(true);
    expect(MACHINES_CONSUMER_CONTRACT.field_capabilities.machine_details.safe_display_metadata).toBe(true);
    expect(typeof discoverMachineTopology).toBe("function");
    expect(typeof checkMachineCompatibility).toBe("function");
    expect(typeof resolveMachineRoute).toBe("function");
    expect(typeof resolveMachineWorkspace).toBe("function");
    expect(typeof createMachineResolverSnapshot).toBe("function");
    expect(typeof listMachineProjectAssignments).toBe("function");
    expect(typeof resolveNoteMachineContext).toBe("function");
    expect(typeof listMachineTrashPolicies).toBe("function");
    expect(typeof getMachineDetails).toBe("function");
  });

  test("exports schema artifacts and validates consumer envelopes", () => {
    const schema = getMachinesConsumerSchemaBundle();
    expect(schema).toEqual(MACHINES_CONSUMER_SCHEMA_BUNDLE);
    expect(schema.$id).toBe(MACHINES_CONSUMER_CONTRACT.schema_uri);
    expect(Object.keys(schema.$defs)).toEqual(expect.arrayContaining([
      "contract",
      "topology",
      "route",
      "workspace",
      "compatibility",
      "resolver_snapshot",
      "cacheability",
      "project_assignments",
      "note_machine_context",
      "machine_trash_policies",
      "note_machine_reference",
      "note_actor_context",
      "machine_trash_policy",
      "machine_details",
    ]));

    const artifact = JSON.parse(readFileSync(resolve(import.meta.dir, "..", MACHINES_CONSUMER_CONTRACT.schema_artifact), "utf8"));
    expect(artifact).toEqual(schema);
    expect(validateMachinesConsumerEnvelope("contract", MACHINES_CONSUMER_CONTRACT)).toMatchObject({ ok: true, errors: [] });
  });

  test("builds cacheable route/workspace snapshots for app-owned registries", () => {
    const now = new Date("2026-06-09T00:00:00.000Z");
    const topology: MachineTopology = {
      schema_version: 1,
      package: { name: "@hasna/machines", version: "0.0.0-test" },
      capabilities: getMachinesConsumerCapabilities(),
      generated_at: now.toISOString(),
      local_machine_id: "demo-node-02",
      local_hostname: "demo-node-02",
      current_platform: "linux",
      manifest_path_known: true,
      pagination: {
        limit: 10,
        offset: 0,
        total: 1,
        count: 1,
        hasMore: false,
        nextOffset: null,
        has_more: false,
        next_offset: null,
        order: "updated_at_desc",
      },
      warnings: [],
      machines: [{
        machine_id: "demo-node-01",
        friendly_name: "Studio Linux",
        display_name: "Studio Linux",
        updated_at: "2026-06-09T00:00:00.000Z",
        hostname: "demo-node-01",
        platform: "linux",
        os: "linux",
        user: "operator",
        workspace_path: "/home/operator/workspace",
        manifest_declared: true,
        heartbeat_status: "unknown",
        last_heartbeat_at: null,
        tailscale: {
          dns_name: "demo-node-01.tailnet.ts.net",
          ips: ["203.0.113.34"],
          online: true,
          active: true,
          last_seen: null,
        },
        ssh: {
          address: "operator@demo-node-01",
          route: "tailscale",
          command_target: "operator@demo-node-01.tailnet.ts.net",
        },
        route_hints: [{ kind: "tailscale", target: "demo-node-01.tailnet.ts.net", reachable: true }],
        tags: ["trusted"],
        metadata: {
          auth_status: "authenticated",
          workspace_paths: {
            "open-knowledge": "/srv/open-knowledge",
          },
          open_files_roots: {
            "open-knowledge": "/srv/open-files",
          },
        },
      }],
    };

    const route = resolveMachineRoute("demo-node-01", { topology, now });
    const workspace = resolveMachineWorkspace({
      machineId: "demo-node-01",
      projectId: "open-knowledge",
      repoName: "open-knowledge",
      topology,
      now,
    });
    const snapshot = createMachineResolverSnapshot({ route, workspace, now });

    expect(route.cacheability).toMatchObject({
      cacheable: true,
      source_authority: "live_topology",
      stale: false,
    });
    expect(workspace.cacheability).toMatchObject({
      cacheable: true,
      source_authority: "manifest_metadata",
      stale: false,
    });
    expect(snapshot.cacheability).toMatchObject({
      cacheable: true,
      source_authority: "mixed",
      stale: false,
    });
    expect(snapshot.provenance.route.evidence.selected_hint_kind).toBe("tailscale");
    expect(snapshot.provenance.workspace?.metadata_keys).not.toContain("api_token");
    expect(validateMachinesConsumerEnvelope("route", route)).toMatchObject({ ok: true, errors: [] });
    expect(validateMachinesConsumerEnvelope("workspace", workspace)).toMatchObject({ ok: true, errors: [] });
    expect(validateMachinesConsumerEnvelope("resolver_snapshot", snapshot)).toMatchObject({ ok: true, errors: [] });
  });
});
