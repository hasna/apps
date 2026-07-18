import { randomUUID } from "crypto";
import { getDb } from "./db.js";
import { parseMessage } from "./messages.js";
import {
  buildIncidentProjectionDisplay,
  IncidentProjectionConflictError,
  IncidentProjectorConfigurationError,
  validateIncidentProjectorBinding,
  validateIncidentProjection,
} from "./incident-projection-contract.js";
import type {
  IncidentProjectionRecord,
  IncidentProjectionRequestV1,
  IncidentProjectorContext,
  Message,
} from "../types.js";

type ProjectionRow = Record<string, unknown>;

export function resolveIncidentProjectorContext(
  env: Record<string, string | undefined> = process.env,
): IncidentProjectorContext {
  const tenant_id = env.HASNA_CONVERSATIONS_TENANT_ID?.trim();
  const authority_id = env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID?.trim();
  if (!tenant_id || !authority_id) {
    throw new IncidentProjectorConfigurationError(
      "Incident projector is not configured. Set HASNA_CONVERSATIONS_TENANT_ID and " +
      "HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID on the selected Conversations authority.",
    );
  }
  const binding = validateIncidentProjectorBinding(tenant_id, authority_id);
  return {
    ...binding,
    routing: {
      from: env.HASNA_CONVERSATIONS_INCIDENT_FROM,
      to: env.HASNA_CONVERSATIONS_INCIDENT_TO,
      channel: env.HASNA_CONVERSATIONS_INCIDENT_CHANNEL,
      project_id: env.HASNA_CONVERSATIONS_INCIDENT_PROJECT_ID,
      session_id: env.HASNA_CONVERSATIONS_INCIDENT_SESSION_ID,
    },
  };
}

function projectionRecord(row: ProjectionRow, message: Message, replayed: boolean): IncidentProjectionRecord {
  return {
    id: Number(row.id),
    event_id: String(row.event_id),
    projection_key: String(row.projection_key),
    message_id: Number(row.message_id),
    schema_version: 1,
    source: "todos",
    tenant_id: String(row.tenant_id),
    authority_id: String(row.authority_id),
    incident_id: String(row.incident_id),
    transition_id: String(row.transition_id),
    incident_version: Number(row.incident_version),
    occurred_at: String(row.occurred_at),
    status: row.status as IncidentProjectionRecord["status"],
    severity: row.severity as IncidentProjectionRecord["severity"],
    blocking: Boolean(row.blocking),
    supersedes_transition_id: row.supersedes_transition_id == null ? null : String(row.supersedes_transition_id),
    supersedes_incident_id: row.supersedes_incident_id == null ? null : String(row.supersedes_incident_id),
    superseded_by_incident_id: row.superseded_by_incident_id == null ? null : String(row.superseded_by_incident_id),
    canonical_payload: String(row.canonical_payload),
    payload_hash: String(row.payload_hash),
    created_at: String(row.created_at),
    message,
    replayed,
  };
}

function loadProjectionRecord(row: ProjectionRow, replayed: boolean): IncidentProjectionRecord {
  const db = getDb();
  const messageRow = db.prepare("SELECT * FROM messages WHERE id = ?").get(Number(row.message_id)) as ProjectionRow | null;
  if (!messageRow) throw new Error(`Incident projection ${String(row.event_id)} has no display message`);
  return projectionRecord(row, parseMessage(messageRow), replayed);
}

function findProjectionByEvent(tenantId: string, eventId: string): ProjectionRow | null {
  return getDb().prepare(
    "SELECT * FROM incident_projections WHERE tenant_id = ? AND event_id = ?",
  ).get(tenantId, eventId) as ProjectionRow | null;
}

/**
 * Atomically append one canonical Todos incident projection and its immutable
 * display message. This low-level local helper requires an explicit authority
 * context; LocalStore binds that context from the selected deployment env.
 */
