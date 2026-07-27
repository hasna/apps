import {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_CONSUMER_SCHEMA_URI,
  type MachineResolverSnapshot,
  type MachineRouteResolution,
  type MachineTopology,
  type MachineWorkspaceResolution,
} from "./topology.js";
import type { MachineCompatibilityReport } from "./compatibility.js";
import type { MachineProjectAssignments } from "./projects.js";
import type { MachineTrashPolicies, NoteMachineContext } from "./notes.js";
import type { MachineDetails } from "./details.js";
import type {
  CommandMatrixReport,
  FleetLoopPreflightReport,
  FleetRoutingReport,
  MachineHealthReport,
} from "./agent-abstractions.js";
import {
  BROWSERPLAN_APP_ID,
  BROWSERPLAN_EXCLUDED_MACHINE_IDS,
  BROWSERPLAN_INSTALL_VERSION_PLACEHOLDER,
  BROWSERPLAN_MACHINE_IDS,
  BROWSERPLAN_ROUTE_OWNER,
  BROWSERPLAN_SECRETS_OWNER,
  BROWSERPLAN_TARGET_NAME,
  type BrowserPlanFleet,
} from "./browserplan.js";

export type MachinesConsumerSchemaEnvelope =
  | "contract"
  | "topology"
  | "route"
  | "workspace"
  | "compatibility"
  | "resolver_snapshot"
  | "project_assignments"
  | "note_machine_context"
  | "machine_trash_policies"
  | "machine_details"
  | "browserplan_fleet"
  | "machine_health"
  | "routing"
  | "command_matrix"
  | "loop_preflight";

export interface MachinesConsumerValidationResult {
  ok: boolean;
  envelope: MachinesConsumerSchemaEnvelope;
  schema_id: typeof MACHINES_CONSUMER_SCHEMA_URI;
  errors: string[];
}

export interface MachinesConsumerSchemaBundle {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  $id: typeof MACHINES_CONSUMER_SCHEMA_URI;
  title: string;
  type: "object";
  $defs: Record<string, unknown>;
}

const BROWSERPLAN_OPERATION_IDS = [
  "profile_setup",
  "headed_launch",
  "headless_launch",
  "daemon_status",
  "supervisor_status",
  "tab_inventory",
  "session_inventory",
  "app_install_update",
] as const;
const BROWSERPLAN_STABLE_SURFACES = {
  sdk: "getBrowserPlanFleet",
  cli: "machines browserplan fleet --json",
  api: "/api/browserplan/fleet",
  mcp: "machines_browserplan_fleet",
} as const;
const BROWSERPLAN_PRIVATE_ROUTE_POLICY = "private targets are omitted unless caller explicitly requests private metadata on a trusted local operator surface";

