// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/server/intake-admin.ts
import { createHash as createHash3 } from "crypto";
import { ApiKeyStore as ApiKeyStore2, verifyApiKeyToken } from "@hasna/contracts/auth";

// src/intake/protocol.ts
import { createHash } from "crypto";

// src/redaction.ts
function shouldRedactKey(key) {
  return /secret|token|password|api[_-]?key|authorization/i.test(key);
}

// src/intake/protocol.ts
var INTAKE_PROTOCOL = "hasna.events.intake.v1";
var CANONICAL_ENCODING = "hasna.sorted-json.v1";
var MAX_ENVELOPE_BYTES = 256 * 1024;
var MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES * 2 + 8192;

class IntakeError extends Error {
  code;
  status;
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
    throw new IntakeError("invalid_identity");
  return value;
}
function boundedText(value, limit = 512) {
  if (typeof value !== "string" || !value.length || value.length > limit || /[\u0000-\u001f\u007f]/.test(value))
    throw new IntakeError("invalid_text");
  return value;
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new IntakeError("invalid_object");
  return value;
}
function exactKeys(value, required, optional = []) {
  if (required.some((k) => !Object.hasOwn(value, k)) || Object.keys(value).some((k) => !required.includes(k) && !optional.includes(k)))
    throw new IntakeError("invalid_fields");
}
function canonicalJson(input) {
  const seen = new Set;
  let nodes = 0;
  let scalarBytes = 0;
  function scalar(text) {
    scalarBytes += Buffer.byteLength(text);
    if (scalarBytes > MAX_ENVELOPE_BYTES)
      throw new IntakeError("envelope_too_large", 413);
    return text;
  }
  function encode(value, depth) {
    if (++nodes > 20000 || depth > 32)
      throw new IntakeError("envelope_complexity_exceeded");
    if (value === null || typeof value === "boolean")
      return scalar(JSON.stringify(value));
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new IntakeError("non_json_value");
      return scalar(JSON.stringify(value));
    }
    if (typeof value === "string") {
      if (Buffer.from(value, "utf8").toString("utf8") !== value)
        throw new IntakeError("invalid_unicode");
      return scalar(JSON.stringify(value));
    }
    if (!value || typeof value !== "object" || seen.has(value))
      throw new IntakeError("non_json_value");
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length)
          throw new IntakeError("non_json_value");
        return `[${Array.from({ length: value.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !Object.hasOwn(descriptor, "value"))
            throw new IntakeError("non_json_value");
          return encode(descriptor.value, depth + 1);
        }).join(",")}]`;
      }
      const record = object(value);
      if (Reflect.ownKeys(record).length !== Object.keys(record).length)
        throw new IntakeError("non_json_value");
      return `{${Object.keys(record).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!Object.hasOwn(descriptor, "value") || ["__proto__", "constructor", "prototype"].includes(key))
          throw new IntakeError("non_json_value");
        return `${encode(key, depth + 1)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }
  const encoded = encode(input, 0);
  if (Buffer.byteLength(encoded) > MAX_ENVELOPE_BYTES)
    throw new IntakeError("envelope_too_large", 413);
  return encoded;
}
function envelopeHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function rejectSensitive(value) {
  if (typeof value === "string" && /(?:hasna_[a-z][a-z0-9-]*_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{12,})/.test(value))
    throw new IntakeError("sensitive_envelope_rejected");
  if (Array.isArray(value)) {
    for (const item of value)
      rejectSensitive(item);
  } else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (shouldRedactKey(key) && item !== "[REDACTED]" && item !== null)
        throw new IntakeError("sensitive_envelope_rejected");
      rejectSensitive(item);
    }
}
function validateEnvelope(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_ENVELOPE_BYTES)
    throw new IntakeError("envelope_too_large", 413);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IntakeError("invalid_envelope_json");
  }
  if (canonicalJson(parsed) !== text)
    throw new IntakeError("noncanonical_envelope");
  const e = object(parsed);
  exactKeys(e, ["id", "source", "type", "time", "severity", "data", "dedupeKey", "schemaVersion", "metadata"], ["subject", "message"]);
  boundedText(e.id);
  boundedText(e.dedupeKey);
  boundedText(e.source, 128);
  boundedText(e.type, 256);
  if (e.schemaVersion !== "1.0" || !["debug", "info", "notice", "warning", "error", "critical"].includes(String(e.severity)))
    throw new IntakeError("unsupported_envelope");
  if (typeof e.time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.time) || !Number.isFinite(Date.parse(e.time)) || new Date(e.time).toISOString() !== e.time)
    throw new IntakeError("invalid_event_time");
  object(e.data);
  object(e.metadata);
  if (Object.hasOwn(e, "subject"))
    boundedText(e.subject, 1024);
  if (Object.hasOwn(e, "message"))
    boundedText(e.message, 4096);
  rejectSensitive(e);
  return e;
}
function validateBinding(raw) {
  const b = object(raw);
  return { sink_id: uuid(b.sink_id), producer_id: uuid(b.producer_id), corpus_id: uuid(b.corpus_id), source_authority_id: uuid(b.source_authority_id) };
}
function validateRequest(raw) {
  const r = object(raw);
  exactKeys(r, ["protocol", "encoding", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "envelope_json"]);
  validateBinding(r);
  if (r.protocol !== INTAKE_PROTOCOL || r.encoding !== CANONICAL_ENCODING)
    throw new IntakeError("unsupported_intake_protocol");
  const e = validateEnvelope(r.envelope_json);
  if (e.id !== r.event_id || e.dedupeKey !== r.dedupe_key || r.envelope_sha256 !== envelopeHash(r.envelope_json))
    throw new IntakeError("envelope_identity_or_hash_mismatch");
  return r;
}
function prepareIntake(binding, envelope) {
  const envelope_json = canonicalJson(envelope);
  return validateRequest({ ...validateBinding(binding), protocol: INTAKE_PROTOCOL, encoding: CANONICAL_ENCODING, event_id: envelope.id, dedupe_key: envelope.dedupeKey, envelope_sha256: envelopeHash(envelope_json), envelope_json });
}
function validateReceipt(raw, request, tenant) {
  const r = object(raw);
  exactKeys(r, ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "tenant_id", "receipt_id", "accepted_at", "status"]);
  for (const k of ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256"])
    if (r[k] !== request[k])
      throw new IntakeError("receipt_identity_mismatch", 502);
  uuid(r.receipt_id);
  if (r.tenant_id !== tenant || r.status !== "accepted_durable" || typeof r.accepted_at !== "string" || !Number.isFinite(Date.parse(r.accepted_at)))
    throw new IntakeError("unconfirmed_intake_receipt", 502);
  return r;
}

