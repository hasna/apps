import type { Pool } from "pg";
export declare const REQUIRED_INTAKE_SCHEMA: Readonly<{
    id: "events_intake_0002";
    sha256: string;
}>;
export declare const INTAKE_MIGRATIONS: readonly [...import("@hasna/contracts/auth").AuthMigration[], {
    readonly id: "events_intake_0001";
    readonly sql: `
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
${string}
`;
}, {
    readonly id: "events_intake_0002";
    readonly sql: "\nALTER TABLE events_producer_bindings\n  ALTER COLUMN corpus_id TYPE TEXT USING corpus_id::text,\n  ALTER COLUMN source_authority_id TYPE TEXT USING source_authority_id::text;\nALTER TABLE events_producer_bindings\n  ADD CONSTRAINT events_corpus_identifier CHECK (length(corpus_id) BETWEEN 1 AND 128 AND corpus_id ~ '^[A-Za-z0-9]' AND corpus_id !~ '[^A-Za-z0-9_.:-]'),\n  ADD CONSTRAINT events_source_authority_identifier CHECK (length(source_authority_id) BETWEEN 1 AND 128 AND source_authority_id ~ '^[A-Za-z0-9]' AND source_authority_id !~ '[^A-Za-z0-9_.:-]');\n";
}];
/** Explicit owner operation only. Normal serve never invokes migrations. */
export declare function migrateIntake(pool: Pool): Promise<void>;