export const MACHINES_CONSUMER_SCHEMA_BUNDLE: MachinesConsumerSchemaBundle = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: MACHINES_CONSUMER_SCHEMA_URI,
  title: "@hasna/machines consumer contract schema bundle",
  type: "object",
  $defs: {
    cacheability: {
      type: "object",
      required: ["observed_at", "verified_at", "expires_at", "ttl_ms", "source_authority", "confidence", "cacheable", "stale", "reasons"],
      properties: {
        observed_at: { type: "string", format: "date-time" },
        verified_at: { type: ["string", "null"], format: "date-time" },
        expires_at: { type: ["string", "null"], format: "date-time" },
        ttl_ms: { type: ["number", "null"] },
        source_authority: { enum: ["open-machines", "manifest", "manifest_metadata", "live_topology", "argument", "inferred", "fallback", "unresolved", "mixed", "unknown"] },
        confidence: { enum: ["exact", "high", "medium", "low", "none"] },
        cacheable: { type: "boolean" },
        stale: { type: "boolean" },
        reasons: { type: "array", items: { type: "string" } },
      },
    },
    contract: {
      type: "object",
      required: ["schema_version", "package_name", "entrypoint", "schema_uri", "schema_artifact", "capabilities", "field_capabilities", "cacheability", "envelopes", "stable_exports"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package_name: { const: "@hasna/machines" },
        entrypoint: { const: "@hasna/machines/consumer" },
        schema_uri: { const: MACHINES_CONSUMER_SCHEMA_URI },
        schema_artifact: { const: "schemas/machines-consumer.schema.json" },
        capabilities: { type: "object" },
        field_capabilities: { type: "object" },
        cacheability: { type: "object" },
        envelopes: { type: "array", items: { enum: ["topology", "route", "workspace", "compatibility", "resolver_snapshot", "project_assignments", "note_machine_context", "machine_trash_policies", "machine_details", "browserplan_fleet", "machine_health", "routing", "command_matrix", "loop_preflight"] } },
        stable_exports: { type: "array", items: { type: "string" } },
      },
    },
    agent_artifact_ref: {
      type: "object",
      required: ["kind", "ref", "format", "private"],
      properties: {
        kind: { enum: ["topology", "route", "workspace", "compatibility", "doctor", "command_matrix", "machine_health"] },
        ref: { type: "string" },
        format: { enum: ["json", "text"] },
        private: { type: "boolean" },
      },
    },
    agent_detail_refs: {
      type: "object",
      required: ["cli", "mcp", "sdk"],
      properties: {
        cli: { type: "string" },
        mcp: { type: "string" },
        sdk: { type: "string" },
      },
    },
    agent_summary: {
      type: "object",
      required: ["total", "ready", "degraded", "blocked", "unknown"],
      properties: {
        total: { type: "number" },
        ready: { type: "number" },
        degraded: { type: "number" },
        blocked: { type: "number" },
        unknown: { type: "number" },
      },
    },
    agent_command_ref: {
      type: "object",
      required: ["provided", "preview", "sha256", "length", "redacted"],
      properties: {
        provided: { type: "boolean" },
        preview: { type: "string" },
        sha256: { type: ["string", "null"] },
        length: { type: "number" },
        redacted: { type: "boolean" },
      },
    },
    command_matrix_plan: {
      type: "object",
      required: ["intent", "label", "placeholder", "command_ref", "local_shell", "cli", "mcp", "sdk", "private_shell_command"],
      properties: {
        intent: { enum: ["placeholder", "provided"] },
        label: { type: "string" },
        placeholder: { const: "<loop-command>" },
        command_ref: { "$ref": "#/$defs/agent_command_ref" },
        local_shell: { type: ["string", "null"] },
        cli: { type: "string" },
        mcp: {
          type: "object",
          required: ["tool", "args"],
          properties: {
            tool: { const: "machines_ssh_resolve" },
            args: {
              type: "object",
              required: ["machine_id", "remote_command", "private_metadata"],
              properties: {
                machine_id: { type: "string" },
                remote_command: { type: "string" },
                private_metadata: { const: false },
              },
            },
          },
        },
        sdk: { type: "string" },
        private_shell_command: { type: ["string", "null"] },
      },
    },
    machine_health_row: {
      type: "object",
      required: ["machine_id", "display_name", "status", "ok", "route", "confidence", "local", "heartbeat", "checks", "issues", "warnings", "detail_refs"],
      properties: {
        machine_id: { type: "string" },
        display_name: { type: "string" },
        status: { enum: ["ready", "degraded", "blocked", "unknown"] },
        ok: { type: "boolean" },
        route: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        confidence: { enum: ["exact", "high", "medium", "low", "none"] },
        local: { type: "boolean" },
        heartbeat: { type: "string" },
        checks: { type: "object" },
        issues: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
        detail_refs: { "$ref": "#/$defs/agent_detail_refs" },
      },
    },
    routing_row: {
      type: "object",
      required: ["machine_id", "display_name", "ok", "route", "source", "confidence", "local", "heartbeat", "cacheable", "target", "command_target", "warnings", "detail_refs"],
      properties: {
        machine_id: { type: "string" },
        display_name: { type: "string" },
        ok: { type: "boolean" },
        route: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        source: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        confidence: { enum: ["exact", "high", "medium", "low", "none"] },
        local: { type: "boolean" },
        heartbeat: { type: "string" },
        cacheable: { type: "boolean" },
        target: { type: ["string", "null"] },
        command_target: { type: ["string", "null"] },
        warnings: { type: "array", items: { type: "string" } },
        detail_refs: { "$ref": "#/$defs/agent_detail_refs" },
      },
    },
    command_matrix_row: {
      type: "object",
      required: ["machine_id", "display_name", "can_run", "readiness", "route", "source", "confidence", "local", "command", "blocked_by", "warnings", "detail_refs"],
      properties: {
        machine_id: { type: "string" },
        display_name: { type: "string" },
        can_run: { type: "boolean" },
        readiness: { enum: ["ready", "degraded", "blocked", "unknown"] },
        route: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        source: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        confidence: { enum: ["exact", "high", "medium", "low", "none"] },
        local: { type: "boolean" },
        command: { "$ref": "#/$defs/command_matrix_plan" },
        blocked_by: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
        detail_refs: { "$ref": "#/$defs/agent_detail_refs" },
      },
    },
    loop_preflight_machine: {
      type: "object",
      required: ["machine_id", "display_name", "ready", "status", "can_run", "route", "confidence", "local", "heartbeat", "blocked_by", "warnings", "next_steps", "detail_refs"],
      properties: {
        machine_id: { type: "string" },
        display_name: { type: "string" },
        ready: { type: "boolean" },
        status: { enum: ["ready", "degraded", "blocked", "unknown"] },
        can_run: { type: "boolean" },
        route: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        confidence: { enum: ["exact", "high", "medium", "low", "none"] },
        local: { type: "boolean" },
        heartbeat: { type: "string" },
        blocked_by: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
        next_steps: { type: "array", items: { type: "string" } },
        detail_refs: { "$ref": "#/$defs/agent_detail_refs" },
      },
    },
    machine_health: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "kind", "pagination", "summary", "machines", "artifacts", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        kind: { const: "machine_health" },
        pagination: { type: "object" },
        summary: { "$ref": "#/$defs/agent_summary" },
        machines: { type: "array", items: { "$ref": "#/$defs/machine_health_row" } },
        artifacts: { type: "array", items: { "$ref": "#/$defs/agent_artifact_ref" } },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    routing: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "kind", "pagination", "summary", "routes", "artifacts", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        kind: { const: "routing" },
        pagination: { type: "object" },
        summary: {
          type: "object",
          required: ["total", "routable", "local", "remote", "unroutable"],
          properties: {
            total: { type: "number" },
            routable: { type: "number" },
            local: { type: "number" },
            remote: { type: "number" },
            unroutable: { type: "number" },
          },
        },
        routes: { type: "array", items: { "$ref": "#/$defs/routing_row" } },
        artifacts: { type: "array", items: { "$ref": "#/$defs/agent_artifact_ref" } },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    command_matrix: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "kind", "mode", "pagination", "summary", "commands", "artifacts", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        kind: { const: "command_matrix" },
        mode: { const: "plan" },
        pagination: { type: "object" },
        summary: {
          type: "object",
          required: ["total", "runnable", "blocked", "local", "remote"],
          properties: {
            total: { type: "number" },
            runnable: { type: "number" },
            blocked: { type: "number" },
            local: { type: "number" },
            remote: { type: "number" },
          },
        },
        commands: { type: "array", items: { "$ref": "#/$defs/command_matrix_row" } },
        artifacts: { type: "array", items: { "$ref": "#/$defs/agent_artifact_ref" } },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    loop_preflight: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "kind", "mode", "selection_mode", "ok", "pagination", "summary", "machines", "artifacts", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        kind: { const: "loop_preflight" },
        mode: { const: "plan" },
        selection_mode: { enum: ["explicit", "discovered"] },
        ok: { type: "boolean" },
        pagination: { type: "object" },
        summary: {
          type: "object",
          required: ["total", "ready", "degraded", "blocked", "unknown", "runnable", "any_ready", "all_ready"],
          properties: {
            total: { type: "number" },
            ready: { type: "number" },
            degraded: { type: "number" },
            blocked: { type: "number" },
            unknown: { type: "number" },
            runnable: { type: "number" },
            any_ready: { type: "boolean" },
            all_ready: { type: "boolean" },
          },
        },
        machines: { type: "array", items: { "$ref": "#/$defs/loop_preflight_machine" } },
        artifacts: { type: "array", items: { "$ref": "#/$defs/agent_artifact_ref" } },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    browserplan_fleet: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "kind", "target", "coverage", "operation_contract", "machines", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        kind: { const: "browserplan_fleet" },
        target: {
          type: "object",
          required: ["name", "owner", "machine_ids", "excluded_machine_ids", "install_target_excludes"],
          properties: {
            name: { const: BROWSERPLAN_TARGET_NAME },
            owner: { const: BROWSERPLAN_APP_ID },
            machine_ids: { const: [...BROWSERPLAN_MACHINE_IDS] },
            excluded_machine_ids: { const: [...BROWSERPLAN_EXCLUDED_MACHINE_IDS] },
            install_target_excludes: { const: [...BROWSERPLAN_EXCLUDED_MACHINE_IDS] },
          },
        },
        coverage: {
          type: "object",
          required: ["expected", "returned", "known", "missing", "unreachable", "excluded_requested"],
          properties: {
            expected: { type: "number" },
            returned: { type: "number" },
            known: { type: "number" },
            missing: { type: "array", items: { enum: [...BROWSERPLAN_MACHINE_IDS] } },
            unreachable: { type: "array", items: { enum: [...BROWSERPLAN_MACHINE_IDS] } },
            excluded_requested: { type: "array", items: { enum: [...BROWSERPLAN_EXCLUDED_MACHINE_IDS] } },
          },
        },
        operation_contract: {
          type: "object",
          required: ["command_owner", "route_owner", "default_timeout_ms", "private_route_policy", "supported_operations", "stable_surfaces"],
          properties: {
            command_owner: { const: BROWSERPLAN_APP_ID },
            route_owner: { const: BROWSERPLAN_ROUTE_OWNER },
            default_timeout_ms: { type: "number" },
            private_route_policy: { const: BROWSERPLAN_PRIVATE_ROUTE_POLICY },
            supported_operations: { const: [...BROWSERPLAN_OPERATION_IDS] },
            stable_surfaces: {
              type: "object",
              required: ["sdk", "cli", "api", "mcp"],
              properties: {
                sdk: { const: BROWSERPLAN_STABLE_SURFACES.sdk },
                cli: { const: BROWSERPLAN_STABLE_SURFACES.cli },
                api: { const: BROWSERPLAN_STABLE_SURFACES.api },
                mcp: { const: BROWSERPLAN_STABLE_SURFACES.mcp },
              },
            },
          },
        },
        machines: {
          type: "array",
          items: {
            type: "object",
            required: ["machine_id", "slug", "display_name", "displayName", "known", "eligible", "status", "reachability", "install_state", "operation_hooks", "warnings"],
            properties: {
              machine_id: { enum: [...BROWSERPLAN_MACHINE_IDS] },
              slug: { enum: [...BROWSERPLAN_MACHINE_IDS] },
              friendly_name: { type: ["string", "null"] },
              friendlyName: { type: ["string", "null"] },
              display_name: { type: "string" },
              displayName: { type: "string" },
              known: { type: "boolean" },
              eligible: { type: "boolean" },
              eligibility_reasons: { type: "array", items: { type: "string" } },
              platform: { type: ["string", "null"] },
              os: { type: ["string", "null"] },
              user: { type: ["string", "null"] },
              workspace: { type: "object" },
              tags: { type: "array", items: { type: "string" } },
              updated_at: { type: ["string", "null"] },
              status: {
                type: "object",
                required: ["state", "label", "online"],
                properties: {
                  state: { enum: ["online", "offline", "unknown"] },
                  label: { enum: ["Online", "Offline", "Unknown"] },
                  online: { type: ["boolean", "null"] },
                },
              },
              reachability: {
                type: "object",
                required: ["ok", "route", "source", "confidence", "local", "tailscale_online", "cacheable", "warnings"],
                properties: {
                  ok: { type: "boolean" },
                  route: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
                  source: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
                  confidence: { enum: ["exact", "high", "medium", "low", "none"] },
                  local: { type: "boolean" },
                  tailscale_online: { type: ["boolean", "null"] },
                  cacheable: { type: "boolean" },
                  warnings: { type: "array", items: { type: "string" } },
                },
              },
              install_state: {
                type: "object",
                required: ["checked", "source", "browserplan_cli", "machines_cli", "bun", "git", "node", "chrome", "warnings"],
                properties: {
                  checked: { type: "boolean" },
                  source: { enum: ["compatibility", "not_checked", "failed"] },
                  warnings: { type: "array", items: { type: "string" } },
                },
              },
              operation_hooks: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "label", "description", "owner", "available", "readiness", "required_capabilities", "blocked_by", "command_template", "command_placeholders", "safe_runner"],
                  properties: {
                    id: { enum: [...BROWSERPLAN_OPERATION_IDS] },
                    owner: { const: BROWSERPLAN_APP_ID },
                    available: { type: "boolean" },
                    readiness: { enum: ["ready", "blocked", "unknown"] },
                    required_capabilities: { type: "array", items: { type: "string" } },
                    blocked_by: { type: "array", items: { type: "string" } },
                    command_template: { type: "string" },
                    command_placeholders: { type: "array", items: { type: "string" } },
                    safe_runner: {
                      type: "object",
                      required: ["sdk", "cli", "mcp", "ownership"],
                      properties: {
                        mcp: {
                          type: "object",
                          required: ["tool", "args", "private_metadata_note"],
                          properties: {
                            tool: { const: "machines_ssh_resolve" },
                            args: {
                              type: "object",
                              required: ["machine_id", "remote_command", "private_metadata"],
                              properties: {
                                machine_id: { enum: [...BROWSERPLAN_MACHINE_IDS] },
                                remote_command: { const: "<browserplan-owned command>" },
                                private_metadata: { const: false },
                              },
                            },
                            private_metadata_note: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
              warnings: { type: "array", items: { type: "string" } },
            },
          },
        },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    machine_details: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "machine_id", "slug", "display_name", "displayName", "known", "status", "timestamps", "source", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        machine_id: { type: "string" },
        slug: { type: "string" },
        friendly_name: { type: "string" },
        friendlyName: { type: "string" },
        display_name: { type: "string" },
        displayName: { type: "string" },
        known: { type: "boolean" },
        status: {
          type: "object",
          required: ["state", "label", "online"],
          properties: {
            state: { enum: ["online", "offline", "unknown"] },
            label: { enum: ["Online", "Offline", "Unknown"] },
            online: { type: ["boolean", "null"] },
            last_seen_at: { type: "string", format: "date-time" },
            last_heartbeat_at: { type: "string", format: "date-time" },
          },
        },
        platform: { type: "string" },
        machine_type: { type: "string" },
        role: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        machine_capabilities: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        updated_at: { type: "string", format: "date-time" },
        last_seen_at: { type: "string", format: "date-time" },
        timestamps: {
          type: "object",
          properties: {
            updated_at: { type: "string", format: "date-time" },
            last_seen_at: { type: "string", format: "date-time" },
            last_heartbeat_at: { type: "string", format: "date-time" },
            last_tailscale_seen_at: { type: "string", format: "date-time" },
            recent_sync_at: { type: "string", format: "date-time" },
            recent_sync_status: { type: "string" },
            storage_sync_status: { type: "string" },
          },
        },
        source: {
          type: "object",
          required: ["authority", "metadata_source", "manifest_declared", "heartbeat_present", "topology_entry", "local"],
          properties: {
            authority: { const: "open-machines" },
            metadata_source: { enum: ["manifest_metadata", "heartbeat", "topology", "fallback"] },
            manifest_declared: { type: "boolean" },
            heartbeat_present: { type: "boolean" },
            topology_entry: { type: "boolean" },
            local: { type: "boolean" },
          },
        },
        display_metadata: {
          type: "object",
          additionalProperties: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "array", items: { type: "string" } },
            ],
          },
        },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    note_machine_reference: {
      type: "object",
      required: ["machine_id", "friendly_name", "display_name", "updated_at", "role", "known", "manifest_declared"],
      properties: {
        machine_id: { type: "string" },
        friendly_name: { type: ["string", "null"] },
        display_name: { type: "string" },
        updated_at: { type: ["string", "null"], format: "date-time" },
        role: { enum: ["origin", "source", "target", "sync_target", "trash_owner"] },
        known: { type: "boolean" },
        manifest_declared: { type: "boolean" },
      },
    },
    note_actor_context: {
      type: "object",
      required: ["actor_type", "actor_id", "actor_name", "agent_id", "agent_name", "source", "display_name"],
      properties: {
        actor_type: { enum: ["human", "agent", "system", "unknown"] },
        actor_id: { type: ["string", "null"] },
        actor_name: { type: ["string", "null"] },
        agent_id: { type: ["string", "null"] },
        agent_name: { type: ["string", "null"] },
        source: { enum: ["open-notes", "agent", "sync", "import", "open-machines", "unknown"] },
        display_name: { type: "string" },
      },
    },
    note_machine_context: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "origin_machine_id", "source_machine_id", "target_machine_id", "origin_machine", "source_machine", "target_machine", "sync_target_machine_ids", "sync_targets", "actor", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        origin_machine_id: { type: ["string", "null"] },
        source_machine_id: { type: ["string", "null"] },
        target_machine_id: { type: ["string", "null"] },
        origin_machine: { anyOf: [{ $ref: "#/$defs/note_machine_reference" }, { type: "null" }] },
        source_machine: { anyOf: [{ $ref: "#/$defs/note_machine_reference" }, { type: "null" }] },
        target_machine: { anyOf: [{ $ref: "#/$defs/note_machine_reference" }, { type: "null" }] },
        sync_target_machine_ids: { type: "array", items: { type: "string" } },
        sync_targets: {
          type: "array",
          items: {
            type: "object",
            required: ["machine_id", "machine"],
            properties: {
              machine_id: { type: "string" },
              machine: { $ref: "#/$defs/note_machine_reference" },
            },
          },
        },
        actor: { $ref: "#/$defs/note_actor_context" },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    machine_trash_policy: {
      type: "object",
      required: ["machine_id", "friendly_name", "display_name", "updated_at", "enabled", "retention_days", "delete_after_days", "trash_path", "source", "metadata_keys"],
      properties: {
        machine_id: { type: "string" },
        friendly_name: { type: ["string", "null"] },
        display_name: { type: "string" },
        updated_at: { type: ["string", "null"], format: "date-time" },
        enabled: { type: ["boolean", "null"] },
        retention_days: { type: ["number", "null"] },
        delete_after_days: { type: ["number", "null"] },
        trash_path: { type: ["string", "null"] },
        source: { enum: ["manifest_metadata", "default"] },
        metadata_keys: { type: "array", items: { type: "string" } },
      },
    },
    machine_trash_policies: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "pagination", "policies", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        pagination: {
          type: "object",
          required: ["limit", "offset", "total", "count", "hasMore", "nextOffset", "has_more", "next_offset", "order"],
          properties: {
            limit: { type: ["number", "null"] },
            offset: { type: "number" },
            total: { type: "number" },
            count: { type: "number" },
            hasMore: { type: "boolean" },
            nextOffset: { type: ["number", "null"] },
            has_more: { type: "boolean" },
            next_offset: { type: ["number", "null"] },
            order: { const: "updated_at_desc" },
          },
        },
        policies: { type: "array", items: { $ref: "#/$defs/machine_trash_policy" } },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    topology: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "generated_at", "local_machine_id", "pagination", "machines", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        local_machine_id: { type: "string" },
        pagination: {
          type: "object",
          required: ["limit", "offset", "total", "count", "hasMore", "nextOffset", "has_more", "next_offset", "order"],
          properties: {
            limit: { type: ["number", "null"] },
            offset: { type: "number" },
            total: { type: "number" },
            count: { type: "number" },
            hasMore: { type: "boolean" },
            nextOffset: { type: ["number", "null"] },
            has_more: { type: "boolean" },
            next_offset: { type: ["number", "null"] },
            order: { const: "updated_at_desc" },
          },
        },
        machines: {
          type: "array",
          items: {
            type: "object",
            required: ["machine_id", "friendly_name", "display_name", "updated_at"],
            properties: {
              machine_id: { type: "string" },
              friendly_name: { type: ["string", "null"] },
              display_name: { type: "string" },
              updated_at: { type: ["string", "null"], format: "date-time" },
            },
          },
        },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    route: {
      type: "object",
      required: ["schema_version", "package", "ok", "machine_id", "requested_machine_id", "generated_at", "route", "source", "target", "command_target", "confidence", "local", "evidence", "cacheability", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        ok: { type: "boolean" },
        machine_id: { type: ["string", "null"] },
        requested_machine_id: { type: "string" },
        generated_at: { type: "string", format: "date-time" },
        route: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        source: { enum: ["local", "lan", "tailscale", "ssh", "unknown"] },
        target: { type: ["string", "null"] },
        command_target: { type: ["string", "null"] },
        confidence: { enum: ["exact", "high", "medium", "low", "none"] },
        local: { type: "boolean" },
        evidence: { type: "object" },
        cacheability: { $ref: "#/$defs/cacheability" },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    workspace: {
      type: "object",
      required: ["schema_version", "package", "ok", "requested_machine_id", "machine_id", "generated_at", "project", "machine", "paths", "diagnostics", "repair_hints", "evidence", "cacheability", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        ok: { type: "boolean" },
        requested_machine_id: { type: "string" },
        machine_id: { type: ["string", "null"] },
        generated_at: { type: "string", format: "date-time" },
        project: { type: "object" },
        machine: {
          type: "object",
          required: ["current", "primary", "trust_status", "auth_status"],
          properties: {
            current: { type: "boolean" },
            primary: { type: "boolean" },
            trust_status: { enum: ["trusted", "untrusted", "unknown"] },
            auth_status: { enum: ["authenticated", "unauthenticated", "unknown"] },
          },
        },
        paths: { type: "object" },
        diagnostics: { type: "array" },
        repair_hints: { type: "array" },
        evidence: { type: "object" },
        cacheability: { $ref: "#/$defs/cacheability" },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    compatibility: {
      type: "object",
      required: ["schema_version", "package", "capabilities", "ok", "machine_id", "source", "generated_at", "checks", "summary"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        capabilities: { type: "object" },
        ok: { type: "boolean" },
        machine_id: { type: "string" },
        source: { type: "string" },
        generated_at: { type: "string", format: "date-time" },
        checks: { type: "array" },
        summary: { type: "object" },
      },
    },
    resolver_snapshot: {
      type: "object",
      required: ["schema_version", "package", "generated_at", "requested_machine_id", "machine_id", "route", "workspace", "cacheability", "warnings", "provenance"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        requested_machine_id: { type: "string" },
        machine_id: { type: ["string", "null"] },
        route: { type: "object" },
        workspace: { type: ["object", "null"] },
        cacheability: { $ref: "#/$defs/cacheability" },
        warnings: { type: "array", items: { type: "string" } },
        provenance: { type: "object" },
      },
    },
    project_assignments: {
      type: "object",
      required: ["schema_version", "package", "generated_at", "assignments", "projects", "machines", "warnings"],
      properties: {
        schema_version: { const: MACHINES_CONSUMER_CONTRACT_VERSION },
        package: { type: "object" },
        generated_at: { type: "string", format: "date-time" },
        assignments: { type: "array" },
        projects: { type: "array" },
        machines: { type: "array" },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string" && value[key].length > 0;
}

function hasObject(value: Record<string, unknown>, key: string): boolean {
  return isRecord(value[key]);
}

function hasArray(value: Record<string, unknown>, key: string): boolean {
  return Array.isArray(value[key]);
}

function hasCacheability(value: Record<string, unknown>, key = "cacheability"): boolean {
  const cache = value[key];
  return isRecord(cache)
    && hasString(cache, "observed_at")
    && typeof cache.cacheable === "boolean"
    && typeof cache.stale === "boolean"
    && hasArray(cache, "reasons");
}

function hasNullableString(value: Record<string, unknown>, key: string): boolean {
  return value[key] === null || typeof value[key] === "string";
}

function hasOptionalString(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || typeof value[key] === "string";
}

function hasOptionalStringArray(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || (Array.isArray(value[key]) && (value[key] as unknown[]).every((entry) => typeof entry === "string"));
}

function hasMachineDetailsMetadataValue(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasOptionalMachineDetailsDisplayMetadata(value: Record<string, unknown>): boolean {
  if (!("display_metadata" in value)) return true;
  if (!isRecord(value.display_metadata)) return false;
  return Object.values(value.display_metadata).every(hasMachineDetailsMetadataValue);
}

const BROWSERPLAN_MACHINE_ID_SET = new Set<string>(BROWSERPLAN_MACHINE_IDS);
const BROWSERPLAN_EXCLUDED_MACHINE_ID_SET = new Set<string>(BROWSERPLAN_EXCLUDED_MACHINE_IDS);
const BROWSERPLAN_OPERATION_ID_SET = new Set<string>(BROWSERPLAN_OPERATION_IDS);
const BROWSERPLAN_CAPABILITY_STATES = new Set(["available", "missing", "unknown", "failed"]);
const BROWSERPLAN_ROUTE_KINDS = new Set(["local", "lan", "tailscale", "ssh", "unknown"]);
const BROWSERPLAN_ROUTE_CONFIDENCES = new Set(["exact", "high", "medium", "low", "none"]);

function arrayEquals(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}

function validateStringArrayOf(value: unknown, path: string, allowed: ReadonlySet<string>, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(path);
    return;
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !allowed.has(entry)) errors.push(`${path}.${index}`);
  }
}

function validateBrowserPlanCapability(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(path);
    return;
  }
  requireFields(value, ["state", "command", "version", "detail"], errors);
  if (!BROWSERPLAN_CAPABILITY_STATES.has(String(value.state))) errors.push(`${path}.state`);
  if (!hasString(value, "command")) errors.push(`${path}.command`);
  if (!hasNullableString(value, "version")) errors.push(`${path}.version`);
  if (!hasNullableString(value, "detail")) errors.push(`${path}.detail`);
}

function validateBrowserPlanSafeRunner(value: unknown, path: string, machineId: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(path);
    return;
  }
  requireFields(value, ["sdk", "cli", "mcp", "ownership"], errors);
  if (isRecord(value.sdk)) {
    if (value.sdk.function !== "runMachineCommand") errors.push(`${path}.sdk.function`);
    if (value.sdk.machine_id !== machineId) errors.push(`${path}.sdk.machine_id`);
    if (value.sdk.command_argument !== "<browserplan-owned command>") errors.push(`${path}.sdk.command_argument`);
    if (typeof value.sdk.timeout_ms !== "number") errors.push(`${path}.sdk.timeout_ms`);
  } else {
    errors.push(`${path}.sdk`);
  }
  if (isRecord(value.cli)) {
    if (!Array.isArray(value.cli.command)) errors.push(`${path}.cli.command`);
    if (!hasString(value.cli, "private_metadata_note")) errors.push(`${path}.cli.private_metadata_note`);
  } else {
    errors.push(`${path}.cli`);
  }
  if (isRecord(value.mcp)) {
    if (value.mcp.tool !== "machines_ssh_resolve") errors.push(`${path}.mcp.tool`);
    if (!hasString(value.mcp, "private_metadata_note")) errors.push(`${path}.mcp.private_metadata_note`);
    if (isRecord(value.mcp.args)) {
      if (value.mcp.args.machine_id !== machineId) errors.push(`${path}.mcp.args.machine_id`);
      if (value.mcp.args.remote_command !== "<browserplan-owned command>") errors.push(`${path}.mcp.args.remote_command`);
      if (value.mcp.args.private_metadata !== false) errors.push(`${path}.mcp.args.private_metadata`);
    } else {
      errors.push(`${path}.mcp.args`);
    }
  } else {
    errors.push(`${path}.mcp`);
  }
  if (isRecord(value.ownership)) {
    if (value.ownership.command_owner !== BROWSERPLAN_APP_ID) errors.push(`${path}.ownership.command_owner`);
    if (value.ownership.route_owner !== BROWSERPLAN_ROUTE_OWNER) errors.push(`${path}.ownership.route_owner`);
    if (value.ownership.secrets_owner !== BROWSERPLAN_SECRETS_OWNER) errors.push(`${path}.ownership.secrets_owner`);
  } else {
    errors.push(`${path}.ownership`);
  }
}

function requireFields(value: Record<string, unknown>, fields: string[], errors: string[]): void {
  for (const field of fields) {
    if (!(field in value)) errors.push(`missing:${field}`);
  }
}

function validatePagination(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(path);
    return;
  }
  requireFields(value, ["limit", "offset", "total", "count", "hasMore", "nextOffset", "has_more", "next_offset", "order"], errors);
  if (value.limit !== null && typeof value.limit !== "number") errors.push(`${path}.limit`);
  if (typeof value.offset !== "number") errors.push(`${path}.offset`);
  if (typeof value.total !== "number") errors.push(`${path}.total`);
  if (typeof value.count !== "number") errors.push(`${path}.count`);
  if (typeof value.hasMore !== "boolean") errors.push(`${path}.hasMore`);
  if (value.nextOffset !== null && typeof value.nextOffset !== "number") errors.push(`${path}.nextOffset`);
  if (typeof value.has_more !== "boolean") errors.push(`${path}.has_more`);
  if (value.next_offset !== null && typeof value.next_offset !== "number") errors.push(`${path}.next_offset`);
  if (value.order !== "updated_at_desc") errors.push(`${path}.order`);
}

function validateNoteMachineReference(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(path);
    return;
  }
  requireFields(value, ["machine_id", "friendly_name", "display_name", "updated_at", "role", "known", "manifest_declared"], errors);
  if (!hasString(value, "machine_id")) errors.push(`${path}.machine_id`);
  if (!hasString(value, "display_name")) errors.push(`${path}.display_name`);
  if (!hasNullableString(value, "friendly_name")) errors.push(`${path}.friendly_name`);
  if (!hasNullableString(value, "updated_at")) errors.push(`${path}.updated_at`);
  if (!["origin", "source", "target", "sync_target", "trash_owner"].includes(String(value.role))) errors.push(`${path}.role`);
  if (typeof value.known !== "boolean") errors.push(`${path}.known`);
  if (typeof value.manifest_declared !== "boolean") errors.push(`${path}.manifest_declared`);
}

function validateAgentSummary(value: unknown, path: string, errors: string[], includeRunnable = false): void {
  if (!isRecord(value)) {
    errors.push(path);
    return;
  }
  for (const key of ["total", "ready", "degraded", "blocked", "unknown"]) {
    if (typeof value[key] !== "number") errors.push(`${path}.${key}`);
  }
  if (includeRunnable && typeof value.runnable !== "number") errors.push(`${path}.runnable`);
}

function validateAgentArtifacts(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(path);
    return;
  }
  for (const [index, artifact] of value.entries()) {
    const artifactPath = `${path}.${index}`;
    if (!isRecord(artifact)) {
      errors.push(artifactPath);
      continue;
    }
    requireFields(artifact, ["kind", "ref", "format", "private"], errors);
    if (!hasString(artifact, "kind")) errors.push(`${artifactPath}.kind`);
    if (!hasString(artifact, "ref")) errors.push(`${artifactPath}.ref`);
    if (!["json", "text"].includes(String(artifact.format))) errors.push(`${artifactPath}.format`);
    if (typeof artifact.private !== "boolean") errors.push(`${artifactPath}.private`);
  }
}

function validateAgentDetailRefs(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(path);
    return;
  }
  for (const key of ["cli", "mcp", "sdk"]) {
    if (!hasString(value, key)) errors.push(`${path}.${key}`);
  }
}

