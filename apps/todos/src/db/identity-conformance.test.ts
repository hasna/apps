import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { AgentIdentityMappingInput, IdentitySourceLineage } from "../types/index.js";
import { registerAgent } from "./agents.js";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import {
  CANARY_IDENTITY_READ_PREFERENCE,
  DEFAULT_IDENTITY_READ_PREFERENCE,
  IDENTITY_PROJECTION_CONTRACT,
  reconcileAgentIdentityMappings,
  ROLLBACK_IDENTITY_READ_PREFERENCE,
  resolveAgentIdentity,
} from "./identity-mapping.js";

interface FoundationRevision {
  revision: number;
  action: "create" | "promote" | "correct" | "retire";
  identity_id: string;
  mapping_kind: "authoritative" | "imported";
  status: "active" | "retired";
  evidence: Record<string, unknown>;
}

interface FoundationFixture {
  fixture_id: string;
  contract: string;
  version: number;
  lineage: {
    field_order: string[];
    input: IdentitySourceLineage;
    normalized: IdentitySourceLineage;
    canonical_key: string;
  };
  ambiguity: { public_code: string };
  lifecycle: {
    unchanged: { appends_revision: boolean; current_revision: number };
    revisions: FoundationRevision[];
  };
  read_preferences: { default: string; canary: string; rollback: string };
  runtime_context: { runtime_field: string; lease_fence_authority: string };
}

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "agent-identity-v1.conformance.json");

describe("hasna/identities agent identity V1 conformance", () => {
  let db: Database;

  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env["TODOS_DB_PATH"];
  });

  it("pins the corrected foundation fixture with exact provenance and fingerprint", () => {
    const bytes = readFileSync(FIXTURE_PATH);
    const fingerprint = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const fixture = JSON.parse(bytes.toString("utf8")) as FoundationFixture;

    expect(IDENTITY_PROJECTION_CONTRACT).toMatchObject({
      foundation_repository: "hasna/identities",
      foundation_pull_request: 14,
      foundation_commit: "14d83e3e45df5748944a871a07c4aacece893169",
      foundation_contract: fixture.contract,
      foundation_version: fixture.version,
      foundation_fixture_id: fixture.fixture_id,
      foundation_fixture_source_path: "docs/fixtures/agent-identity-v1.conformance.json",
      foundation_fixture_local_path: "src/db/fixtures/agent-identity-v1.conformance.json",
      foundation_fixture_sha256: fingerprint,
    });
    expect(fingerprint).toBe("sha256:2d22e72b7315d0b06b3c67c71674cfd8c2dff552727eea00efb325f52c9420af");
    expect(bytes.toString("utf8")).not.toContain("/home/");
    expect(bytes.toString("utf8")).not.toMatch(/https?:\/\//);
    expect(fixture.ambiguity.public_code).toBe("IDENTITY_ALIAS_AMBIGUOUS");
    expect(fixture.runtime_context).toEqual({
      runtime_field: "runtime_instance_id",
      lease_fence_authority: "external Runtime Coordination",
    });
  });

  it("replays normalized lineage, immutable evidence, lifecycle, and read preferences offline", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as FoundationFixture;
    const original = registerAgent({ name: "pliny" }, db);
    const corrected = registerAgent({ name: "seneca" }, db);
    if ("conflict" in original || "conflict" in corrected) throw new Error("unexpected registration conflict");
    const localIds = new Map([
      ["identity-original", original.id],
      ["identity-corrected", corrected.id],
    ]);

    expect(fixture.lineage.field_order).toEqual([
      "source_authority",
      "source_tenant_id",
      "source_namespace",
      "source_entity_type",
      "source_record_id",
    ]);
    expect(JSON.stringify(Object.values(fixture.lineage.normalized))).toBe(fixture.lineage.canonical_key);

    for (const expected of fixture.lifecycle.revisions) {
      const input: AgentIdentityMappingInput & { evidence: Record<string, unknown> } = {
        ...fixture.lineage.input,
        local_agent_id: localIds.get(expected.identity_id)!,
        identity_id: expected.identity_id,
        observed_label: String(expected.evidence["observed_label"]),
        mapping_basis: expected.mapping_kind,
        status: expected.status,
        evidence: expected.evidence,
      };
      const changesBefore = (db.query("SELECT total_changes() AS count").get() as { count: number }).count;
      const dryRun = reconcileAgentIdentityMappings([input], { dry_run: true }, db);
      const changesAfter = (db.query("SELECT total_changes() AS count").get() as { count: number }).count;
      expect(dryRun.uniquely_mapped[0]?.lifecycle_action).toBe(expected.action);
      expect(changesAfter).toBe(changesBefore);

      const applied = reconcileAgentIdentityMappings([input], { dry_run: false }, db);
      expect(applied.uniquely_mapped[0]?.lifecycle_action).toBe(expected.action);
    }

    const rows = db.query(`
      SELECT source_authority, source_tenant_id, source_namespace, source_entity_type,
             source_record_id, identity_id, mapping_basis, status, revision, evidence
      FROM agent_identity_source_mappings
      ORDER BY revision
    `).all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(fixture.lifecycle.revisions.length);
    expect(rows.map((row) => ({
      source: {
        source_authority: row["source_authority"],
        source_tenant_id: row["source_tenant_id"],
        source_namespace: row["source_namespace"],
        source_entity_type: row["source_entity_type"],
        source_record_id: row["source_record_id"],
      },
      identity_id: row["identity_id"],
      mapping_kind: row["mapping_basis"],
      status: row["status"],
      revision: row["revision"],
      evidence: JSON.parse(String(row["evidence"])),
    }))).toEqual(fixture.lifecycle.revisions.map((revision) => ({
      source: fixture.lineage.normalized,
      identity_id: revision.identity_id,
      mapping_kind: revision.mapping_kind,
      status: revision.status,
      revision: revision.revision,
      evidence: revision.evidence,
    })));

    const unchangedInput: AgentIdentityMappingInput & { evidence: Record<string, unknown> } = {
      ...fixture.lineage.normalized,
      local_agent_id: corrected.id,
      identity_id: "identity-corrected",
      observed_label: "Corrected label",
      mapping_basis: "authoritative",
      status: "retired",
      evidence: { observed_label: "Corrected label", evidence_id: "evidence-2" },
    };
    const unchanged = reconcileAgentIdentityMappings([unchangedInput], { dry_run: false }, db);
    expect(unchanged.uniquely_mapped[0]?.lifecycle_action).toBe("unchanged");
    expect(db.query("SELECT COUNT(*) AS count FROM agent_identity_source_mappings").get()).toEqual({
      count: fixture.lifecycle.revisions.length,
    });

    expect(resolveAgentIdentity({ source: fixture.lineage.normalized }, { read_preference: "canonical_first" }, db))
      .toMatchObject({ identity_id: "identity-corrected", trust: "non_authoritative" });
    expect(IDENTITY_PROJECTION_CONTRACT.foundation_default_read_preference).toBe(fixture.read_preferences.default);
    expect(DEFAULT_IDENTITY_READ_PREFERENCE).toBe("legacy_first");
    expect(CANARY_IDENTITY_READ_PREFERENCE).toBe(fixture.read_preferences.canary);
    expect(ROLLBACK_IDENTITY_READ_PREFERENCE).toBe(fixture.read_preferences.rollback);
  });
});
