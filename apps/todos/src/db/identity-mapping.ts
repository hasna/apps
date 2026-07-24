import type { Database } from "bun:sqlite";
import {
  IdentityAliasAmbiguousError,
  IdentityIdImmutableError,
  type AgentIdentityAlias,
  type AgentIdentityMappingInput,
  type AgentIdentityMappingOutcome,
  type AgentIdentityReconciliationReport,
  type AgentIdentityResolution,
  type AgentIdentityResolutionInput,
  type AgentIdentitySourceMapping,
  type IdentityMappingBasis,
  type IdentityMappingLifecycleAction,
  type IdentityMappingStatus,
  type IdentityReadPreference,
  type IdentitySourceLineage,
} from "../types/index.js";

export {
  IdentityAliasAmbiguousError,
  IdentityIdImmutableError,
  type AgentIdentityAlias,
  type AgentIdentityMappingInput,
  type AgentIdentityMappingOutcome,
  type AgentIdentityReconciliationReport,
  type AgentIdentityResolution,
  type AgentIdentityResolutionInput,
  type AgentIdentitySourceMapping,
  type IdentityMappingBasis,
  type IdentityMappingLifecycleAction,
  type IdentityMappingStatus,
  type IdentityReadPreference,
  type IdentityResolutionTrust,
  type IdentitySourceLineage,
} from "../types/index.js";

export const IDENTITY_PROJECTION_CONTRACT = Object.freeze({
  name: "hasna.todos.agent-identity-projection/v1",
  version: 1,
  foundation_repository: "hasna/identities",
  foundation_pull_request: 14,
  foundation_contract: "hasna.identities.agent-identity/v1",
  foundation_version: 1,
  foundation_commit: "14d83e3e45df5748944a871a07c4aacece893169",
  foundation_fixture_id: "hasna.identities.agent-identity/v1/conformance/1",
  foundation_fixture_source_path: "docs/fixtures/agent-identity-v1.conformance.json",
  foundation_fixture_local_path: "src/db/fixtures/agent-identity-v1.conformance.json",
  foundation_fixture_sha256: "sha256:2d22e72b7315d0b06b3c67c71674cfd8c2dff552727eea00efb325f52c9420af",
  foundation_default_read_preference: "canonical_first",
  consumer_rollout_default_read_preference: "legacy_first",
  lease_fence_authority: "external Runtime Coordination",
});

export const IDENTITY_READ_PREFERENCE_ENV = "TODOS_IDENTITY_READ_PREFERENCE";
export const DEFAULT_IDENTITY_READ_PREFERENCE = "legacy_first" as const;
export const CANARY_IDENTITY_READ_PREFERENCE = "canonical_first" as const;
export const ROLLBACK_IDENTITY_READ_PREFERENCE = "legacy_first" as const;

const IDENTITY_MIGRATION_ID = 65;

function timestamp(): string {
  return new Date().toISOString();
}

function mappingId(): string {
  return crypto.randomUUID();
}

function normalizedRequired(value: string, field: string, lowercase = false): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`IDENTITY_SOURCE_LINEAGE_INVALID: ${field} is required`);
  return lowercase ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function normalizeLineage(source: IdentitySourceLineage): IdentitySourceLineage {
  return {
    source_authority: normalizedRequired(source.source_authority, "source_authority", true),
    source_tenant_id: normalizedRequired(source.source_tenant_id, "source_tenant_id", true),
    source_namespace: normalizedRequired(source.source_namespace, "source_namespace", true),
    source_entity_type: normalizedRequired(source.source_entity_type, "source_entity_type", true),
    source_record_id: normalizedRequired(source.source_record_id, "source_record_id"),
  };
}

function normalizedAlias(label: string): string {
  const normalized = label.trim().toLocaleLowerCase("en-US");
  if (!normalized) throw new Error("IDENTITY_ALIAS_INVALID: label is required");
  return normalized;
}