function validateReadiness(value: unknown, path: string, errors: string[]): void {
  if (!["ready", "degraded", "blocked", "unknown"].includes(String(value))) errors.push(path);
}

function validateCommandMatrixPlan(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(path);
    return;
  }
  requireFields(value, ["intent", "label", "placeholder", "command_ref", "local_shell", "cli", "mcp", "sdk", "private_shell_command"], errors);
  if (!["placeholder", "provided"].includes(String(value.intent))) errors.push(`${path}.intent`);
  if (!hasString(value, "label")) errors.push(`${path}.label`);
  if (value.placeholder !== "<loop-command>") errors.push(`${path}.placeholder`);
  if (!isRecord(value.command_ref)) {
    errors.push(`${path}.command_ref`);
  } else {
    const ref = value.command_ref as Record<string, unknown>;
    requireFields(ref, ["provided", "preview", "sha256", "length", "redacted"], errors);
    if (typeof ref.provided !== "boolean") errors.push(`${path}.command_ref.provided`);
    if (!hasString(ref, "preview")) errors.push(`${path}.command_ref.preview`);
    if (!hasNullableString(ref, "sha256")) errors.push(`${path}.command_ref.sha256`);
    if (typeof ref.length !== "number") errors.push(`${path}.command_ref.length`);
    if (typeof ref.redacted !== "boolean") errors.push(`${path}.command_ref.redacted`);
    if (ref.redacted === true && ref.preview !== "[redacted]") errors.push(`${path}.command_ref.preview`);
  }
  if (!hasNullableString(value, "local_shell")) errors.push(`${path}.local_shell`);
  if (!hasString(value, "cli")) errors.push(`${path}.cli`);
  if (!isRecord(value.mcp)) {
    errors.push(`${path}.mcp`);
  } else {
    const mcp = value.mcp as Record<string, unknown>;
    if (mcp.tool !== "machines_ssh_resolve") errors.push(`${path}.mcp.tool`);
    if (!isRecord(mcp.args)) {
      errors.push(`${path}.mcp.args`);
    } else {
      const args = mcp.args as Record<string, unknown>;
      if (!hasString(args, "machine_id")) errors.push(`${path}.mcp.args.machine_id`);
      if (!hasString(args, "remote_command")) errors.push(`${path}.mcp.args.remote_command`);
      if (args.private_metadata !== false) errors.push(`${path}.mcp.args.private_metadata`);
    }
  }
  if (!hasString(value, "sdk")) errors.push(`${path}.sdk`);
  if (!hasNullableString(value, "private_shell_command")) errors.push(`${path}.private_shell_command`);
}