export function appendIncidentProjection(
  raw: IncidentProjectionRequestV1,
  context: IncidentProjectorContext,
): IncidentProjectionRecord {
  const validated = validateIncidentProjection(raw, context);
  const { request } = validated;
  const display = buildIncidentProjectionDisplay(request, context);
  const db = getDb();

  const write = db.transaction((): IncidentProjectionRecord => {
    const existing = findProjectionByEvent(context.tenant_id, request.event_id);
    if (existing) {
      if (String(existing.payload_hash) !== validated.payload_hash) {
        throw new IncidentProjectionConflictError(
          `Event ${request.event_id} already exists with a different canonical payload`,
        );
      }
      return loadProjectionRecord(existing, true);
    }

    const latest = db.prepare(
      `SELECT * FROM incident_projections
       WHERE tenant_id = ? AND authority_id = ? AND incident_id = ?
       ORDER BY incident_version DESC LIMIT 1`,
    ).get(context.tenant_id, context.authority_id, request.incident_id) as ProjectionRow | null;

    if (request.incident_version === 1) {
      if (latest) {
        throw new IncidentProjectionConflictError(
          `Incident ${request.incident_id} already has projection version ${String(latest.incident_version)}`,
        );
      }
    } else {
      if (!latest || Number(latest.incident_version) !== request.incident_version - 1 ||
          String(latest.transition_id) !== validated.supersedes_transition_id) {
        throw new IncidentProjectionConflictError(
          `Incident ${request.incident_id} requires canonical predecessor version ${request.incident_version - 1}`,
        );
      }
      if (Date.parse(request.occurred_at) < Date.parse(String(latest.occurred_at))) {
        throw new IncidentProjectionConflictError("Incident projection occurred_at cannot move backwards");
      }
    }

    const assertSupersededSource = (id: string | null): void => {
      if (!id) return;
      const target = db.prepare(
        `SELECT * FROM incident_projections
         WHERE tenant_id = ? AND authority_id = ? AND incident_id = ?
         ORDER BY incident_version DESC LIMIT 1`,
      ).get(context.tenant_id, context.authority_id, id);
      if (!target) {
        throw new IncidentProjectionConflictError("incident.supersedes_id references an incident outside this tenant/authority or not yet projected");
      }
      const row = target as ProjectionRow;
      if (row.status !== "superseded" || row.superseded_by_incident_id !== request.incident_id) {
        throw new IncidentProjectionConflictError(
          "incident.supersedes_id must reciprocate a superseded incident whose superseded_by_id is this incident",
        );
      }
    };
    // superseded_by_id is a forward reference by design: Todos emits the old
    // incident's terminal event before the replacement v1. The replacement then
    // closes the relation by supplying reciprocal supersedes_id.
    assertSupersededSource(request.incident.supersedes_id);

    const routedChannel = display.channel
      ? db.prepare(
          "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = ?",
        ).get(display.channel) as { current_channel: string } | null
      : null;
    let channel = routedChannel?.current_channel ?? display.channel ?? null;
    let projectId = display.project_id ?? null;
    let sessionId = channel
      ? `channel:${channel}`
      : display.session_id ?? `incident:${context.authority_id}:${request.incident_id}`;
    let toAgent = channel ?? display.to;
    let replyTo: number | null = null;
    if (request.incident_version > 1) {
      const root = db.prepare(
        `SELECT m.id, m.session_id, m.channel, m.project_id, m.to_agent
         FROM incident_projections p JOIN messages m ON m.id = p.message_id
         WHERE p.tenant_id = ? AND p.authority_id = ? AND p.incident_id = ? AND p.incident_version = 1`,
      ).get(context.tenant_id, context.authority_id, request.incident_id) as ProjectionRow | null;
      if (!root) throw new IncidentProjectionConflictError("Incident projection root is missing");
      sessionId = String(root.session_id);
      channel = root.channel == null ? null : String(root.channel);
      projectId = root.project_id == null ? null : String(root.project_id);
      toAgent = String(root.to_agent);
      replyTo = Number(root.id);
    }

    const pointer = JSON.stringify({
      canonical_incident_projection: {
        schema_version: 1,
        source: "todos",
        authority_id: context.authority_id,
        incident_id: request.incident_id,
        incident_version: request.incident_version,
        transition_id: request.transition_id,
        event_id: request.event_id,
        projection_key: request.projection_key,
      },
    });
    const messageRow = db.prepare(`
      INSERT INTO messages (
        uuid, session_id, from_agent, to_agent, channel, project_id, content, priority,
        working_dir, repository, branch, metadata, blocking, reply_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      randomUUID().replace(/-/g, ""),
      sessionId,
      display.from,
      toAgent,
      channel,
      projectId,
      display.content,
      display.priority ?? "normal",
      display.working_dir ?? null,
      display.repository ?? null,
      display.branch ?? null,
      pointer,
      validated.blocking ? 1 : 0,
      replyTo,
    ) as ProjectionRow;

    const incident = request.incident;
    const projectionRow = db.prepare(`
      INSERT INTO incident_projections (
        event_id, projection_key, message_id, schema_version, source, tenant_id, authority_id,
        incident_id, transition_id, incident_version, occurred_at, status, severity, blocking,
        affected_scopes, blocked_scopes, supersedes_transition_id, supersedes_incident_id,
        superseded_by_incident_id, canonical_payload, payload_hash
      ) VALUES (?, ?, ?, 1, 'todos', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      request.event_id,
      request.projection_key,
      Number(messageRow.id),
      context.tenant_id,
      context.authority_id,
      request.incident_id,
      request.transition_id,
      request.incident_version,
      request.occurred_at,
      incident.status,
      incident.severity,
      validated.blocking ? 1 : 0,
      JSON.stringify(incident.affected_scopes),
      JSON.stringify(incident.blocked_scopes),
      validated.supersedes_transition_id,
      incident.supersedes_id,
      incident.superseded_by_id,
      validated.canonical_payload,
      validated.payload_hash,
    ) as ProjectionRow;

    const scopeInsert = db.prepare(
      "INSERT INTO incident_projection_scopes (projection_id, scope_type, scope) VALUES (?, ?, ?)",
    );
    for (const scope of incident.affected_scopes) scopeInsert.run(Number(projectionRow.id), "affected", scope);
    for (const scope of incident.blocked_scopes) scopeInsert.run(Number(projectionRow.id), "blocked", scope);

    return projectionRecord(projectionRow, parseMessage(messageRow), false);
  });

  return write;
}

export function getIncidentProjection(
  eventId: string,
  context: IncidentProjectorContext,
): IncidentProjectionRecord | null {
  const row = findProjectionByEvent(context.tenant_id, eventId);
  if (!row || String(row.authority_id) !== context.authority_id) return null;
  return loadProjectionRecord(row, false);
}