function sourceSubject(source: IdentitySourceLineage): string {
  return JSON.stringify([
    source.source_authority,
    source.source_tenant_id,
    source.source_namespace,
    source.source_entity_type,
    source.source_record_id,
  ]);
}

type AgentIdentitySourceMappingRow = Omit<AgentIdentitySourceMapping, "evidence"> & { evidence: string };

function mappingRowToSourceMapping(row: AgentIdentitySourceMappingRow): AgentIdentitySourceMapping {
  return {
    ...row,
    evidence: JSON.parse(row.evidence || "{}") as Record<string, unknown>,
  };
}

function currentSourceMappings(source: IdentitySourceLineage, db: Database): AgentIdentitySourceMapping[] {
  const normalized = normalizeLineage(source);
  const rows = db.query(`
    WITH lineage AS (
      SELECT * FROM agent_identity_source_mappings
      WHERE source_authority = ?
        AND source_tenant_id = ?
        AND source_namespace = ?
        AND source_entity_type = ?
        AND source_record_id = ?
        AND mapping_basis IN ('authoritative', 'imported')
    )
    SELECT * FROM lineage
    WHERE revision = (SELECT MAX(revision) FROM lineage)
    ORDER BY id
  `).all(
    normalized.source_authority,
    normalized.source_tenant_id,
    normalized.source_namespace,
    normalized.source_entity_type,
    normalized.source_record_id,
  ) as AgentIdentitySourceMappingRow[];
  return rows.map(mappingRowToSourceMapping);
}

function ensureColumn(db: Database, table: string, column: string, type: string): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Repairs partially-applied migration 65 without rewriting agent rows. The
 * transaction is bounded to local SQLite DDL and never touches task leases,
 * fences, heartbeats, or external Runtime Coordination state.
 */
