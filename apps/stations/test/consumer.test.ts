import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STATIONS_CONSUMER_SCHEMA_BUNDLE,
  STATIONS_CONSUMER_CAPABILITIES,
  STATIONS_CONSUMER_CONTRACT,
  STATIONS_CONSUMER_ENTRYPOINT,
  STATIONS_CONSUMER_CONTRACT_VERSION,
  createMachineResolverSnapshot,
  checkMachineCompatibility,
  discoverMachineTopology,
  getCommandMatrix,
  getBrowserPlanFleet,
  getFleetLoopPreflight,
  getFleetMachineHealth,
  getFleetRouting,
  getStationsConsumerCapabilities,
  getStationsConsumerSchemaBundle,
  getMachineDetails,
  listMachineProjectAssignments,
  listMachineTrashPolicies,
  resolveNoteMachineContext,
  resolveMachineRoute,
  resolveMachineWorkspace,
  normalizeBrowserPlanMachineId,
  validateStationsConsumerEnvelope,
  type MachineTopology,
} from "../src/consumer.js";

describe("stations consumer SDK", () => {
  test("exports lightweight consumer contracts", () => {
    expect(STATIONS_CONSUMER_CONTRACT_VERSION).toBe(1);
    expect(STATIONS_CONSUMER_ENTRYPOINT).toBe("@hasna/stations/consumer");
    expect(STATIONS_CONSUMER_CAPABILITIES.workspace_path_mapping).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.workspace_diagnostics).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.friendly_machine_names).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.machine_list_pagination).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.note_machine_context).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.machine_trash_policies).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.machine_details).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.browserplan_fleet).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.machine_health).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.fleet_routing).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.command_matrix).toBe(true);
    expect(STATIONS_CONSUMER_CAPABILITIES.loop_preflight).toBe(true);
    expect(getStationsConsumerCapabilities()).toEqual(STATIONS_CONSUMER_CAPABILITIES);
    expect(STATIONS_CONSUMER_CONTRACT).toMatchObject({
      schema_version: 1,
      package_name: "@hasna/stations",
      entrypoint: "@hasna/stations/consumer",
      schema_artifact: "schemas/stations-consumer.schema.json",
      envelopes: ["topology", "route", "workspace", "compatibility", "resolver_snapshot", "project_assignments", "note_machine_context", "machine_trash_policies", "machine_details", "browserplan_fleet", "machine_health", "routing", "command_matrix", "loop_preflight"],
    });
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("resolveMachineWorkspace");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("createMachineResolverSnapshot");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("listMachineProjectAssignments");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("resolveNoteMachineContext");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("listMachineTrashPolicies");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("getMachineDetails");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("getBrowserPlanFleet");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("getFleetMachineHealth");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("getFleetRouting");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("getCommandMatrix");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("getFleetLoopPreflight");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("normalizeBrowserPlanMachineId");
    expect(STATIONS_CONSUMER_CONTRACT.stable_exports).toContain("validateStationsConsumerEnvelope");
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.workspace.trust_auth).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.topology.display_name_fallback).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.topology.pagination).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.project_assignments.open_projects_compatibility).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.note_machine_context.actor_context).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.machine_trash_policies.retention_metadata).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.machine_details.safe_display_metadata).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.browserplan_fleet.machine001_machine011_target).toBe(true);
    expect(STATIONS_CONSUMER_CONTRACT.field_capabilities.agent_abstractions.compact_json_defaults).toBe(true);
    expect(typeof discoverMachineTopology).toBe("function");
    expect(typeof checkMachineCompatibility).toBe("function");
    expect(typeof resolveMachineRoute).toBe("function");
    expect(typeof resolveMachineWorkspace).toBe("function");
    expect(typeof createMachineResolverSnapshot).toBe("function");
    expect(typeof listMachineProjectAssignments).toBe("function");
    expect(typeof resolveNoteMachineContext).toBe("function");
    expect(typeof listMachineTrashPolicies).toBe("function");
    expect(typeof getMachineDetails).toBe("function");
    expect(typeof getBrowserPlanFleet).toBe("function");
    expect(typeof getFleetMachineHealth).toBe("function");
    expect(typeof getFleetRouting).toBe("function");
    expect(typeof getCommandMatrix).toBe("function");
    expect(typeof getFleetLoopPreflight).toBe("function");
    expect(normalizeBrowserPlanMachineId("Machine2")).toBe("machine002");
  });

  test("exports schema artifacts and validates consumer envelopes", () => {
    const schema = getStationsConsumerSchemaBundle();
    expect(schema).toEqual(STATIONS_CONSUMER_SCHEMA_BUNDLE);
    expect(schema.$id).toBe(STATIONS_CONSUMER_CONTRACT.schema_uri);
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
      "browserplan_fleet",
      "machine_health",
      "routing",
      "command_matrix",
      "loop_preflight",
    ]));

    // The checked-in artifact is generated by `bun run schema:generate`, never hand-edited.
    // Byte identity (not just deep equality) keeps that script idempotent, so a regenerate
    // never shows up as diff noise in an unrelated PR.
    const artifactText = readFileSync(resolve(import.meta.dir, "..", STATIONS_CONSUMER_CONTRACT.schema_artifact), "utf8");
    expect(JSON.parse(artifactText)).toEqual(schema);
    expect(artifactText).toBe(`${JSON.stringify(STATIONS_CONSUMER_SCHEMA_BUNDLE, null, 2)}\n`);
    expect(validateStationsConsumerEnvelope("contract", STATIONS_CONSUMER_CONTRACT)).toMatchObject({ ok: true, errors: [] });
  });

  test("builds cacheable route/workspace snapshots for app-owned registries", () => {
    const now = new Date("2026-06-09T00:00:00.000Z");
    const topology: MachineTopology = {
      schema_version: 1,
      package: { name: "@hasna/stations", version: "0.0.0-test" },
      capabilities: getStationsConsumerCapabilities(),
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
      stations: [{
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
            "knowledge": "/srv/knowledge",
          },
          open_files_roots: {
            "knowledge": "/srv/open-files",
          },
        },
      }],
    };

    const route = resolveMachineRoute("demo-node-01", { topology, now });
    const workspace = resolveMachineWorkspace({
      machineId: "demo-node-01",
      projectId: "knowledge",
      repoName: "knowledge",
      topology,
      now,
    });
    const snapshot = createMachineResolverSnapshot({ route, workspace, now });
    const browserPlanFleet = getBrowserPlanFleet({ topology, now });

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
    expect(validateStationsConsumerEnvelope("route", route)).toMatchObject({ ok: true, errors: [] });
    expect(validateStationsConsumerEnvelope("workspace", workspace)).toMatchObject({ ok: true, errors: [] });
    expect(validateStationsConsumerEnvelope("resolver_snapshot", snapshot)).toMatchObject({ ok: true, errors: [] });
    expect(validateStationsConsumerEnvelope("browserplan_fleet", browserPlanFleet)).toMatchObject({ ok: true, errors: [] });
  });

  test("v1 identity literals use the stations wire literal, accepting legacy open-stations on read (release-review P1#1)", () => {
    const now = new Date("2026-06-09T00:00:00.000Z");
    const topology: MachineTopology = {
      schema_version: 1,
      package: { name: "@hasna/stations", version: "0.0.0-test" },
      capabilities: getStationsConsumerCapabilities(),
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
      stations: [{
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
            "knowledge": "/srv/knowledge",
          },
          open_files_roots: {
            "knowledge": "/srv/open-files",
          },
        },
        agent: {
          pid: null,
          daemon_version: null,
          mode: null,
          private_metadata: false,
          platform: null,
          os_version: null,
          os_build: null,
          arch: null,
          uptime_seconds: null,
          tool_versions: null,
          tailscale: null,
          storage_sync_status: null,
          storage_sync_last_error: null,
          doctor_summary: null,
        },
      }],
    };

    const details = getMachineDetails("demo-node-01", { topology, now });
    const browserPlanFleet = getBrowserPlanFleet({ topology, now });

    // Canonical v1 literals validate.
    expect(validateStationsConsumerEnvelope("machine_details", details)).toMatchObject({ ok: true, errors: [] });
    expect(validateStationsConsumerEnvelope("browserplan_fleet", browserPlanFleet)).toMatchObject({ ok: true, errors: [] });

    // Legacy v1 literals ("open-stations") must still validate on read: the
    // rename made "stations" the canonical wire literal, and the renamed
    // contract accepts "open-stations" as the legacy stored value (validator
    // and source_authority enum accept both).
    const legacyDetails = structuredClone(details);
    legacyDetails.source.authority = "open-stations";
    expect(validateStationsConsumerEnvelope("machine_details", legacyDetails)).toMatchObject({ ok: true, errors: [] });

    const legacyFleet = structuredClone(browserPlanFleet);
    legacyFleet.operation_contract.route_owner = "open-stations";
    // route_owner is strict under the renamed contract (const "stations"): the
    // legacy value must be REJECTED, unlike authority which stays read-lenient.
    expect(validateStationsConsumerEnvelope("browserplan_fleet", legacyFleet)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining(["operation_contract.route_owner"]),
    });

    // The shipped schema artifact mirrors the const wire literal.
    const schema = STATIONS_CONSUMER_SCHEMA_BUNDLE;
    const sourceSchema = JSON.stringify(schema);
    expect(sourceSchema).toContain('"authority":{"const":"stations"}');
    expect(sourceSchema).toContain('"route_owner":{"const":"stations"}');
  });
});
