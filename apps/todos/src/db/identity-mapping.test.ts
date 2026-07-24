import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAvailableNamesFromPool,
  getAgent,
  getAgentByName,
  isAgentConflict,
  listAgents,
  registerAgent,
  updateAgent,
} from "./agents.js";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { MIGRATIONS } from "./migrations.js";
import {
  bindAuthoritativeIdentityMapping,
  CANARY_IDENTITY_READ_PREFERENCE,
  DEFAULT_IDENTITY_READ_PREFERENCE,
  ensureAgentIdentitySchema,
  IdentityAliasAmbiguousError,
  IDENTITY_PROJECTION_CONTRACT,
  listAgentAliases,
  reconcileAgentIdentityMappings,
  recordAgentAlias,
  ROLLBACK_IDENTITY_READ_PREFERENCE,
  resolveAgentIdentity,
  type IdentitySourceLineage,
} from "./identity-mapping.js";

const GITHUB_ACTOR_SOURCE: IdentitySourceLineage = {
  source_authority: "github.com",
  source_tenant_id: "hasna",
  source_namespace: "accounts",
  source_entity_type: "user",
  source_record_id: "actor-42",
};

function expectIdentityAmbiguity(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityAliasAmbiguousError);
    expect((error as IdentityAliasAmbiguousError).code).toBe("IDENTITY_ALIAS_AMBIGUOUS");
    return;
  }
  throw new Error("Expected IDENTITY_ALIAS_AMBIGUOUS");
}