export function ensureAgentIdentitySchema(db: Database): void {
  const install = db.transaction(() => {
    ensureColumn(db, "agents", "identity_id", "TEXT");
    ensureColumn(db, "agents", "project_id", "TEXT");
    ensureColumn(db, "agents", "runtime_instance_id", "TEXT");

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_identity_source_mappings (
        id TEXT PRIMARY KEY,
        local_agent_id TEXT REFERENCES agents(id) ON DELETE RESTRICT,
        identity_id TEXT,
        source_authority TEXT NOT NULL CHECK(length(trim(source_authority)) > 0),
        source_tenant_id TEXT NOT NULL CHECK(length(trim(source_tenant_id)) > 0),
        source_namespace TEXT NOT NULL CHECK(length(trim(source_namespace)) > 0),
        source_entity_type TEXT NOT NULL CHECK(length(trim(source_entity_type)) > 0),
        source_record_id TEXT NOT NULL CHECK(length(trim(source_record_id)) > 0),
        observed_label TEXT,
        evidence TEXT NOT NULL DEFAULT '{}',
        mapping_basis TEXT NOT NULL CHECK(mapping_basis IN ('authoritative', 'imported', 'candidate', 'name_similarity')),
        status TEXT NOT NULL CHECK(status IN ('active', 'retired', 'quarantined', 'revoked')),
        revision INTEGER NOT NULL CHECK(revision > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(mapping_basis IN ('authoritative', 'imported') OR status IN ('quarantined', 'revoked')),
        CHECK(status != 'active' OR (mapping_basis IN ('authoritative', 'imported') AND identity_id IS NOT NULL))
      );
    `);
    ensureColumn(db, "agent_identity_source_mappings", "revision", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn(db, "agent_identity_source_mappings", "evidence", "TEXT NOT NULL DEFAULT '{}'");
    db.exec(`
      DROP INDEX IF EXISTS idx_agent_identity_source_active_unique;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_identity_source_revision_unique
        ON agent_identity_source_mappings (
          source_authority, source_tenant_id, source_namespace, source_entity_type, source_record_id, revision
        )
        WHERE mapping_basis IN ('authoritative', 'imported');
      CREATE INDEX IF NOT EXISTS idx_agent_identity_source_identity
        ON agent_identity_source_mappings(identity_id);
      CREATE INDEX IF NOT EXISTS idx_agent_identity_source_local
        ON agent_identity_source_mappings(local_agent_id);
      DROP INDEX IF EXISTS idx_agents_identity_unique;

      CREATE TABLE IF NOT EXISTS agent_identity_aliases (
        id TEXT PRIMARY KEY,
        local_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        label TEXT NOT NULL,
        normalized_label TEXT NOT NULL,
        alias_kind TEXT NOT NULL CHECK(alias_kind IN ('historical', 'candidate')),
        status TEXT NOT NULL CHECK(status IN ('active', 'quarantined', 'revoked')),
        created_at TEXT NOT NULL,
        UNIQUE(local_agent_id, normalized_label)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_identity_alias_lookup
        ON agent_identity_aliases(normalized_label, status);

      CREATE TRIGGER IF NOT EXISTS trg_agents_identity_id_immutable
      BEFORE UPDATE OF identity_id ON agents
      WHEN OLD.identity_id IS NOT NULL AND OLD.identity_id IS NOT NEW.identity_id
      BEGIN
        SELECT RAISE(ABORT, 'IDENTITY_ID_IMMUTABLE');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_identity_mapping_identity_immutable
      BEFORE UPDATE OF identity_id ON agent_identity_source_mappings
      WHEN OLD.identity_id IS NOT NEW.identity_id
      BEGIN
        SELECT RAISE(ABORT, 'IDENTITY_ID_IMMUTABLE');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_identity_mapping_lineage_immutable
      BEFORE UPDATE OF source_authority, source_tenant_id, source_namespace, source_entity_type, source_record_id
        ON agent_identity_source_mappings
      WHEN OLD.source_authority IS NOT NEW.source_authority
        OR OLD.source_tenant_id IS NOT NEW.source_tenant_id
        OR OLD.source_namespace IS NOT NEW.source_namespace
        OR OLD.source_entity_type IS NOT NEW.source_entity_type
        OR OLD.source_record_id IS NOT NEW.source_record_id
      BEGIN
        SELECT RAISE(ABORT, 'IDENTITY_SOURCE_LINEAGE_IMMUTABLE');
      END;

      DROP TRIGGER IF EXISTS trg_agent_identity_mapping_history_immutable;
      CREATE TRIGGER trg_agent_identity_mapping_history_immutable
      BEFORE UPDATE OF local_agent_id, observed_label, evidence, mapping_basis, status, revision, created_at
        ON agent_identity_source_mappings
      BEGIN
        SELECT RAISE(ABORT, 'IDENTITY_MAPPING_HISTORY_IMMUTABLE');
      END;

      DROP TRIGGER IF EXISTS trg_agent_identity_mapping_history_append_only;
      CREATE TRIGGER trg_agent_identity_mapping_history_append_only
      BEFORE DELETE ON agent_identity_source_mappings
      BEGIN
        SELECT RAISE(ABORT, 'IDENTITY_MAPPING_HISTORY_IMMUTABLE');
      END;
    `);
    db.run("INSERT OR IGNORE INTO _migrations (id) VALUES (?)", [IDENTITY_MIGRATION_ID]);
  });
  install.immediate();
}

function identityReadPreference(explicit?: IdentityReadPreference): IdentityReadPreference {
  if (explicit) return explicit;
  const configured = process.env[IDENTITY_READ_PREFERENCE_ENV];
  if (
    configured === "canonical_first"
    || configured === "legacy_first"
    || configured === "canonical_only"
    || configured === "legacy_only"
  ) return configured;
  return DEFAULT_IDENTITY_READ_PREFERENCE;
}

function agentIdentity(agentId: string, db: Database): string | null | undefined {
  const row = db.query("SELECT identity_id FROM agents WHERE id = ?").get(agentId) as { identity_id: string | null } | null;
  return row ? row.identity_id : undefined;
}

function bindAgentIdentity(agentId: string, identityId: string, db: Database): void {
  const existing = agentIdentity(agentId, db);
  if (existing === undefined) throw new Error(`Agent not found: ${agentId}`);
  if (existing !== null && existing !== identityId) throw new IdentityIdImmutableError(agentId);
  if (existing === null) {
    db.run("UPDATE agents SET identity_id = ? WHERE id = ?", [identityId, agentId]);
  }
}

function sourceCollision(source: IdentitySourceLineage, mappings: AgentIdentitySourceMapping[]): IdentityAliasAmbiguousError {
  return new IdentityAliasAmbiguousError(
    sourceSubject(source),
    mappings.flatMap((mapping) => [mapping.identity_id, mapping.local_agent_id]).filter((value): value is string => Boolean(value)),
  );
}

type ProjectedMappingBasis = Extract<IdentityMappingBasis, "authoritative" | "imported">;
type ProjectedMappingStatus = Extract<IdentityMappingStatus, "active" | "retired">;

function projectedStatus(input: AgentIdentityMappingInput): ProjectedMappingStatus {
  const status = input.status ?? "active";
  if (status !== "active" && status !== "retired") {
    throw new Error(`IDENTITY_MAPPING_STATUS_INVALID: ${String(status)}`);
  }
  return status;
}

function projectedLocalAgentId(
  input: AgentIdentityMappingInput,
  current: AgentIdentitySourceMapping | undefined,
  identityId: string,
): string | null {
  if (input.local_agent_id !== undefined) return input.local_agent_id?.trim() || null;
  return current?.identity_id === identityId ? current.local_agent_id : null;
}

function projectedObservedLabel(
  input: AgentIdentityMappingInput,
  current: AgentIdentitySourceMapping | undefined,
): string | null {
  if (input.observed_label !== undefined) return input.observed_label?.trim() || null;
  return current?.observed_label ?? null;
}

function normalizeEvidenceValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => normalizeEvidenceValue(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      normalized[key] = normalizeEvidenceValue((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return normalized;
  }
  throw new Error(`IDENTITY_EVIDENCE_INVALID: ${path} must contain JSON values`);
}

function projectedEvidence(
  input: AgentIdentityMappingInput,
  current: AgentIdentitySourceMapping | undefined,
): Record<string, unknown> {
  const candidate = input.evidence ?? current?.evidence ?? {};
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== "object") {
    throw new Error("IDENTITY_EVIDENCE_INVALID: evidence must be an object");
  }
  return normalizeEvidenceValue(candidate, "evidence") as Record<string, unknown>;
}

function evidenceJson(evidence: Record<string, unknown>): string {
  return JSON.stringify(evidence);
}

function appendProjectedIdentityMapping(
  input: AgentIdentityMappingInput,
  mappingBasis: ProjectedMappingBasis,
  db: Database,
): AgentIdentitySourceMapping {
  const source = normalizeLineage(input);
  const identityId = input.identity_id?.trim();
  if (!identityId) throw new Error("IDENTITY_SOURCE_LINEAGE_INVALID: identity_id is required for projected mappings");
  const status = projectedStatus(input);

  const append = db.transaction((): AgentIdentitySourceMapping => {
    const existing = currentSourceMappings(source, db);
    if (existing.length > 1) throw sourceCollision(source, existing);
    const current = existing[0];
    const localAgentId = projectedLocalAgentId(input, current, identityId);
    const observedLabel = projectedObservedLabel(input, current);
    const evidence = projectedEvidence(input, current);

    if (localAgentId && mappingBasis === "authoritative" && status === "active") {
      bindAgentIdentity(localAgentId, identityId, db);
    } else if (localAgentId && agentIdentity(localAgentId, db) === undefined) {
      throw new Error(`Agent not found: ${localAgentId}`);
    }

    if (
      current
      && current.identity_id === identityId
      && current.local_agent_id === localAgentId
      && current.observed_label === observedLabel
      && evidenceJson(current.evidence) === evidenceJson(evidence)
      && current.mapping_basis === mappingBasis
      && current.status === status
    ) return current;

    const id = mappingId();
    const createdAt = timestamp();
    const revision = (current?.revision ?? 0) + 1;
    db.run(`
      INSERT INTO agent_identity_source_mappings (
        id, local_agent_id, identity_id, source_authority, source_tenant_id, source_namespace,
        source_entity_type, source_record_id, observed_label, evidence, mapping_basis, status, revision,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      localAgentId,
      identityId,
      source.source_authority,
      source.source_tenant_id,
      source.source_namespace,
      source.source_entity_type,
      source.source_record_id,
      observedLabel,
      evidenceJson(evidence),
      mappingBasis,
      status,
      revision,
      createdAt,
      createdAt,
    ]);
    return mappingRowToSourceMapping(
      db.query("SELECT * FROM agent_identity_source_mappings WHERE id = ?").get(id) as AgentIdentitySourceMappingRow,
    );
  });

  try {
    return append.immediate();
  } catch (error) {
    if (error instanceof IdentityAliasAmbiguousError || error instanceof IdentityIdImmutableError) throw error;
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      const current = currentSourceMappings(source, db);
      if (current.length > 1) throw sourceCollision(source, current);
    }
    throw error;
  }
}