function validateAgentMachineRows(value: unknown, path: string, errors: string[], commandRows = false): void {
  if (!Array.isArray(value)) {
    errors.push(path);
    return;
  }
  for (const [index, row] of value.entries()) {
    const rowPath = `${path}.${index}`;
    if (!isRecord(row)) {
      errors.push(rowPath);
      continue;
    }
    requireFields(row, commandRows
      ? ["machine_id", "display_name", "can_run", "readiness", "route", "source", "confidence", "local", "command", "blocked_by", "warnings", "detail_refs"]
      : ["machine_id", "display_name", "status", "ok", "route", "confidence", "local", "heartbeat", "checks", "issues", "warnings", "detail_refs"], errors);
    if (!hasString(row, "machine_id")) errors.push(`${rowPath}.machine_id`);
    if (!hasString(row, "display_name")) errors.push(`${rowPath}.display_name`);
    if (commandRows) {
      if (typeof row.can_run !== "boolean") errors.push(`${rowPath}.can_run`);
      validateReadiness(row.readiness, `${rowPath}.readiness`, errors);
      validateCommandMatrixPlan(row.command, `${rowPath}.command`, errors);
      if (!hasArray(row, "blocked_by")) errors.push(`${rowPath}.blocked_by`);
    } else {
      validateReadiness(row.status, `${rowPath}.status`, errors);
      if (typeof row.ok !== "boolean") errors.push(`${rowPath}.ok`);
      if (!hasObject(row, "checks")) errors.push(`${rowPath}.checks`);
      if (!hasArray(row, "issues")) errors.push(`${rowPath}.issues`);
    }
    if (!hasString(row, "route")) errors.push(`${rowPath}.route`);
    if (!hasString(row, "confidence")) errors.push(`${rowPath}.confidence`);
    if (typeof row.local !== "boolean") errors.push(`${rowPath}.local`);
    if (!hasArray(row, "warnings")) errors.push(`${rowPath}.warnings`);
    validateAgentDetailRefs(row.detail_refs, `${rowPath}.detail_refs`, errors);
  }
}