describe("agent identity projection contract", () => {
  let db: Database;

  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    delete process.env["TODOS_AGENT_AUTO_RELEASE"];
    delete process.env["TODOS_IDENTITY_READ_PREFERENCE"];
    resetDatabase();
    db = getDatabase();
  });

  afterEach(() => {
    delete process.env["TODOS_AGENT_AUTO_RELEASE"];
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
    delete process.env["TODOS_IDENTITY_READ_PREFERENCE"];
    closeDatabase();
    delete process.env["TODOS_DB_PATH"];
  });

  it("uses the frozen local contract name and version", () => {
    expect(IDENTITY_PROJECTION_CONTRACT).toEqual({
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
    expect(DEFAULT_IDENTITY_READ_PREFERENCE).toBe("legacy_first");
    expect(CANARY_IDENTITY_READ_PREFERENCE).toBe("canonical_first");
    expect(ROLLBACK_IDENTITY_READ_PREFERENCE).toBe("legacy_first");
    expect(resolveAgentIdentity({}, {}, db)).toEqual({
      identity_id: null,
      local_agent_id: null,
      resolved_by: "none",
      trust: "denied",
    });
    expect(resolveAgentIdentity(
      { identity_id: "identity-unknown" },
      { read_preference: "canonical_only" },
      db,
    )).toEqual({
      identity_id: null,
      local_agent_id: null,
      resolved_by: "none",
      trust: "denied",
    });
  });

  it("keeps agent list and availability reads byte-for-byte non-mutating", () => {
    const agent = registerAgent({ name: "aurelius", session_id: "session-stale" }, db);
    if ("conflict" in agent) throw new Error(agent.message);
    const staleAt = "2026-01-01T00:00:00.000Z";
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleAt, agent.id]);
    recordAgentAlias(agent.id, "aurelius-old", db);
    process.env["TODOS_AGENT_AUTO_RELEASE"] = "true";

    const before = db.query("SELECT * FROM agents WHERE id = ?").get(agent.id);
    const changesBefore = db.query("SELECT total_changes() AS count").get() as { count: number };

    expect(listAgents(db).map((item) => item.id)).toContain(agent.id);
    expect(getAvailableNamesFromPool(["aurelius", "cassius"], db)).toEqual(["aurelius", "cassius"]);
    expect(getAgent(agent.id, db)?.id).toBe(agent.id);
    expect(getAgentByName("aurelius", db)?.id).toBe(agent.id);
    expect(listAgentAliases(agent.id, db)).toHaveLength(1);
    expect(resolveAgentIdentity(
      { alias: "aurelius-old" },
      { read_preference: "legacy_first" },
      db,
    )).toMatchObject({ local_agent_id: agent.id, trust: "non_authoritative" });

    const after = db.query("SELECT * FROM agents WHERE id = ?").get(agent.id);
    const changesAfter = db.query("SELECT total_changes() AS count").get() as { count: number };
    expect(after).toEqual(before);
    expect(changesAfter.count).toBe(changesBefore.count);
  });

  it("fails closed on a stale label collision without generating an eviction suffix", () => {
    const holder = registerAgent({ name: "octavia" }, db);
    const requester = registerAgent({ name: "livia" }, db);
    if ("conflict" in holder || "conflict" in requester) throw new Error("unexpected registration conflict");
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", holder.id]);

    expectIdentityAmbiguity(() => updateAgent(requester.id, { name: "octavia" }, db));

    expect(getAgent(holder.id, db)?.name).toBe("octavia");
    expect(getAgent(requester.id, db)?.name).toBe("livia");
    const generated = db.query("SELECT name FROM agents WHERE name LIKE '%__evicted_%'").all();
    expect(generated).toEqual([]);
  });

  it("stores structured nullable projection metadata and never creates runtime_id", () => {
    ensureAgentIdentitySchema(db);
    const columns = (db.query("PRAGMA table_info(agents)").all() as Array<{ name: string }>).map((row) => row.name);
    for (const column of [
      "identity_id",
      "machine_id",
      "project_id",
      "role",
      "session_id",
      "runtime_instance_id",
    ]) expect(columns).toContain(column);
    expect(columns).not.toContain("runtime_id");
  });

  it("normalizes authority, tenant, namespace, and entity type into one qualified lineage", () => {
    const agent = registerAgent({ name: "plotinus" }, db);
    if ("conflict" in agent) throw new Error(agent.message);
    bindAuthoritativeIdentityMapping({
      source_authority: "GitHub.COM",
      source_tenant_id: "HASNA",
      source_namespace: "Accounts",
      source_entity_type: "USER",
      source_record_id: "Actor-Case-Sensitive",
      local_agent_id: agent.id,
      identity_id: "identity-plotinus",
    }, db);
    bindAuthoritativeIdentityMapping({
      source_authority: "github.com",
      source_tenant_id: "hasna",
      source_namespace: "accounts",
      source_entity_type: "user",
      source_record_id: "Actor-Case-Sensitive",
      local_agent_id: agent.id,
      identity_id: "identity-plotinus",
    }, db);

    expect(db.query("SELECT COUNT(*) AS count FROM agent_identity_source_mappings").get()).toEqual({ count: 1 });
    expect(resolveAgentIdentity({
      source: {
        source_authority: "GITHUB.COM",
        source_tenant_id: "HASNA",
        source_namespace: "ACCOUNTS",
        source_entity_type: "USER",
        source_record_id: "Actor-Case-Sensitive",
      },
    }, { read_preference: "canonical_only" }, db).identity_id).toBe("identity-plotinus");
  });

  it("migrates a legacy agent database additively without rewriting local IDs or labels", () => {
    closeDatabase();
    resetDatabase();
    const root = mkdtempSync(join(tmpdir(), "todos-identity-migration-"));
    const path = join(root, "todos.db");
    const legacy = new Database(path);
    for (const migration of MIGRATIONS.slice(0, 64)) legacy.exec(migration);
    legacy.run(
      "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
      ["legacy01", "legacylabel", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    );
    legacy.close();

    try {
      const migrated = getDatabase(path);
      expect(migrated.query("SELECT id, name, identity_id FROM agents WHERE id = 'legacy01'").get()).toEqual({
        id: "legacy01",
        name: "legacylabel",
        identity_id: null,
      });
      expect(migrated.query("SELECT MAX(id) AS id FROM _migrations").get()).toEqual({ id: 65 });
      expect(migrated.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_identity_source_mappings'",
      ).get()).toEqual({ name: "agent_identity_source_mappings" });
    } finally {
      closeDatabase();
      resetDatabase();
      rmSync(root, { recursive: true, force: true });
      process.env["TODOS_DB_PATH"] = ":memory:";
      db = getDatabase();
    }
  });

  it("quarantines name-similarity candidates and never infers identity_id from a name", () => {
    ensureAgentIdentitySchema(db);
    const agent = registerAgent({ name: "cassius" }, db);
    if ("conflict" in agent) throw new Error(agent.message);

    const report = reconcileAgentIdentityMappings([
      {
        ...GITHUB_ACTOR_SOURCE,
        local_agent_id: agent.id,
        identity_id: "identity-candidate",
        observed_label: "cassius",
        mapping_basis: "name_similarity",
      },
    ], { dry_run: false }, db);

    expect(report.uniquely_mapped).toHaveLength(0);
    expect(report.ambiguous).toHaveLength(0);
    expect(report.unmapped).toHaveLength(1);
    expect(getAgent(agent.id, db)?.identity_id).toBeNull();
    expect(resolveAgentIdentity({ alias: "cassius" }, { read_preference: "canonical_first" }, db)).toEqual({
      identity_id: null,
      local_agent_id: agent.id,
      resolved_by: "legacy_alias",
      trust: "non_authoritative",
    });
    const mapping = db.query(
      "SELECT mapping_basis, status FROM agent_identity_source_mappings WHERE source_record_id = ?",
    ).get(GITHUB_ACTOR_SOURCE.source_record_id) as { mapping_basis: string; status: string };
    expect(mapping).toEqual({ mapping_basis: "name_similarity", status: "quarantined" });
  });

  it("uses canonical identity rather than a display label as registration authority", () => {
    ensureAgentIdentitySchema(db);
    const original = registerAgent({
      name: "maximus",
      identity_id: "identity-maximus",
      session_id: "session-one",
      runtime_instance_id: "runtime-instance-one",
      project_id: "project-one",
    }, db);
    if ("conflict" in original) throw new Error(original.message);

    const labelOnly = registerAgent({ name: "maximus", session_id: "session-one" }, db);
    expect(isAgentConflict(labelOnly)).toBe(true);

    const sameIdentityNewLabel = registerAgent({
      name: "differentlabel",
      identity_id: "identity-maximus",
      session_id: "session-one",
    }, db);
    if ("conflict" in sameIdentityNewLabel) throw new Error(sameIdentityNewLabel.message);
    expect(sameIdentityNewLabel.id).toBe(original.id);
    expect(sameIdentityNewLabel.name).toBe("maximus");
    expect(db.query("SELECT COUNT(*) AS count FROM agents WHERE identity_id = ?").get("identity-maximus"))
      .toEqual({ count: 1 });
    expect(getAgent(original.id, db)).toMatchObject({
      identity_id: "identity-maximus",
      project_id: "project-one",
      session_id: "session-one",
      runtime_instance_id: "runtime-instance-one",
    });
    expect(getAgentByName("maximus", db)?.identity_id).toBeNull();
  });

  it("never binds an existing legacy actor to identity_id from a name-selected registration", () => {
    const legacy = registerAgent({ name: "vitruvius" }, db);
    if ("conflict" in legacy) throw new Error(legacy.message);

    expectIdentityAmbiguity(() => registerAgent({
      name: "vitruvius",
      identity_id: "identity-vitruvius",
    }, db));

    expect(getAgent(legacy.id, db)?.identity_id).toBeNull();
  });

  it("fails closed with a typed code for an ambiguous historical alias", () => {
    ensureAgentIdentitySchema(db);
    const first = registerAgent({ name: "marcus" }, db);
    const second = registerAgent({ name: "tiberius" }, db);
    if ("conflict" in first || "conflict" in second) throw new Error("unexpected registration conflict");
    recordAgentAlias(first.id, "legacy-label", db);
    recordAgentAlias(second.id, "legacy-label", db);

    expectIdentityAmbiguity(() => resolveAgentIdentity({ alias: "legacy-label" }, { read_preference: "legacy_first" }, db));
  });

  it("serializes concurrently competing authoritative source bindings across processes", async () => {
    closeDatabase();
    resetDatabase();
    const root = mkdtempSync(join(tmpdir(), "todos-identity-race-"));
    const path = join(root, "todos.db");
    const firstDb = getDatabase(path);
    const first = registerAgent({ name: "hadrian" }, firstDb);
    const second = registerAgent({ name: "trajan" }, firstDb);
    if ("conflict" in first || "conflict" in second) throw new Error("unexpected registration conflict");

    try {
      const moduleUrl = new URL("./identity-mapping.ts", import.meta.url).href;
      const childScript = `
        import { Database } from "bun:sqlite";
        import { bindAuthoritativeIdentityMapping } from ${JSON.stringify(moduleUrl)};
        const db = new Database(process.env.TODOS_RACE_DB);
        db.run("PRAGMA busy_timeout = 5000");
        db.run("PRAGMA foreign_keys = ON");
        try {
          bindAuthoritativeIdentityMapping(JSON.parse(process.env.TODOS_RACE_INPUT), db);
          console.log("bound");
        } catch (error) {
          throw error;
        } finally {
          db.close();
        }
      `;
      const inputs = [
        { ...GITHUB_ACTOR_SOURCE, local_agent_id: first.id, identity_id: "identity-one" },
        { ...GITHUB_ACTOR_SOURCE, local_agent_id: second.id, identity_id: "identity-two" },
      ];
      const children = inputs.map((input) => Bun.spawn([process.execPath, "--eval", childScript], {
        env: { ...process.env, TODOS_RACE_DB: path, TODOS_RACE_INPUT: JSON.stringify(input) },
        stdout: "pipe",
        stderr: "pipe",
      }));
      const results = await Promise.all(children.map(async (child) => {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (exitCode !== 0) throw new Error(stderr || `identity race child exited ${exitCode}`);
        return stdout.trim();
      }));
      expect(results.sort()).toEqual(["bound", "bound"]);

      const revisions = firstDb.query(`
        SELECT identity_id, revision FROM agent_identity_source_mappings
        WHERE mapping_basis = 'authoritative'
        ORDER BY revision
      `).all() as Array<{ identity_id: string; revision: number }>;
      expect(revisions).toHaveLength(2);
      expect(revisions.map((mapping) => mapping.revision)).toEqual([1, 2]);
      expect(revisions.map((mapping) => mapping.identity_id).sort()).toEqual(["identity-one", "identity-two"]);

      const current = resolveAgentIdentity(
        { source: GITHUB_ACTOR_SOURCE },
        { read_preference: "canonical_first" },
        firstDb,
      );
      expect(current.trust).toBe("authoritative");
      expect(["identity-one", "identity-two"]).toContain(current.identity_id);
    } finally {
      closeDatabase();
      resetDatabase();
      rmSync(root, { recursive: true, force: true });
      process.env["TODOS_DB_PATH"] = ":memory:";
      db = getDatabase();
    }
  });

  it("fails closed when imported evidence contains multiple authoritative results", () => {
    ensureAgentIdentitySchema(db);
    const first = registerAgent({ name: "cicero" }, db);
    const second = registerAgent({ name: "caesar" }, db);
    if ("conflict" in first || "conflict" in second) throw new Error("unexpected registration conflict");
    db.run("DROP INDEX idx_agent_identity_source_revision_unique");
    const timestamp = "2026-07-23T00:00:00.000Z";
    const insert = db.prepare(`
      INSERT INTO agent_identity_source_mappings (
        id, local_agent_id, identity_id, source_authority, source_tenant_id, source_namespace,
        source_entity_type, source_record_id, mapping_basis, status, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'authoritative', 'active', 1, ?, ?)
    `);
    insert.run("mapping-one", first.id, "identity-one", ...Object.values(GITHUB_ACTOR_SOURCE), timestamp, timestamp);
    insert.run("mapping-two", second.id, "identity-two", ...Object.values(GITHUB_ACTOR_SOURCE), timestamp, timestamp);

    expectIdentityAmbiguity(() => resolveAgentIdentity({ source: GITHUB_ACTOR_SOURCE }, { read_preference: "canonical_first" }, db));
  });

  it("preserves multiple historical local IDs for one identity and disambiguates by source", () => {
    const first = registerAgent({ name: "euclid" }, db);
    const second = registerAgent({ name: "hipparchus" }, db);
    if ("conflict" in first || "conflict" in second) throw new Error("unexpected registration conflict");
    const secondSource: IdentitySourceLineage = {
      ...GITHUB_ACTOR_SOURCE,
      source_record_id: "actor-legacy-42",
    };

    bindAuthoritativeIdentityMapping({
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: first.id,
      identity_id: "identity-shared",
    }, db);
    bindAuthoritativeIdentityMapping({
      ...secondSource,
      local_agent_id: second.id,
      identity_id: "identity-shared",
    }, db);

    expect(resolveAgentIdentity({ source: GITHUB_ACTOR_SOURCE }, { read_preference: "canonical_only" }, db))
      .toEqual({
        identity_id: "identity-shared",
        local_agent_id: first.id,
        resolved_by: "source",
        trust: "authoritative",
      });
    expect(resolveAgentIdentity({ source: secondSource }, { read_preference: "canonical_only" }, db))
      .toEqual({
        identity_id: "identity-shared",
        local_agent_id: second.id,
        resolved_by: "source",
        trust: "authoritative",
      });
    expectIdentityAmbiguity(() => resolveAgentIdentity(
      { identity_id: "identity-shared" },
      { read_preference: "canonical_only" },
      db,
    ));
  });

  it("reports unique, ambiguous, and unmapped dry-run outcomes with zero writes", () => {
    ensureAgentIdentitySchema(db);
    const mapped = registerAgent({ name: "claudius" }, db);
    const pending = registerAgent({ name: "vespasian", identity_id: "identity-pending" }, db);
    if ("conflict" in mapped || "conflict" in pending) throw new Error("unexpected registration conflict");
    bindAuthoritativeIdentityMapping({
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: mapped.id,
      identity_id: "identity-existing",
    }, db);

    const before = db.query("SELECT total_changes() AS count").get() as { count: number };
    const report = reconcileAgentIdentityMappings([
      {
        ...GITHUB_ACTOR_SOURCE,
        local_agent_id: mapped.id,
        identity_id: "identity-existing",
        mapping_basis: "authoritative",
      },
      {
        ...GITHUB_ACTOR_SOURCE,
        local_agent_id: pending.id,
        identity_id: "identity-conflict",
        mapping_basis: "authoritative",
      },
      {
        ...GITHUB_ACTOR_SOURCE,
        source_record_id: "actor-unmapped",
        local_agent_id: pending.id,
        observed_label: "vespasian",
        mapping_basis: "candidate",
      },
    ], { dry_run: true }, db);
    const after = db.query("SELECT total_changes() AS count").get() as { count: number };

    expect(report.uniquely_mapped).toHaveLength(1);
    expect(report.ambiguous).toHaveLength(1);
    expect(report.unmapped).toHaveLength(1);
    expect(after.count).toBe(before.count);
  });

  it("reports and applies same-lineage promotion, correction, and retirement as append-only history", () => {
    const original = registerAgent({ name: "pliny" }, db);
    const corrected = registerAgent({ name: "seneca" }, db);
    if ("conflict" in original || "conflict" in corrected) throw new Error("unexpected registration conflict");

    const imported = reconcileAgentIdentityMappings([{
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: original.id,
      identity_id: "identity-original",
      mapping_basis: "imported",
      status: "active",
    }], { dry_run: false }, db);
    expect(imported.uniquely_mapped[0]?.lifecycle_action).toBe("create");
    expect(getAgent(original.id, db)?.identity_id).toBeNull();
    expect(resolveAgentIdentity(
      { source: GITHUB_ACTOR_SOURCE },
      { read_preference: "canonical_first" },
      db,
    ).trust).toBe("non_authoritative");

    const changesBeforePromotion = db.query("SELECT total_changes() AS count").get() as { count: number };
    const promotionDryRun = reconcileAgentIdentityMappings([{
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: original.id,
      identity_id: "identity-original",
      mapping_basis: "authoritative",
      status: "active",
    }], { dry_run: true }, db);
    const changesAfterPromotion = db.query("SELECT total_changes() AS count").get() as { count: number };
    expect(promotionDryRun.uniquely_mapped[0]).toMatchObject({
      lifecycle_action: "promote",
      reason: "authoritative_mapping_promotion_available",
    });
    expect(changesAfterPromotion.count).toBe(changesBeforePromotion.count);

    reconcileAgentIdentityMappings([{
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: original.id,
      identity_id: "identity-original",
      mapping_basis: "authoritative",
      status: "active",
    }], { dry_run: false }, db);
    expect(getAgent(original.id, db)?.identity_id).toBe("identity-original");

    const correctionDryRun = reconcileAgentIdentityMappings([{
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: corrected.id,
      identity_id: "identity-corrected",
      mapping_basis: "authoritative",
      status: "active",
    }], { dry_run: true }, db);
    expect(correctionDryRun.uniquely_mapped[0]).toMatchObject({
      lifecycle_action: "correct",
      reason: "authoritative_mapping_correction_available",
    });
    reconcileAgentIdentityMappings([{
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: corrected.id,
      identity_id: "identity-corrected",
      mapping_basis: "authoritative",
      status: "active",
    }], { dry_run: false }, db);

    const retirementDryRun = reconcileAgentIdentityMappings([{
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: corrected.id,
      identity_id: "identity-corrected",
      mapping_basis: "authoritative",
      status: "retired",
    }], { dry_run: true }, db);
    expect(retirementDryRun.uniquely_mapped[0]).toMatchObject({
      lifecycle_action: "retire",
      reason: "authoritative_mapping_retirement_available",
    });
    reconcileAgentIdentityMappings([{
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: corrected.id,
      identity_id: "identity-corrected",
      mapping_basis: "authoritative",
      status: "retired",
    }], { dry_run: false }, db);

    expect(resolveAgentIdentity(
      { source: GITHUB_ACTOR_SOURCE },
      { read_preference: "canonical_first" },
      db,
    )).toEqual({
      identity_id: "identity-corrected",
      local_agent_id: corrected.id,
      resolved_by: "source",
      trust: "non_authoritative",
    });
    expect(getAgent(original.id, db)?.identity_id).toBe("identity-original");
    expect(getAgent(corrected.id, db)?.identity_id).toBe("identity-corrected");
    expect(db.query(`
      SELECT identity_id, mapping_basis, status, revision
      FROM agent_identity_source_mappings
      WHERE source_record_id = ?
      ORDER BY revision
    `).all(GITHUB_ACTOR_SOURCE.source_record_id)).toEqual([
      { identity_id: "identity-original", mapping_basis: "imported", status: "active", revision: 1 },
      { identity_id: "identity-original", mapping_basis: "authoritative", status: "active", revision: 2 },
      { identity_id: "identity-corrected", mapping_basis: "authoritative", status: "active", revision: 3 },
      { identity_id: "identity-corrected", mapping_basis: "authoritative", status: "retired", revision: 4 },
    ]);
  });

  it("canaries canonical source preference and rolls back to legacy local IDs without data loss", () => {
    ensureAgentIdentitySchema(db);
    const canonical = registerAgent({ name: "agrippina" }, db);
    const legacy = registerAgent({ name: "domitian" }, db);
    if ("conflict" in canonical || "conflict" in legacy) throw new Error("unexpected registration conflict");
    bindAuthoritativeIdentityMapping({
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: canonical.id,
      identity_id: "identity-canonical",
    }, db);

    expect(resolveAgentIdentity({
      source: GITHUB_ACTOR_SOURCE,
      local_agent_id: legacy.id,
    }, { read_preference: "canonical_first" }, db)).toEqual({
      identity_id: "identity-canonical",
      local_agent_id: canonical.id,
      resolved_by: "source",
      trust: "authoritative",
    });

    expect(resolveAgentIdentity({
      source: GITHUB_ACTOR_SOURCE,
      local_agent_id: legacy.id,
    }, { read_preference: "legacy_first" }, db)).toEqual({
      identity_id: null,
      local_agent_id: legacy.id,
      resolved_by: "legacy_local_id",
      trust: "non_authoritative",
    });

    expect(resolveAgentIdentity({
      source: GITHUB_ACTOR_SOURCE,
      local_agent_id: legacy.id,
    }, {}, db)).toEqual({
      identity_id: null,
      local_agent_id: legacy.id,
      resolved_by: "legacy_local_id",
      trust: "non_authoritative",
    });

    expect(getAgent(canonical.id, db)?.identity_id).toBe("identity-canonical");
    expect(db.query("SELECT COUNT(*) AS count FROM agent_identity_source_mappings").get()).toEqual({ count: 1 });
    expect(resolveAgentIdentity({
      source: GITHUB_ACTOR_SOURCE,
      local_agent_id: legacy.id,
    }, { read_preference: "legacy_only" }, db)).toEqual({
      identity_id: null,
      local_agent_id: legacy.id,
      resolved_by: "legacy_local_id",
      trust: "non_authoritative",
    });
  });

  it("preserves historical labels additively across an explicit rename", () => {
    ensureAgentIdentitySchema(db);
    const agent = registerAgent({ name: "caligula" }, db);
    if ("conflict" in agent) throw new Error(agent.message);

    updateAgent(agent.id, { name: "commodus" }, db);

    expect(getAgent(agent.id, db)?.name).toBe("commodus");
    expect(listAgentAliases(agent.id, db).map((alias) => alias.label)).toContain("caligula");
    expect(resolveAgentIdentity({ alias: "caligula" }, { read_preference: "legacy_first" }, db)).toEqual({
      identity_id: null,
      local_agent_id: agent.id,
      resolved_by: "legacy_alias",
      trust: "non_authoritative",
    });
  });

  it("enforces identity_id immutability below the application layer", () => {
    ensureAgentIdentitySchema(db);
    const agent = registerAgent({ name: "augustus" }, db);
    if ("conflict" in agent) throw new Error(agent.message);
    bindAuthoritativeIdentityMapping({
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: agent.id,
      identity_id: "identity-fixed",
    }, db);

    expect(() => db.run("UPDATE agents SET identity_id = ? WHERE id = ?", ["identity-replacement", agent.id]))
      .toThrow("IDENTITY_ID_IMMUTABLE");
    expect(() => db.run(
      "UPDATE agent_identity_source_mappings SET identity_id = ? WHERE source_record_id = ?",
      ["identity-replacement", GITHUB_ACTOR_SOURCE.source_record_id],
    )).toThrow("IDENTITY_ID_IMMUTABLE");
    expect(() => db.run(
      "UPDATE agent_identity_source_mappings SET source_record_id = ? WHERE source_record_id = ?",
      ["rewritten-record", GITHUB_ACTOR_SOURCE.source_record_id],
    )).toThrow("IDENTITY_SOURCE_LINEAGE_IMMUTABLE");
    expect(() => db.run(
      "UPDATE agent_identity_source_mappings SET status = 'retired' WHERE source_record_id = ?",
      [GITHUB_ACTOR_SOURCE.source_record_id],
    )).toThrow("IDENTITY_MAPPING_HISTORY_IMMUTABLE");
    expect(getAgent(agent.id, db)?.identity_id).toBe("identity-fixed");
  });

  it("rejects deletion of append-only identity mapping history below the application layer", () => {
    const agent = registerAgent({ name: "boethius" }, db);
    if ("conflict" in agent) throw new Error(agent.message);
    const mapping = bindAuthoritativeIdentityMapping({
      ...GITHUB_ACTOR_SOURCE,
      local_agent_id: agent.id,
      identity_id: "identity-boethius",
    }, db);

    expect(() => db.run(
      "DELETE FROM agent_identity_source_mappings WHERE id = ?",
      [mapping.id],
    )).toThrow(/IDENTITY_MAPPING_HISTORY_IMMUTABLE/);
    expect(db.query(
      "SELECT id FROM agent_identity_source_mappings WHERE id = ?",
    ).get(mapping.id)).toEqual({ id: mapping.id });
  });
});