export function bindAuthoritativeIdentityMapping(
  input: Omit<AgentIdentityMappingInput, "mapping_basis">,
  db: Database,
): AgentIdentitySourceMapping {
  return appendProjectedIdentityMapping({ ...input, mapping_basis: "authoritative" }, "authoritative", db);
}

function lifecycleAction(
  current: AgentIdentitySourceMapping | undefined,
  mappingBasis: ProjectedMappingBasis,
  status: ProjectedMappingStatus,
  identityId: string,
  localAgentId: string | null,
  observedLabel: string | null,
  evidence: Record<string, unknown>,
): IdentityMappingLifecycleAction {
  if (!current) return "create";
  if (
    current.identity_id === identityId
    && current.local_agent_id === localAgentId
    && current.observed_label === observedLabel
    && evidenceJson(current.evidence) === evidenceJson(evidence)
    && current.mapping_basis === mappingBasis
    && current.status === status
  ) return "unchanged";
  if (status === "retired" && current.status !== "retired") return "retire";
  if (
    mappingBasis === "authoritative"
    && status === "active"
    && current.identity_id === identityId
    && (current.mapping_basis !== "authoritative" || current.status !== "active")
  ) return "promote";
  return "correct";
}

function lifecycleReason(action: IdentityMappingLifecycleAction, mappingBasis: ProjectedMappingBasis): string {
  if (action === "promote") return "authoritative_mapping_promotion_available";
  if (action === "correct") return "authoritative_mapping_correction_available";
  if (action === "retire") return "authoritative_mapping_retirement_available";
  if (action === "unchanged") return `${mappingBasis}_mapping_exists`;
  return `${mappingBasis}_mapping_available`;
}