function validateRoutingRows(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(path);
    return;
  }
  for (const [index, row] of value.entries()) {
    const rowPath = `${path}.${index}`;
    if (!isRecord(row)) {
      errors.push(rowPath);
      continue;
    }
    requireFields(row, ["machine_id", "display_name", "ok", "route", "source", "confidence", "local", "heartbeat", "cacheable", "target", "command_target", "warnings", "detail_refs"], errors);
    if (!hasString(row, "machine_id")) errors.push(`${rowPath}.machine_id`);
    if (!hasString(row, "display_name")) errors.push(`${rowPath}.display_name`);
    if (typeof row.ok !== "boolean") errors.push(`${rowPath}.ok`);
    if (!hasString(row, "route")) errors.push(`${rowPath}.route`);
    if (!hasString(row, "source")) errors.push(`${rowPath}.source`);
    if (!hasString(row, "confidence")) errors.push(`${rowPath}.confidence`);
    if (typeof row.local !== "boolean") errors.push(`${rowPath}.local`);
    if (typeof row.cacheable !== "boolean") errors.push(`${rowPath}.cacheable`);
    if (!hasNullableString(row, "target")) errors.push(`${rowPath}.target`);
    if (!hasNullableString(row, "command_target")) errors.push(`${rowPath}.command_target`);
    if (!hasArray(row, "warnings")) errors.push(`${rowPath}.warnings`);
    validateAgentDetailRefs(row.detail_refs, `${rowPath}.detail_refs`, errors);
  }
}

function validateLoopPreflightRows(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(path);
    return;
  }
  for (const [index, row] of value.entries()) {
    const rowPath = `${path}.${index}`;
    if (!isRecord(row)) {
      errors.push(rowPath);
      continue;
    }
    requireFields(row, ["machine_id", "display_name", "ready", "status", "can_run", "route", "confidence", "local", "heartbeat", "blocked_by", "warnings", "next_steps", "detail_refs"], errors);
    if (!hasString(row, "machine_id")) errors.push(`${rowPath}.machine_id`);
    if (!hasString(row, "display_name")) errors.push(`${rowPath}.display_name`);
    if (typeof row.ready !== "boolean") errors.push(`${rowPath}.ready`);
    if (typeof row.can_run !== "boolean") errors.push(`${rowPath}.can_run`);
    validateReadiness(row.status, `${rowPath}.status`, errors);
    if (!hasString(row, "route")) errors.push(`${rowPath}.route`);
    if (!hasString(row, "confidence")) errors.push(`${rowPath}.confidence`);
    if (typeof row.local !== "boolean") errors.push(`${rowPath}.local`);
    if (!hasArray(row, "blocked_by")) errors.push(`${rowPath}.blocked_by`);
    if (!hasArray(row, "warnings")) errors.push(`${rowPath}.warnings`);
    if (!hasArray(row, "next_steps")) errors.push(`${rowPath}.next_steps`);
    validateAgentDetailRefs(row.detail_refs, `${rowPath}.detail_refs`, errors);
  }
}