// src/server/intake-postgres.ts
import { randomUUID } from "crypto";
import { ApiKeyStore } from "@hasna/contracts/auth";
function authQueries(pool) {
  return {
    async many(sql, params) {
      return (await pool.query(sql, params ? [...params] : undefined)).rows;
    },
    async get(sql, params) {
      return (await pool.query(sql, params ? [...params] : undefined)).rows[0] ?? null;
    },
    async execute(sql, params) {
      await pool.query(sql, params ? [...params] : undefined);
    }
  };
}
async function tenantTransaction(pool, tenant, run) {
  boundedText(tenant, 256);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL synchronous_commit=on");
    await c.query("SET LOCAL statement_timeout='10000'");
    await c.query("SET LOCAL lock_timeout='5000'");
    await c.query("SELECT set_config('events.tenant_id',$1,true)", [tenant]);
    const result = await run(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}

class IntakePostgres {
  pool;
  expectedSinkId;
  expectedAuthorityId;
  keys;
  constructor(pool, expectedSinkId, expectedAuthorityId) {
    this.pool = pool;
    this.expectedSinkId = expectedSinkId;
    this.expectedAuthorityId = expectedAuthorityId;
    uuid(expectedSinkId);
    uuid(expectedAuthorityId);
    this.keys = new ApiKeyStore(authQueries(pool));
  }
  async ready() {
    const { rows } = await this.pool.query(`SELECT r.rolsuper,r.rolbypassrls,
      EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=current_schema()::regnamespace AND (c.relname LIKE 'events_%' OR c.relname='api_keys') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns
      FROM pg_roles r WHERE rolname=current_user`);
    if (!rows[0] || rows[0].rolsuper || rows[0].rolbypassrls || rows[0].owns)
      throw new IntakeError("runtime_role_must_not_own_intake", 503);
    const durability = await this.pool.query("SELECT current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes");
    if (durability.rows[0]?.fsync !== "on" || durability.rows[0]?.full_page_writes !== "on")
      throw new IntakeError("intake_durable_postgres_required", 503);
    const policies = await this.pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname IN ('events_producer_bindings','events_producer_key_grants','events_intake_records')");
    if (policies.rows.length !== 3 || policies.rows.some((r) => !r.relrowsecurity || !r.relforcerowsecurity))
      throw new IntakeError("intake_row_security_required", 503);
    const identity = await this.pool.query("SELECT sink_id,authority_id,protocol FROM events_intake_identity");
    if (identity.rows.length !== 1 || identity.rows[0].sink_id !== this.expectedSinkId || identity.rows[0].authority_id !== this.expectedAuthorityId || identity.rows[0].protocol !== INTAKE_PROTOCOL)
      throw new IntakeError("intake_not_initialized_for_authority", 503);
  }
  async authorize(c, principal, binding) {
    if (binding.sink_id !== this.expectedSinkId)
      throw new IntakeError("sink_mismatch", 409);
    const key = await c.query(`SELECT kid FROM api_keys WHERE kid=$1 AND app='events' AND tid=$2
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE`, [principal.kid, principal.tid]);
    const producer = await c.query(`SELECT app,corpus_id,source_authority_id FROM events_producer_bindings
      WHERE producer_id=$1 AND tenant_id=$2 AND active FOR SHARE`, [binding.producer_id, principal.tid]);
    const grant = await c.query(`SELECT kid FROM events_producer_key_grants
      WHERE producer_id=$1 AND tenant_id=$2 AND kid=$3 AND active FOR SHARE`, [binding.producer_id, principal.tid, principal.kid]);
    const p = producer.rows[0];
    if (!key.rows.length || !p || !grant.rows.length || p.corpus_id !== binding.corpus_id || p.source_authority_id !== binding.source_authority_id)
      throw new IntakeError("producer_not_authorized", 403);
  }
  receipt(row, binding, tenant) {
    return { ...binding, protocol: INTAKE_PROTOCOL, tenant_id: tenant, event_id: row.event_id, dedupe_key: row.dedupe_key, envelope_sha256: row.envelope_sha256, receipt_id: row.receipt_id, accepted_at: new Date(row.accepted_at).toISOString(), status: "accepted_durable" };
  }
  async capability(principal, binding) {
    await this.ready();
    validateBinding(binding);
    if (!principal.tid)
      throw new IntakeError("tenant_required", 403);
    return tenantTransaction(this.pool, principal.tid, async (c) => {
      await this.authorize(c, principal, binding);
      return { protocol: INTAKE_PROTOCOL, ...binding, tenant_id: principal.tid, kid: principal.kid };
    });
  }
  async accept(principal, raw) {
    await this.ready();
    const request = validateRequest(raw);
    if (!principal.tid)
      throw new IntakeError("tenant_required", 403);
    return tenantTransaction(this.pool, principal.tid, async (c) => {
      await this.authorize(c, principal, request);
      const producer = await c.query("SELECT app FROM events_producer_bindings WHERE producer_id=$1", [request.producer_id]);
      if (JSON.parse(request.envelope_json).source !== producer.rows[0]?.app)
        throw new IntakeError("producer_source_mismatch", 403);
      await c.query(`INSERT INTO events_intake_records(tenant_id,producer_id,event_id,dedupe_key,envelope_sha256,envelope_json,receipt_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [principal.tid, request.producer_id, request.event_id, request.dedupe_key, request.envelope_sha256, request.envelope_json, randomUUID()]);
      const rows = await c.query(`SELECT event_id,dedupe_key,envelope_sha256,receipt_id,accepted_at FROM events_intake_records
        WHERE tenant_id=$1 AND producer_id=$2 AND (event_id=$3 OR dedupe_key=$4)`, [principal.tid, request.producer_id, request.event_id, request.dedupe_key]);
      const row = rows.rows[0];
      if (rows.rows.length !== 1 || row.event_id !== request.event_id || row.dedupe_key !== request.dedupe_key || row.envelope_sha256 !== request.envelope_sha256)
        throw new IntakeError("event_identity_conflict", 409);
      return this.receipt(row, validateBinding(request), principal.tid);
    });
  }
  async read(principal, binding, eventId) {
    await this.ready();
    validateBinding(binding);
    boundedText(eventId);
    if (!principal.tid)
      throw new IntakeError("tenant_required", 403);
    return tenantTransaction(this.pool, principal.tid, async (c) => {
      await this.authorize(c, principal, binding);
      const rows = await c.query("SELECT event_id,dedupe_key,envelope_sha256,receipt_id,accepted_at FROM events_intake_records WHERE tenant_id=$1 AND producer_id=$2 AND event_id=$3", [principal.tid, binding.producer_id, eventId]);
      if (!rows.rows[0])
        throw new IntakeError("receipt_not_found", 404);
      return this.receipt(rows.rows[0], binding, principal.tid);
    });
  }
}

// src/server/intake-migrations.ts
import { createHash as createHash2 } from "crypto";
import { apiKeyMigrations } from "@hasna/contracts/auth";
var INTAKE_MIGRATIONS = [
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
${["events_producer_bindings", "events_producer_key_grants", "events_intake_records"].map((table) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_tenant ON ${table} USING (tenant_id=nullif(current_setting('events.tenant_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('events.tenant_id',true),''));`).join(`
`)}
` }
];
async function migrateIntake(pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(725941039)");
    await c.query("CREATE TABLE IF NOT EXISTS events_intake_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL)");
    for (const migration of INTAKE_MIGRATIONS) {
      const hash = createHash2("sha256").update(migration.sql).digest("hex");
      const existing = await c.query("SELECT sha256 FROM events_intake_migrations WHERE id=$1", [migration.id]);
      if (existing.rows.length) {
        if (existing.rows[0].sha256 !== hash)
          throw new Error("Intake migration checksum mismatch");
        continue;
      }
      await c.query(migration.sql);
      await c.query("INSERT INTO events_intake_migrations VALUES($1,$2)", [migration.id, hash]);
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}

// src/server/intake-admin.ts
async function owner(pool) {
  const row = await pool.query("SELECT pg_get_userbyid(relowner)=current_user AS owned FROM pg_class WHERE oid='events_intake_identity'::regclass");
  if (row.rows[0]?.owned !== true)
    throw new IntakeError("intake_owner_role_required", 403);
}
async function initializeIntake(pool, sinkId, authorityId) {
  uuid(sinkId);
  uuid(authorityId);
  await migrateIntake(pool);
  await owner(pool);
  await pool.query("INSERT INTO events_intake_identity(singleton,sink_id,authority_id,protocol) VALUES(TRUE,$1,$2,$3) ON CONFLICT DO NOTHING", [sinkId, authorityId, INTAKE_PROTOCOL]);
  const row = await pool.query("SELECT sink_id,authority_id FROM events_intake_identity");
  if (row.rows[0]?.sink_id !== sinkId || row.rows[0]?.authority_id !== authorityId)
    throw new IntakeError("sink_identity_is_immutable", 409);
}
async function bindProducer(pool, input) {
  await owner(pool);
  uuid(input.producer_id);
  uuid(input.corpus_id);
  uuid(input.source_authority_id);
  boundedText(input.tenant_id, 256);
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(input.app))
    throw new IntakeError("invalid_producer_app");
  await tenantTransaction(pool, input.tenant_id, async (c) => {
    await c.query("INSERT INTO events_producer_bindings(producer_id,tenant_id,app,corpus_id,source_authority_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [input.producer_id, input.tenant_id, input.app, input.corpus_id, input.source_authority_id]);
    const row = (await c.query("SELECT producer_id,tenant_id,app,corpus_id,source_authority_id FROM events_producer_bindings WHERE producer_id=$1", [input.producer_id])).rows[0];
    if (!row || Object.keys(input).some((k) => row[k] !== input[k]))
      throw new IntakeError("producer_identity_is_immutable", 409);
  });
}
async function grantProducerKey(pool, tenant, producer, kid) {
  await owner(pool);
  uuid(producer);
  boundedText(kid, 256);
  await tenantTransaction(pool, tenant, async (c) => {
    const key = await c.query("SELECT kid FROM api_keys WHERE kid=$1 AND app='events' AND tid=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE", [kid, tenant]);
    if (!key.rows.length)
      throw new IntakeError("active_registered_tenant_key_required", 403);
    await c.query("INSERT INTO events_producer_key_grants(tenant_id,producer_id,kid) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [tenant, producer, kid]);
    const row = (await c.query("SELECT active FROM events_producer_key_grants WHERE tenant_id=$1 AND producer_id=$2 AND kid=$3", [tenant, producer, kid])).rows[0];
    if (!row?.active)
      throw new IntakeError("key_grant_is_revoked", 409);
  });
}
async function revokeProducerAccess(pool, tenant, producer, kid) {
  await owner(pool);
  uuid(producer);
  if (kid !== undefined)
    boundedText(kid, 256);
  await tenantTransaction(pool, tenant, async (c) => {
    const result = kid === undefined ? await c.query("UPDATE events_producer_bindings SET active=FALSE,generation=generation+1 WHERE tenant_id=$1 AND producer_id=$2 AND active RETURNING producer_id", [tenant, producer]) : await c.query("UPDATE events_producer_key_grants SET active=FALSE,generation=generation+1 WHERE tenant_id=$1 AND producer_id=$2 AND kid=$3 AND active RETURNING producer_id", [tenant, producer, kid]);
    if (!result.rows.length)
      throw new IntakeError("active_producer_access_not_found", 404);
  });
}
async function registerIntakeKey(pool, token, signingSecret) {
  await owner(pool);
  const result = verifyApiKeyToken(token, { expectedApp: "events", signingSecret, requireTenant: true });
  if (!result.ok || !result.tid)
    throw new IntakeError("invalid_registered_key", 403);
  await new ApiKeyStore2(authQueries(pool)).insert({ kid: result.kid, app: "events", tid: result.tid, scopes: result.claims.scopes, tokenHash: createHash3("sha256").update(token).digest("hex"), issuedAt: new Date(result.claims.iat * 1000), expiresAt: result.claims.exp === null ? null : new Date(result.claims.exp * 1000) });
}
async function runIntakeAdmin(pool, args, signingSecret) {
  const [operation, ...rest] = args;
  const opts = {};
  for (let i = 0;i < rest.length; i += 2) {
    const k = rest[i], v = rest[i + 1];
    if (!k || !v || !/^--[a-z-]+$/.test(k) || Object.hasOwn(opts, k))
      throw new IntakeError("invalid_admin_arguments");
    opts[k] = v;
  }
  const take = (keys) => {
    if (Object.keys(opts).length !== keys.length || keys.some((k) => !opts[k]))
      throw new IntakeError("invalid_admin_arguments");
    return keys.map((k) => opts[k]);
  };
  switch (operation) {
    case "init": {
      const [sink, authority] = take(["--sink-id", "--authority-id"]);
      await initializeIntake(pool, sink, authority);
      break;
    }
    case "bind": {
      const [producer, tenant, app, corpus, authority] = take(["--producer-id", "--tenant-id", "--app", "--corpus-id", "--source-authority-id"]);
      await bindProducer(pool, { producer_id: producer, tenant_id: tenant, app, corpus_id: corpus, source_authority_id: authority });
      break;
    }
    case "grant": {
      const [tenant, producer, kid] = take(["--tenant-id", "--producer-id", "--kid"]);
      await grantProducerKey(pool, tenant, producer, kid);
      break;
    }
    case "revoke": {
      const keys = ["--tenant-id", "--producer-id", ...opts["--kid"] ? ["--kid"] : []];
      const [tenant, producer, kid] = take(keys);
      await revokeProducerAccess(pool, tenant, producer, kid);
      break;
    }
    case "register-key": {
      take([]);
      if (!signingSecret || process.stdin.isTTY)
        throw new IntakeError("private_key_stdin_required");
      let text = "";
      for await (const chunk of process.stdin) {
        text += chunk.toString();
        if (text.length > 16384)
          throw new IntakeError("invalid_registered_key");
      }
      await registerIntakeKey(pool, text.trim(), signingSecret);
      break;
    }
    default:
      throw new IntakeError("unknown_intake_admin_operation");
  }
}
export {
  runIntakeAdmin,
  revokeProducerAccess,
  registerIntakeKey,
  initializeIntake,
  grantProducerKey,
  bindProducer
};