function classifyProjected(
  input: AgentIdentityMappingInput,
  mappingBasis: ProjectedMappingBasis,
  db: Database,
): AgentIdentityMappingOutcome {
  const source = normalizeLineage(input);
  const existing = currentSourceMappings(source, db);
  const identityId = input.identity_id?.trim() || null;
  const status = projectedStatus(input);
  const blocked = (classification: "ambiguous" | "unmapped", reason: string): AgentIdentityMappingOutcome => ({
    ...input,
    ...source,
    status,
    classification,
    mapping_id: null,
    previous_mapping_id: existing[0]?.id ?? null,
    lifecycle_action: "blocked",
    reason,
  });
  if (!identityId) return blocked("unmapped", `${mappingBasis}_identity_missing`);
  if (existing.length > 1) return blocked("ambiguous", "multiple_authoritative_results");

  const current = existing[0];
  const localAgentId = projectedLocalAgentId(input, current, identityId);
  const observedLabel = projectedObservedLabel(input, current);
  const evidence = projectedEvidence(input, current);
  if (localAgentId) {
    const projected = agentIdentity(localAgentId, db);
    if (projected === undefined) return blocked("unmapped", "local_agent_missing");
    if (mappingBasis === "authoritative" && status === "active" && projected !== null && projected !== identityId) {
      return blocked("ambiguous", "identity_id_immutable");
    }
  }

  const action = lifecycleAction(current, mappingBasis, status, identityId, localAgentId, observedLabel, evidence);
  return {
    ...input,
    ...source,
    status,
    local_agent_id: localAgentId,
    observed_label: observedLabel,
    evidence,
    classification: "uniquely_mapped",
    mapping_id: current?.id ?? null,
    previous_mapping_id: current?.id ?? null,
    lifecycle_action: action,
    reason: lifecycleReason(action, mappingBasis),
  };
}

