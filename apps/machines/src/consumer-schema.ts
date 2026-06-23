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

export type MachinesConsumerSchemaEnvelope =
  | "contract"
  | "topology"
  | "route"
  | "workspace"
  | "compatibility"
  | "resolver_snapshot"
  | "project_assignments";

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
        envelopes: { type: "array", items: { enum: ["topology", "route", "workspace", "compatibility", "resolver_snapshot", "project_assignments"] } },
        stable_exports: { type: "array", items: { type: "string" } },
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

function requireFields(value: Record<string, unknown>, fields: string[], errors: string[]): void {
  for (const field of fields) {
    if (!(field in value)) errors.push(`missing:${field}`);
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
    if (!hasObject(value, "pagination")) {
      errors.push("pagination");
    } else {
      const pagination = value.pagination as Record<string, unknown>;
      requireFields(pagination, ["limit", "offset", "total", "count", "hasMore", "nextOffset", "has_more", "next_offset", "order"], errors);
      if (typeof pagination.hasMore !== "boolean") errors.push("pagination.hasMore");
      if (typeof pagination.has_more !== "boolean") errors.push("pagination.has_more");
      if (pagination.order !== "updated_at_desc") errors.push("pagination.order");
    }
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
  }

  return { ok: errors.length === 0, envelope, schema_id: MACHINES_CONSUMER_SCHEMA_URI, errors };
}

export type MachinesConsumerEnvelopeValue =
  | MachineTopology
  | MachineRouteResolution
  | MachineWorkspaceResolution
  | MachineCompatibilityReport
  | MachineResolverSnapshot
  | MachineProjectAssignments;