export function getMachinesConsumerSchemaBundle(): MachinesConsumerSchemaBundle {
  return JSON.parse(JSON.stringify(MACHINES_CONSUMER_SCHEMA_BUNDLE)) as MachinesConsumerSchemaBundle;
}

export function validateMachinesConsumerEnvelope(
  envelope: MachinesConsumerSchemaEnvelope,
  value: unknown,
): MachinesConsumerValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, envelope, schema_id: MACHINES_CONSUMER_SCHEMA_URI, errors: ["not_object"] };
  }
  if (value.schema_version !== MACHINES_CONSUMER_CONTRACT_VERSION) errors.push(`schema_version:${String(value.schema_version)}`);

  if (envelope === "contract") {
    requireFields(value, ["package_name", "entrypoint", "schema_uri", "schema_artifact", "capabilities", "field_capabilities", "cacheability", "envelopes", "stable_exports"], errors);
    if (value.package_name !== "@hasna/machines") errors.push("package_name");
    if (value.entrypoint !== "@hasna/machines/consumer") errors.push("entrypoint");
    if (!hasObject(value, "capabilities")) errors.push("capabilities");
    if (!hasObject(value, "field_capabilities")) errors.push("field_capabilities");
    if (!hasArray(value, "envelopes")) errors.push("envelopes");
    if (!hasArray(value, "stable_exports")) errors.push("stable_exports");
  } else if (envelope === "topology") {
    requireFields(value, ["package", "capabilities", "generated_at", "local_machine_id", "pagination", "machines", "warnings"], errors);
    validatePagination(value.pagination, "pagination", errors);
    if (!hasArray(value, "machines")) errors.push("machines");
    if (Array.isArray(value.machines)) {
      for (const [index, machine] of value.machines.entries()) {
        if (!isRecord(machine)) {
          errors.push(`machines.${index}`);
          continue;
        }
        requireFields(machine, ["machine_id", "friendly_name", "display_name", "updated_at"], errors);
        if (!hasString(machine, "machine_id")) errors.push(`machines.${index}.machine_id`);
        if (!hasString(machine, "display_name")) errors.push(`machines.${index}.display_name`);
        if (machine.friendly_name !== null && typeof machine.friendly_name !== "string") errors.push(`machines.${index}.friendly_name`);
        if (machine.updated_at !== null && typeof machine.updated_at !== "string") errors.push(`machines.${index}.updated_at`);
      }
    }
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "route") {
    requireFields(value, ["package", "ok", "machine_id", "requested_machine_id", "generated_at", "route", "source", "target", "command_target", "confidence", "local", "evidence", "cacheability", "warnings"], errors);
    if (typeof value.ok !== "boolean") errors.push("ok");
    if (!hasObject(value, "evidence")) errors.push("evidence");
    if (!hasCacheability(value)) errors.push("cacheability");
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "workspace") {
    requireFields(value, ["package", "ok", "requested_machine_id", "machine_id", "generated_at", "project", "machine", "paths", "diagnostics", "repair_hints", "evidence", "cacheability", "warnings"], errors);
    if (typeof value.ok !== "boolean") errors.push("ok");
    if (!hasObject(value, "machine")) errors.push("machine");
    if (!hasObject(value, "paths")) errors.push("paths");
    if (!hasArray(value, "diagnostics")) errors.push("diagnostics");
    if (!hasArray(value, "repair_hints")) errors.push("repair_hints");
    if (!hasCacheability(value)) errors.push("cacheability");
  } else if (envelope === "compatibility") {
    requireFields(value, ["package", "capabilities", "ok", "machine_id", "source", "generated_at", "checks", "summary"], errors);
    if (typeof value.ok !== "boolean") errors.push("ok");
    if (!hasArray(value, "checks")) errors.push("checks");
    if (!hasObject(value, "summary")) errors.push("summary");
  } else if (envelope === "resolver_snapshot") {
    requireFields(value, ["package", "generated_at", "requested_machine_id", "machine_id", "route", "workspace", "cacheability", "warnings", "provenance"], errors);
    if (!hasObject(value, "route")) errors.push("route");
    if (!hasCacheability(value)) errors.push("cacheability");
    if (!hasArray(value, "warnings")) errors.push("warnings");
    if (!hasObject(value, "provenance")) errors.push("provenance");
  } else if (envelope === "project_assignments") {
    requireFields(value, ["package", "generated_at", "assignments", "projects", "machines", "warnings"], errors);
    if (!hasArray(value, "assignments")) errors.push("assignments");
    if (!hasArray(value, "projects")) errors.push("projects");
    if (!hasArray(value, "machines")) errors.push("machines");
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "note_machine_context") {
    requireFields(value, ["package", "capabilities", "generated_at", "origin_machine_id", "source_machine_id", "target_machine_id", "origin_machine", "source_machine", "target_machine", "sync_target_machine_ids", "sync_targets", "actor", "warnings"], errors);
    if (!hasNullableString(value, "origin_machine_id")) errors.push("origin_machine_id");
    if (!hasNullableString(value, "source_machine_id")) errors.push("source_machine_id");
    if (!hasNullableString(value, "target_machine_id")) errors.push("target_machine_id");
    if (value.origin_machine !== null) validateNoteMachineReference(value.origin_machine, "origin_machine", errors);
    if (value.source_machine !== null) validateNoteMachineReference(value.source_machine, "source_machine", errors);
    if (value.target_machine !== null) validateNoteMachineReference(value.target_machine, "target_machine", errors);
    if (!hasArray(value, "sync_target_machine_ids")) errors.push("sync_target_machine_ids");
    if (!hasArray(value, "sync_targets")) errors.push("sync_targets");
    if (Array.isArray(value.sync_targets)) {
      for (const [index, target] of value.sync_targets.entries()) {
        if (!isRecord(target)) {
          errors.push(`sync_targets.${index}`);
          continue;
        }
        requireFields(target, ["machine_id", "machine"], errors);
        if (!hasString(target, "machine_id")) errors.push(`sync_targets.${index}.machine_id`);
        validateNoteMachineReference(target.machine, `sync_targets.${index}.machine`, errors);
      }
    }
    if (!hasObject(value, "actor")) {
      errors.push("actor");
    } else {
      const actor = value.actor as Record<string, unknown>;
      requireFields(actor, ["actor_type", "actor_id", "actor_name", "agent_id", "agent_name", "source", "display_name"], errors);
      if (!["human", "agent", "system", "unknown"].includes(String(actor.actor_type))) errors.push("actor.actor_type");
      if (!hasNullableString(actor, "actor_id")) errors.push("actor.actor_id");
      if (!hasNullableString(actor, "actor_name")) errors.push("actor.actor_name");
      if (!hasNullableString(actor, "agent_id")) errors.push("actor.agent_id");
      if (!hasNullableString(actor, "agent_name")) errors.push("actor.agent_name");
      if (!["open-notes", "agent", "sync", "import", "open-machines", "unknown"].includes(String(actor.source))) errors.push("actor.source");
      if (!hasString(actor, "display_name")) errors.push("actor.display_name");
    }
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "machine_trash_policies") {
    requireFields(value, ["package", "capabilities", "generated_at", "pagination", "policies", "warnings"], errors);
    validatePagination(value.pagination, "pagination", errors);
    if (!hasArray(value, "policies")) errors.push("policies");
    if (Array.isArray(value.policies)) {
      for (const [index, policy] of value.policies.entries()) {
        if (!isRecord(policy)) {
          errors.push(`policies.${index}`);
          continue;
        }
        requireFields(policy, ["machine_id", "friendly_name", "display_name", "updated_at", "enabled", "retention_days", "delete_after_days", "trash_path", "source", "metadata_keys"], errors);
        if (!hasString(policy, "machine_id")) errors.push(`policies.${index}.machine_id`);
        if (!hasString(policy, "display_name")) errors.push(`policies.${index}.display_name`);
        if (!hasNullableString(policy, "friendly_name")) errors.push(`policies.${index}.friendly_name`);
        if (!hasNullableString(policy, "updated_at")) errors.push(`policies.${index}.updated_at`);
        if (policy.enabled !== null && typeof policy.enabled !== "boolean") errors.push(`policies.${index}.enabled`);
        if (policy.retention_days !== null && typeof policy.retention_days !== "number") errors.push(`policies.${index}.retention_days`);
        if (policy.delete_after_days !== null && typeof policy.delete_after_days !== "number") errors.push(`policies.${index}.delete_after_days`);
        if (!hasNullableString(policy, "trash_path")) errors.push(`policies.${index}.trash_path`);
        if (!["manifest_metadata", "default"].includes(String(policy.source))) errors.push(`policies.${index}.source`);
        if (!hasArray(policy, "metadata_keys")) errors.push(`policies.${index}.metadata_keys`);
      }
    }
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "machine_health") {
    requireFields(value, ["package", "capabilities", "generated_at", "kind", "pagination", "summary", "machines", "artifacts", "warnings"], errors);
    if (value.kind !== "machine_health") errors.push("kind");
    validatePagination(value.pagination, "pagination", errors);
    validateAgentSummary(value.summary, "summary", errors);
    validateAgentMachineRows(value.machines, "machines", errors);
    validateAgentArtifacts(value.artifacts, "artifacts", errors);
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "routing") {
    requireFields(value, ["package", "capabilities", "generated_at", "kind", "pagination", "summary", "routes", "artifacts", "warnings"], errors);
    if (value.kind !== "routing") errors.push("kind");
    validatePagination(value.pagination, "pagination", errors);
    if (!hasObject(value, "summary")) {
      errors.push("summary");
    } else {
      const routingSummary = value.summary as Record<string, unknown>;
      for (const key of ["total", "routable", "local", "remote", "unroutable"]) {
        if (typeof routingSummary[key] !== "number") errors.push(`summary.${key}`);
      }
    }
    validateRoutingRows(value.routes, "routes", errors);
    validateAgentArtifacts(value.artifacts, "artifacts", errors);
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "command_matrix") {
    requireFields(value, ["package", "capabilities", "generated_at", "kind", "mode", "pagination", "summary", "commands", "artifacts", "warnings"], errors);
    if (value.kind !== "command_matrix") errors.push("kind");
    if (value.mode !== "plan") errors.push("mode");
    validatePagination(value.pagination, "pagination", errors);
    if (!hasObject(value, "summary")) {
      errors.push("summary");
    } else {
      const matrixSummary = value.summary as Record<string, unknown>;
      for (const key of ["total", "runnable", "blocked", "local", "remote"]) {
        if (typeof matrixSummary[key] !== "number") errors.push(`summary.${key}`);
      }
    }
    validateAgentMachineRows(value.commands, "commands", errors, true);
    validateAgentArtifacts(value.artifacts, "artifacts", errors);
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "loop_preflight") {
    requireFields(value, ["package", "capabilities", "generated_at", "kind", "mode", "selection_mode", "ok", "pagination", "summary", "machines", "artifacts", "warnings"], errors);
    if (value.kind !== "loop_preflight") errors.push("kind");
    if (value.mode !== "plan") errors.push("mode");
    if (!["explicit", "discovered"].includes(String(value.selection_mode))) errors.push("selection_mode");
    if (typeof value.ok !== "boolean") errors.push("ok");
    validatePagination(value.pagination, "pagination", errors);
    validateAgentSummary(value.summary, "summary", errors, true);
    if (isRecord(value.summary)) {
      if (typeof value.summary.any_ready !== "boolean") errors.push("summary.any_ready");
      if (typeof value.summary.all_ready !== "boolean") errors.push("summary.all_ready");
    }
    validateLoopPreflightRows(value.machines, "machines", errors);
    validateAgentArtifacts(value.artifacts, "artifacts", errors);
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "browserplan_fleet") {
    requireFields(value, ["package", "capabilities", "generated_at", "kind", "target", "coverage", "operation_contract", "machines", "warnings"], errors);
    if (value.kind !== "browserplan_fleet") errors.push("kind");
    if (!hasObject(value, "target")) {
      errors.push("target");
    } else {
      const target = value.target as Record<string, unknown>;
      requireFields(target, ["name", "owner", "machine_ids", "excluded_machine_ids", "install_target_excludes"], errors);
      if (target.name !== BROWSERPLAN_TARGET_NAME) errors.push("target.name");
      if (target.owner !== BROWSERPLAN_APP_ID) errors.push("target.owner");
      if (!arrayEquals(target.machine_ids, BROWSERPLAN_MACHINE_IDS)) errors.push("target.machine_ids");
      if (!arrayEquals(target.excluded_machine_ids, BROWSERPLAN_EXCLUDED_MACHINE_IDS)) errors.push("target.excluded_machine_ids");
      if (!arrayEquals(target.install_target_excludes, BROWSERPLAN_EXCLUDED_MACHINE_IDS)) errors.push("target.install_target_excludes");
    }
    if (!hasObject(value, "coverage")) {
      errors.push("coverage");
    } else {
      const coverage = value.coverage as Record<string, unknown>;
      requireFields(coverage, ["expected", "returned", "known", "missing", "unreachable", "excluded_requested"], errors);
      for (const key of ["expected", "returned", "known"]) {
        if (typeof coverage[key] !== "number") errors.push(`coverage.${key}`);
      }
      for (const key of ["missing", "unreachable", "excluded_requested"]) {
        if (!hasArray(coverage, key)) errors.push(`coverage.${key}`);
      }
      validateStringArrayOf(coverage.missing, "coverage.missing", BROWSERPLAN_MACHINE_ID_SET, errors);
      validateStringArrayOf(coverage.unreachable, "coverage.unreachable", BROWSERPLAN_MACHINE_ID_SET, errors);
      validateStringArrayOf(coverage.excluded_requested, "coverage.excluded_requested", BROWSERPLAN_EXCLUDED_MACHINE_ID_SET, errors);
    }
    if (!hasObject(value, "operation_contract")) {
      errors.push("operation_contract");
    } else {
      const contract = value.operation_contract as Record<string, unknown>;
      requireFields(contract, ["command_owner", "route_owner", "default_timeout_ms", "private_route_policy", "supported_operations", "stable_surfaces"], errors);
      if (contract.command_owner !== BROWSERPLAN_APP_ID) errors.push("operation_contract.command_owner");
      if (contract.route_owner !== BROWSERPLAN_ROUTE_OWNER) errors.push("operation_contract.route_owner");
      if (typeof contract.default_timeout_ms !== "number") errors.push("operation_contract.default_timeout_ms");
      if (contract.private_route_policy !== BROWSERPLAN_PRIVATE_ROUTE_POLICY) errors.push("operation_contract.private_route_policy");
      if (!arrayEquals(contract.supported_operations, BROWSERPLAN_OPERATION_IDS)) errors.push("operation_contract.supported_operations");
      if (!isRecord(contract.stable_surfaces)) {
        errors.push("operation_contract.stable_surfaces");
      } else {
        for (const [key, expected] of Object.entries(BROWSERPLAN_STABLE_SURFACES)) {
          if (contract.stable_surfaces[key] !== expected) errors.push(`operation_contract.stable_surfaces.${key}`);
        }
      }
    }
    if (!hasArray(value, "machines")) {
      errors.push("machines");
    } else {
      const machines = value.machines as unknown[];
      const coverage = isRecord(value.coverage) ? value.coverage : null;
      if (coverage) {
        if (typeof coverage.expected === "number" && coverage.expected !== machines.length) errors.push("coverage.expected");
        if (typeof coverage.returned === "number" && coverage.returned !== machines.length) errors.push("coverage.returned");
        if (typeof coverage.known === "number" && Array.isArray(coverage.missing) && coverage.known !== machines.length - coverage.missing.length) errors.push("coverage.known");
      }
      for (const [index, machine] of machines.entries()) {
        if (!isRecord(machine)) {
          errors.push(`machines.${index}`);
          continue;
        }
        requireFields(machine, ["machine_id", "slug", "display_name", "displayName", "known", "eligible", "status", "reachability", "install_state", "operation_hooks", "warnings"], errors);
        if (!hasString(machine, "machine_id")) errors.push(`machines.${index}.machine_id`);
        if (!BROWSERPLAN_MACHINE_ID_SET.has(String(machine.machine_id))) errors.push(`machines.${index}.machine_id`);
        if (machine.slug !== machine.machine_id) errors.push(`machines.${index}.slug`);
        if (BROWSERPLAN_EXCLUDED_MACHINE_ID_SET.has(String(machine.machine_id))) errors.push(`machines.${index}.excluded_machine_id`);
        if (!hasNullableString(machine, "friendly_name")) errors.push(`machines.${index}.friendly_name`);
        if (!hasNullableString(machine, "friendlyName")) errors.push(`machines.${index}.friendlyName`);
        if (!hasString(machine, "display_name")) errors.push(`machines.${index}.display_name`);
        if (!hasString(machine, "displayName")) errors.push(`machines.${index}.displayName`);
        if (machine.displayName !== machine.display_name) errors.push(`machines.${index}.displayName`);
        if (typeof machine.known !== "boolean") errors.push(`machines.${index}.known`);
        if (typeof machine.eligible !== "boolean") errors.push(`machines.${index}.eligible`);
        if (!hasObject(machine, "status")) {
          errors.push(`machines.${index}.status`);
        } else {
          const status = machine.status as Record<string, unknown>;
          requireFields(status, ["state", "label", "online"], errors);
          if (!["online", "offline", "unknown"].includes(String(status.state))) errors.push(`machines.${index}.status.state`);
          if (!["Online", "Offline", "Unknown"].includes(String(status.label))) errors.push(`machines.${index}.status.label`);
          if (status.online !== null && typeof status.online !== "boolean") errors.push(`machines.${index}.status.online`);
        }
        if (!hasObject(machine, "reachability")) {
          errors.push(`machines.${index}.reachability`);
        } else {
          const reachability = machine.reachability as Record<string, unknown>;
          requireFields(reachability, ["ok", "route", "source", "confidence", "local", "tailscale_online", "cacheable", "warnings"], errors);
          if (typeof reachability.ok !== "boolean") errors.push(`machines.${index}.reachability.ok`);
          if (!BROWSERPLAN_ROUTE_KINDS.has(String(reachability.route))) errors.push(`machines.${index}.reachability.route`);
          if (!BROWSERPLAN_ROUTE_KINDS.has(String(reachability.source))) errors.push(`machines.${index}.reachability.source`);
          if (!BROWSERPLAN_ROUTE_CONFIDENCES.has(String(reachability.confidence))) errors.push(`machines.${index}.reachability.confidence`);
          if (typeof reachability.local !== "boolean") errors.push(`machines.${index}.reachability.local`);
          if (reachability.tailscale_online !== null && typeof reachability.tailscale_online !== "boolean") errors.push(`machines.${index}.reachability.tailscale_online`);
          if (typeof reachability.cacheable !== "boolean") errors.push(`machines.${index}.reachability.cacheable`);
          if (!hasArray(reachability, "warnings")) errors.push(`machines.${index}.reachability.warnings`);
        }
        if (!hasObject(machine, "install_state")) {
          errors.push(`machines.${index}.install_state`);
        } else {
          const install = machine.install_state as Record<string, unknown>;
          requireFields(install, ["checked", "source", "browserplan_cli", "machines_cli", "bun", "git", "node", "chrome", "warnings"], errors);
          if (typeof install.checked !== "boolean") errors.push(`machines.${index}.install_state.checked`);
          if (!["compatibility", "not_checked", "failed"].includes(String(install.source))) errors.push(`machines.${index}.install_state.source`);
          for (const key of ["browserplan_cli", "machines_cli", "bun", "git", "node", "chrome"]) {
            validateBrowserPlanCapability(install[key], `machines.${index}.install_state.${key}`, errors);
          }
          if (!hasArray(install, "warnings")) errors.push(`machines.${index}.install_state.warnings`);
        }
        if (!hasArray(machine, "operation_hooks")) {
          errors.push(`machines.${index}.operation_hooks`);
        } else {
          for (const [hookIndex, hook] of (machine.operation_hooks as unknown[]).entries()) {
            const path = `machines.${index}.operation_hooks.${hookIndex}`;
            if (!isRecord(hook)) {
              errors.push(path);
              continue;
            }
            requireFields(hook, ["id", "label", "description", "owner", "available", "readiness", "required_capabilities", "blocked_by", "command_template", "command_placeholders", "safe_runner"], errors);
            if (!BROWSERPLAN_OPERATION_ID_SET.has(String(hook.id))) errors.push(`${path}.id`);
            if (hook.owner !== BROWSERPLAN_APP_ID) errors.push(`${path}.owner`);
            if (typeof hook.available !== "boolean") errors.push(`${path}.available`);
            if (!["ready", "blocked", "unknown"].includes(String(hook.readiness))) errors.push(`${path}.readiness`);
            if (!hasString(hook, "command_template")) errors.push(`${path}.command_template`);
            if (hook.id === "supervisor_status" && String(hook.command_template).includes("remote start")) errors.push(`${path}.command_template`);
            if (hook.id === "app_install_update" && !String(hook.command_template).includes(`<${BROWSERPLAN_INSTALL_VERSION_PLACEHOLDER}>`)) errors.push(`${path}.command_template`);
            // The BrowserPlan source repository is being retired; a git-checkout install cannot be relied on.
            if (hook.id === "app_install_update" && /\bgit\s+pull\b/.test(String(hook.command_template))) errors.push(`${path}.command_template`);
            if (!hasArray(hook, "command_placeholders")) errors.push(`${path}.command_placeholders`);
            if (!hasArray(hook, "required_capabilities")) errors.push(`${path}.required_capabilities`);
            if (!hasArray(hook, "blocked_by")) errors.push(`${path}.blocked_by`);
            validateBrowserPlanSafeRunner(hook.safe_runner, `${path}.safe_runner`, String(machine.machine_id), errors);
          }
        }
        if (!hasArray(machine, "warnings")) errors.push(`machines.${index}.warnings`);
      }
    }
    if (!hasArray(value, "warnings")) errors.push("warnings");
  } else if (envelope === "machine_details") {
    requireFields(value, ["package", "capabilities", "generated_at", "machine_id", "slug", "display_name", "displayName", "known", "status", "timestamps", "source", "warnings"], errors);
    if (!hasString(value, "machine_id")) errors.push("machine_id");
    if (!hasString(value, "slug")) errors.push("slug");
    if (!hasOptionalString(value, "friendly_name")) errors.push("friendly_name");
    if (!hasOptionalString(value, "friendlyName")) errors.push("friendlyName");
    if (!hasString(value, "display_name")) errors.push("display_name");
    if (!hasString(value, "displayName")) errors.push("displayName");
    if (typeof value.known !== "boolean") errors.push("known");
    if (!hasOptionalString(value, "platform")) errors.push("platform");
    if (!hasOptionalString(value, "machine_type")) errors.push("machine_type");
    if (!hasOptionalString(value, "role")) errors.push("role");
    if (!hasOptionalStringArray(value, "roles")) errors.push("roles");
    if (!hasOptionalStringArray(value, "machine_capabilities")) errors.push("machine_capabilities");
    if (!hasOptionalStringArray(value, "tags")) errors.push("tags");
    if (!hasOptionalString(value, "updated_at")) errors.push("updated_at");
    if (!hasOptionalString(value, "last_seen_at")) errors.push("last_seen_at");
    if (!hasObject(value, "status")) {
      errors.push("status");
    } else {
      const status = value.status as Record<string, unknown>;
      requireFields(status, ["state", "label", "online"], errors);
      if (!["online", "offline", "unknown"].includes(String(status.state))) errors.push("status.state");
      if (!["Online", "Offline", "Unknown"].includes(String(status.label))) errors.push("status.label");
      if (status.online !== null && typeof status.online !== "boolean") errors.push("status.online");
      if (!hasOptionalString(status, "last_seen_at")) errors.push("status.last_seen_at");
      if (!hasOptionalString(status, "last_heartbeat_at")) errors.push("status.last_heartbeat_at");
    }
    if (!hasObject(value, "timestamps")) {
      errors.push("timestamps");
    } else {
      const timestamps = value.timestamps as Record<string, unknown>;
      for (const key of ["updated_at", "last_seen_at", "last_heartbeat_at", "last_tailscale_seen_at", "recent_sync_at", "recent_sync_status", "storage_sync_status"]) {
        if (!hasOptionalString(timestamps, key)) errors.push(`timestamps.${key}`);
      }
    }
    if (!hasObject(value, "source")) {
      errors.push("source");
    } else {
      const source = value.source as Record<string, unknown>;
      requireFields(source, ["authority", "metadata_source", "manifest_declared", "heartbeat_present", "topology_entry", "local"], errors);
      if (source.authority !== "open-machines") errors.push("source.authority");
      if (!["manifest_metadata", "heartbeat", "topology", "fallback"].includes(String(source.metadata_source))) errors.push("source.metadata_source");
      if (typeof source.manifest_declared !== "boolean") errors.push("source.manifest_declared");
      if (typeof source.heartbeat_present !== "boolean") errors.push("source.heartbeat_present");
      if (typeof source.topology_entry !== "boolean") errors.push("source.topology_entry");
      if (typeof source.local !== "boolean") errors.push("source.local");
    }
    if (!hasOptionalMachineDetailsDisplayMetadata(value)) errors.push("display_metadata");
    if (!hasArray(value, "warnings")) errors.push("warnings");
  }

  return { ok: errors.length === 0, envelope, schema_id: MACHINES_CONSUMER_SCHEMA_URI, errors };
}

export type MachinesConsumerEnvelopeValue =
  | MachineTopology
  | MachineRouteResolution
  | MachineWorkspaceResolution
  | MachineCompatibilityReport
  | MachineResolverSnapshot
  | MachineProjectAssignments
  | NoteMachineContext
  | MachineTrashPolicies
  | MachineDetails
  | BrowserPlanFleet
  | MachineHealthReport
  | FleetRoutingReport
  | CommandMatrixReport
  | FleetLoopPreflightReport;