function insertQuarantinedMapping(input: AgentIdentityMappingInput, db: Database): string {
  const insert = db.transaction((): string => {
    const source = normalizeLineage(input);
    const localAgentId = input.local_agent_id?.trim() || null;
    const identityId = input.identity_id?.trim() || null;
    const observedLabel = input.observed_label?.trim() || null;
    const evidence = projectedEvidence(input, undefined);
    const serializedEvidence = evidenceJson(evidence);
    const existing = db.query(`
    SELECT id FROM agent_identity_source_mappings
    WHERE source_authority = ? AND source_tenant_id = ? AND source_namespace = ?
      AND source_entity_type = ? AND source_record_id = ?
      AND mapping_basis = ? AND status = 'quarantined'
      AND local_agent_id IS ? AND identity_id IS ? AND observed_label IS ? AND evidence = ?
    ORDER BY created_at, id LIMIT 1
  `).get(
    source.source_authority,
    source.source_tenant_id,
    source.source_namespace,
    source.source_entity_type,
    source.source_record_id,
    input.mapping_basis,
    localAgentId,
    identityId,
    observedLabel,
    serializedEvidence,
  ) as { id: string } | null;
    if (existing) return existing.id;

    const id = mappingId();
    const createdAt = timestamp();
    db.run(`
    INSERT INTO agent_identity_source_mappings (
      id, local_agent_id, identity_id, source_authority, source_tenant_id, source_namespace,
      source_entity_type, source_record_id, observed_label, evidence, mapping_basis, status, revision,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', 1, ?, ?)
  `, [
    id,
    localAgentId,
    identityId,
    source.source_authority,
    source.source_tenant_id,
    source.source_namespace,
    source.source_entity_type,
    source.source_record_id,
    observedLabel,
    serializedEvidence,
    input.mapping_basis,
    createdAt,
    createdAt,
  ]);
    if (localAgentId && observedLabel) {
      storeAgentAliasInCurrentTransaction(localAgentId, observedLabel, "candidate", "quarantined", db);
    }
    return id;
  });
  return insert.immediate();
}

function addOutcome(report: AgentIdentityReconciliationReport, outcome: AgentIdentityMappingOutcome): void {
  if (outcome.classification === "uniquely_mapped") report.uniquely_mapped.push(outcome);
  else if (outcome.classification === "ambiguous") report.ambiguous.push(outcome);
  else report.unmapped.push(outcome);
}

