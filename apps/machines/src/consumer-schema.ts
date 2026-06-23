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
  | "machine_details";

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
        envelopes: { type: "array", items: { enum: ["topology", "route", "workspace", "compatibility", "resolver_snapshot", "project_assignments", "note_machine_context", "machine_trash_policies", "machine_details"] } },
        stable_exports: { type: "array", items: { type: "string" } },
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
  | MachineDetails;
