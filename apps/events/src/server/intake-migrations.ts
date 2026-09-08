import { createHash } from "node:crypto";
import { apiKeyMigrations } from "@hasna/contracts/auth";
import type { Pool } from "pg";

export const INTAKE_MIGRATIONS = [
  ...apiKeyMigrations(),
  { id: "events_intake_0001", sql: `
CREATE TABLE events_intake_identity (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
 sink_id UUID NOT NULL UNIQUE, authority_id UUID NOT NULL, protocol TEXT NOT NULL CHECK (protocol='hasna.events.intake.v1')
);
CREATE TABLE events_producer_bindings (
 producer_id UUID PRIMARY KEY, tenant_id TEXT NOT NULL, app TEXT NOT NULL,
 corpus_id UUID NOT NULL, source_authority_id UUID NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, generation BIGINT NOT NULL DEFAULT 1 CHECK (generation>0),
 UNIQUE(tenant_id,producer_id)
);
CREATE TABLE events_producer_key_grants (
 tenant_id TEXT NOT NULL, producer_id UUID NOT NULL, kid TEXT NOT NULL REFERENCES api_keys(kid),
 active BOOLEAN NOT NULL DEFAULT TRUE, generation BIGINT NOT NULL DEFAULT 1 CHECK (generation>0),
 PRIMARY KEY(tenant_id,producer_id,kid),
 FOREIGN KEY(tenant_id,producer_id) REFERENCES events_producer_bindings(tenant_id,producer_id)
);
CREATE TABLE events_intake_records (
 tenant_id TEXT NOT NULL, producer_id UUID NOT NULL, event_id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
 envelope_sha256 TEXT NOT NULL CHECK (envelope_sha256 ~ '^[0-9a-f]{64}$'),
 envelope_json TEXT NOT NULL CHECK (octet_length(envelope_json)<=262144),
 receipt_id UUID NOT NULL UNIQUE, accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,producer_id,event_id), UNIQUE(tenant_id,producer_id,dedupe_key),
 FOREIGN KEY(tenant_id,producer_id) REFERENCES events_producer_bindings(tenant_id,producer_id)
);
CREATE FUNCTION events_intake_immutable() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'immutable intake evidence'; END $$;
CREATE FUNCTION events_intake_owner_write() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RAISE EXCEPTION 'intake owner role required'; END IF;
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-'active'-'generation') IS DISTINCT FROM (to_jsonb(OLD)-'active'-'generation') OR NEW.generation<>OLD.generation+1 THEN RAISE EXCEPTION 'immutable producer identity'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION events_intake_key_owner() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN RAISE EXCEPTION 'intake owner role required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER keys_owner BEFORE INSERT OR UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION events_intake_key_owner();
CREATE TRIGGER keys_no_delete BEFORE DELETE OR TRUNCATE ON api_keys FOR EACH STATEMENT EXECUTE FUNCTION events_intake_immutable();
CREATE TRIGGER identity_owner BEFORE INSERT ON events_intake_identity FOR EACH ROW EXECUTE FUNCTION events_intake_owner_write();
CREATE TRIGGER identity_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON events_intake_identity FOR EACH STATEMENT EXECUTE FUNCTION events_intake_immutable();
CREATE TRIGGER records_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON events_intake_records FOR EACH STATEMENT EXECUTE FUNCTION events_intake_immutable();
CREATE TRIGGER binding_owner BEFORE INSERT OR UPDATE ON events_producer_bindings FOR EACH ROW EXECUTE FUNCTION events_intake_owner_write();
CREATE TRIGGER binding_immutable BEFORE DELETE OR TRUNCATE ON events_producer_bindings FOR EACH STATEMENT EXECUTE FUNCTION events_intake_immutable();
CREATE TRIGGER grant_owner BEFORE INSERT OR UPDATE ON events_producer_key_grants FOR EACH ROW EXECUTE FUNCTION events_intake_owner_write();
CREATE TRIGGER grant_immutable BEFORE DELETE OR TRUNCATE ON events_producer_key_grants FOR EACH STATEMENT EXECUTE FUNCTION events_intake_immutable();
${["events_producer_bindings", "events_producer_key_grants", "events_intake_records"].map(table => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_tenant ON ${table} USING (tenant_id=nullif(current_setting('events.tenant_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('events.tenant_id',true),''));`).join("\n")}
` },
] as const;

/** Explicit owner operation only. Normal serve never invokes migrations. */
export async function migrateIntake(pool: Pool): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(725941039)");
    await c.query("CREATE TABLE IF NOT EXISTS events_intake_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL)");
    for (const migration of INTAKE_MIGRATIONS) {
      const hash = createHash("sha256").update(migration.sql).digest("hex");
      const existing = await c.query("SELECT sha256 FROM events_intake_migrations WHERE id=$1", [migration.id]);
      if (existing.rows.length) { if (existing.rows[0].sha256 !== hash) throw new Error("Intake migration checksum mismatch"); continue; }
      await c.query(migration.sql);
      await c.query("INSERT INTO events_intake_migrations VALUES($1,$2)", [migration.id, hash]);
    }
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