export function reconcileAgentIdentityMappings(
  inputs: AgentIdentityMappingInput[],
  options: { dry_run: boolean },
  db: Database,
): AgentIdentityReconciliationReport {
  const report: AgentIdentityReconciliationReport = {
    dry_run: options.dry_run,
    uniquely_mapped: [],
    ambiguous: [],
    unmapped: [],
  };

  for (const input of inputs) {
    if (input.mapping_basis === "authoritative" || input.mapping_basis === "imported") {
      const outcome = classifyProjected(input, input.mapping_basis, db);
      if (!options.dry_run && outcome.classification === "uniquely_mapped") {
        try {
          const mapping = appendProjectedIdentityMapping(input, input.mapping_basis, db);
          outcome.mapping_id = mapping.id;
          outcome.reason = outcome.lifecycle_action === "unchanged"
            ? `${input.mapping_basis}_mapping_unchanged`
            : `${outcome.lifecycle_action}_applied`;
        } catch (error) {
          if (error instanceof IdentityAliasAmbiguousError || error instanceof IdentityIdImmutableError) {
            outcome.classification = "ambiguous";
            outcome.mapping_id = null;
            outcome.lifecycle_action = "blocked";
            outcome.reason = error.code.toLowerCase();
          } else {
            throw error;
          }
        }
      }
      addOutcome(report, outcome);
      continue;
    }

    const source = normalizeLineage(input);
    const outcome: AgentIdentityMappingOutcome = {
      ...input,
      ...source,
      classification: "unmapped",
      mapping_id: options.dry_run ? null : insertQuarantinedMapping(input, db),
      previous_mapping_id: null,
      lifecycle_action: "quarantine",
      reason: input.mapping_basis === "name_similarity" ? "name_similarity_quarantined" : "candidate_quarantined",
    };
    addOutcome(report, outcome);
  }
  return report;
}

function resolveCanonical(input: AgentIdentityResolutionInput, db: Database): AgentIdentityResolution | null {
  const identityId = input.identity_id?.trim();
  if (identityId) {
    const rows = db.query("SELECT id FROM agents WHERE identity_id = ? ORDER BY id").all(identityId) as Array<{ id: string }>;
    if (rows.length > 1) {
      throw new IdentityAliasAmbiguousError(identityId, rows.map((row) => row.id));
    }
    if (rows.length === 0) return null;
    return {
      identity_id: identityId,
      local_agent_id: rows[0]!.id,
      resolved_by: "identity_id",
      trust: "authoritative",
    };
  }
  if (input.source) {
    const source = normalizeLineage(input.source);
    const mappings = currentSourceMappings(source, db);
    if (mappings.length > 1) throw sourceCollision(source, mappings);
    const mapping = mappings[0];
    if (mapping) {
      return {
        identity_id: mapping.identity_id,
        local_agent_id: mapping.local_agent_id,
        resolved_by: "source",
        trust: mapping.mapping_basis === "authoritative" && mapping.status === "active"
          ? "authoritative"
          : "non_authoritative",
      };
    }
  }
  return null;
}

function legacyAliasAgentIds(alias: string, db: Database): string[] {
  const normalized = normalizedAlias(alias);
  const rows = db.query(`
    SELECT id AS local_agent_id FROM agents WHERE lower(name) = ?
    UNION
    SELECT local_agent_id FROM agent_identity_aliases
      WHERE normalized_label = ? AND status = 'active'
    ORDER BY local_agent_id
  `).all(normalized, normalized) as Array<{ local_agent_id: string }>;
  return rows.map((row) => row.local_agent_id);
}

function resolveLegacy(input: AgentIdentityResolutionInput, db: Database): AgentIdentityResolution | null {
  const localAgentId = input.local_agent_id?.trim();
  if (localAgentId) {
    const exists = db.query("SELECT id FROM agents WHERE id = ?").get(localAgentId) as { id: string } | null;
    if (exists) {
      return {
        identity_id: null,
        local_agent_id: localAgentId,
        resolved_by: "legacy_local_id",
        trust: "non_authoritative",
      };
    }
  }
  const alias = input.alias?.trim();
  if (alias) {
    const matches = legacyAliasAgentIds(alias, db);
    if (matches.length > 1) throw new IdentityAliasAmbiguousError(alias, matches);
    if (matches.length === 1) {
      return {
        identity_id: null,
        local_agent_id: matches[0]!,
        resolved_by: "legacy_alias",
        trust: "non_authoritative",
      };
    }
  }
  return null;
}

export function resolveAgentIdentity(
  input: AgentIdentityResolutionInput,
  options: { read_preference?: IdentityReadPreference } = {},
  db: Database,
): AgentIdentityResolution {
  const preference = identityReadPreference(options.read_preference);
  const denied: AgentIdentityResolution = {
    identity_id: null,
    local_agent_id: null,
    resolved_by: "none",
    trust: "denied",
  };
  if (preference === "canonical_only") {
    return resolveCanonical(input, db) ?? denied;
  }
  if (preference === "legacy_only") {
    return resolveLegacy(input, db) ?? denied;
  }
  const canonicalFirst = preference === "canonical_first";
  const first = canonicalFirst ? resolveCanonical(input, db) : resolveLegacy(input, db);
  if (first) return first;
  const fallback = canonicalFirst ? resolveLegacy(input, db) : resolveCanonical(input, db);
  return fallback ?? denied;
}

function storeAgentAliasInCurrentTransaction(
  agentId: string,
  label: string,
  aliasKind: "historical" | "candidate",
  status: "active" | "quarantined",
  db: Database,
): AgentIdentityAlias {
  const normalized = normalizedAlias(label);
  const exists = db.query("SELECT id FROM agents WHERE id = ?").get(agentId);
  if (!exists) throw new Error(`Agent not found: ${agentId}`);
  const existing = db.query(`
    SELECT * FROM agent_identity_aliases
    WHERE local_agent_id = ? AND normalized_label = ?
  `).get(agentId, normalized) as AgentIdentityAlias | null;
  if (existing) {
    if (aliasKind === "historical" && (existing.alias_kind !== "historical" || existing.status !== "active")) {
      db.run(
        "UPDATE agent_identity_aliases SET label = ?, alias_kind = 'historical', status = 'active' WHERE id = ?",
        [label.trim(), existing.id],
      );
      return db.query("SELECT * FROM agent_identity_aliases WHERE id = ?").get(existing.id) as AgentIdentityAlias;
    }
    return existing;
  }
  const id = mappingId();
  db.run(`
    INSERT INTO agent_identity_aliases (
      id, local_agent_id, label, normalized_label, alias_kind, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, agentId, label.trim(), normalized, aliasKind, status, timestamp()]);
  return db.query("SELECT * FROM agent_identity_aliases WHERE id = ?").get(id) as AgentIdentityAlias;
}

function storeAgentAlias(
  agentId: string,
  label: string,
  aliasKind: "historical" | "candidate",
  status: "active" | "quarantined",
  db: Database,
): AgentIdentityAlias {
  if (db.inTransaction) {
    return storeAgentAliasInCurrentTransaction(agentId, label, aliasKind, status, db);
  }
  const store = db.transaction(() => storeAgentAliasInCurrentTransaction(agentId, label, aliasKind, status, db));
  return store.immediate();
}

export function recordAgentAlias(agentId: string, label: string, db: Database): AgentIdentityAlias {
  return storeAgentAlias(agentId, label, "historical", "active", db);
}

export function recordAgentAliasCandidate(agentId: string, label: string, db: Database): AgentIdentityAlias {
  return storeAgentAlias(agentId, label, "candidate", "quarantined", db);
}

export function listAgentAliases(agentId: string, db: Database): AgentIdentityAlias[] {
  return db.query(`
    SELECT * FROM agent_identity_aliases
    WHERE local_agent_id = ?
    ORDER BY created_at, id
  `).all(agentId) as AgentIdentityAlias[];
}
