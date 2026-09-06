#!/usr/bin/env bun
// @bun

// src/serve-entry.ts
import { readFileSync as readFileSync3 } from "fs";

// src/serve.ts
import { readFileSync as readFileSync2 } from "fs";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";

// src/generated/storage-kit/pool.ts
import pg from "pg";

// src/generated/storage-kit/own.ts
function ownProp(source, key) {
  if (source === null || source === undefined)
    return;
  const kind = typeof source;
  if (kind !== "object" && kind !== "function")
    return;
  if (!Object.hasOwn(source, key))
    return;
  return source[key];
}
function ownString(source, key) {
  const value = ownProp(source, key);
  return typeof value === "string" ? value : undefined;
}

// src/generated/storage-kit/tls.ts
import { readFileSync } from "fs";
var PG_TLS_QUERY_PARAMETERS = new Set([
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslpassword",
  "sslnegotiation",
  "uselibpqcompat"
]);
var EXPLICIT_SSL_ON_VALUES = new Set(["1", "true", "yes", "on", "require"]);
var EXPLICIT_SSL_OFF_VALUES = new Set(["0", "false", "no", "off", "disable"]);
var SSLMODE_VALUES = new Map([
  ["disable", "disable"],
  ["allow", "prefer"],
  ["prefer", "prefer"],
  ["require", "require"],
  ["verify-ca", "verify-ca"],
  ["verify-full", "verify-full"]
]);
function connectionStringParts(connectionString) {
  const queryStart = connectionString.indexOf("?");
  if (queryStart === -1) {
    return { base: connectionString, fragment: "", params: new URLSearchParams };
  }
  const base = connectionString.slice(0, queryStart);
  const queryAndFragment = connectionString.slice(queryStart + 1);
  const fragmentStart = queryAndFragment.indexOf("#");
  const query = fragmentStart === -1 ? queryAndFragment : queryAndFragment.slice(0, fragmentStart);
  const fragment = fragmentStart === -1 ? "" : queryAndFragment.slice(fragmentStart);
  return { base, fragment, params: new URLSearchParams(query) };
}
function tlsQueryValues(connectionString) {
  const values = new Map;
  for (const [key, value] of connectionStringParts(connectionString).params) {
    const normalized = key.toLowerCase();
    if (PG_TLS_QUERY_PARAMETERS.has(normalized))
      values.set(normalized, value);
  }
  return values;
}
function connectionStringWithoutTlsParameters(connectionString) {
  const { base, fragment, params } = connectionStringParts(connectionString);
  for (const key of [...params.keys()]) {
    if (PG_TLS_QUERY_PARAMETERS.has(key.toLowerCase()))
      params.delete(key);
  }
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}${fragment}`;
}
function rawSslMode(values) {
  const raw = values.get("sslmode");
  return raw === undefined ? undefined : raw.trim().toLowerCase();
}
function sslNegotiationFromConnectionString(connectionString) {
  const value = tlsQueryValues(connectionString).get("sslnegotiation")?.trim().toLowerCase();
  if (!value)
    return;
  if (value === "postgres" || value === "direct")
    return value;
  throw new Error(`Unknown sslnegotiation '${value}' in connection string; expected postgres or direct.`);
}
function sslModeFromConnectionString(connectionString) {
  const values = tlsQueryValues(connectionString);
  const sslmode = rawSslMode(values);
  if (sslmode !== undefined) {
    const resolved = SSLMODE_VALUES.get(sslmode);
    if (resolved)
      return resolved;
    throw new Error(`Unknown sslmode '${sslmode}' in connection string; expected one of ` + `${[...SSLMODE_VALUES.keys()].join(", ")}. Remove the parameter entirely to defer to ` + `PGSSLMODE \u2014 an empty value is not how that is spelled.`);
  }
  if (values.has("ssl")) {
    const ssl = values.get("ssl")?.trim().toLowerCase() ?? "";
    if (EXPLICIT_SSL_ON_VALUES.has(ssl))
      return "require";
    if (!EXPLICIT_SSL_OFF_VALUES.has(ssl)) {
      throw new Error(`Unknown ssl value '${ssl}' in connection string.`);
    }
    return "disable";
  }
  const sslnegotiation = values.get("sslnegotiation")?.trim().toLowerCase();
  if (sslnegotiation === "direct")
    return "require";
  return "disable";
}
function loadCaBundle(connectionString, options) {
  const env = ownProp(options, "env") ?? process.env;
  const ca = ownString(options, "ca");
  if (ca && ca.trim())
    return ca;
  const sslRootCert = tlsQueryValues(connectionString).get("sslrootcert")?.trim();
  const path = ownString(options, "caCertPath") ?? (sslRootCert ? sslRootCert : undefined) ?? ownString(env, "PGSSLROOTCERT") ?? ownString(env, "NODE_EXTRA_CA_CERTS");
  if (path && path.trim())
    return readFileSync(path.trim(), "utf8");
  return null;
}
function loadClientCertificate(connectionString) {
  const values = tlsQueryValues(connectionString);
  const material = {};
  const certPath = values.get("sslcert")?.trim();
  if (certPath)
    material.cert = readFileSync(certPath, "utf8");
  const keyPath = values.get("sslkey")?.trim();
  if (keyPath)
    material.key = readFileSync(keyPath, "utf8");
  const passphrase = values.get("sslpassword");
  if (passphrase)
    material.passphrase = passphrase;
  return material;
}
function resolveTlsConfig(connectionString, options = {}) {
  const mode = sslModeFromConnectionString(connectionString);
  if (mode === "disable") {
    const values = tlsQueryValues(connectionString);
    const sslmode = rawSslMode(values);
    const ssl = values.get("ssl")?.trim().toLowerCase();
    const explicitlyOff = sslmode === "disable" || ssl !== undefined && EXPLICIT_SSL_OFF_VALUES.has(ssl);
    return explicitlyOff ? false : undefined;
  }
  const ca = loadCaBundle(connectionString, options);
  const clientCertificate = loadClientCertificate(connectionString);
  if (mode === "prefer" || mode === "require") {
    return { rejectUnauthorized: true, ...ca ? { ca } : {}, ...clientCertificate };
  }
  if (!ca) {
    throw new Error(`sslmode=${mode} requires a CA bundle. Set PGSSLROOTCERT (or pass caCertPath/ca) to the ` + `Amazon RDS global bundle: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`);
  }
  return { rejectUnauthorized: true, ca, ...clientCertificate };
}

// src/generated/storage-kit/query.ts
function wrapExecutor(executor) {
  return {
    async query(sql, params) {
      const result = await executor.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    async many(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows;
    },
    async get(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows[0] ?? null;
    },
    async one(sql, params) {
      const result = await executor.query(sql, params);
      if (result.rows.length !== 1) {
        throw new Error(`Expected exactly one row, got ${result.rows.length}.`);
      }
      return result.rows[0];
    },
    async execute(sql, params) {
      await executor.query(sql, params);
    }
  };
}
function createQueryClient(pool) {
  const base = wrapExecutor(pool);
  return {
    ...base,
    pool,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrapExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}

// src/generated/storage-kit/pool.ts
function ownPoolOptions(options) {
  const own = Object.create(null);
  const ca = ownString(options, "ca");
  if (ca !== undefined)
    own.ca = ca;
  const caCertPath = ownString(options, "caCertPath");
  if (caCertPath !== undefined)
    own.caCertPath = caCertPath;
  const env = ownProp(options, "env");
  if (env !== undefined)
    own.env = env;
  const max = ownProp(options, "max");
  if (max !== undefined)
    own.max = max;
  const idleTimeoutMillis = ownProp(options, "idleTimeoutMillis");
  if (idleTimeoutMillis !== undefined)
    own.idleTimeoutMillis = idleTimeoutMillis;
  const connectionTimeoutMillis = ownProp(options, "connectionTimeoutMillis");
  if (connectionTimeoutMillis !== undefined)
    own.connectionTimeoutMillis = connectionTimeoutMillis;
  const applicationName = ownString(options, "applicationName");
  if (applicationName !== undefined)
    own.applicationName = applicationName;
  return own;
}
function createPgPool(options) {
  const connectionString = ownString(options, "connectionString");
  if (!connectionString || !connectionString.trim()) {
    throw new Error("createPgPool requires an own `connectionString` on the options object.");
  }
  const own = ownPoolOptions(options);
  const ssl = resolveTlsConfig(connectionString, {
    ...own.ca !== undefined ? { ca: own.ca } : {},
    ...own.caCertPath !== undefined ? { caCertPath: own.caCertPath } : {},
    ...own.env !== undefined ? { env: own.env } : {}
  });
  const config = {
    connectionString: connectionStringWithoutTlsParameters(connectionString)
  };
  if (ssl !== undefined)
    config.ssl = ssl;
  const sslnegotiation = sslNegotiationFromConnectionString(connectionString);
  if (sslnegotiation !== undefined)
    config.sslnegotiation = sslnegotiation;
  if (own.max !== undefined)
    config.max = own.max;
  if (own.idleTimeoutMillis !== undefined)
    config.idleTimeoutMillis = own.idleTimeoutMillis;
  if (own.connectionTimeoutMillis !== undefined)
    config.connectionTimeoutMillis = own.connectionTimeoutMillis;
  if (own.applicationName !== undefined)
    config.application_name = own.applicationName;
  return new pg.Pool(config);
}

// src/client-transport.ts
import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  credentialDiskSources,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  defaultFleetGatewayBaseUrl,
  resolveClientTransport
} from "@hasna/contracts/client";

// src/net-guard.ts
var REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// src/client-transport.ts
var KNOWLEDGE_APP_SLUG = "knowledge";
var ENV_KEYS = clientTransportEnvKeys(KNOWLEDGE_APP_SLUG);
var KNOWLEDGE_API_URL_ENV_KEYS = Object.freeze([...ENV_KEYS.apiUrlKeys]);
var KNOWLEDGE_API_KEY_ENV_KEYS = Object.freeze([...ENV_KEYS.apiKeyKeys]);
var KNOWLEDGE_API_URL_ENV = KNOWLEDGE_API_URL_ENV_KEYS[0];
var KNOWLEDGE_API_KEY_ENV = KNOWLEDGE_API_KEY_ENV_KEYS[0];
var KNOWLEDGE_DATABASE_URL_ENV = "HASNA_KNOWLEDGE_DATABASE_URL";
var KNOWLEDGE_DEFAULT_API_URL = defaultFleetGatewayBaseUrl(KNOWLEDGE_APP_SLUG);
var KNOWLEDGE_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_KNOWLEDGE_LOCAL"];
var KNOWLEDGE_LOCAL_OPT_IN_ENV = KNOWLEDGE_LOCAL_OPT_IN_ENV_KEYS[0];
var RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS = [
  "HASNA_KNOWLEDGE_STORAGE_MODE",
  "HASNA_KNOWLEDGE_MODE",
  "KNOWLEDGE_STORAGE_MODE",
  "KNOWLEDGE_MODE"
];

class RetiredKnowledgeStorageSelectorError extends Error {
  envKey;
  code = "retired_knowledge_storage_selector";
  constructor(envKey) {
    super(`knowledge: ${envKey} was retired and must be unset. ` + `Clients resolve their credential through @hasna/contracts \u2014 an explicit --api-key, ` + `${KNOWLEDGE_API_KEY_ENV}_OVERRIDE / HASNA_PROFILE / ${KNOWLEDGE_API_KEY_ENV}_REF, the macOS Keychain ` + `item hasna.credentials.${KNOWLEDGE_APP_SLUG}.api-key, ~/.hasna/${KNOWLEDGE_APP_SLUG}/config/credentials, ` + `then ${KNOWLEDGE_API_KEY_ENV} \u2014 and reach ${KNOWLEDGE_DEFAULT_API_URL} unless ${KNOWLEDGE_API_URL_ENV} ` + `(or the Keychain api-url item, or the credentials file) names another authority. ` + `With no credential and no ${KNOWLEDGE_LOCAL_OPT_IN_ENV} opt-in the client fails closed. ` + `Servers select PostgreSQL with ${KNOWLEDGE_DATABASE_URL_ENV}.`);
    this.envKey = envKey;
    this.name = "RetiredKnowledgeStorageSelectorError";
  }
}
function firstDefined(env, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined)
      return key;
  }
  return null;
}
function assertNoRetiredKnowledgeStorageSelector(env = process.env) {
  const retired = firstDefined(env, RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS);
  if (retired)
    throw new RetiredKnowledgeStorageSelectorError(retired);
}

// src/db/remote-storage.ts
function createKnowledgeDatabaseClient(env = process.env) {
  assertNoRetiredKnowledgeStorageSelector(env);
  const connectionString = env[KNOWLEDGE_DATABASE_URL_ENV]?.trim();
  if (!connectionString) {
    throw new Error(`knowledge server requires ${KNOWLEDGE_DATABASE_URL_ENV} for PostgreSQL. ` + "Knowledge clients use HASNA_KNOWLEDGE_API_URL and never receive this database URL.");
  }
  return createQueryClient(createPgPool({
    connectionString,
    env,
    applicationName: "@hasna/knowledge"
  }));
}
// src/db/migrate-list.ts
import { apiKeyMigrations } from "@hasna/contracts/auth";

// src/project-links.ts
import { createHash } from "crypto";

// src/workspace.ts
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");

// src/project-links.ts
var KNOWLEDGE_PROJECT_REGISTRATION_ROUTE = "knowledge.project-registration.v1";
var KNOWLEDGE_PROJECT_RESOURCES_ROUTE = "knowledge.project-resources.v1";
var KNOWLEDGE_PROJECT_REGISTRATION_SCHEMA_VERSION = 1;
var KNOWLEDGE_PROJECT_MEMBERSHIP_RULE = "explicit_collection_binding";
var KNOWLEDGE_PROJECT_RESOURCE_PAGE_LOOKAHEAD = 1;

class KnowledgeProjectLinksError extends Error {
  code;
  details;
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "KnowledgeProjectLinksError";
  }
}
function postgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

class PostgresProjectLinksSql {
  client;
  transactionClient;
  kind = "postgres";
  constructor(client, transactionClient) {
    this.client = client;
    this.transactionClient = transactionClient;
  }
  async close() {}
  async get(sql, params = []) {
    return this.client.get(postgresSql(sql), params);
  }
  async many(sql, params = []) {
    return this.client.many(postgresSql(sql), params);
  }
  async run(sql, params = []) {
    const result = await this.client.query(postgresSql(sql), params);
    return { changes: result.rowCount };
  }
  async lock(key) {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  }
  async transaction(fn) {
    if (!this.transactionClient)
      return fn(this);
    return this.transactionClient.transaction((tx) => fn(new PostgresProjectLinksSql(tx)));
  }
}

class SqliteProjectLinksSql {
  db;
  kind = "sqlite";
  tail = Promise.resolve();
  closed = false;
  constructor(db) {
    this.db = db;
  }
  async close() {
    await this.tail;
    if (this.closed)
      return;
    this.closed = true;
    this.db.close();
  }
  async get(sql, params = []) {
    return this.db.query(sql).get(...params) ?? null;
  }
  async many(sql, params = []) {
    return this.db.query(sql).all(...params);
  }
  async run(sql, params = []) {
    const result = this.db.query(sql).run(...params);
    return { changes: Number(result.changes) };
  }
  async lock(_key) {}
  transaction(fn) {
    const run = this.tail.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(this);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    this.tail = run.then(() => {
      return;
    }, () => {
      return;
    });
    return run;
  }
}
function canonicalize(value) {
  if (Array.isArray(value))
    return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}
function canonicalKnowledgeProjectLinksJson(value) {
  return JSON.stringify(canonicalize(value));
}
function digestKnowledgeProjectLinksValue(value) {
  return createHash("sha256").update(canonicalKnowledgeProjectLinksJson(value)).digest("hex");
}
function stableUuid(namespace) {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = (Number.parseInt(hex[16], 16) & 3 | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function requiredString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", `${field} must be a non-empty string.`);
  }
  return value.trim();
}
function boundedLimit(value) {
  const resolved = value ?? 100;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 200) {
    throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", "limit must be an integer between 1 and 200.");
  }
  return resolved;
}
function normalizeKinds(kinds) {
  const supported = ["project", "collection", "item", "taxonomy"];
  if (!kinds || kinds.length === 0)
    return supported;
  const unique = [...new Set(kinds)];
  for (const kind of unique) {
    if (!supported.includes(kind)) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", `unsupported project resource kind: ${kind}`);
    }
  }
  return unique.sort((left, right) => supported.indexOf(left) - supported.indexOf(right));
}
function toReceipt(row) {
  return {
    receipt_id: row.receipt_id,
    authority: "knowledge",
    route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
    package_version: row.package_version,
    authority_id: row.authority_id,
    tenant_id: row.tenant_id,
    corpus_id: row.corpus_id,
    operation_id: row.operation_id,
    step_id: row.step_id,
    action: row.action,
    resource_kind: row.resource_kind,
    direction: row.direction,
    idempotency_key: row.idempotency_key,
    request_digest: row.request_digest,
    precondition_digest: row.precondition_digest,
    outcome: row.outcome,
    reason: row.reason,
    source_project_id: row.source_project_id,
    project_id: row.project_id,
    collection_id: row.collection_id,
    item_id: row.item_id,
    result_revision: row.result_revision,
    result_digest: row.result_digest,
    accepted_receipt_id: row.accepted_receipt_id,
    created_by_operation: Number(row.created_by_operation) === 1,
    created_at: row.created_at
  };
}
function aggregateRecord(row) {
  const record = {
    source_project_id: row.source_project_id,
    project_id: row.project_id,
    project_slug: row.project_slug,
    project_name: row.project_name,
    collection_id: row.collection_id,
    collection_slug: row.collection_slug,
    collection_name: row.collection_name,
    membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
    revision: `r${Number(row.revision)}`,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  return { ...record, digest: digestKnowledgeProjectLinksValue(record) };
}
function receiptInsertParams(receipt) {
  return [
    receipt.receipt_id,
    receipt.authority,
    receipt.route,
    receipt.package_version,
    receipt.authority_id,
    receipt.tenant_id,
    receipt.corpus_id,
    receipt.operation_id,
    receipt.step_id,
    receipt.action,
    receipt.resource_kind,
    receipt.direction,
    receipt.idempotency_key,
    receipt.request_digest,
    receipt.precondition_digest,
    receipt.outcome,
    receipt.reason,
    receipt.source_project_id,
    receipt.project_id,
    receipt.collection_id,
    receipt.item_id,
    receipt.result_revision,
    receipt.result_digest,
    receipt.accepted_receipt_id,
    receipt.created_by_operation ? 1 : 0,
    receipt.created_at
  ];
}
var RECEIPT_INSERT_SQL = `INSERT INTO knowledge_project_link_receipts (
  receipt_id, authority, route, package_version, authority_id, tenant_id, corpus_id,
  operation_id, step_id, action, resource_kind, direction, idempotency_key,
  request_digest, precondition_digest, outcome, reason, source_project_id,
  project_id, collection_id, item_id, result_revision, result_digest,
  accepted_receipt_id, created_by_operation, created_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

class PackageOwnedKnowledgeProjectLinksAuthority {
  sql;
  itemResolver;
  options;
  identity;
  now;
  constructor(sql, itemResolver, options) {
    this.sql = sql;
    this.itemResolver = itemResolver;
    this.options = options;
    this.identity = {
      authority_id: requiredString(options.authorityId, "authority_id"),
      tenant_id: requiredString(options.tenantId, "tenant_id"),
      corpus_id: requiredString(options.corpusId, "corpus_id")
    };
    this.now = options.now ?? (() => new Date().toISOString());
  }
  async close() {
    await this.sql.close();
  }
  capabilityValue() {
    return {
      authority: "knowledge",
      route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
      resource_route: KNOWLEDGE_PROJECT_RESOURCES_ROUTE,
      package_version: this.options.packageVersion,
      schema_version: KNOWLEDGE_PROJECT_REGISTRATION_SCHEMA_VERSION,
      ...this.identity,
      registration_resource: "collection",
      supported_resources: ["project", "collection", "item", "taxonomy"],
      stable_project_ids: true,
      stable_collection_ids: true,
      explicit_membership: true,
      membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
      later_child_binding_required: true,
      bind_existing_items: true,
      immutable_receipts: true,
      exact_terminal_lookup: true,
      exact_readback: true,
      conditional_inverse: true,
      complete_keyset_pagination: true,
      revision_bound_cursors: true
    };
  }
  async capability() {
    return this.capabilityValue();
  }
  assertIdentity(request) {
    const capability = this.capabilityValue();
    if (request.authority_route !== capability.route || request.package_version !== capability.package_version || request.authority_id !== capability.authority_id || request.tenant_id !== capability.tenant_id || request.corpus_id !== capability.corpus_id) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CAPABILITY_MISMATCH", "request does not match the current Knowledge project-registration capability identity.");
    }
  }
  stableProjectId(sourceProjectId) {
    return stableUuid(`${this.identity.authority_id}\x00${this.identity.tenant_id}\x00${this.identity.corpus_id}\x00project\x00${sourceProjectId}`);
  }
  stableCollectionId(sourceProjectId, collectionSlug) {
    return stableUuid(`${this.identity.authority_id}\x00${this.identity.tenant_id}\x00${this.identity.corpus_id}\x00collection\x00${sourceProjectId}\x00${collectionSlug}`);
  }
  collectionFence(collectionId) {
    return [
      "knowledge-project-links",
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      "collection",
      collectionId
    ].join("\x1F");
  }
  membershipFence(collectionId, itemId) {
    return [
      "knowledge-project-links",
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      "membership",
      collectionId,
      itemId
    ].join("\x1F");
  }
  stableReceiptId(operationId, stepId, action, direction) {
    return stableUuid(`${this.identity.authority_id}\x00${this.identity.tenant_id}\x00${this.identity.corpus_id}\x00receipt\x00${operationId}\x00${stepId}\x00${action}\x00${direction}`);
  }
  async getAggregateBySource(sql, sourceProjectId) {
    return sql.get(`SELECT p.source_project_id, p.project_id, p.project_slug, p.project_name,
              c.collection_id, c.collection_slug, c.collection_name,
              c.membership_rule, c.revision, c.created_at, c.updated_at
         FROM knowledge_projects p
         JOIN knowledge_project_collections c
           ON c.authority_id = p.authority_id
          AND c.tenant_id = p.tenant_id
          AND c.corpus_id = p.corpus_id
          AND c.project_id = p.project_id
        WHERE p.authority_id = ? AND p.tenant_id = ? AND p.corpus_id = ?
          AND p.source_project_id = ?`, [this.identity.authority_id, this.identity.tenant_id, this.identity.corpus_id, sourceProjectId]);
  }
  async getAggregateByCollection(sql, collectionId) {
    return sql.get(`SELECT p.source_project_id, p.project_id, p.project_slug, p.project_name,
              c.collection_id, c.collection_slug, c.collection_name,
              c.membership_rule, c.revision, c.created_at, c.updated_at
         FROM knowledge_projects p
         JOIN knowledge_project_collections c
           ON c.authority_id = p.authority_id
          AND c.tenant_id = p.tenant_id
          AND c.corpus_id = p.corpus_id
          AND c.project_id = p.project_id
        WHERE c.authority_id = ? AND c.tenant_id = ? AND c.corpus_id = ?
          AND c.collection_id = ?`, [this.identity.authority_id, this.identity.tenant_id, this.identity.corpus_id, collectionId]);
  }
  async getAggregateByProject(sql, projectId) {
    return sql.get(`SELECT p.source_project_id, p.project_id, p.project_slug, p.project_name,
              c.collection_id, c.collection_slug, c.collection_name,
              c.membership_rule, c.revision, c.created_at, c.updated_at
         FROM knowledge_projects p
         JOIN knowledge_project_collections c
           ON c.authority_id = p.authority_id
          AND c.tenant_id = p.tenant_id
          AND c.corpus_id = p.corpus_id
          AND c.project_id = p.project_id
        WHERE p.authority_id = ? AND p.tenant_id = ? AND p.corpus_id = ?
          AND (p.source_project_id = ? OR p.project_id = ?)`, [
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      projectId,
      projectId
    ]);
  }
  async getReceiptByAttempt(sql, input) {
    const row = await sql.get(`SELECT * FROM knowledge_project_link_receipts
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
          AND operation_id = ? AND step_id = ? AND action = ? AND direction = ?`, [
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      input.operation_id,
      input.step_id,
      input.action,
      input.direction
    ]);
    return row ? toReceipt(row) : null;
  }
  assertIdempotent(existing, input) {
    if (existing.idempotency_key !== input.idempotency_key || input.request_digest !== undefined && existing.request_digest !== input.request_digest || input.precondition_digest !== undefined && existing.precondition_digest !== input.precondition_digest || input.accepted_receipt_id !== undefined && existing.accepted_receipt_id !== input.accepted_receipt_id) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_IDEMPOTENCY_MISMATCH", "operation and step identity are already bound to a different Knowledge project-link request.", { receipt_id: existing.receipt_id });
    }
  }
  async registerCollection(request) {
    this.assertIdentity(request);
    if (request.resource_kind !== "collection" || request.direction !== "forward") {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", "collection registration requires resource_kind=collection and direction=forward.");
    }
    const sourceProjectId = requiredString(request.project_id, "project_id");
    const projectSlug = requiredString(request.project_slug, "project_slug");
    const projectName = requiredString(request.project_name, "project_name");
    const targetSelector = requiredString(request.target_selector, "target_selector");
    if (targetSelector !== sourceProjectId) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", "target_selector must equal the exact source project id.");
    }
    const collectionSlug = requiredString(request.desired.collection_slug ?? `${projectSlug}-knowledge`, "desired.collection_slug");
    const collectionName = requiredString(request.desired.collection_name ?? `${projectName} Knowledge`, "desired.collection_name");
    const expectedRequestDigest = digestKnowledgeProjectLinksValue({
      action: "register_collection",
      source_project_id: sourceProjectId,
      project_slug: projectSlug,
      project_name: projectName,
      collection_slug: collectionSlug,
      collection_name: collectionName,
      membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE
    });
    if (request.request_digest !== expectedRequestDigest) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_DIGEST_MISMATCH", "request_digest does not bind the normalized collection-registration request.", { expected_request_digest: expectedRequestDigest });
    }
    const stableCollectionId = this.stableCollectionId(sourceProjectId, collectionSlug);
    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "register_collection",
        direction: "forward"
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }
      await tx.lock(this.collectionFence(stableCollectionId));
      let aggregate = await this.getAggregateBySource(tx, sourceProjectId);
      const createdByOperation = aggregate === null;
      if (!aggregate) {
        const now = this.now();
        const projectId = this.stableProjectId(sourceProjectId);
        const collectionId = stableCollectionId;
        await tx.run(`INSERT INTO knowledge_projects (
            authority_id, tenant_id, corpus_id, source_project_id, project_id,
            project_slug, project_name, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?)`, [
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          sourceProjectId,
          projectId,
          projectSlug,
          projectName,
          now,
          now
        ]);
        await tx.run(`INSERT INTO knowledge_project_collections (
            authority_id, tenant_id, corpus_id, collection_id, project_id,
            collection_slug, collection_name, membership_rule, revision,
            created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          collectionId,
          projectId,
          collectionSlug,
          collectionName,
          KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
          1,
          now,
          now
        ]);
        aggregate = await this.getAggregateByCollection(tx, collectionId);
      } else if (aggregate.project_slug !== projectSlug || aggregate.project_name !== projectName || aggregate.collection_slug !== collectionSlug || aggregate.collection_name !== collectionName || aggregate.membership_rule !== KNOWLEDGE_PROJECT_MEMBERSHIP_RULE) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CONFLICT", "the source project is already bound to a different Knowledge collection aggregate.", {
          source_project_id: sourceProjectId,
          collection_id: aggregate.collection_id
        });
      }
      if (!aggregate) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "collection registration committed but exact aggregate readback was unavailable.");
      }
      const record = aggregateRecord(aggregate);
      const receipt = {
        receipt_id: this.stableReceiptId(request.operation_id, request.step_id, "register_collection", "forward"),
        authority: "knowledge",
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "register_collection",
        resource_kind: "collection",
        direction: "forward",
        idempotency_key: requiredString(request.idempotency_key, "idempotency_key"),
        request_digest: request.request_digest,
        precondition_digest: requiredString(request.precondition_digest, "precondition_digest"),
        outcome: "accepted",
        reason: createdByOperation ? null : "adopted_existing_collection",
        source_project_id: record.source_project_id,
        project_id: record.project_id,
        collection_id: record.collection_id,
        item_id: null,
        result_revision: record.revision,
        result_digest: record.digest,
        accepted_receipt_id: null,
        created_by_operation: createdByOperation,
        created_at: this.now()
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }
  async readCollection(collectionId) {
    const aggregate = await this.getAggregateByCollection(this.sql, requiredString(collectionId, "collection_id"));
    if (!aggregate) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "Knowledge collection was not found by exact id.");
    }
    return aggregateRecord(aggregate);
  }
  async lookupReceipt(request) {
    if (request.max_items !== 1) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", "exact terminal receipt lookup requires max_items=1.");
    }
    if (request.authority_id !== this.identity.authority_id || request.tenant_id !== this.identity.tenant_id || request.corpus_id !== this.identity.corpus_id) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CAPABILITY_MISMATCH", "receipt lookup does not match this authority identity.");
    }
    const receipt = await this.getReceiptByAttempt(this.sql, request);
    if (!receipt || receipt.idempotency_key !== request.idempotency_key) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "exact Knowledge project-link receipt was not found.");
    }
    return receipt;
  }
  async receiptById(sql, receiptId) {
    const row = await sql.get(`SELECT * FROM knowledge_project_link_receipts
        WHERE receipt_id = ? AND authority_id = ? AND tenant_id = ? AND corpus_id = ?`, [
      receiptId,
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id
    ]);
    return row ? toReceipt(row) : null;
  }
  async hasOtherAcceptedForwardReceipt(sql, accepted) {
    const itemPredicate = accepted.action === "bind_item" ? "AND item_id = ?" : "AND item_id IS NULL";
    const row = await sql.get(`SELECT receipt_id
         FROM knowledge_project_link_receipts
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
          AND action = ? AND direction = 'forward' AND outcome = 'accepted'
          AND collection_id = ? AND receipt_id <> ?
          ${itemPredicate}
        LIMIT 1`, [
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      accepted.action,
      accepted.collection_id,
      accepted.receipt_id,
      ...accepted.action === "bind_item" ? [accepted.item_id] : []
    ]);
    return row !== null;
  }
  assertInverseIdentity(request) {
    this.assertIdentity(request);
    requiredString(request.accepted_receipt_id, "accepted_receipt_id");
    requiredString(request.idempotency_key, "idempotency_key");
  }
  async compensateRegistration(request) {
    this.assertInverseIdentity(request);
    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "register_collection",
        direction: "inverse"
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }
      const accepted = await this.receiptById(tx, request.accepted_receipt_id);
      if (!accepted || accepted.action !== "register_collection" || accepted.direction !== "forward" || accepted.outcome !== "accepted") {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "accepted collection-registration receipt was not found.");
      }
      if (accepted.collection_id) {
        await tx.lock(this.collectionFence(accepted.collection_id));
      }
      const aggregate = accepted.collection_id ? await this.getAggregateByCollection(tx, accepted.collection_id) : null;
      let outcome = "accepted";
      let reason = null;
      if (!accepted.created_by_operation) {
        outcome = "terminal_nonacceptance";
        reason = "adopted_collection_is_not_inverse_owned";
      } else if (!aggregate) {
        outcome = "terminal_nonacceptance";
        reason = "accepted_collection_is_already_absent";
      } else if (await this.hasOtherAcceptedForwardReceipt(tx, accepted)) {
        outcome = "terminal_nonacceptance";
        reason = "collection_has_later_accepted_adopter";
      } else {
        const membership = await tx.get(`SELECT COUNT(*) AS count
             FROM knowledge_project_collection_memberships
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`, [
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          aggregate.collection_id
        ]);
        if (Number(membership?.count ?? 0) > 0) {
          outcome = "terminal_nonacceptance";
          reason = "collection_has_bound_items";
        } else {
          await tx.run(`DELETE FROM knowledge_project_collections
              WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`, [
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            aggregate.collection_id
          ]);
          await tx.run(`DELETE FROM knowledge_projects
              WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND project_id = ?
                AND NOT EXISTS (
                  SELECT 1 FROM knowledge_project_collections c
                   WHERE c.authority_id = knowledge_projects.authority_id
                     AND c.tenant_id = knowledge_projects.tenant_id
                     AND c.corpus_id = knowledge_projects.corpus_id
                     AND c.project_id = knowledge_projects.project_id
                )`, [
            this.identity.authority_id,
            this.identity.tenant_id,
            this.identity.corpus_id,
            aggregate.project_id
          ]);
        }
      }
      const absent = {
        accepted_receipt_id: accepted.receipt_id,
        collection_id: accepted.collection_id,
        absent: outcome === "accepted"
      };
      const receipt = {
        receipt_id: this.stableReceiptId(request.operation_id, request.step_id, "register_collection", "inverse"),
        authority: "knowledge",
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "register_collection",
        resource_kind: "collection",
        direction: "inverse",
        idempotency_key: request.idempotency_key,
        request_digest: digestKnowledgeProjectLinksValue({
          accepted_receipt_id: accepted.receipt_id,
          collection_id: accepted.collection_id
        }),
        precondition_digest: accepted.result_digest ?? "",
        outcome,
        reason,
        source_project_id: accepted.source_project_id,
        project_id: accepted.project_id,
        collection_id: accepted.collection_id,
        item_id: null,
        result_revision: outcome === "accepted" ? "absent" : accepted.result_revision,
        result_digest: digestKnowledgeProjectLinksValue(absent),
        accepted_receipt_id: accepted.receipt_id,
        created_by_operation: false,
        created_at: this.now()
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }
  async verifyRegistrationInverse(request) {
    this.assertInverseIdentity(request);
    const inverse = await this.getReceiptByAttempt(this.sql, {
      operation_id: request.operation_id,
      step_id: request.step_id,
      action: "register_collection",
      direction: "inverse"
    });
    if (!inverse || inverse.outcome !== "accepted" || inverse.accepted_receipt_id !== request.accepted_receipt_id) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "accepted collection inverse receipt was not found.");
    }
    const aggregate = inverse.collection_id ? await this.getAggregateByCollection(this.sql, inverse.collection_id) : null;
    if (aggregate) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CONFLICT", "collection inverse verification found the target still present.");
    }
    const verification = {
      accepted_receipt_id: request.accepted_receipt_id,
      target_id: inverse.collection_id,
      absent: true,
      digest: inverse.result_digest
    };
    return verification;
  }
  async bindItem(request) {
    this.assertIdentity(request);
    if (request.direction !== "forward") {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", "item binding requires direction=forward.");
    }
    const collectionId = requiredString(request.collection_id, "collection_id");
    const itemId = requiredString(request.item_id, "item_id");
    const item = await this.itemResolver(itemId);
    if (!item || item.id !== itemId) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "bind-existing requires an exact existing Knowledge item id.", { item_id: itemId });
    }
    const expectedRequestDigest = digestKnowledgeProjectLinksValue({
      action: "bind_item",
      collection_id: collectionId,
      item_id: itemId
    });
    if (request.request_digest !== expectedRequestDigest) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_DIGEST_MISMATCH", "request_digest does not bind the normalized item-membership request.", { expected_request_digest: expectedRequestDigest });
    }
    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "bind_item",
        direction: "forward"
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }
      await tx.lock(this.collectionFence(collectionId));
      await tx.lock(this.membershipFence(collectionId, itemId));
      const aggregate = await this.getAggregateByCollection(tx, collectionId);
      if (!aggregate) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "Knowledge collection was not found by exact id.");
      }
      const existing = await tx.get(`SELECT * FROM knowledge_project_collection_memberships
          WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
            AND collection_id = ? AND item_id = ?`, [
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
        collectionId,
        itemId
      ]);
      const createdByOperation = existing === null;
      const now = this.now();
      const receiptId = this.stableReceiptId(request.operation_id, request.step_id, "bind_item", "forward");
      if (!existing) {
        await tx.run(`INSERT INTO knowledge_project_collection_memberships (
            authority_id, tenant_id, corpus_id, collection_id, item_id,
            bound_receipt_id, created_by_operation, bound_at
          ) VALUES (?,?,?,?,?,?,?,?)`, [
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          collectionId,
          itemId,
          receiptId,
          1,
          now
        ]);
        await tx.run(`UPDATE knowledge_project_collections
              SET revision = revision + 1, updated_at = ?
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`, [
          now,
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          collectionId
        ]);
      }
      const current = await this.getAggregateByCollection(tx, collectionId);
      if (!current) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "item binding committed but collection readback was unavailable.");
      }
      const binding = {
        collection_id: collectionId,
        item_id: itemId,
        collection_revision: `r${Number(current.revision)}`,
        item_revision: `v${item.version ?? 1}`
      };
      const receipt = {
        receipt_id: receiptId,
        authority: "knowledge",
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "bind_item",
        resource_kind: "item",
        direction: "forward",
        idempotency_key: requiredString(request.idempotency_key, "idempotency_key"),
        request_digest: request.request_digest,
        precondition_digest: requiredString(request.precondition_digest, "precondition_digest"),
        outcome: "accepted",
        reason: createdByOperation ? null : "adopted_existing_membership",
        source_project_id: current.source_project_id,
        project_id: current.project_id,
        collection_id: collectionId,
        item_id: itemId,
        result_revision: binding.collection_revision,
        result_digest: digestKnowledgeProjectLinksValue(binding),
        accepted_receipt_id: null,
        created_by_operation: createdByOperation,
        created_at: now
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }
  async readItemBinding(collectionId, itemId) {
    const membership = await this.sql.get(`SELECT * FROM knowledge_project_collection_memberships
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
          AND collection_id = ? AND item_id = ?`, [
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      requiredString(collectionId, "collection_id"),
      requiredString(itemId, "item_id")
    ]);
    if (!membership) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "Knowledge collection membership was not found by exact ids.");
    }
    const aggregate = await this.getAggregateByCollection(this.sql, collectionId);
    if (!aggregate) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "membership exists without its collection aggregate.");
    }
    const record = {
      collection_id: collectionId,
      item_id: itemId,
      revision: `r${Number(aggregate.revision)}`,
      bound_at: membership.bound_at
    };
    return { ...record, digest: digestKnowledgeProjectLinksValue(record) };
  }
  async compensateItemBinding(request) {
    this.assertInverseIdentity(request);
    return this.sql.transaction(async (tx) => {
      const duplicate = await this.getReceiptByAttempt(tx, {
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "bind_item",
        direction: "inverse"
      });
      if (duplicate) {
        this.assertIdempotent(duplicate, request);
        return duplicate;
      }
      const accepted = await this.receiptById(tx, request.accepted_receipt_id);
      if (!accepted || accepted.action !== "bind_item" || accepted.direction !== "forward" || accepted.outcome !== "accepted") {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "accepted item-binding receipt was not found.");
      }
      if (accepted.collection_id) {
        await tx.lock(this.collectionFence(accepted.collection_id));
      }
      if (accepted.collection_id && accepted.item_id) {
        await tx.lock(this.membershipFence(accepted.collection_id, accepted.item_id));
      }
      let outcome = "accepted";
      let reason = null;
      const membership = await tx.get(`SELECT * FROM knowledge_project_collection_memberships
          WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
            AND collection_id = ? AND item_id = ?`, [
        this.identity.authority_id,
        this.identity.tenant_id,
        this.identity.corpus_id,
        accepted.collection_id,
        accepted.item_id
      ]);
      if (!accepted.created_by_operation) {
        outcome = "terminal_nonacceptance";
        reason = "adopted_membership_is_not_inverse_owned";
      } else if (!membership) {
        outcome = "terminal_nonacceptance";
        reason = "accepted_membership_is_already_absent";
      } else if (await this.hasOtherAcceptedForwardReceipt(tx, accepted)) {
        outcome = "terminal_nonacceptance";
        reason = "membership_has_later_accepted_adopter";
      } else if (membership.bound_receipt_id !== accepted.receipt_id || Number(membership.created_by_operation) !== 1) {
        outcome = "terminal_nonacceptance";
        reason = "membership_is_owned_by_a_different_receipt";
      } else {
        await tx.run(`DELETE FROM knowledge_project_collection_memberships
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
              AND collection_id = ? AND item_id = ? AND bound_receipt_id = ?`, [
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          accepted.collection_id,
          accepted.item_id,
          accepted.receipt_id
        ]);
        await tx.run(`UPDATE knowledge_project_collections
              SET revision = revision + 1, updated_at = ?
            WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?`, [
          this.now(),
          this.identity.authority_id,
          this.identity.tenant_id,
          this.identity.corpus_id,
          accepted.collection_id
        ]);
      }
      const aggregate = accepted.collection_id ? await this.getAggregateByCollection(tx, accepted.collection_id) : null;
      const absent = {
        accepted_receipt_id: accepted.receipt_id,
        collection_id: accepted.collection_id,
        item_id: accepted.item_id,
        absent: outcome === "accepted"
      };
      const receipt = {
        receipt_id: this.stableReceiptId(request.operation_id, request.step_id, "bind_item", "inverse"),
        authority: "knowledge",
        route: KNOWLEDGE_PROJECT_REGISTRATION_ROUTE,
        package_version: this.options.packageVersion,
        ...this.identity,
        operation_id: request.operation_id,
        step_id: request.step_id,
        action: "bind_item",
        resource_kind: "item",
        direction: "inverse",
        idempotency_key: request.idempotency_key,
        request_digest: digestKnowledgeProjectLinksValue({
          accepted_receipt_id: accepted.receipt_id,
          collection_id: accepted.collection_id,
          item_id: accepted.item_id
        }),
        precondition_digest: accepted.result_digest ?? "",
        outcome,
        reason,
        source_project_id: accepted.source_project_id,
        project_id: accepted.project_id,
        collection_id: accepted.collection_id,
        item_id: accepted.item_id,
        result_revision: outcome === "accepted" && aggregate ? `r${Number(aggregate.revision)}` : accepted.result_revision,
        result_digest: digestKnowledgeProjectLinksValue(absent),
        accepted_receipt_id: accepted.receipt_id,
        created_by_operation: false,
        created_at: this.now()
      };
      await tx.run(RECEIPT_INSERT_SQL, receiptInsertParams(receipt));
      return receipt;
    });
  }
  async verifyItemBindingInverse(request) {
    this.assertInverseIdentity(request);
    const inverse = await this.getReceiptByAttempt(this.sql, {
      operation_id: request.operation_id,
      step_id: request.step_id,
      action: "bind_item",
      direction: "inverse"
    });
    if (!inverse || inverse.outcome !== "accepted" || inverse.accepted_receipt_id !== request.accepted_receipt_id) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "accepted item-binding inverse receipt was not found.");
    }
    const membership = await this.sql.get(`SELECT item_id FROM knowledge_project_collection_memberships
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ?
          AND collection_id = ? AND item_id = ?`, [
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      inverse.collection_id,
      inverse.item_id
    ]);
    if (membership) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CONFLICT", "item-binding inverse verification found the membership still present.");
    }
    return {
      accepted_receipt_id: request.accepted_receipt_id,
      target_id: inverse.item_id,
      absent: true,
      digest: inverse.result_digest
    };
  }
  resourceBase(aggregate) {
    return {
      project_id: aggregate.project_id,
      source_project_id: aggregate.source_project_id,
      collection_id: aggregate.collection_id,
      revision: `r${Number(aggregate.revision)}`
    };
  }
  projectResource(aggregate) {
    const body = {
      ...this.resourceBase(aggregate),
      kind: "project",
      id: aggregate.project_id,
      title: aggregate.project_name,
      locator: { kind: "canonical_uri", value: `knowledge:project:${aggregate.project_id}` },
      metadata: {
        source_project_id: aggregate.source_project_id,
        slug: aggregate.project_slug,
        collection_count: 1
      }
    };
    return {
      ...body,
      key: `project:${aggregate.project_id}`,
      digest: digestKnowledgeProjectLinksValue(body)
    };
  }
  collectionResource(aggregate, memberCount) {
    const body = {
      ...this.resourceBase(aggregate),
      kind: "collection",
      id: aggregate.collection_id,
      title: aggregate.collection_name,
      locator: { kind: "external_uuid", value: aggregate.collection_id },
      metadata: {
        slug: aggregate.collection_slug,
        membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
        member_count: memberCount
      }
    };
    return {
      ...body,
      key: `collection:${aggregate.collection_id}`,
      digest: digestKnowledgeProjectLinksValue(body)
    };
  }
  itemResource(aggregate, item) {
    const body = {
      ...this.resourceBase(aggregate),
      kind: "item",
      id: item.id,
      revision: `v${item.version ?? 1}`,
      title: item.title,
      locator: { kind: "canonical_uri", value: `knowledge:item:${encodeURIComponent(item.id)}` },
      metadata: {
        tags: [...item.tags ?? []],
        archived: item.archived === true,
        updated_at: item.updated_at
      }
    };
    return {
      ...body,
      key: `item:${item.id}`,
      digest: digestKnowledgeProjectLinksValue(body)
    };
  }
  taxonomyResource(aggregate, normalized, input) {
    const taxonomyId = stableUuid(`${aggregate.collection_id}\x00taxonomy\x00${normalized}`);
    const body = {
      ...this.resourceBase(aggregate),
      kind: "taxonomy",
      id: taxonomyId,
      title: input.label,
      locator: { kind: "external_uuid", value: taxonomyId },
      metadata: {
        tag: input.label,
        normalized_tag: normalized,
        item_count: input.itemCount,
        member_digest: input.memberDigest
      }
    };
    return {
      ...body,
      key: `taxonomy:${taxonomyId}`,
      digest: digestKnowledgeProjectLinksValue(body)
    };
  }
  postgresItem(row) {
    const parseJson = (value, fallback) => {
      if (value == null)
        return fallback;
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      }
      return value;
    };
    return {
      id: String(row.id),
      short_id: row.short_id ?? null,
      title: String(row.title ?? ""),
      content: String(row.content ?? ""),
      url: row.url ?? null,
      tags: parseJson(row.tags, []),
      metadata: parseJson(row.metadata, {}),
      archived: Boolean(row.archived),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      version: row.version == null ? 1 : Number(row.version)
    };
  }
  resourceCursorAfter(input) {
    if (!input.cursor)
      return "";
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
    } catch {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", "cursor is not a valid Knowledge project-resources cursor.");
    }
    if (decoded.version !== 1 || decoded.project_id !== input.aggregate.project_id || decoded.collection_id !== input.aggregate.collection_id || decoded.collection_revision !== input.revision || decoded.population_digest !== input.populationDigest || canonicalKnowledgeProjectLinksJson(decoded.kinds) !== canonicalKnowledgeProjectLinksJson(input.kinds) || typeof decoded.after !== "string") {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE", "project resources changed or the cursor belongs to a different project/kind selection; restart from the first page.");
    }
    return decoded.after;
  }
  async listPostgresProjectResources(projectId, options, limit, kinds) {
    const aggregate = await this.getAggregateByProject(this.sql, requiredString(projectId, "project_id"));
    if (!aggregate) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "Knowledge project aggregate was not found by source or stable project id.");
    }
    const identityParams = [
      this.identity.tenant_id,
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      aggregate.collection_id
    ];
    const population = await this.sql.get(`SELECT
         COUNT(*)::text AS membership_count,
         COUNT(i.id)::text AS visible_item_count,
         encode(sha256(convert_to(COALESCE(string_agg(
             m.item_id || E'\\x1f'
             || COALESCE(i.title, '') || E'\\x1f'
             || COALESCE(i.updated_at, '') || E'\\x1f'
             || COALESCE(i.version::text, '1') || E'\\x1f'
             || COALESCE(i.tags::text, '[]') || E'\\x1f'
             || COALESCE(i.archived::text, 'false'),
             E'\\x1e' ORDER BY m.item_id
           ), ''), 'UTF8')), 'hex') AS item_snapshot_digest
       FROM knowledge_project_collection_memberships m
       LEFT JOIN knowledge_items i
         ON i.id = m.item_id
        AND (i.authority_classification IS NULL OR i.tenant_id::text = ?)
      WHERE m.authority_id = ? AND m.tenant_id = ? AND m.corpus_id = ?
        AND m.collection_id = ?`, [
      this.identity.tenant_id,
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      aggregate.collection_id
    ]);
    const membershipCount = Number(population?.membership_count ?? 0);
    const visibleItemCount = Number(population?.visible_item_count ?? 0);
    if (membershipCount !== visibleItemCount) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "collection membership points at a missing or inaccessible Knowledge item; refusing a partial resource population.", {
        collection_id: aggregate.collection_id,
        membership_count: membershipCount,
        visible_item_count: visibleItemCount
      });
    }
    const taxonomyCountRow = await this.sql.get(`SELECT COUNT(*)::text AS taxonomy_count
         FROM (
           SELECT LOWER(BTRIM(tag.value)) AS normalized_tag
             FROM knowledge_project_collection_memberships m
             JOIN knowledge_items i
               ON i.id = m.item_id
              AND (i.authority_classification IS NULL OR i.tenant_id::text = ?)
             CROSS JOIN LATERAL jsonb_array_elements_text(i.tags) AS tag(value)
            WHERE m.authority_id = ? AND m.tenant_id = ? AND m.corpus_id = ?
              AND m.collection_id = ?
              AND BTRIM(tag.value) <> ''
            GROUP BY LOWER(BTRIM(tag.value))
         ) taxonomy`, identityParams);
    const taxonomyCount = Number(taxonomyCountRow?.taxonomy_count ?? 0);
    const revision = `r${Number(aggregate.revision)}`;
    const populationDigest = digestKnowledgeProjectLinksValue({
      collection_revision: revision,
      kinds,
      item_snapshot_digest: kinds.includes("item") || kinds.includes("taxonomy") ? population?.item_snapshot_digest ?? "" : null,
      taxonomy_count: kinds.includes("taxonomy") ? taxonomyCount : null
    });
    const after = this.resourceCursorAfter({
      cursor: options.cursor,
      aggregate,
      revision,
      populationDigest,
      kinds
    });
    const targetCount = limit + KNOWLEDGE_PROJECT_RESOURCE_PAGE_LOOKAHEAD;
    const candidates = [];
    const append = (resource) => {
      if (candidates.length < targetCount && kinds.includes(resource.kind) && resource.key > after) {
        candidates.push(resource);
      }
    };
    append(this.collectionResource(aggregate, membershipCount));
    if (kinds.includes("item") && candidates.length < targetCount && after < "project:") {
      const itemAfter = after.startsWith("item:") ? after.slice("item:".length) : "";
      const rows = await this.sql.many(`SELECT i.*
           FROM knowledge_project_collection_memberships m
           JOIN knowledge_items i
             ON i.id = m.item_id
            AND (i.authority_classification IS NULL OR i.tenant_id::text = ?)
          WHERE m.authority_id = ? AND m.tenant_id = ? AND m.corpus_id = ?
            AND m.collection_id = ? AND m.item_id > ?
          ORDER BY m.item_id ASC
          LIMIT ${targetCount - candidates.length}`, [...identityParams, itemAfter]);
      for (const row of rows)
        append(this.itemResource(aggregate, this.postgresItem(row)));
    }
    append(this.projectResource(aggregate));
    if (kinds.includes("taxonomy") && candidates.length < targetCount) {
      const taxonomyAfter = after.startsWith("taxonomy:") ? after : "taxonomy:";
      const rows = await this.sql.many(`WITH tagged AS (
           SELECT
             m.item_id,
             BTRIM(tag.value) AS label,
             LOWER(BTRIM(tag.value)) AS normalized_tag,
             tag.ordinality
           FROM knowledge_project_collection_memberships m
           JOIN knowledge_items i
             ON i.id = m.item_id
            AND (i.authority_classification IS NULL OR i.tenant_id::text = ?)
           CROSS JOIN LATERAL jsonb_array_elements_text(i.tags)
             WITH ORDINALITY AS tag(value, ordinality)
           WHERE m.authority_id = ? AND m.tenant_id = ? AND m.corpus_id = ?
             AND m.collection_id = ?
             AND BTRIM(tag.value) <> ''
         ),
         grouped AS (
           SELECT
             normalized_tag,
             (array_agg(label ORDER BY item_id, ordinality))[1] AS label,
             COUNT(*)::text AS item_count,
             encode(sha256(convert_to(
               '[' || string_agg(
                 to_json(item_id)::text,
                 ',' ORDER BY item_id, ordinality
               ) || ']',
               'UTF8'
             )), 'hex') AS member_digest,
             encode(sha256(
               convert_to(?, 'UTF8')
               || decode('00', 'hex')
               || convert_to('taxonomy', 'UTF8')
               || decode('00', 'hex')
               || convert_to(normalized_tag, 'UTF8')
             ), 'hex') AS stable_hex
           FROM tagged
           GROUP BY normalized_tag
         ),
         mutated AS (
           SELECT
             *,
             overlay(
               overlay(substr(stable_hex, 1, 32) placing '5' from 13 for 1)
               placing substr(
                 '89ab',
                 ((strpos('0123456789abcdef', substr(stable_hex, 17, 1)) - 1) % 4) + 1,
                 1
               )
               from 17 for 1
             ) AS stable_uuid_hex
           FROM grouped
         ),
         keyed AS (
           SELECT
             normalized_tag,
             label,
             item_count,
             member_digest,
             substr(stable_uuid_hex, 1, 8)
               || '-' || substr(stable_uuid_hex, 9, 4)
               || '-' || substr(stable_uuid_hex, 13, 4)
               || '-' || substr(stable_uuid_hex, 17, 4)
               || '-' || substr(stable_uuid_hex, 21, 12) AS taxonomy_id
           FROM mutated
         )
         SELECT normalized_tag, label, item_count, member_digest
           FROM keyed
          WHERE 'taxonomy:' || taxonomy_id > ?
          ORDER BY taxonomy_id ASC
         LIMIT ${targetCount - candidates.length}`, [...identityParams, aggregate.collection_id, taxonomyAfter]);
      for (const row of rows) {
        append(this.taxonomyResource(aggregate, row.normalized_tag, {
          label: row.label,
          itemCount: Number(row.item_count),
          memberDigest: row.member_digest
        }));
      }
    }
    const total = (kinds.includes("collection") ? 1 : 0) + (kinds.includes("item") ? membershipCount : 0) + (kinds.includes("project") ? 1 : 0) + (kinds.includes("taxonomy") ? taxonomyCount : 0);
    const pageResources = candidates.slice(0, limit);
    const hasMore = candidates.length > pageResources.length;
    const nextCursor = hasMore && pageResources.length > 0 ? Buffer.from(JSON.stringify({
      version: 1,
      project_id: aggregate.project_id,
      collection_id: aggregate.collection_id,
      collection_revision: revision,
      population_digest: populationDigest,
      kinds,
      after: pageResources.at(-1).key
    })).toString("base64url") : null;
    return {
      schema: "knowledge.project-resources.page.v1",
      authority: "knowledge",
      route: KNOWLEDGE_PROJECT_RESOURCES_ROUTE,
      ...this.identity,
      project_id: aggregate.project_id,
      source_project_id: aggregate.source_project_id,
      collection_id: aggregate.collection_id,
      collection_revision: revision,
      population_digest: populationDigest,
      resource_kinds: kinds,
      resources: pageResources,
      count: pageResources.length,
      total,
      limit,
      cursor: options.cursor ?? null,
      next_cursor: nextCursor,
      has_more: hasMore,
      complete: !hasMore,
      truncated: false
    };
  }
  async buildResources(projectId) {
    const aggregate = await this.getAggregateByProject(this.sql, requiredString(projectId, "project_id"));
    if (!aggregate) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "Knowledge project aggregate was not found by source or stable project id.");
    }
    const memberships = await this.sql.many(`SELECT * FROM knowledge_project_collection_memberships
        WHERE authority_id = ? AND tenant_id = ? AND corpus_id = ? AND collection_id = ?
        ORDER BY item_id ASC`, [
      this.identity.authority_id,
      this.identity.tenant_id,
      this.identity.corpus_id,
      aggregate.collection_id
    ]);
    const items = await Promise.all(memberships.map(async (membership) => {
      const item = await this.itemResolver(membership.item_id);
      if (!item || item.id !== membership.item_id) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "collection membership points at a missing Knowledge item; refusing a partial resource population.", { collection_id: aggregate.collection_id, item_id: membership.item_id });
      }
      return item;
    }));
    const revision = `r${Number(aggregate.revision)}`;
    const base = {
      project_id: aggregate.project_id,
      source_project_id: aggregate.source_project_id,
      collection_id: aggregate.collection_id,
      revision
    };
    const resources = [];
    const projectBody = {
      ...base,
      kind: "project",
      id: aggregate.project_id,
      title: aggregate.project_name,
      locator: { kind: "canonical_uri", value: `knowledge:project:${aggregate.project_id}` },
      metadata: {
        source_project_id: aggregate.source_project_id,
        slug: aggregate.project_slug,
        collection_count: 1
      }
    };
    resources.push({
      ...projectBody,
      key: `project:${aggregate.project_id}`,
      digest: digestKnowledgeProjectLinksValue(projectBody)
    });
    const collectionBody = {
      ...base,
      kind: "collection",
      id: aggregate.collection_id,
      title: aggregate.collection_name,
      locator: { kind: "external_uuid", value: aggregate.collection_id },
      metadata: {
        slug: aggregate.collection_slug,
        membership_rule: KNOWLEDGE_PROJECT_MEMBERSHIP_RULE,
        member_count: items.length
      }
    };
    resources.push({
      ...collectionBody,
      key: `collection:${aggregate.collection_id}`,
      digest: digestKnowledgeProjectLinksValue(collectionBody)
    });
    for (const item of items) {
      const itemBody = {
        ...base,
        kind: "item",
        id: item.id,
        revision: `v${item.version ?? 1}`,
        title: item.title,
        locator: { kind: "canonical_uri", value: `knowledge:item:${encodeURIComponent(item.id)}` },
        metadata: {
          tags: [...item.tags ?? []],
          archived: item.archived === true,
          updated_at: item.updated_at
        }
      };
      resources.push({
        ...itemBody,
        key: `item:${item.id}`,
        digest: digestKnowledgeProjectLinksValue(itemBody)
      });
    }
    const taxonomy = new Map;
    for (const item of items) {
      for (const rawTag of item.tags ?? []) {
        const normalized = rawTag.trim().toLowerCase();
        if (!normalized)
          continue;
        const entry = taxonomy.get(normalized) ?? { label: rawTag.trim(), itemIds: [] };
        entry.itemIds.push(item.id);
        taxonomy.set(normalized, entry);
      }
    }
    for (const [normalized, entry] of [...taxonomy.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const taxonomyId = stableUuid(`${aggregate.collection_id}\x00taxonomy\x00${normalized}`);
      const taxonomyBody = {
        ...base,
        kind: "taxonomy",
        id: taxonomyId,
        title: entry.label,
        locator: { kind: "external_uuid", value: taxonomyId },
        metadata: {
          tag: entry.label,
          normalized_tag: normalized,
          item_count: entry.itemIds.length,
          member_digest: digestKnowledgeProjectLinksValue([...entry.itemIds].sort())
        }
      };
      resources.push({
        ...taxonomyBody,
        key: `taxonomy:${taxonomyId}`,
        digest: digestKnowledgeProjectLinksValue(taxonomyBody)
      });
    }
    resources.sort((left, right) => left.key.localeCompare(right.key));
    return { aggregate, resources };
  }
  async listProjectResources(projectId, options = {}) {
    const limit = boundedLimit(options.limit);
    const kinds = normalizeKinds(options.kinds);
    if (this.sql.kind === "postgres") {
      return this.listPostgresProjectResources(projectId, options, limit, kinds);
    }
    const { aggregate, resources } = await this.buildResources(projectId);
    const revision = `r${Number(aggregate.revision)}`;
    const population = resources.filter((resource) => kinds.includes(resource.kind));
    const populationDigest = digestKnowledgeProjectLinksValue(population.map((resource) => ({ key: resource.key, digest: resource.digest })));
    let after = "";
    if (options.cursor) {
      let decoded;
      try {
        decoded = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
      } catch {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT", "cursor is not a valid Knowledge project-resources cursor.");
      }
      if (decoded.version !== 1 || decoded.project_id !== aggregate.project_id || decoded.collection_id !== aggregate.collection_id || decoded.collection_revision !== revision || decoded.population_digest !== populationDigest || canonicalKnowledgeProjectLinksJson(decoded.kinds) !== canonicalKnowledgeProjectLinksJson(kinds) || typeof decoded.after !== "string") {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE", "project resources changed or the cursor belongs to a different project/kind selection; restart from the first page.");
      }
      after = decoded.after;
    }
    const remaining = after ? population.filter((resource) => resource.key > after) : population;
    const pageResources = remaining.slice(0, limit);
    const hasMore = remaining.length > pageResources.length;
    const nextCursor = hasMore && pageResources.length > 0 ? Buffer.from(JSON.stringify({
      version: 1,
      project_id: aggregate.project_id,
      collection_id: aggregate.collection_id,
      collection_revision: revision,
      population_digest: populationDigest,
      kinds,
      after: pageResources.at(-1).key
    })).toString("base64url") : null;
    return {
      schema: "knowledge.project-resources.page.v1",
      authority: "knowledge",
      route: KNOWLEDGE_PROJECT_RESOURCES_ROUTE,
      ...this.identity,
      project_id: aggregate.project_id,
      source_project_id: aggregate.source_project_id,
      collection_id: aggregate.collection_id,
      collection_revision: revision,
      population_digest: populationDigest,
      resource_kinds: kinds,
      resources: pageResources,
      count: pageResources.length,
      total: population.length,
      limit,
      cursor: options.cursor ?? null,
      next_cursor: nextCursor,
      has_more: hasMore,
      complete: !hasMore,
      truncated: false
    };
  }
  async readProjectResource(projectId, kind, resourceId) {
    const { resources } = await this.buildResources(projectId);
    const resource = resources.find((candidate) => candidate.kind === kind && candidate.id === resourceId);
    if (!resource) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_NOT_FOUND", "Knowledge project resource was not found by exact kind and id.");
    }
    return resource;
  }
  async readAllProjectResources(projectId, options = {}) {
    const resources = [];
    const seen = new Set;
    let cursor = null;
    let expected = null;
    do {
      const page = await this.listProjectResources(projectId, { ...options, cursor });
      const identity = {
        project_id: page.project_id,
        collection_id: page.collection_id,
        collection_revision: page.collection_revision,
        population_digest: page.population_digest,
        total: page.total,
        kinds: canonicalKnowledgeProjectLinksJson(page.resource_kinds)
      };
      if (expected && canonicalKnowledgeProjectLinksJson(expected) !== canonicalKnowledgeProjectLinksJson(identity)) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE", "project resources changed while the complete population was being read.");
      }
      expected ??= identity;
      for (const resource of page.resources) {
        if (seen.has(resource.key)) {
          throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "project resource pagination returned a duplicate stable resource key.", { key: resource.key });
        }
        seen.add(resource.key);
        resources.push(resource);
      }
      if (page.has_more && !page.next_cursor) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "project resource page claims more data without a continuation cursor.");
      }
      cursor = page.next_cursor;
    } while (cursor);
    if (!expected || resources.length !== expected.total) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "complete project resource enumeration did not match the producer total.", { expected_total: expected?.total ?? null, received: resources.length });
    }
    return resources;
  }
}
function createPostgresKnowledgeProjectLinksAuthority(input) {
  return new PackageOwnedKnowledgeProjectLinksAuthority(new PostgresProjectLinksSql(input.client, input.client), input.itemResolver, input.options);
}
function wireErrorStatus(error) {
  if (error.code === "KNOWLEDGE_PROJECT_LINKS_NOT_FOUND")
    return 404;
  if (error.code === "KNOWLEDGE_PROJECT_LINKS_CONFLICT" || error.code === "KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE" || error.code === "KNOWLEDGE_PROJECT_LINKS_IDEMPOTENCY_MISMATCH")
    return 409;
  if (error.code === "KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION")
    return 503;
  return 400;
}
function knowledgeProjectLinksErrorResponse(error) {
  if (error instanceof KnowledgeProjectLinksError) {
    return Response.json({ error: error.code, message: error.message, details: error.details }, { status: wireErrorStatus(error) });
  }
  throw error;
}
var KNOWLEDGE_PROJECT_LINKS_ERROR_CODES = new Set([
  "KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT",
  "KNOWLEDGE_PROJECT_LINKS_CAPABILITY_MISMATCH",
  "KNOWLEDGE_PROJECT_LINKS_DIGEST_MISMATCH",
  "KNOWLEDGE_PROJECT_LINKS_IDEMPOTENCY_MISMATCH",
  "KNOWLEDGE_PROJECT_LINKS_CONFLICT",
  "KNOWLEDGE_PROJECT_LINKS_NOT_FOUND",
  "KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE",
  "KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION",
  "KNOWLEDGE_PROJECT_LINKS_INVALID_RESPONSE"
]);
// src/registry-contract.ts
var KNOWLEDGE_REGISTRY_CONTRACT_VERSION = 2;
function knowledgeRegistryContract(input) {
  return {
    contract_version: KNOWLEDGE_REGISTRY_CONTRACT_VERSION,
    service: "open-knowledge",
    capabilities: [
      "registry",
      "notes-read",
      "notes-write",
      "open-files-source-refs",
      "s3-generated-artifacts"
    ],
    endpoints: {
      registry: "/v1/registry",
      notes: "/v1/notes",
      note: "/v1/notes/{id}",
      health: "/health",
      version: "/version",
      ready: "/ready",
      openapi: "/openapi.json"
    },
    source_contract: {
      owner: "open-files",
      preferred_ref: "open-files",
      allowed_schemes: input.sourceSchemes,
      raw_source_bytes_stored_in_open_knowledge: false
    },
    artifact_contract: {
      storage_type: input.storageType,
      uri_prefix: input.artifactUriPrefix,
      generated_only: true
    }
  };
}

// src/store.ts
var SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
var heldLockPaths = new Set;
var LOCK_CONTENTION_CODES = new Set(["EEXIST", "EPERM", "EBUSY"]);
function makeId() {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function makeShortId(id) {
  return id.replace(/^k_/, "").slice(0, 12);
}

// src/guarded-write-contract.ts
import { createHash as createHash2, randomUUID } from "crypto";
var KNOWLEDGE_GUARDED_WRITE_CONTRACT = "FCAME-1";
var KNOWLEDGE_PRIVATE_INPUT_SCHEMA = "hasna.knowledge.private-input.v1";
var KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA = "hasna.knowledge.private-title-lookup.v1";
var KNOWLEDGE_PRIVATE_QUERY_SCHEMA = "hasna.knowledge.private-query.v1";
var KNOWLEDGE_RELATIONS_SCHEMA = "hasna.knowledge.relations.v1";
var KNOWLEDGE_RELATIONS_METADATA_KEY = "hasna_knowledge_relations";
var DEFAULT_KNOWLEDGE_GUARDED_LIMITS = Object.freeze({
  submission: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 1048576,
    wall_time_ms: 1e4
  }),
  reconciliation: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 262144,
    wall_time_ms: 5000
  }),
  readback: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 1048576,
    wall_time_ms: 5000
  })
});
var MAX_GUARDED_BYTES = 4 * 1024 * 1024;
var MAX_GUARDED_WALL_TIME_MS = 30000;
var MAX_DESCRIPTOR_LIFETIME_MS = 60 * 60 * 1000;
var PRIVATE_PAYLOADS = new WeakMap;
var PRIVATE_TITLE_LOOKUPS = new WeakMap;
var PRIVATE_QUERIES = new WeakMap;
var PRIVATE_RESULTS = new WeakMap;
function assertObjectKeys(value, field, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !keys.includes(key));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`${field} keys must match its FCAME-1 schema` + `${unexpected.length > 0 ? `; unexpected: ${unexpected.sort().join(",")}` : ""}` + `${missing.length > 0 ? `; missing: ${missing.sort().join(",")}` : ""}.`);
  }
}
function assertBoundText(value, field, maxLength = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must be a non-empty, trimmed string without control characters.`);
  }
}
function assertKnowledgeGuardedBinding(binding) {
  assertObjectKeys(binding, "binding", ["authority", "tenant_id", "scope", "parent_id"]);
  assertObjectKeys(binding.authority, "binding.authority", ["classification", "authority_id"]);
  if (!["user_hosted", "hasna_saas"].includes(binding.authority.classification)) {
    throw new Error("binding.authority.classification must be user_hosted or hasna_saas.");
  }
  assertBoundText(binding.authority.authority_id, "binding.authority.authority_id");
  assertBoundText(binding.tenant_id, "binding.tenant_id", 64);
  assertBoundText(binding.scope, "binding.scope");
  assertBoundText(binding.parent_id, "binding.parent_id");
}
function assertKnowledgeGuardedPrecondition(verb, precondition) {
  if (!["create", "update"].includes(verb)) {
    throw new Error("verb must be create or update.");
  }
  if (verb === "create") {
    assertObjectKeys(precondition, "precondition", ["kind"]);
    if (!precondition || precondition.kind !== "absent") {
      throw new Error("create requires the create-if-absent precondition.");
    }
    return;
  }
  assertObjectKeys(precondition, "precondition", ["kind", "expected_version"]);
  if (!precondition || precondition.kind !== "version" || !Number.isInteger(precondition.expected_version) || precondition.expected_version < 1) {
    throw new Error("update requires a positive compare-and-swap expected_version.");
  }
}
function assertKnowledgeGuardedManifestBinding(manifest) {
  assertObjectKeys(manifest, "manifest", ["manifest_id", "ordinal", "phase", "compensates_receipt_id"]);
  assertBoundText(manifest.manifest_id, "manifest.manifest_id");
  if (!Number.isInteger(manifest.ordinal) || manifest.ordinal < 0) {
    throw new Error("manifest.ordinal must be a non-negative integer.");
  }
  if (!["primary", "recovery"].includes(manifest.phase)) {
    throw new Error("manifest.phase must be primary or recovery.");
  }
  if (manifest.phase === "primary" && manifest.compensates_receipt_id !== null) {
    throw new Error("a primary manifest step cannot compensate a receipt.");
  }
  if (manifest.compensates_receipt_id !== null && (typeof manifest.compensates_receipt_id !== "string" || !/^kwr_[0-9a-f]{64}$/.test(manifest.compensates_receipt_id))) {
    throw new Error("manifest.compensates_receipt_id must be null or an immutable guarded receipt id.");
  }
}
function assertKnowledgeGuardedBounds(bounds, field = "limits") {
  assertObjectKeys(bounds, field, ["max_calls", "max_items", "max_bytes", "wall_time_ms"]);
  if (bounds.max_calls !== 1)
    throw new Error(`${field}.max_calls must be exactly 1.`);
  if (bounds.max_items !== 1)
    throw new Error(`${field}.max_items must be exactly 1.`);
  if (!Number.isInteger(bounds.max_bytes) || bounds.max_bytes < 1 || bounds.max_bytes > MAX_GUARDED_BYTES) {
    throw new Error(`${field}.max_bytes must be a positive integer no greater than ${MAX_GUARDED_BYTES}.`);
  }
  if (!Number.isInteger(bounds.wall_time_ms) || bounds.wall_time_ms < 1 || bounds.wall_time_ms > MAX_GUARDED_WALL_TIME_MS) {
    throw new Error(`${field}.wall_time_ms must be a positive integer no greater than ${MAX_GUARDED_WALL_TIME_MS}.`);
  }
}
function assertKnowledgePrivateQueryBounds(bounds, field = "query limits") {
  assertObjectKeys(bounds, field, ["max_calls", "max_items", "max_bytes", "wall_time_ms"]);
  if (bounds.max_calls !== 1)
    throw new Error(`${field}.max_calls must be exactly 1.`);
  if (!Number.isInteger(bounds.max_items) || bounds.max_items < 1 || bounds.max_items > 50) {
    throw new Error(`${field}.max_items must be an integer between 1 and 50.`);
  }
  if (!Number.isInteger(bounds.max_bytes) || bounds.max_bytes < 1 || bounds.max_bytes > MAX_GUARDED_BYTES) {
    throw new Error(`${field}.max_bytes must be a positive integer no greater than ${MAX_GUARDED_BYTES}.`);
  }
  if (!Number.isInteger(bounds.wall_time_ms) || bounds.wall_time_ms < 1 || bounds.wall_time_ms > MAX_GUARDED_WALL_TIME_MS) {
    throw new Error(`${field}.wall_time_ms must be a positive integer no greater than ${MAX_GUARDED_WALL_TIME_MS}.`);
  }
}
function assertKnowledgePrivateQueryPage(page, bounds) {
  assertObjectKeys(page, "query page", ["limit", "offset"]);
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > bounds.max_items) {
    throw new Error("query page.limit must be a positive integer no greater than limits.max_items.");
  }
  if (!Number.isInteger(page.offset) || page.offset < 0 || page.offset > 1e4) {
    throw new Error("query page.offset must be an integer between 0 and 10000.");
  }
}
function assertKnowledgePrivateQuerySelector(selector) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    throw new Error("private query selector must be an object.");
  }
  switch (selector.kind) {
    case "exact_title":
      assertObjectKeys(selector, "private query selector", ["kind", "title"]);
      assertBoundText(selector.title, "private query selector.title", 2048);
      return;
    case "lexical_overlap":
    case "semantic_overlap":
      assertObjectKeys(selector, "private query selector", ["kind", "query"]);
      assertBoundText(selector.query, "private query selector.query", 4096);
      return;
    case "supersession":
      assertObjectKeys(selector, "private query selector", ["kind", "supersedes_item_id"]);
      assertBoundText(selector.supersedes_item_id, "private query selector.supersedes_item_id");
      return;
    case "current_version":
      assertObjectKeys(selector, "private query selector", ["kind", "item_id"]);
      assertBoundText(selector.item_id, "private query selector.item_id");
      return;
    case "historical_version":
      assertObjectKeys(selector, "private query selector", ["kind", "item_id", "version"]);
      assertBoundText(selector.item_id, "private query selector.item_id");
      if (!Number.isInteger(selector.version) || selector.version < 1) {
        throw new Error("private query selector.version must be a positive integer.");
      }
      return;
    case "canonical_pointer":
      assertObjectKeys(selector, "private query selector", ["kind", "canonical_item_id"]);
      assertBoundText(selector.canonical_item_id, "private query selector.canonical_item_id");
      return;
    default:
      throw new Error("private query selector.kind is unsupported.");
  }
}
function assertKnowledgeRelationsMetadata(metadata, itemId) {
  const raw = metadata[KNOWLEDGE_RELATIONS_METADATA_KEY];
  if (raw === undefined)
    return;
  assertObjectKeys(raw, `metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}`, ["schema", "supersedes_item_id", "canonical_item_id"], ["schema"]);
  if (raw.schema !== KNOWLEDGE_RELATIONS_SCHEMA) {
    throw new Error(`metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.schema is unsupported.`);
  }
  const supersedes = raw.supersedes_item_id;
  const canonical = raw.canonical_item_id;
  if (supersedes === undefined && canonical === undefined) {
    throw new Error(`metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY} must contain at least one pointer.`);
  }
  if (supersedes !== undefined) {
    assertBoundText(supersedes, `metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.supersedes_item_id`);
    if (itemId && supersedes === itemId) {
      throw new Error("an item cannot supersede itself.");
    }
  }
  if (canonical !== undefined) {
    assertBoundText(canonical, `metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.canonical_item_id`);
    if (itemId && canonical === itemId) {
      throw new Error(`metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.canonical_item_id cannot reference itself.`);
    }
  }
}
function normalizeKnowledgeGuardedLimits(limits = {}) {
  assertObjectKeys(limits, "limits", ["submission", "reconciliation", "readback"], []);
  if (limits.submission !== undefined) {
    assertKnowledgeGuardedBounds(limits.submission, "limits.submission");
  }
  if (limits.reconciliation !== undefined) {
    assertKnowledgeGuardedBounds(limits.reconciliation, "limits.reconciliation");
  }
  if (limits.readback !== undefined) {
    assertKnowledgeGuardedBounds(limits.readback, "limits.readback");
  }
  const normalized = {
    submission: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.submission, ...limits.submission },
    reconciliation: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.reconciliation, ...limits.reconciliation },
    readback: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.readback, ...limits.readback }
  };
  assertKnowledgeGuardedBounds(normalized.submission, "limits.submission");
  assertKnowledgeGuardedBounds(normalized.reconciliation, "limits.reconciliation");
  assertKnowledgeGuardedBounds(normalized.readback, "limits.readback");
  return Object.freeze({
    submission: Object.freeze(normalized.submission),
    reconciliation: Object.freeze(normalized.reconciliation),
    readback: Object.freeze(normalized.readback)
  });
}
function canonicalValue(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  if (typeof value !== "object") {
    throw new Error(`${path} must contain only JSON values.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain plain JSON objects.`);
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child === undefined)
      throw new Error(`${path}.${key} must not be undefined.`);
    result[key] = canonicalValue(child, `${path}.${key}`);
  }
  return result;
}
function canonicalKnowledgeGuardedJson(value) {
  return JSON.stringify(canonicalValue(value, "value"));
}
function knowledgeGuardedDigest(value) {
  return createHash2("sha256").update(canonicalKnowledgeGuardedJson(value), "utf8").digest("hex");
}
function knowledgeGuardedContentSha256(content) {
  if (typeof content !== "string")
    throw new Error("content must be a string.");
  return createHash2("sha256").update(content, "utf8").digest("hex");
}
function computeKnowledgeGuardedAdoptionDeterministicKey(input) {
  if (!["adopt", "rollback"].includes(input.action)) {
    throw new Error("adoption action must be adopt or rollback.");
  }
  assertBoundText(input.operation_id, "operation_id");
  assertBoundText(input.step_id, "step_id");
  assertBoundText(input.target_id, "target_id");
  assertKnowledgeGuardedBinding(input.binding);
  if (!Number.isInteger(input.expected_version) || input.expected_version < 1) {
    throw new Error("expected_version must be a positive integer.");
  }
  if (!/^[0-9a-f]{64}$/.test(input.expected_content_sha256)) {
    throw new Error("expected_content_sha256 must be a lowercase sha256 hex digest.");
  }
  const adoptionReceiptId = input.adoption_receipt_id ?? null;
  if (input.action === "adopt" && adoptionReceiptId !== null) {
    throw new Error("adopt must not reference an adoption receipt.");
  }
  if (input.action === "rollback" && (typeof adoptionReceiptId !== "string" || !/^kar_[0-9a-f]{64}$/.test(adoptionReceiptId))) {
    throw new Error("rollback requires an immutable adoption receipt id.");
  }
  return `fcame1_adoption_${knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    action: input.action,
    operation_id: input.operation_id,
    step_id: input.step_id,
    target_id: input.target_id,
    binding: input.binding,
    expected_version: input.expected_version,
    expected_content_sha256: input.expected_content_sha256,
    adoption_receipt_id: adoptionReceiptId
  })}`;
}
function computeKnowledgeGuardedAdoptionReceiptId(deterministicKey) {
  if (!/^fcame1_adoption_[0-9a-f]{64}$/.test(deterministicKey)) {
    throw new Error("deterministicKey must be an FCAME-1 adoption key.");
  }
  return `kar_${deterministicKey.slice("fcame1_adoption_".length)}`;
}
function computeKnowledgeGuardedDeterministicKey(input) {
  assertKnowledgeGuardedBinding(input.binding);
  assertBoundText(input.operation_id, "operation_id");
  assertBoundText(input.step_id, "step_id");
  assertBoundText(input.target_id, "target_id");
  if (!/^[0-9a-f]{64}$/.test(input.payload_digest)) {
    throw new Error("payload_digest must be a lowercase sha256 hex digest.");
  }
  assertKnowledgeGuardedPrecondition(input.verb, input.precondition);
  if (input.manifest)
    assertKnowledgeGuardedManifestBinding(input.manifest);
  const digest = knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    authority: input.binding.authority,
    tenant_id: input.binding.tenant_id,
    scope: input.binding.scope,
    parent_id: input.binding.parent_id,
    operation_id: input.operation_id,
    step_id: input.step_id,
    verb: input.verb,
    target_id: input.target_id,
    payload_digest: input.payload_digest,
    precondition: input.precondition,
    manifest: input.manifest ?? null
  });
  return `fcame1_${digest}`;
}
function computeKnowledgeGuardedRecoveryKey(input) {
  assertBoundText(input.manifest_id, "manifest_id");
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
    throw new Error("ordinal must be a non-negative integer.");
  }
  if (!/^fcame1_[0-9a-f]{64}$/.test(input.step_deterministic_key)) {
    throw new Error("step_deterministic_key must be an FCAME-1 deterministic key.");
  }
  assertBoundText(input.operation_id, "recovery.operation_id");
  assertBoundText(input.step_id, "recovery.step_id");
  assertBoundText(input.target_id, "recovery.target_id");
  assertKnowledgeGuardedBinding(input.binding);
  assertKnowledgeGuardedPrecondition(input.verb, input.precondition);
  const recoveryLimits = normalizeKnowledgeGuardedLimits(input.limits);
  if (canonicalKnowledgeGuardedJson(recoveryLimits) !== canonicalKnowledgeGuardedJson(input.limits)) {
    throw new Error("recovery.limits must be explicit and complete.");
  }
  if (!/^[0-9a-f]{64}$/.test(input.semantic_digest)) {
    throw new Error("recovery.semantic_digest must be a lowercase sha256 hex digest.");
  }
  if (!["forward_repair", "receipt_scoped_compensation"].includes(input.strategy)) {
    throw new Error("recovery.strategy must be forward_repair or receipt_scoped_compensation.");
  }
  if (input.strategy === "receipt_scoped_compensation" && input.receipt_scope !== "accepted_step_receipt" || input.strategy === "forward_repair" && input.receipt_scope !== null) {
    throw new Error("receipt_scoped_compensation requires accepted_step_receipt; forward_repair requires null receipt_scope.");
  }
  const expectedReceiptId = computeKnowledgeGuardedReceiptId(input.step_deterministic_key);
  if (input.strategy === "receipt_scoped_compensation" && input.compensates_receipt_id !== expectedReceiptId || input.strategy === "forward_repair" && input.compensates_receipt_id !== null) {
    throw new Error("receipt-scoped compensation must bind the deterministic accepted-step receipt; " + "forward repair must not bind one.");
  }
  return computeKnowledgeGuardedDeterministicKey({
    binding: input.binding,
    operation_id: input.operation_id,
    step_id: input.step_id,
    verb: input.verb,
    target_id: input.target_id,
    payload_digest: input.semantic_digest,
    precondition: input.precondition,
    manifest: {
      manifest_id: input.manifest_id,
      ordinal: input.ordinal,
      phase: "recovery",
      compensates_receipt_id: input.compensates_receipt_id
    }
  });
}
function computeKnowledgeGuardedReceiptId(deterministicKey) {
  if (!/^fcame1_[0-9a-f]{64}$/.test(deterministicKey)) {
    throw new Error("deterministicKey must be an FCAME-1 write key.");
  }
  return `kwr_${deterministicKey.slice("fcame1_".length)}`;
}
function computeKnowledgeGuardedManifestId(maintainer, operationId) {
  assertKnowledgeGuardedBinding(maintainer);
  assertBoundText(operationId, "operation_id");
  return `kmf_${knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    maintainer,
    operation_id: operationId
  })}`;
}
function assertKnowledgeGuardedManifestStep(manifestId, step, expectedOrdinal) {
  assertObjectKeys(step, `steps[${expectedOrdinal}]`, [
    "ordinal",
    "operation_id",
    "step_id",
    "deterministic_key",
    "verb",
    "target_id",
    "binding",
    "semantic_digest",
    "precondition",
    "dependencies",
    "limits",
    "recovery"
  ]);
  assertObjectKeys(step.recovery, `steps[${expectedOrdinal}].recovery`, [
    "strategy",
    "operation_id",
    "step_id",
    "deterministic_key",
    "verb",
    "target_id",
    "semantic_digest",
    "precondition",
    "binding",
    "limits",
    "receipt_scope",
    "compensates_receipt_id"
  ]);
  if (step.ordinal !== expectedOrdinal) {
    throw new Error(`manifest steps must be ordered contiguously from zero; expected ordinal ${expectedOrdinal}.`);
  }
  assertBoundText(step.operation_id, `steps[${expectedOrdinal}].operation_id`);
  assertBoundText(step.step_id, `steps[${expectedOrdinal}].step_id`);
  assertBoundText(step.target_id, `steps[${expectedOrdinal}].target_id`);
  assertKnowledgeGuardedBinding(step.binding);
  assertKnowledgeGuardedPrecondition(step.verb, step.precondition);
  if (!/^[0-9a-f]{64}$/.test(step.semantic_digest)) {
    throw new Error(`steps[${expectedOrdinal}].semantic_digest must be a lowercase sha256 digest.`);
  }
  const normalizedLimits = normalizeKnowledgeGuardedLimits(step.limits);
  if (canonicalKnowledgeGuardedJson(normalizedLimits) !== canonicalKnowledgeGuardedJson(step.limits)) {
    throw new Error(`steps[${expectedOrdinal}].limits must be explicit and complete.`);
  }
  const expectedDependencies = Array.from({ length: expectedOrdinal }, (_unused, index) => index);
  if (!Array.isArray(step.dependencies) || canonicalKnowledgeGuardedJson(step.dependencies) !== canonicalKnowledgeGuardedJson(expectedDependencies)) {
    throw new Error(`steps[${expectedOrdinal}].dependencies must name every prior ordinal in order.`);
  }
  const expectedStepKey = computeKnowledgeGuardedDeterministicKey({
    binding: step.binding,
    operation_id: step.operation_id,
    step_id: step.step_id,
    verb: step.verb,
    target_id: step.target_id,
    payload_digest: step.semantic_digest,
    precondition: step.precondition,
    manifest: {
      manifest_id: manifestId,
      ordinal: step.ordinal,
      phase: "primary",
      compensates_receipt_id: null
    }
  });
  if (step.deterministic_key !== expectedStepKey) {
    throw new Error(`steps[${expectedOrdinal}].deterministic_key does not match its frozen tuple.`);
  }
  const expectedRecoveryKey = computeKnowledgeGuardedRecoveryKey({
    manifest_id: manifestId,
    ordinal: step.ordinal,
    step_deterministic_key: step.deterministic_key,
    strategy: step.recovery.strategy,
    operation_id: step.recovery.operation_id,
    step_id: step.recovery.step_id,
    verb: step.recovery.verb,
    target_id: step.recovery.target_id,
    semantic_digest: step.recovery.semantic_digest,
    precondition: step.recovery.precondition,
    binding: step.recovery.binding,
    limits: step.recovery.limits,
    receipt_scope: step.recovery.receipt_scope,
    compensates_receipt_id: step.recovery.compensates_receipt_id
  });
  if (step.recovery.deterministic_key !== expectedRecoveryKey) {
    throw new Error(`steps[${expectedOrdinal}].recovery.deterministic_key does not match its frozen tuple.`);
  }
}
function assertKnowledgeGuardedManifestOptions(maintainer, options) {
  assertKnowledgeGuardedBinding(maintainer);
  assertObjectKeys(options, "manifest", ["manifest_id", "operation_id", "steps"]);
  assertBoundText(options.manifest_id, "manifest_id");
  assertBoundText(options.operation_id, "operation_id");
  const expectedManifestId = computeKnowledgeGuardedManifestId(maintainer, options.operation_id);
  if (options.manifest_id !== expectedManifestId) {
    throw new Error("manifest_id must be the deterministic FCAME-1 id for its maintainer and workflow operation.");
  }
  if (!Array.isArray(options.steps) || options.steps.length < 2 || options.steps.length > 64) {
    throw new Error("a guarded workflow manifest must contain between 2 and 64 ordered steps.");
  }
  const identities = new Set;
  const deterministicKeys = new Set;
  options.steps.forEach((step, index) => {
    assertKnowledgeGuardedManifestStep(options.manifest_id, step, index);
    if (step.binding.tenant_id !== maintainer.tenant_id || step.recovery.binding.tenant_id !== maintainer.tenant_id) {
      throw new Error(`manifest step ${index} crosses tenants without an authority delegation contract.`);
    }
    for (const action of [step, step.recovery]) {
      const identity = `${action.binding.authority.classification}\x00${action.binding.authority.authority_id}` + `\x00${action.binding.tenant_id}\x00${action.binding.scope}\x00${action.binding.parent_id}` + `\x00${action.operation_id}\x00${action.step_id}`;
      if (identities.has(identity)) {
        throw new Error(`manifest step ${index} repeats an operation/step identity.`);
      }
      identities.add(identity);
      if (deterministicKeys.has(action.deterministic_key)) {
        throw new Error(`manifest step ${index} repeats a deterministic action key.`);
      }
      deterministicKeys.add(action.deterministic_key);
    }
  });
}
function computeKnowledgeGuardedManifestDigest(maintainer, options) {
  assertKnowledgeGuardedManifestOptions(maintainer, options);
  return knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    manifest_id: options.manifest_id,
    operation_id: options.operation_id,
    maintainer,
    steps: options.steps
  });
}
function computeKnowledgeGuardedManifestDeterministicKey(maintainer, options) {
  return `fcame1_manifest_${computeKnowledgeGuardedManifestDigest(maintainer, options)}`;
}
function assertKnowledgeGuardedPayload(verb, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload must be a JSON object.");
  }
  canonicalValue(payload, "payload");
  if (verb === "create") {
    const title = payload.title;
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("create payload.title is required.");
    }
  }
  const allowed = verb === "create" ? new Set(["title", "content", "url", "tags", "metadata"]) : new Set(["title", "content", "url", "tags", "metadata", "archived"]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key))
      throw new Error(`payload.${key} is not allowed for ${verb}.`);
  }
  if ("title" in payload && payload.title !== undefined) {
    assertBoundText(payload.title, "payload.title", 2048);
  }
  if ("content" in payload && payload.content !== undefined && typeof payload.content !== "string") {
    throw new Error("payload.content must be a string.");
  }
  if ("url" in payload && payload.url !== undefined && payload.url !== null && (typeof payload.url !== "string" || payload.url.length > 8192 || /[\u0000-\u001f\u007f]/.test(payload.url))) {
    throw new Error("payload.url must be null or a string without control characters.");
  }
  if ("tags" in payload && payload.tags !== undefined) {
    if (!Array.isArray(payload.tags) || payload.tags.length > 256) {
      throw new Error("payload.tags must be an array of strings.");
    }
    payload.tags.forEach((tag, index) => assertBoundText(tag, `payload.tags[${index}]`, 256));
  }
  if ("archived" in payload && payload.archived !== undefined && typeof payload.archived !== "boolean") {
    throw new Error("payload.archived must be a boolean.");
  }
  if ("metadata" in payload && payload.metadata !== undefined) {
    if (payload.metadata === null || typeof payload.metadata !== "object" || Array.isArray(payload.metadata)) {
      throw new Error("payload.metadata must be a JSON object.");
    }
  }
  if (verb === "update" && Object.keys(payload).length === 0) {
    throw new Error("update payload must change at least one field.");
  }
}
function knowledgePrivateItemProof(item) {
  return Object.freeze({
    id: item.id,
    version: Number(item.version ?? 1),
    title_sha256: knowledgeGuardedContentSha256(item.title),
    content_sha256: knowledgeGuardedContentSha256(item.content),
    url_sha256: item.url === null || item.url === undefined ? null : knowledgeGuardedContentSha256(item.url),
    tags_sha256: knowledgeGuardedDigest(item.tags ?? []),
    metadata_sha256: knowledgeGuardedDigest(item.metadata ?? {}),
    archived: item.archived === true
  });
}
function knowledgePrivateQueryItemProof(item, matchedValue = null) {
  return Object.freeze({
    id_sha256: knowledgeGuardedContentSha256(item.id),
    version: Number(item.version ?? 1),
    title_sha256: knowledgeGuardedContentSha256(item.title),
    content_sha256: knowledgeGuardedContentSha256(item.content),
    url_sha256: item.url === null || item.url === undefined ? null : knowledgeGuardedContentSha256(item.url),
    tags_sha256: knowledgeGuardedDigest(item.tags ?? []),
    metadata_sha256: knowledgeGuardedDigest(item.metadata ?? {}),
    archived: item.archived === true,
    record_kind: "current",
    matched_value_sha256: matchedValue === null ? null : knowledgeGuardedContentSha256(matchedValue)
  });
}
function knowledgePrivateHistoricalQueryItemProof(item, matchedValue = null) {
  return Object.freeze({
    id_sha256: knowledgeGuardedContentSha256(item.item_id),
    version: item.version,
    title_sha256: knowledgeGuardedContentSha256(item.title),
    content_sha256: item.content_hash,
    url_sha256: item.url === null ? null : knowledgeGuardedContentSha256(item.url),
    tags_sha256: knowledgeGuardedDigest(item.tags),
    metadata_sha256: knowledgeGuardedDigest(item.metadata),
    archived: item.archived,
    record_kind: "historical",
    matched_value_sha256: matchedValue === null ? null : knowledgeGuardedContentSha256(matchedValue)
  });
}
function evaluateKnowledgeGuardedManifestCompletion(steps) {
  if (steps.length === 0 || steps.some((step) => step.state === "unverified_external_authority" || step.recovery_state === "unverified_external_authority")) {
    return { terminal_complete: false, accepted_complete: false };
  }
  const acceptedComplete = steps.every((step) => step.state === "accepted" && step.recovery_state === "missing");
  if (acceptedComplete) {
    return { terminal_complete: true, accepted_complete: true };
  }
  const allPrimaryTerminal = steps.every((step) => step.state === "accepted" || step.state === "rejected");
  const allRecoveryMissing = steps.every((step) => step.recovery_state === "missing");
  if (allPrimaryTerminal && allRecoveryMissing) {
    return { terminal_complete: true, accepted_complete: false };
  }
  const firstNonAccepted = steps.findIndex((step) => step.state !== "accepted");
  if (firstNonAccepted === 0) {
    const cleanInitialRejection = steps[0].state === "rejected" && steps.slice(1).every((step) => step.state !== "accepted") && allRecoveryMissing;
    return { terminal_complete: cleanInitialRejection, accepted_complete: false };
  }
  if (firstNonAccepted < 1) {
    return { terminal_complete: false, accepted_complete: false };
  }
  const closingRecoveryOrdinal = firstNonAccepted - 1;
  const closingRecovery = steps[closingRecoveryOrdinal];
  const closingRecoveryTerminal = closingRecovery.recovery_state === "accepted" || closingRecovery.recovery_state === "rejected";
  const exactAcceptedPrefix = steps.slice(0, firstNonAccepted).every((step) => step.state === "accepted");
  const closedPrimarySuffix = steps.slice(firstNonAccepted).every((step) => step.state !== "accepted");
  const exactlyOneClosingRecovery = steps.every((step, ordinal) => ordinal === closingRecoveryOrdinal ? closingRecoveryTerminal : step.recovery_state === "missing");
  return {
    terminal_complete: closingRecoveryTerminal && exactAcceptedPrefix && closedPrimarySuffix && exactlyOneClosingRecovery,
    accepted_complete: false
  };
}
function knowledgeGuardedUtf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// src/query-contract.ts
var KNOWLEDGE_BOUNDED_QUERY_CAPABILITY = "hasna.knowledge.bounded-query.v1";

// src/serve.ts
var KNOWLEDGE_SERVE_APP = "knowledge";
function normalizePostgresDatabaseUrl(env = process.env) {
  const key = "HASNA_KNOWLEDGE_DATABASE_URL";
  const url = env[key];
  if (!url)
    return url;
  const lower = url.toLowerCase();
  const needsCompat = (lower.includes("sslmode=require") || lower.includes("sslmode=prefer")) && !lower.includes("uselibpqcompat");
  if (!needsCompat)
    return url;
  const updated = url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
  env[key] = updated;
  return updated;
}
function resolveVersion() {
  if (process.env.HASNA_KNOWLEDGE_VERSION)
    return process.env.HASNA_KNOWLEDGE_VERSION;
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync2(url, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function resolveSigningSecret(env = process.env) {
  const secret = env.HASNA_KNOWLEDGE_API_SIGNING_KEY?.trim() || env.API_KEY_SIGNING_SECRET?.trim() || env.HASNA_API_SIGNING_KEY?.trim();
  if (!secret) {
    throw new Error("knowledge-serve requires an API signing secret: set HASNA_KNOWLEDGE_API_SIGNING_KEY " + "(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).");
  }
  return secret;
}

class VersionConflictError extends Error {
  expected;
  current;
  code = "version_conflict";
  constructor(expected, current) {
    super(`version_conflict: expected version ${expected}, stored version is ${current}`);
    this.expected = expected;
    this.current = current;
    this.name = "VersionConflictError";
  }
}

class CannotPurgeLiveVersionError extends Error {
  version;
  current;
  id;
  code = "cannot_purge_live_version";
  constructor(version, current, id) {
    super(`cannot purge version ${version} of ${id}: it is the live version (the item is at version ${current}), not a retained prior version`);
    this.version = version;
    this.current = current;
    this.id = id;
    this.name = "CannotPurgeLiveVersionError";
  }
}
function parseJsonColumn(value, fallback) {
  if (value == null)
    return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}
function boundedInteger(value, fallback, field, minimum, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new HttpError(400, `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}
function rowToVersion(row) {
  return {
    id: String(row.id),
    item_id: String(row.item_id),
    tenant_id: row.tenant_id ?? null,
    version: Number(row.version),
    title: String(row.title ?? ""),
    content: row.content ?? null,
    body_uri: row.body_uri ?? null,
    content_hash: String(row.content_hash ?? ""),
    content_bytes: Number(row.content_bytes ?? 0),
    url: row.url ?? null,
    tags: parseJsonColumn(row.tags, []),
    metadata: parseJsonColumn(row.metadata, {}),
    archived: Boolean(row.archived),
    actor: row.actor ?? null,
    reason: row.reason ?? null,
    valid_from: row.valid_from ?? null,
    valid_to: String(row.valid_to ?? "")
  };
}
function rowToItem(row) {
  const parseJson = (value, fallback) => {
    if (value == null)
      return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value;
  };
  return {
    id: String(row.id),
    short_id: row.short_id ?? null,
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    url: row.url ?? null,
    tags: parseJson(row.tags, []),
    metadata: parseJson(row.metadata, {}),
    archived: Boolean(row.archived),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    version: row.version == null ? 1 : Number(row.version)
  };
}

class NoteRepo {
  client;
  constructor(client) {
    this.client = client;
  }
  async write(options, fn) {
    return this.client.transaction(async (tx) => {
      await tx.execute(`SELECT set_config('hasna.actor', $1, true), set_config('hasna.reason', $2, true)`, [
        options.actor ?? "",
        options.reason ?? ""
      ]);
      return fn(tx);
    });
  }
  async create(input, options = {}) {
    if (!input.title || typeof input.title !== "string") {
      throw new HttpError(400, "title is required");
    }
    const now = new Date().toISOString();
    const suppliedId = typeof input.id === "string" ? input.id.trim() : "";
    if (input.metadata) {
      try {
        assertKnowledgeRelationsMetadata(input.metadata, suppliedId || undefined);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "invalid relation metadata.");
      }
    }
    if (suppliedId) {
      const guarded = await this.client.get(`SELECT TRUE AS guarded FROM knowledge_items
          WHERE id = $1 AND authority_classification IS NOT NULL
          LIMIT 1`, [suppliedId]);
      if (guarded) {
        throw new HttpError(409, "guarded_item_requires_fcame1_writer");
      }
      const row2 = await this.write(options, (tx) => tx.get(`INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           url = EXCLUDED.url,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at
         RETURNING *`, [
        suppliedId,
        makeShortId(suppliedId),
        input.title,
        input.content ?? "",
        input.url ?? null,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.metadata ?? {}),
        now
      ]));
      return rowToItem(row2);
    }
    const id = makeId();
    const row = await this.write(options, (tx) => tx.get(`INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$9)
       RETURNING *`, [
      id,
      makeShortId(id),
      input.title,
      input.content ?? "",
      input.url ?? null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.metadata ?? {}),
      now,
      now
    ]));
    return rowToItem(row);
  }
  async list(options = {}, guardedTenantId) {
    const limit = boundedInteger(options.limit, 50, "limit", 1, 200);
    const offset = boundedInteger(options.offset, 0, "offset", 0, 1e4);
    const params = [];
    const where = [];
    if (guardedTenantId) {
      params.push(guardedTenantId);
      where.push(`(authority_classification IS NULL OR tenant_id = $${params.length})`);
    } else {
      where.push("authority_classification IS NULL");
    }
    const archive = options.archive ?? "active";
    if (archive === "active")
      where.push("archived = FALSE");
    else if (archive === "archived")
      where.push("archived = TRUE");
    const filter = options.filter?.trim();
    if (filter) {
      params.push(filter);
      const position = params.length;
      where.push(`(strpos(LOWER(id), LOWER($${position})) > 0
          OR strpos(LOWER(title), LOWER($${position})) > 0
          OR strpos(LOWER(content), LOWER($${position})) > 0)`);
    }
    for (const raw of options.tags ?? []) {
      const whole = raw.trim().toLowerCase();
      const parts = raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      const tagPredicates = [];
      if (whole) {
        params.push(whole);
        tagPredicates.push(`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(tags) AS item_tag
          WHERE LOWER(item_tag) = $${params.length}
        )`);
      }
      if (parts.length > 0) {
        const partPredicates = parts.map((part) => {
          params.push(part);
          return `EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(tags) AS item_tag
            WHERE LOWER(item_tag) = $${params.length}
          )`;
        });
        tagPredicates.push(`(${partPredicates.join(" AND ")})`);
      }
      if (tagPredicates.length > 0)
        where.push(`(${tagPredicates.join(" OR ")})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sortColumn = options.sort === "title" ? "title" : "created_at";
    const direction = options.direction === "desc" ? "DESC" : "ASC";
    const orderSql = `ORDER BY ${sortColumn} ${direction}, id ${direction}`;
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, params);
    const rows = await this.client.many(`SELECT * FROM knowledge_items ${whereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map(rowToItem), total: Number(totalRow?.count ?? 0) };
  }
  async search(options, guardedTenantId) {
    const query = options.query.trim();
    if (!query)
      throw new HttpError(400, "q is required");
    const limit = boundedInteger(options.limit, 20, "limit", 1, 200);
    const offset = boundedInteger(options.offset, 0, "offset", 0, 1e4);
    const params = [];
    const where = [];
    if (guardedTenantId) {
      params.push(guardedTenantId);
      where.push(`(authority_classification IS NULL OR tenant_id = $${params.length})`);
    } else {
      where.push("authority_classification IS NULL");
    }
    const archive = options.archive ?? "active";
    if (archive === "active")
      where.push("archived = FALSE");
    else if (archive === "archived")
      where.push("archived = TRUE");
    params.push(query);
    const tsQueryExpr = `websearch_to_tsquery('english', $${params.length})`;
    where.push(`search_vector @@ ${tsQueryExpr}`);
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, params);
    const rows = await this.client.many(`SELECT *, ts_rank_cd(search_vector, ${tsQueryExpr}) AS search_rank
        FROM knowledge_items
        ${whereSql}
        ORDER BY search_rank DESC, created_at DESC, id ASC
        LIMIT ${limit} OFFSET ${offset}`, params);
    return {
      items: rows.map((row) => ({
        item: rowToItem(row),
        rank: Number(row.search_rank ?? 0)
      })),
      total: Number(totalRow?.count ?? 0)
    };
  }
  async get(idOrShort, guardedTenantId) {
    const guardedVisibility = guardedTenantId ? "AND (authority_classification IS NULL OR tenant_id = $2)" : "AND authority_classification IS NULL";
    const row = await this.client.get(`SELECT * FROM knowledge_items
        WHERE (id = $1 OR short_id = $1)
          ${guardedVisibility}
        LIMIT 1`, guardedTenantId ? [idOrShort, guardedTenantId] : [idOrShort]);
    return row ? rowToItem(row) : null;
  }
  async update(idOrShort, patch, options = {}) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return null;
    if (patch.metadata !== undefined) {
      try {
        assertKnowledgeRelationsMetadata(patch.metadata, existing.id);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "invalid relation metadata.");
      }
    }
    const sets = [];
    const params = [];
    const push = (col, val, cast = "") => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.title !== undefined)
      push("title", patch.title);
    if (patch.content !== undefined)
      push("content", patch.content);
    if (patch.url !== undefined)
      push("url", patch.url);
    if (patch.tags !== undefined)
      push("tags", JSON.stringify(patch.tags), "::jsonb");
    if (patch.metadata !== undefined)
      push("metadata", JSON.stringify(patch.metadata), "::jsonb");
    if (patch.archived !== undefined)
      push("archived", patch.archived);
    push("updated_at", new Date().toISOString());
    params.push(existing.id);
    let where = `id = $${params.length}`;
    const { expectedVersion } = options;
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      where += ` AND version = $${params.length}`;
    }
    const row = await this.write(options, (tx) => tx.get(`UPDATE knowledge_items SET ${sets.join(", ")} WHERE ${where} RETURNING *`, params));
    if (row)
      return rowToItem(row);
    if (expectedVersion === undefined)
      return null;
    const current = await this.get(existing.id);
    if (!current)
      return null;
    throw new VersionConflictError(expectedVersion, current.version ?? 1);
  }
  async listVersions(idOrShort, options = {}, guardedTenantId) {
    const existing = await this.get(idOrShort, guardedTenantId);
    if (!existing)
      return null;
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_item_versions WHERE item_id = $1`, [existing.id]);
    const rows = await this.client.many(`SELECT * FROM knowledge_item_versions WHERE item_id = $1
        ORDER BY version DESC LIMIT ${limit} OFFSET ${offset}`, [existing.id]);
    return {
      item_id: existing.id,
      current_version: existing.version ?? 1,
      total: Number(totalRow?.count ?? 0),
      items: rows.map(rowToVersion)
    };
  }
  async getVersion(idOrShort, version, guardedTenantId) {
    const existing = await this.get(idOrShort, guardedTenantId);
    if (!existing)
      return null;
    const row = await this.client.get(`SELECT * FROM knowledge_item_versions WHERE item_id = $1 AND version = $2`, [existing.id, version]);
    return row ? rowToVersion(row) : null;
  }
  async purgeVersions(idOrShort, options, guardedTenantId) {
    const existing = await this.get(idOrShort, guardedTenantId);
    if (!existing)
      return null;
    const currentVersion = existing.version ?? 1;
    if (options?.version !== undefined) {
      const version = options.version;
      if (!Number.isInteger(version) || version < 1) {
        throw new Error(`version must be a positive integer, got ${version}`);
      }
      if (version === currentVersion) {
        throw new CannotPurgeLiveVersionError(version, currentVersion, existing.id);
      }
      const deleted2 = await this.client.query(`DELETE FROM knowledge_item_versions WHERE item_id = $1 AND version = $2 RETURNING version`, [existing.id, version]);
      return { purged: deleted2.rows.length, current_version: currentVersion };
    }
    const deleted = await this.client.query(`DELETE FROM knowledge_item_versions WHERE item_id = $1 RETURNING version`, [existing.id]);
    return { purged: deleted.rows.length, current_version: currentVersion };
  }
  async delete(idOrShort) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return false;
    await this.client.execute(`DELETE FROM knowledge_items WHERE id = $1`, [existing.id]);
    return true;
  }
}

class OperationBindingConflictError extends Error {
  receipt;
  constructor(receipt) {
    super("operation and step are already bound to a different deterministic key");
    this.receipt = receipt;
    this.name = "OperationBindingConflictError";
  }
}

class AdoptionOperationBindingConflictError extends Error {
  receipt;
  constructor(receipt) {
    super("adoption operation and step are already bound to a different deterministic key");
    this.receipt = receipt;
    this.name = "AdoptionOperationBindingConflictError";
  }
}

class ManifestBindingConflictError extends Error {
  manifest;
  constructor(manifest) {
    super("manifest_id is already bound to a different deterministic key");
    this.manifest = manifest;
    this.name = "ManifestBindingConflictError";
  }
}
function rowToAdoptionReceipt(row) {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    receipt_id: String(row.receipt_id),
    deterministic_key: String(row.deterministic_key),
    action: String(row.action),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    target_id: String(row.target_id),
    binding: {
      authority: {
        classification: String(row.authority_classification),
        authority_id: String(row.authority_id)
      },
      tenant_id: String(row.tenant_id),
      scope: String(row.scope),
      parent_id: String(row.parent_id)
    },
    expected_version: Number(row.expected_version),
    expected_content_sha256: String(row.expected_content_sha256),
    adoption_receipt_id: row.adoption_receipt_id == null ? null : String(row.adoption_receipt_id),
    prior_tenant_id: row.prior_tenant_id == null ? null : String(row.prior_tenant_id),
    status: String(row.status),
    code: String(row.code),
    effect_count: Number(row.effect_count),
    result_version: row.result_version == null ? null : Number(row.result_version),
    result_content_sha256: row.result_content_sha256 == null ? null : String(row.result_content_sha256),
    created_at: String(row.created_at)
  };
}
function guardedPreconditionFromRow(row) {
  return row.precondition_kind === "absent" ? { kind: "absent" } : { kind: "version", expected_version: Number(row.expected_version) };
}
function rowToGuardedReceipt(row) {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    receipt_id: String(row.receipt_id),
    deterministic_key: String(row.deterministic_key),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    verb: String(row.verb),
    target_id: String(row.target_id),
    authority: {
      classification: String(row.authority_classification),
      authority_id: String(row.authority_id)
    },
    tenant_id: String(row.tenant_id),
    scope: String(row.scope),
    parent_id: String(row.parent_id),
    payload_digest: String(row.payload_digest),
    precondition: guardedPreconditionFromRow(row),
    manifest: row.manifest_id == null ? null : {
      manifest_id: String(row.manifest_id),
      ordinal: Number(row.manifest_ordinal),
      phase: String(row.manifest_phase),
      compensates_receipt_id: row.compensates_receipt_id == null ? null : String(row.compensates_receipt_id)
    },
    status: String(row.status),
    code: String(row.code),
    effect_count: Number(row.effect_count),
    result_id: row.result_id == null ? null : String(row.result_id),
    result_version: row.result_version == null ? null : Number(row.result_version),
    created_at: String(row.created_at)
  };
}
function rowMatchesGuardedBinding(row, binding) {
  return row.authority_classification === binding.authority.classification && row.authority_id === binding.authority.authority_id && row.tenant_id === binding.tenant_id && row.scope === binding.scope && row.parent_id === binding.parent_id;
}
function guardedRelationTargets(payload) {
  if (!("metadata" in payload) || !payload.metadata)
    return [];
  const relation = payload.metadata[KNOWLEDGE_RELATIONS_METADATA_KEY];
  if (!relation || typeof relation !== "object" || Array.isArray(relation))
    return [];
  const value = relation;
  return [value.supersedes_item_id, value.canonical_item_id].filter((target) => typeof target === "string");
}
function rowToManifestStep(row) {
  return {
    ordinal: Number(row.ordinal),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    deterministic_key: String(row.deterministic_key),
    verb: String(row.verb),
    target_id: String(row.target_id),
    binding: {
      authority: {
        classification: String(row.authority_classification),
        authority_id: String(row.authority_id)
      },
      tenant_id: String(row.tenant_id),
      scope: String(row.scope),
      parent_id: String(row.parent_id)
    },
    semantic_digest: String(row.semantic_digest),
    precondition: guardedPreconditionFromRow(row),
    dependencies: parseJsonColumn(row.dependencies, []),
    limits: parseJsonColumn(row.limits, normalizeKnowledgeGuardedLimits()),
    recovery: {
      strategy: String(row.recovery_strategy),
      operation_id: String(row.recovery_operation_id),
      step_id: String(row.recovery_step_id),
      deterministic_key: String(row.recovery_deterministic_key),
      verb: String(row.recovery_verb),
      target_id: String(row.recovery_target_id),
      semantic_digest: String(row.recovery_semantic_digest),
      precondition: row.recovery_precondition_kind === "absent" ? { kind: "absent" } : { kind: "version", expected_version: Number(row.recovery_expected_version) },
      binding: {
        authority: {
          classification: String(row.recovery_authority_classification),
          authority_id: String(row.recovery_authority_id)
        },
        tenant_id: String(row.recovery_tenant_id),
        scope: String(row.recovery_scope),
        parent_id: String(row.recovery_parent_id)
      },
      limits: parseJsonColumn(row.recovery_limits, normalizeKnowledgeGuardedLimits()),
      receipt_scope: row.recovery_receipt_scope == null ? null : "accepted_step_receipt",
      compensates_receipt_id: row.recovery_compensates_receipt_id == null ? null : String(row.recovery_compensates_receipt_id)
    }
  };
}
function rowsToManifest(row, stepRows) {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    manifest_receipt_id: String(row.manifest_receipt_id),
    manifest_id: String(row.manifest_id),
    operation_id: String(row.operation_id),
    deterministic_key: String(row.deterministic_key),
    manifest_digest: String(row.manifest_digest),
    maintainer: {
      authority: {
        classification: String(row.maintainer_authority_classification),
        authority_id: String(row.maintainer_authority_id)
      },
      tenant_id: String(row.maintainer_tenant_id),
      scope: String(row.maintainer_scope),
      parent_id: String(row.maintainer_parent_id)
    },
    step_count: Number(row.step_count),
    steps: stepRows.map(rowToManifestStep),
    created_at: String(row.created_at)
  };
}

class GuardedWriteRepo {
  client;
  authority;
  constructor(client, authority) {
    this.client = client;
    this.authority = authority;
  }
  binding(envelope) {
    return envelope.descriptor.binding;
  }
  async receiptById(client, receiptId) {
    const row = await client.get(`SELECT * FROM knowledge_guarded_write_receipts WHERE receipt_id = $1`, [receiptId]);
    return row ? rowToGuardedReceipt(row) : null;
  }
  async adoptionReceiptById(client, receiptId) {
    const row = await client.get(`SELECT * FROM knowledge_guarded_adoption_receipts WHERE receipt_id = $1`, [receiptId]);
    return row ? rowToAdoptionReceipt(row) : null;
  }
  async finishAdoption(client, envelope, status, code, result, priorTenantId) {
    const binding = envelope.binding;
    const receiptId = computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key);
    const row = await client.get(`INSERT INTO knowledge_guarded_adoption_receipts (
         receipt_id, deterministic_key, operation_id, step_id, action, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         expected_version, expected_content_sha256, adoption_receipt_id, prior_tenant_id,
         status, code, effect_count, result_version, result_content_sha256
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       )
       RETURNING *`, [
      receiptId,
      envelope.deterministic_key,
      envelope.operation_id,
      envelope.step_id,
      envelope.action,
      envelope.target_id,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      envelope.expected_version,
      envelope.expected_content_sha256,
      envelope.adoption_receipt_id,
      priorTenantId,
      status,
      code,
      status === "accepted" ? 1 : 0,
      result?.version ?? null,
      result?.content_sha256 ?? null
    ]);
    const boundClaim = await client.get(`UPDATE knowledge_guarded_adoption_claims
          SET receipt_id = $1
        WHERE deterministic_key = $2 AND receipt_id IS NULL
        RETURNING deterministic_key`, [receiptId, envelope.deterministic_key]);
    if (!row)
      throw new Error("guarded adoption receipt insertion returned no row.");
    if (boundClaim?.deterministic_key !== envelope.deterministic_key) {
      throw new Error("guarded adoption receipt was not bound to exactly one live claim.");
    }
    return rowToAdoptionReceipt(row);
  }
  async bindingState(fullId, binding, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_items
        WHERE id = $1
          AND (
            (
              authority_classification IS NULL
              AND (tenant_id IS NULL OR tenant_id::text = $2)
            )
            OR tenant_id::text = $2
          )
        LIMIT 1`, [fullId, binding.tenant_id]);
    if (!row)
      return null;
    const legacyForRequestedTenant = row.authority_classification == null && row.authority_id == null && row.scope == null && row.parent_id == null && (row.tenant_id == null || String(row.tenant_id) === binding.tenant_id);
    const requested = rowMatchesGuardedBinding(row, binding);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: 1,
      target_id: fullId,
      state: legacyForRequestedTenant ? "legacy_unbound" : requested ? "bound_to_requested" : "bound_elsewhere",
      item_version: legacyForRequestedTenant || requested ? Number(row.version ?? 1) : null,
      content_sha256: legacyForRequestedTenant || requested ? knowledgeGuardedContentSha256(String(row.content ?? "")) : null,
      limits
    };
  }
  async executeAdoption(envelope, actor) {
    const binding = envelope.binding;
    return this.client.transaction(async (tx) => {
      await tx.execute(`SELECT
           set_config('hasna.actor', $1, true),
           set_config('hasna.reason', $2, true),
           set_config('hasna.knowledge_guarded_adoption_key', $3, true)`, [
        actor,
        `FCAME-1 ${envelope.action} ${envelope.operation_id}/${envelope.step_id}`,
        envelope.deterministic_key
      ]);
      await tx.execute(`INSERT INTO knowledge_guarded_adoption_claims (
           deterministic_key, planned_receipt_id, operation_id, step_id, action, target_id,
           authority_classification, authority_id, tenant_id, scope, parent_id,
           expected_version, expected_content_sha256, adoption_receipt_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING`, [
        envelope.deterministic_key,
        computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key),
        envelope.operation_id,
        envelope.step_id,
        envelope.action,
        envelope.target_id,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        envelope.expected_version,
        envelope.expected_content_sha256,
        envelope.adoption_receipt_id
      ]);
      const claim = await tx.get(`SELECT * FROM knowledge_guarded_adoption_claims
          WHERE authority_classification = $1
            AND authority_id = $2
            AND tenant_id = $3
            AND scope = $4
            AND parent_id = $5
            AND operation_id = $6
            AND step_id = $7
          FOR UPDATE`, [
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        envelope.operation_id,
        envelope.step_id
      ]);
      if (!claim)
        throw new Error("guarded adoption claim was not created.");
      if (claim.deterministic_key !== envelope.deterministic_key) {
        const receipt2 = claim.receipt_id ? await this.adoptionReceiptById(tx, String(claim.receipt_id)) : null;
        throw new AdoptionOperationBindingConflictError(receipt2);
      }
      if (claim.receipt_id) {
        const receipt2 = await this.adoptionReceiptById(tx, String(claim.receipt_id));
        if (!receipt2)
          throw new Error("guarded adoption claim references a missing receipt.");
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: true
        };
      }
      if (envelope.action === "rollback") {
        const source = envelope.adoption_receipt_id ? await this.adoptionReceiptById(tx, envelope.adoption_receipt_id) : null;
        if (!source || source.action !== "adopt" || source.status !== "accepted" || source.effect_count !== 1 || source.target_id !== envelope.target_id || source.result_version !== envelope.expected_version || source.result_content_sha256 !== envelope.expected_content_sha256 || canonicalKnowledgeGuardedJson(source.binding) !== canonicalKnowledgeGuardedJson(binding)) {
          const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "adoption_receipt_mismatch", null, null);
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt: receipt2,
            duplicate: false
          };
        }
      }
      const existing = await tx.get(`SELECT * FROM knowledge_items
          WHERE id = $1
            AND (tenant_id IS NULL OR tenant_id::text = $2)
          FOR UPDATE`, [envelope.target_id, binding.tenant_id]);
      if (!existing) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "not_found", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const legacyForRequestedTenant = existing.authority_classification == null && existing.authority_id == null && existing.scope == null && existing.parent_id == null && (existing.tenant_id == null || String(existing.tenant_id) === binding.tenant_id);
      const requested = rowMatchesGuardedBinding(existing, binding);
      if (envelope.action === "adopt" && !legacyForRequestedTenant || envelope.action === "rollback" && (!requested || existing.guarded_adoption_receipt_id !== envelope.adoption_receipt_id)) {
        const code = envelope.action === "adopt" ? requested ? "already_bound" : "binding_mismatch" : requested ? "adoption_receipt_not_current" : "binding_mismatch";
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", code, null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const currentVersion = Number(existing.version ?? 1);
      if (currentVersion !== envelope.expected_version) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "version_conflict", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const currentContentSha256 = knowledgeGuardedContentSha256(String(existing.content ?? ""));
      if (currentContentSha256 !== envelope.expected_content_sha256) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "content_digest_conflict", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const updated = envelope.action === "adopt" ? await tx.get(`UPDATE knowledge_items SET
             authority_classification = $1,
             authority_id = $2,
             tenant_id = (
               jsonb_populate_record(
                 NULL::knowledge_items,
                 jsonb_build_object('tenant_id', $3::text)
               )
             ).tenant_id,
             scope = $4,
             parent_id = $5,
             guarded_adoption_receipt_id = $6
           WHERE id = $7
             AND version = $8
             AND authority_classification IS NULL
             AND authority_id IS NULL
             AND scope IS NULL
             AND parent_id IS NULL
             AND guarded_adoption_receipt_id IS NULL
             AND (tenant_id IS NULL OR tenant_id::text = $3)
             AND encode(sha256(convert_to(coalesce(content, ''), 'UTF8')), 'hex') = $9
           RETURNING *`, [
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key),
        envelope.target_id,
        envelope.expected_version,
        envelope.expected_content_sha256
      ]) : await tx.get(`UPDATE knowledge_items SET
             authority_classification = NULL,
             authority_id = NULL,
             tenant_id = (
               jsonb_populate_record(
                 NULL::knowledge_items,
                 jsonb_build_object('tenant_id', $1::text)
               )
             ).tenant_id,
             scope = NULL,
             parent_id = NULL,
             guarded_adoption_receipt_id = NULL
           WHERE id = $2
             AND version = $3
             AND authority_classification = $4
             AND authority_id = $5
             AND tenant_id::text = $6
             AND scope = $7
             AND parent_id = $8
             AND guarded_adoption_receipt_id = $9
             AND encode(sha256(convert_to(coalesce(content, ''), 'UTF8')), 'hex') = $10
           RETURNING *`, [
        (await this.adoptionReceiptById(tx, envelope.adoption_receipt_id)).prior_tenant_id,
        envelope.target_id,
        envelope.expected_version,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        envelope.adoption_receipt_id,
        envelope.expected_content_sha256
      ]);
      if (!updated) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "compare_and_swap_conflict", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const result = {
        version: Number(updated.version ?? 1),
        content_sha256: knowledgeGuardedContentSha256(String(updated.content ?? ""))
      };
      const receipt = await this.finishAdoption(tx, envelope, "accepted", envelope.action === "adopt" ? "adopted" : "rolled_back", result, envelope.action === "adopt" ? existing.tenant_id == null ? null : String(existing.tenant_id) : (await this.adoptionReceiptById(tx, envelope.adoption_receipt_id)).prior_tenant_id);
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        receipt,
        duplicate: false
      };
    });
  }
  async reconcileAdoption(deterministicKey, binding, operationId, stepId, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_guarded_adoption_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`, [
      deterministicKey,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      operationId,
      stepId
    ]);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      deterministic_key: deterministicKey,
      operation_id: operationId,
      step_id: stepId,
      exact: true,
      bounded: true,
      receipt_count: row ? 1 : 0,
      terminal_complete: Boolean(row),
      receipt: row ? rowToAdoptionReceipt(row) : null,
      limits
    };
  }
  async manifestById(client, manifestId) {
    const row = await client.get(`SELECT * FROM knowledge_guarded_write_manifests WHERE manifest_id = $1`, [manifestId]);
    if (!row)
      return null;
    const steps = await client.many(`SELECT * FROM knowledge_guarded_write_manifest_steps
        WHERE manifest_id = $1 ORDER BY ordinal ASC`, [manifestId]);
    return rowsToManifest(row, steps);
  }
  async createManifest(envelope) {
    const { manifest, maintainer } = envelope;
    return this.client.transaction(async (tx) => {
      await tx.execute(`INSERT INTO knowledge_guarded_write_manifests (
           manifest_id, manifest_receipt_id, deterministic_key, operation_id,
           manifest_digest,
           maintainer_authority_classification, maintainer_authority_id,
           maintainer_tenant_id, maintainer_scope, maintainer_parent_id,
           step_count
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`, [
        manifest.manifest_id,
        `kmr_${envelope.deterministic_key.replace(/^fcame1_manifest_/, "")}`,
        envelope.deterministic_key,
        manifest.operation_id,
        computeKnowledgeGuardedManifestDigest(maintainer, manifest),
        maintainer.authority.classification,
        maintainer.authority.authority_id,
        maintainer.tenant_id,
        maintainer.scope,
        maintainer.parent_id,
        manifest.steps.length
      ]);
      const row = await tx.get(`SELECT * FROM knowledge_guarded_write_manifests WHERE manifest_id = $1 FOR UPDATE`, [manifest.manifest_id]);
      if (!row)
        throw new Error("guarded manifest was not created.");
      const existingSteps = await tx.many(`SELECT * FROM knowledge_guarded_write_manifest_steps
          WHERE manifest_id = $1 ORDER BY ordinal ASC`, [manifest.manifest_id]);
      if (row.deterministic_key !== envelope.deterministic_key) {
        throw new ManifestBindingConflictError(rowsToManifest(row, existingSteps));
      }
      const duplicate = existingSteps.length > 0;
      if (!duplicate) {
        for (const step of manifest.steps) {
          await tx.execute(`INSERT INTO knowledge_guarded_write_manifest_steps (
               manifest_id, ordinal, operation_id, step_id, deterministic_key,
               verb, target_id, semantic_digest, precondition_kind, expected_version,
               dependencies, limits,
               authority_classification, authority_id, tenant_id, scope, parent_id,
               recovery_strategy, recovery_operation_id, recovery_step_id,
               recovery_deterministic_key, recovery_verb, recovery_target_id,
               recovery_semantic_digest, recovery_precondition_kind, recovery_expected_version,
               recovery_authority_classification, recovery_authority_id,
               recovery_tenant_id, recovery_scope, recovery_parent_id,
               recovery_limits, recovery_receipt_scope, recovery_compensates_receipt_id
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
             )`, [
            manifest.manifest_id,
            step.ordinal,
            step.operation_id,
            step.step_id,
            step.deterministic_key,
            step.verb,
            step.target_id,
            step.semantic_digest,
            step.precondition.kind,
            step.precondition.kind === "version" ? step.precondition.expected_version : null,
            JSON.stringify(step.dependencies),
            JSON.stringify(step.limits),
            step.binding.authority.classification,
            step.binding.authority.authority_id,
            step.binding.tenant_id,
            step.binding.scope,
            step.binding.parent_id,
            step.recovery.strategy,
            step.recovery.operation_id,
            step.recovery.step_id,
            step.recovery.deterministic_key,
            step.recovery.verb,
            step.recovery.target_id,
            step.recovery.semantic_digest,
            step.recovery.precondition.kind,
            step.recovery.precondition.kind === "version" ? step.recovery.precondition.expected_version : null,
            step.recovery.binding.authority.classification,
            step.recovery.binding.authority.authority_id,
            step.recovery.binding.tenant_id,
            step.recovery.binding.scope,
            step.recovery.binding.parent_id,
            JSON.stringify(step.recovery.limits),
            step.recovery.receipt_scope,
            step.recovery.compensates_receipt_id
          ]);
        }
      }
      const stored = await this.manifestById(tx, manifest.manifest_id);
      if (!stored || stored.steps.length !== manifest.steps.length) {
        throw new Error("guarded manifest exact readback failed in its creation transaction.");
      }
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        manifest: stored,
        duplicate
      };
    });
  }
  async assertManifestStep(client, envelope) {
    const manifestBinding = envelope.descriptor.manifest;
    if (!manifestBinding)
      return;
    const lockedManifest = await client.get(`SELECT manifest_id FROM knowledge_guarded_write_manifests
        WHERE manifest_id = $1
        FOR UPDATE`, [manifestBinding.manifest_id]);
    if (!lockedManifest)
      throw new HttpError(409, "guarded manifest does not exist.");
    const manifest = await this.manifestById(client, manifestBinding.manifest_id);
    if (!manifest)
      throw new Error("locked guarded manifest disappeared inside its transaction.");
    const step = manifest.steps[manifestBinding.ordinal];
    if (!step || step.ordinal !== manifestBinding.ordinal) {
      throw new HttpError(409, "guarded manifest step does not exist.");
    }
    const descriptor = envelope.descriptor;
    const action = manifestBinding.phase === "primary" ? step : step.recovery;
    if (action.deterministic_key !== envelope.deterministic_key || action.operation_id !== descriptor.operation_id || action.step_id !== descriptor.step_id || action.verb !== descriptor.verb || action.target_id !== descriptor.target_id || action.semantic_digest !== descriptor.payload_digest || canonicalKnowledgeGuardedJson(action.precondition) !== canonicalKnowledgeGuardedJson(descriptor.precondition) || canonicalKnowledgeGuardedJson(action.binding) !== canonicalKnowledgeGuardedJson(descriptor.binding) || canonicalKnowledgeGuardedJson(action.limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new HttpError(409, "guarded write does not match its immutable manifest step.");
    }
    if (manifestBinding.phase === "recovery" && (manifestBinding.compensates_receipt_id !== step.recovery.compensates_receipt_id || step.recovery.strategy === "receipt_scoped_compensation" && manifestBinding.compensates_receipt_id === null)) {
      throw new HttpError(409, "guarded recovery does not match its receipt-scoped manifest action.");
    }
    const existingExactReceipt = await client.get(`SELECT receipt_id FROM knowledge_guarded_write_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`, [
      envelope.deterministic_key,
      descriptor.binding.authority.classification,
      descriptor.binding.authority.authority_id,
      descriptor.binding.tenant_id,
      descriptor.binding.scope,
      descriptor.binding.parent_id,
      descriptor.operation_id,
      descriptor.step_id
    ]);
    if (existingExactReceipt)
      return;
    const prerequisites = manifestBinding.phase === "primary" ? step.dependencies.map((ordinal) => manifest.steps[ordinal]) : manifest.steps.slice(0, step.ordinal + 1);
    let prefixReceipt = null;
    for (const prior of prerequisites) {
      if (prior.binding.authority.classification !== this.authority.classification || prior.binding.authority.authority_id !== this.authority.authority_id) {
        throw new HttpError(409, "manifest_prior_external_authority_receipt_unverified: this authority cannot certify the prior step.");
      }
      const receipt = await client.get(`SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
          LIMIT 1`, [
        prior.deterministic_key,
        prior.binding.authority.classification,
        prior.binding.authority.authority_id,
        prior.binding.tenant_id,
        prior.binding.scope,
        prior.binding.parent_id
      ]);
      if (!receipt || receipt.status !== "accepted") {
        throw new HttpError(409, "manifest_prior_step_not_accepted.");
      }
      if (prior.ordinal === step.ordinal)
        prefixReceipt = rowToGuardedReceipt(receipt);
    }
    if (manifestBinding.phase === "primary") {
      for (const prior of prerequisites) {
        if (prior.recovery.binding.authority.classification !== this.authority.classification || prior.recovery.binding.authority.authority_id !== this.authority.authority_id || prior.recovery.binding.tenant_id !== descriptor.binding.tenant_id) {
          throw new HttpError(409, "external_authority_receipt_verifier_required: " + "this authority cannot prove that a prior recovery action is absent.");
        }
        const recoveryReceipt = await client.get(`SELECT status FROM knowledge_guarded_write_receipts
            WHERE deterministic_key = $1
              AND authority_classification = $2
              AND authority_id = $3
              AND tenant_id = $4
              AND scope = $5
              AND parent_id = $6
              AND operation_id = $7
              AND step_id = $8
            LIMIT 1`, [
          prior.recovery.deterministic_key,
          prior.recovery.binding.authority.classification,
          prior.recovery.binding.authority.authority_id,
          prior.recovery.binding.tenant_id,
          prior.recovery.binding.scope,
          prior.recovery.binding.parent_id,
          prior.recovery.operation_id,
          prior.recovery.step_id
        ]);
        if (recoveryReceipt) {
          throw new HttpError(409, "manifest_prior_recovery_terminal: the workflow cannot resume its primary path " + "after a declared recovery action reached a terminal receipt.");
        }
      }
    }
    if (manifestBinding.phase === "recovery" && step.recovery.strategy === "receipt_scoped_compensation" && prefixReceipt?.receipt_id !== step.recovery.compensates_receipt_id) {
      throw new HttpError(409, "manifest compensation is not scoped to the accepted prefix receipt.");
    }
    if (manifestBinding.phase === "recovery") {
      const next = manifest.steps[step.ordinal + 1];
      if (!next) {
        throw new HttpError(409, "manifest has no partial suffix after this prefix; recovery is not runnable.");
      }
      if (next.binding.authority.classification !== this.authority.classification || next.binding.authority.authority_id !== this.authority.authority_id || next.binding.tenant_id !== descriptor.binding.tenant_id) {
        throw new HttpError(409, "external_authority_receipt_verifier_required: recovery cannot infer the next authority state.");
      }
      const nextReceipt = await client.get(`SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
          LIMIT 1`, [
        next.deterministic_key,
        next.binding.authority.classification,
        next.binding.authority.authority_id,
        next.binding.tenant_id,
        next.binding.scope,
        next.binding.parent_id
      ]);
      if (nextReceipt?.status === "accepted") {
        throw new HttpError(409, "manifest prefix has already advanced; this recovery action is no longer runnable.");
      }
    }
  }
  async finish(client, envelope, status, code, result) {
    const descriptor = envelope.descriptor;
    const binding = descriptor.binding;
    const receiptId = computeKnowledgeGuardedReceiptId(envelope.deterministic_key);
    const row = await client.get(`INSERT INTO knowledge_guarded_write_receipts (
         receipt_id, deterministic_key, operation_id, step_id, verb, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         payload_digest, precondition_kind, expected_version,
         manifest_id, manifest_ordinal, manifest_phase, compensates_receipt_id,
         status, code, effect_count, result_id, result_version
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
       )
       RETURNING *`, [
      receiptId,
      envelope.deterministic_key,
      descriptor.operation_id,
      descriptor.step_id,
      descriptor.verb,
      descriptor.target_id,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      descriptor.payload_digest,
      descriptor.precondition.kind,
      descriptor.precondition.kind === "version" ? descriptor.precondition.expected_version : null,
      descriptor.manifest?.manifest_id ?? null,
      descriptor.manifest?.ordinal ?? null,
      descriptor.manifest?.phase ?? null,
      descriptor.manifest?.compensates_receipt_id ?? null,
      status,
      code,
      status === "accepted" ? 1 : 0,
      result?.id ?? null,
      result?.version ?? null
    ]);
    const boundClaim = await client.get(`UPDATE knowledge_guarded_write_claims
          SET receipt_id = $1
        WHERE deterministic_key = $2 AND receipt_id IS NULL
        RETURNING deterministic_key`, [receiptId, envelope.deterministic_key]);
    if (!row)
      throw new Error("guarded receipt insertion returned no row.");
    if (boundClaim?.deterministic_key !== envelope.deterministic_key) {
      throw new Error("guarded receipt was not bound to exactly one live operation claim.");
    }
    return rowToGuardedReceipt(row);
  }
  async execute(envelope, actor) {
    const descriptor = envelope.descriptor;
    const binding = this.binding(envelope);
    return this.client.transaction(async (tx) => {
      await tx.execute(`SELECT
           set_config('hasna.actor', $1, true),
           set_config('hasna.reason', $2, true),
           set_config('hasna.knowledge_guarded_deterministic_key', $3, true)`, [
        actor,
        `FCAME-1 ${descriptor.operation_id}/${descriptor.step_id}`,
        envelope.deterministic_key
      ]);
      await this.assertManifestStep(tx, envelope);
      await tx.execute(`INSERT INTO knowledge_guarded_write_claims (
           deterministic_key, operation_id, step_id,
           authority_classification, authority_id, tenant_id, scope, parent_id,
           verb, target_id, payload_digest, precondition_kind, expected_version,
           manifest_id, manifest_ordinal, manifest_phase, compensates_receipt_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT DO NOTHING`, [
        envelope.deterministic_key,
        descriptor.operation_id,
        descriptor.step_id,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        descriptor.verb,
        descriptor.target_id,
        descriptor.payload_digest,
        descriptor.precondition.kind,
        descriptor.precondition.kind === "version" ? descriptor.precondition.expected_version : null,
        descriptor.manifest?.manifest_id ?? null,
        descriptor.manifest?.ordinal ?? null,
        descriptor.manifest?.phase ?? null,
        descriptor.manifest?.compensates_receipt_id ?? null
      ]);
      const claim = await tx.get(`SELECT * FROM knowledge_guarded_write_claims
          WHERE authority_classification = $1
            AND authority_id = $2
            AND tenant_id = $3
            AND scope = $4
            AND parent_id = $5
            AND operation_id = $6
            AND step_id = $7
          FOR UPDATE`, [
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        descriptor.operation_id,
        descriptor.step_id
      ]);
      if (!claim)
        throw new Error("guarded operation claim was not created.");
      if (claim.deterministic_key !== envelope.deterministic_key) {
        const receipt2 = claim.receipt_id ? await this.receiptById(tx, String(claim.receipt_id)) : null;
        throw new OperationBindingConflictError(receipt2);
      }
      if (claim.receipt_id) {
        const receipt2 = await this.receiptById(tx, String(claim.receipt_id));
        if (!receipt2)
          throw new Error("guarded claim references a missing receipt.");
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: true
        };
      }
      for (const targetId of guardedRelationTargets(envelope.payload)) {
        const target = await tx.get(`SELECT id FROM knowledge_items
            WHERE id = $1
              AND authority_classification = $2
              AND authority_id = $3
              AND tenant_id = $4
              AND scope = $5
              AND parent_id = $6
            LIMIT 1`, [
          targetId,
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id
        ]);
        if (!target) {
          const receipt2 = await this.finish(tx, envelope, "rejected", "relation_binding_mismatch", null);
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt: receipt2,
            duplicate: false
          };
        }
      }
      if (descriptor.verb === "create") {
        const payload = envelope.payload;
        const now = new Date().toISOString();
        const inserted = await tx.get(`INSERT INTO knowledge_items (
             id, short_id, title, content, url, tags, metadata, archived,
             created_at, updated_at,
             authority_classification, authority_id, tenant_id, scope, parent_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$8,$9,$10,$11,$12,$13
           )
           ON CONFLICT (id) DO NOTHING
           RETURNING *`, [
          descriptor.target_id,
          makeShortId(descriptor.target_id),
          payload.title,
          payload.content ?? "",
          payload.url ?? null,
          JSON.stringify(payload.tags ?? []),
          JSON.stringify(payload.metadata ?? {}),
          now,
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id
        ]);
        if (!inserted) {
          const existing2 = await tx.get(`SELECT * FROM knowledge_items WHERE id = $1 FOR UPDATE`, [descriptor.target_id]);
          const code = existing2 && rowMatchesGuardedBinding(existing2, binding) ? "target_exists" : "binding_mismatch";
          const receipt3 = await this.finish(tx, envelope, "rejected", code, null);
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt: receipt3,
            duplicate: false
          };
        }
        const item2 = rowToItem(inserted);
        const receipt2 = await this.finish(tx, envelope, "accepted", "created", item2);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const existing = await tx.get(`SELECT * FROM knowledge_items WHERE id = $1 FOR UPDATE`, [descriptor.target_id]);
      if (!existing) {
        const receipt2 = await this.finish(tx, envelope, "rejected", "not_found", null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      if (!rowMatchesGuardedBinding(existing, binding)) {
        const receipt2 = await this.finish(tx, envelope, "rejected", "binding_mismatch", null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const expectedVersion = descriptor.precondition.kind === "version" ? descriptor.precondition.expected_version : 0;
      const currentVersion = Number(existing.version ?? 1);
      if (currentVersion !== expectedVersion) {
        const receipt2 = await this.finish(tx, envelope, "rejected", "version_conflict", null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const patch = envelope.payload;
      const sets = [];
      const params = [];
      const push = (column, value, cast = "") => {
        params.push(value);
        sets.push(`${column} = $${params.length}${cast}`);
      };
      if (patch.title !== undefined)
        push("title", patch.title);
      if (patch.content !== undefined)
        push("content", patch.content);
      if (patch.url !== undefined)
        push("url", patch.url);
      if (patch.tags !== undefined)
        push("tags", JSON.stringify(patch.tags), "::jsonb");
      if (patch.metadata !== undefined)
        push("metadata", JSON.stringify(patch.metadata), "::jsonb");
      if (patch.archived !== undefined)
        push("archived", patch.archived);
      push("updated_at", new Date().toISOString());
      params.push(descriptor.target_id);
      const idPosition = params.length;
      params.push(expectedVersion);
      const versionPosition = params.length;
      const updated = await tx.get(`UPDATE knowledge_items
            SET ${sets.join(", ")}
          WHERE id = $${idPosition} AND version = $${versionPosition}
          RETURNING *`, params);
      if (!updated)
        throw new Error("guarded compare-and-swap lost its locked target.");
      const item = rowToItem(updated);
      const receipt = await this.finish(tx, envelope, "accepted", "updated", item);
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        receipt,
        duplicate: false
      };
    });
  }
  async reconcileManifest(manifestId, maintainer, limits) {
    const manifest = await this.manifestById(this.client, manifestId);
    if (!manifest || canonicalKnowledgeGuardedJson(manifest.maintainer) !== canonicalKnowledgeGuardedJson(maintainer)) {
      return null;
    }
    const steps = [];
    const externalAuthorities = new Set;
    const reconcileAction = async (action) => {
      const locallyVerifiable = action.binding.authority.classification === this.authority.classification && action.binding.authority.authority_id === this.authority.authority_id && action.binding.tenant_id === maintainer.tenant_id;
      if (!locallyVerifiable) {
        const authorityKey = `${action.binding.authority.classification}:${action.binding.authority.authority_id}`;
        externalAuthorities.add(authorityKey);
        return { state: "unverified_external_authority", receipt: null };
      }
      const row = await this.client.get(`SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
            AND operation_id = $7
            AND step_id = $8
          LIMIT 1`, [
        action.deterministic_key,
        action.binding.authority.classification,
        action.binding.authority.authority_id,
        action.binding.tenant_id,
        action.binding.scope,
        action.binding.parent_id,
        action.operation_id,
        action.step_id
      ]);
      const receipt = row ? rowToGuardedReceipt(row) : null;
      return { state: receipt?.status ?? "missing", receipt };
    };
    for (const step of manifest.steps) {
      const primary = await reconcileAction(step);
      const recovery = await reconcileAction(step.recovery);
      steps.push({
        ordinal: step.ordinal,
        deterministic_key: step.deterministic_key,
        authority: step.binding.authority,
        state: primary.state,
        receipt: primary.receipt,
        recovery_deterministic_key: step.recovery.deterministic_key,
        recovery_state: recovery.state,
        recovery_receipt: recovery.receipt
      });
    }
    const completion = evaluateKnowledgeGuardedManifestCompletion(steps);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      manifest,
      exact: true,
      bounded: true,
      terminal_complete: completion.terminal_complete,
      accepted_complete: completion.accepted_complete,
      unsupported_gap: externalAuthorities.size > 0 ? `external_authority_receipt_verifier_required:${[...externalAuthorities].sort().join(",")}` : null,
      steps,
      limits
    };
  }
  async reconcile(deterministicKey, binding, operationId, stepId, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_guarded_write_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`, [
      deterministicKey,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      operationId,
      stepId
    ]);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      deterministic_key: deterministicKey,
      operation_id: operationId,
      step_id: stepId,
      exact: true,
      bounded: true,
      receipt_count: row ? 1 : 0,
      terminal_complete: Boolean(row),
      receipt: row ? rowToGuardedReceipt(row) : null,
      limits
    };
  }
  async lookupTitle(title, binding, limits) {
    const rows = await this.client.many(`SELECT * FROM knowledge_items
        WHERE title = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
        ORDER BY id
        LIMIT 2`, [
      title,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id
    ]);
    if (rows.length > 1)
      throw new PrivateTitleLookupAmbiguousError;
    const items = rows.map((row) => knowledgePrivateItemProof(rowToItem(row)));
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: items.length,
      binding,
      title_digest: knowledgeGuardedContentSha256(title),
      items,
      limits
    };
  }
  async query(selector, selectorDigest, archive, page, binding, limits) {
    if (selector.kind === "semantic_overlap") {
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        exact: true,
        bounded: true,
        private: true,
        query_kind: selector.kind,
        status: "unavailable",
        code: "semantic_query_unavailable",
        binding,
        selector_digest: selectorDigest,
        total: 0,
        item_count: 0,
        page: {
          limit: page.limit,
          offset: page.offset,
          returned: 0,
          has_more: false
        },
        items: [],
        limits
      };
    }
    const bindingParams = [
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id
    ];
    const currentWhere = [
      "authority_classification = $1",
      "authority_id = $2",
      "tenant_id = $3",
      "scope = $4",
      "parent_id = $5"
    ];
    if (archive === "active")
      currentWhere.push("archived = FALSE");
    else if (archive === "archived")
      currentWhere.push("archived = TRUE");
    let currentOrder = "ORDER BY id ASC";
    let matchedValue;
    if (selector.kind === "historical_version") {
      const params = [...bindingParams, selector.item_id, selector.version];
      const historyWhere = [
        "i.authority_classification = $1",
        "i.authority_id = $2",
        "i.tenant_id = $3",
        "i.scope = $4",
        "i.parent_id = $5",
        "v.item_id = $6",
        "v.version = $7"
      ];
      if (archive === "active")
        historyWhere.push("v.archived = FALSE");
      else if (archive === "archived")
        historyWhere.push("v.archived = TRUE");
      const whereSql2 = `WHERE ${historyWhere.join(" AND ")}`;
      const totalRow2 = await this.client.get(`SELECT count(*)::text AS count
          FROM knowledge_item_versions v
          JOIN knowledge_items i ON i.id = v.item_id
          ${whereSql2}`, params);
      const rows2 = await this.client.many(`SELECT v.*
          FROM knowledge_item_versions v
          JOIN knowledge_items i ON i.id = v.item_id
          ${whereSql2}
          ORDER BY v.version ASC
          LIMIT ${page.limit} OFFSET ${page.offset}`, params);
      const total2 = Number(totalRow2?.count ?? 0);
      const items2 = rows2.map((row) => knowledgePrivateHistoricalQueryItemProof(rowToVersion(row), selector.item_id));
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        exact: true,
        bounded: true,
        private: true,
        query_kind: selector.kind,
        status: "available",
        code: null,
        binding,
        selector_digest: selectorDigest,
        total: total2,
        item_count: items2.length,
        page: {
          limit: page.limit,
          offset: page.offset,
          returned: items2.length,
          has_more: page.offset + items2.length < total2
        },
        items: items2,
        limits
      };
    }
    switch (selector.kind) {
      case "exact_title":
        bindingParams.push(selector.title);
        currentWhere.push(`title = $${bindingParams.length}`);
        matchedValue = selector.title;
        break;
      case "lexical_overlap": {
        bindingParams.push(selector.query);
        const tsQuery = `websearch_to_tsquery('english', $${bindingParams.length})`;
        currentWhere.push(`search_vector @@ ${tsQuery}`);
        currentOrder = `ORDER BY ts_rank_cd(search_vector, ${tsQuery}) DESC, id ASC`;
        matchedValue = selector.query;
        break;
      }
      case "supersession":
        bindingParams.push(KNOWLEDGE_RELATIONS_SCHEMA, selector.supersedes_item_id);
        currentWhere.push(`metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},schema}' = $${bindingParams.length - 1}`, `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},supersedes_item_id}' = $${bindingParams.length}`);
        matchedValue = selector.supersedes_item_id;
        break;
      case "current_version":
        bindingParams.push(selector.item_id);
        currentWhere.push(`id = $${bindingParams.length}`);
        matchedValue = selector.item_id;
        break;
      case "canonical_pointer":
        bindingParams.push(KNOWLEDGE_RELATIONS_SCHEMA, selector.canonical_item_id);
        currentWhere.push(`metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},schema}' = $${bindingParams.length - 1}`, `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},canonical_item_id}' = $${bindingParams.length}`);
        matchedValue = selector.canonical_item_id;
        break;
      default:
        throw new HttpError(400, "private query selector kind is unsupported.");
    }
    const whereSql = `WHERE ${currentWhere.join(" AND ")}`;
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, bindingParams);
    const rows = await this.client.many(`SELECT * FROM knowledge_items
        ${whereSql}
        ${currentOrder}
        LIMIT ${page.limit} OFFSET ${page.offset}`, bindingParams);
    const total = Number(totalRow?.count ?? 0);
    const items = rows.map((row) => knowledgePrivateQueryItemProof(rowToItem(row), matchedValue));
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      private: true,
      query_kind: selector.kind,
      status: "available",
      code: null,
      binding,
      selector_digest: selectorDigest,
      total,
      item_count: items.length,
      page: {
        limit: page.limit,
        offset: page.offset,
        returned: items.length,
        has_more: page.offset + items.length < total
      },
      items,
      limits
    };
  }
  async readback(fullId, binding, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_items
        WHERE id = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
        LIMIT 1`, [
      fullId,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id
    ]);
    if (!row)
      return null;
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: 1,
      binding,
      item: rowToItem(row),
      limits
    };
  }
}

class PrivateTitleLookupAmbiguousError extends Error {
  constructor() {
    super("more than one exact title exists in the frozen binding.");
    this.name = "PrivateTitleLookupAmbiguousError";
  }
}
function knowledgeOpenApi(version) {
  const noteSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      short_id: { type: "string", nullable: true },
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" },
      created_at: { type: "string" },
      updated_at: { type: "string" },
      version: { type: "integer", description: "Current entry version; send it back as If-Match to write safely." }
    },
    required: ["id", "title", "content", "tags", "archived", "created_at", "updated_at", "version"]
  };
  const noteVersionSchema = {
    type: "object",
    description: "An immutable snapshot of the entry as it stood BEFORE the edit that produced the next version.",
    properties: {
      id: { type: "string" },
      item_id: { type: "string" },
      tenant_id: { type: "string", nullable: true },
      version: { type: "integer" },
      title: { type: "string" },
      content: { type: "string", nullable: true },
      body_uri: { type: "string", nullable: true },
      content_hash: { type: "string" },
      content_bytes: { type: "integer" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" },
      actor: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      valid_from: { type: "string", nullable: true },
      valid_to: { type: "string" }
    },
    required: ["id", "item_id", "version", "title", "content_hash", "content_bytes", "tags", "archived", "valid_to"]
  };
  const noteInput = {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true }
    },
    required: ["title"]
  };
  const notePatch = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" },
      expected_version: {
        type: "integer",
        description: "Optimistic concurrency guard, equivalent to the If-Match header, for clients that cannot set headers. " + "The write applies only if the stored entry is still at this version; otherwise 409 version_conflict."
      }
    }
  };
  const versionConflict = {
    type: "object",
    properties: {
      error: { type: "string", enum: ["version_conflict"] },
      expected: { type: "integer" },
      current: { type: "integer" }
    },
    required: ["error", "expected", "current"]
  };
  const guardedReceipt = {
    type: "object",
    description: "Immutable FCAME-1 terminal receipt. Private payload bytes are never stored here.",
    properties: {
      contract: { type: "string", enum: [KNOWLEDGE_GUARDED_WRITE_CONTRACT] },
      receipt_id: { type: "string" },
      deterministic_key: { type: "string" },
      operation_id: { type: "string" },
      step_id: { type: "string" },
      status: { type: "string", enum: ["accepted", "rejected"] },
      code: { type: "string" },
      effect_count: { type: "integer", enum: [0, 1] },
      result_id: { type: "string", nullable: true },
      result_version: { type: "integer", nullable: true },
      created_at: { type: "string" }
    },
    required: [
      "contract",
      "receipt_id",
      "deterministic_key",
      "operation_id",
      "step_id",
      "status",
      "code",
      "effect_count",
      "created_at"
    ]
  };
  const guardedAdoptionReceipt = {
    type: "object",
    description: "Immutable FCAME-1 receipt for an exact legacy binding adoption or its receipt-scoped rollback.",
    properties: {
      contract: { type: "string", enum: [KNOWLEDGE_GUARDED_WRITE_CONTRACT] },
      receipt_id: { type: "string" },
      deterministic_key: { type: "string" },
      action: { type: "string", enum: ["adopt", "rollback"] },
      operation_id: { type: "string" },
      step_id: { type: "string" },
      target_id: { type: "string" },
      expected_version: { type: "integer" },
      expected_content_sha256: { type: "string" },
      adoption_receipt_id: { type: "string", nullable: true },
      prior_tenant_id: { type: "string", nullable: true },
      status: { type: "string", enum: ["accepted", "rejected"] },
      code: { type: "string" },
      effect_count: { type: "integer", enum: [0, 1] },
      result_version: { type: "integer", nullable: true },
      result_content_sha256: { type: "string", nullable: true },
      created_at: { type: "string" }
    },
    required: [
      "contract",
      "receipt_id",
      "deterministic_key",
      "action",
      "operation_id",
      "step_id",
      "target_id",
      "expected_version",
      "expected_content_sha256",
      "status",
      "code",
      "effect_count",
      "created_at"
    ]
  };
  const guardedLimitParameters = [
    "max_calls",
    "max_items",
    "max_bytes",
    "wall_time_ms"
  ].map((name) => ({
    name,
    in: "query",
    required: true,
    schema: { type: "integer", minimum: 1 }
  }));
  const guardedBindingParameters = [
    "authority_classification",
    "authority_id",
    "tenant_id",
    "scope",
    "parent_id"
  ].map((name) => ({
    name,
    in: "query",
    required: true,
    schema: { type: "string" }
  }));
  return {
    openapi: "3.0.3",
    info: { title: "Knowledge", version, description: "@hasna/knowledge self-hosted HTTP API" },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Note: noteSchema,
        NoteInput: noteInput,
        NotePatch: notePatch,
        NoteVersion: noteVersionSchema,
        VersionConflict: versionConflict,
        GuardedReceipt: guardedReceipt,
        GuardedAdoptionReceipt: guardedAdoptionReceipt,
        GuardedAdoptionEnvelope: {
          type: "object",
          description: "Exact full-ID, version, and raw UTF-8 content-sha256 compare-and-swap for legacy binding adoption " + "or immutable-receipt-scoped rollback.",
          required: [
            "contract",
            "action",
            "deterministic_key",
            "operation_id",
            "step_id",
            "target_id",
            "binding",
            "expected_version",
            "expected_content_sha256",
            "adoption_receipt_id",
            "limits"
          ],
          additionalProperties: false
        },
        GuardedWriteEnvelope: {
          type: "object",
          description: "FCAME-1 frozen descriptor metadata, deterministic key, explicit finite limits, and private payload. " + "The payload is accepted only in this authenticated request body.",
          required: ["contract", "descriptor", "deterministic_key", "limits", "payload"],
          additionalProperties: true
        },
        GuardedManifest: {
          type: "object",
          description: "Immutable ordered workflow manifest. Every step declares deterministic forward repair or " + "accepted-receipt-scoped compensation.",
          required: [
            "manifest_receipt_id",
            "manifest_id",
            "operation_id",
            "deterministic_key",
            "manifest_digest",
            "maintainer",
            "step_count",
            "steps",
            "created_at"
          ],
          additionalProperties: true
        },
        ProjectRegistrationCapability: {
          type: "object",
          required: [
            "authority",
            "route",
            "resource_route",
            "package_version",
            "authority_id",
            "tenant_id",
            "corpus_id",
            "supported_resources",
            "membership_rule"
          ],
          additionalProperties: true
        },
        ProjectRegistrationReceipt: {
          type: "object",
          required: [
            "receipt_id",
            "authority",
            "route",
            "package_version",
            "authority_id",
            "tenant_id",
            "corpus_id",
            "operation_id",
            "step_id",
            "action",
            "resource_kind",
            "direction",
            "idempotency_key",
            "request_digest",
            "precondition_digest",
            "outcome",
            "created_by_operation",
            "created_at"
          ],
          additionalProperties: true
        },
        ProjectCollectionRecord: {
          type: "object",
          required: [
            "source_project_id",
            "project_id",
            "project_slug",
            "project_name",
            "collection_id",
            "collection_slug",
            "collection_name",
            "membership_rule",
            "revision",
            "digest",
            "created_at",
            "updated_at"
          ],
          properties: {
            source_project_id: { type: "string" },
            project_id: { type: "string" },
            project_slug: { type: "string" },
            project_name: { type: "string" },
            collection_id: { type: "string" },
            collection_slug: { type: "string" },
            collection_name: { type: "string" },
            membership_rule: {
              type: "string",
              enum: ["explicit_collection_binding"]
            },
            revision: { type: "string" },
            digest: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" }
          },
          additionalProperties: false
        },
        ProjectResource: {
          type: "object",
          required: [
            "key",
            "kind",
            "id",
            "project_id",
            "source_project_id",
            "collection_id",
            "revision",
            "digest",
            "title",
            "locator",
            "metadata"
          ],
          properties: {
            key: { type: "string" },
            kind: {
              type: "string",
              enum: ["project", "collection", "item", "taxonomy"]
            },
            id: { type: "string" },
            project_id: { type: "string" },
            source_project_id: { type: "string" },
            collection_id: { type: "string" },
            revision: { type: "string" },
            digest: { type: "string" },
            title: { type: "string" },
            locator: {
              type: "object",
              required: ["kind", "value"],
              properties: {
                kind: {
                  type: "string",
                  enum: ["external_uuid", "canonical_uri"]
                },
                value: { type: "string" }
              },
              additionalProperties: false
            },
            metadata: {
              type: "object",
              additionalProperties: true
            }
          },
          additionalProperties: false
        },
        ProjectResourcePage: {
          type: "object",
          required: [
            "schema",
            "authority",
            "route",
            "authority_id",
            "tenant_id",
            "corpus_id",
            "project_id",
            "source_project_id",
            "collection_id",
            "collection_revision",
            "population_digest",
            "resource_kinds",
            "resources",
            "count",
            "total",
            "limit",
            "cursor",
            "next_cursor",
            "has_more",
            "complete",
            "truncated"
          ],
          properties: {
            collection_revision: { type: "string" },
            population_digest: { type: "string" },
            resources: {
              type: "array",
              items: { $ref: "#/components/schemas/ProjectResource" }
            },
            count: { type: "integer" },
            total: { type: "integer" },
            limit: { type: "integer", minimum: 1, maximum: 200 },
            has_more: { type: "boolean" },
            complete: { type: "boolean" },
            truncated: { type: "boolean", enum: [false] }
          },
          additionalProperties: true
        },
        NoteList: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/Note" } },
            total: { type: "integer" },
            query_capability: {
              type: "string",
              enum: [KNOWLEDGE_BOUNDED_QUERY_CAPABILITY]
            }
          },
          required: ["items", "total", "query_capability"]
        },
        NoteSearchList: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item: { $ref: "#/components/schemas/Note" },
                  rank: { type: "number" }
                },
                required: ["item", "rank"]
              }
            },
            total: { type: "integer" },
            query_capability: {
              type: "string",
              enum: [KNOWLEDGE_BOUNDED_QUERY_CAPABILITY]
            }
          },
          required: ["items", "total", "query_capability"]
        },
        NoteVersionList: {
          type: "object",
          properties: {
            item_id: { type: "string" },
            current_version: { type: "integer" },
            total: { type: "integer" },
            items: { type: "array", items: { $ref: "#/components/schemas/NoteVersion" } }
          },
          required: ["item_id", "current_version", "total", "items"]
        },
        NotePurgeReceipt: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            id: { type: "string" },
            purged: { type: "integer" },
            current_version: { type: "integer" },
            message: { type: "string" }
          },
          required: ["ok", "id", "purged", "current_version"]
        }
      }
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/project-registration/capability": {
        get: {
          operationId: "getKnowledgeProjectRegistrationCapability",
          summary: "Read the exact Knowledge project-registration capability identity",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      capability: { $ref: "#/components/schemas/ProjectRegistrationCapability" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/v1/project-registration/create": {
        post: {
          operationId: "registerKnowledgeProjectCollection",
          summary: "Create or exactly adopt one project-owned Knowledge collection",
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      receipt: { $ref: "#/components/schemas/ProjectRegistrationReceipt" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/v1/project-registration/read-exact": {
        post: {
          operationId: "readKnowledgeProjectCollection",
          summary: "Read one project collection by exact stable collection id",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      record: { $ref: "#/components/schemas/ProjectCollectionRecord" }
                    }
                  }
                }
              }
            },
            "404": { description: "No exact collection id." }
          }
        }
      },
      "/v1/project-registration/receipts/lookup": {
        post: {
          operationId: "lookupKnowledgeProjectRegistrationReceipt",
          summary: "Look up exactly one immutable registration or membership receipt",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      receipt: { $ref: "#/components/schemas/ProjectRegistrationReceipt" }
                    }
                  }
                }
              }
            },
            "404": { description: "No exact terminal receipt." }
          }
        }
      },
      "/v1/project-registration/compensate": {
        post: {
          operationId: "compensateKnowledgeProjectCollection",
          summary: "Conditionally remove an operation-created empty collection aggregate",
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      receipt: { $ref: "#/components/schemas/ProjectRegistrationReceipt" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/v1/project-registration/verify-inverse": {
        post: {
          operationId: "verifyKnowledgeProjectCollectionInverse",
          summary: "Verify an accepted collection inverse by exact receipt and absence",
          responses: { "200": { description: "Exact absence verification." } }
        }
      },
      "/v1/project-registration/items/bind": {
        post: {
          operationId: "bindKnowledgeItemToProjectCollection",
          summary: "Explicitly bind one exact existing item to a project collection",
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      receipt: { $ref: "#/components/schemas/ProjectRegistrationReceipt" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/v1/project-registration/items/read-exact": {
        post: {
          operationId: "readKnowledgeProjectItemBinding",
          summary: "Read one exact collection/item membership",
          responses: {
            "200": { description: "Exact membership readback." },
            "404": { description: "No exact membership." }
          }
        }
      },
      "/v1/project-registration/items/compensate": {
        post: {
          operationId: "compensateKnowledgeProjectItemBinding",
          summary: "Conditionally remove a membership owned by the accepted binding receipt",
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      receipt: { $ref: "#/components/schemas/ProjectRegistrationReceipt" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/v1/project-registration/items/verify-inverse": {
        post: {
          operationId: "verifyKnowledgeProjectItemBindingInverse",
          summary: "Verify an accepted membership inverse by exact receipt and absence",
          responses: { "200": { description: "Exact membership absence verification." } }
        }
      },
      "/v1/projects/{projectId}/resources": {
        get: {
          operationId: "listKnowledgeProjectResources",
          summary: "Enumerate the complete stable project/collection/item/taxonomy population",
          parameters: [
            { name: "projectId", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            {
              name: "kind",
              in: "query",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                items: { type: "string", enum: ["project", "collection", "item", "taxonomy"] }
              }
            }
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ProjectResourcePage" } }
              }
            },
            "409": { description: "Cursor is stale or belongs to another population." }
          }
        }
      },
      "/v1/projects/{projectId}/resources/{kind}/{resourceId}": {
        get: {
          operationId: "getKnowledgeProjectResource",
          summary: "Read one project resource by exact stable kind and id",
          parameters: [
            { name: "projectId", in: "path", required: true, schema: { type: "string" } },
            {
              name: "kind",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["project", "collection", "item", "taxonomy"] }
            },
            { name: "resourceId", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { resource: { $ref: "#/components/schemas/ProjectResource" } }
                  }
                }
              }
            },
            "404": { description: "No exact resource kind and id." }
          }
        }
      },
      "/v1/notes": {
        get: {
          operationId: "listNotes",
          summary: "List knowledge items with literal filters and bounded paging",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "filter", in: "query", schema: { type: "string" } },
            {
              name: "search",
              in: "query",
              deprecated: true,
              description: "Legacy alias for filter.",
              schema: { type: "string" }
            },
            {
              name: "tags",
              in: "query",
              style: "form",
              explode: true,
              schema: { type: "array", items: { type: "string" } }
            },
            { name: "archive", in: "query", schema: { type: "string", enum: ["active", "archived", "all"] } },
            {
              name: "includeArchived",
              in: "query",
              deprecated: true,
              description: "Legacy alias: true maps to archive=all.",
              schema: { type: "boolean" }
            },
            { name: "sort", in: "query", schema: { type: "string", enum: ["created", "title"] } },
            { name: "direction", in: "query", schema: { type: "string", enum: ["asc", "desc"] } }
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/NoteList" } }
              }
            }
          }
        },
        post: {
          operationId: "createNote",
          summary: "Create a knowledge item",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NoteInput" } } }
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        }
      },
      "/v1/notes/search": {
        get: {
          operationId: "searchNotes",
          summary: "Ranked PostgreSQL full-text query with bounded paging",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "archive", in: "query", schema: { type: "string", enum: ["active", "archived", "all"] } }
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/NoteSearchList" } }
              }
            }
          }
        }
      },
      "/v1/notes/{id}": {
        get: {
          operationId: "getNote",
          summary: "Fetch a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        },
        patch: {
          operationId: "updateNote",
          summary: "Update a knowledge item",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            {
              name: "If-Match",
              in: "header",
              required: false,
              schema: { type: "string" },
              description: "Optimistic concurrency guard: the version the client last read. The write applies only if the " + "stored entry is still at that version, otherwise 409 version_conflict. Optional in this phase so " + 'already-installed clients keep working; `*` means "any existing version".'
            }
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotePatch" } } }
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } },
            "409": {
              description: "The stored entry moved on; nothing was written.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/VersionConflict" } } }
            }
          }
        },
        delete: {
          operationId: "deleteNote",
          summary: "Delete a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} }
        }
      },
      "/v1/notes/{id}/versions": {
        get: {
          operationId: "listNoteVersions",
          summary: "List prior versions of a knowledge item (newest first)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } }
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/NoteVersionList" } } } },
            "404": { description: "No such entry. An entry that exists but was never edited returns 200 with an empty list." }
          }
        },
        delete: {
          operationId: "purgeNoteVersions",
          summary: "Permanently purge every retained prior version of a knowledge item",
          description: "Secret-hygiene operation: deletes the retained history so a credential-shaped value " + "in a prior snapshot stops being reachable. Never returns or renders the retained body. " + "The live row is untouched.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Purge receipt: purged count and the untouched current version.", content: { "application/json": { schema: { $ref: "#/components/schemas/NotePurgeReceipt" } } } },
            "404": { description: "No such entry." }
          }
        }
      },
      "/v1/notes/{id}/versions/{version}": {
        get: {
          operationId: "getNoteVersion",
          summary: "Fetch one prior version of a knowledge item",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "path", required: true, schema: { type: "integer" } }
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/NoteVersion" } } } },
            "404": { description: "No such entry, or no such version of it." }
          }
        },
        delete: {
          operationId: "purgeNoteVersion",
          summary: "Permanently purge ONE retained prior version of a knowledge item",
          description: "Secret-hygiene operation. Deleting the live/current version is refused with 409. " + "A version that is not retained returns 200 with purged: 0. Never returns the body.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "path", required: true, schema: { type: "integer" } }
          ],
          responses: {
            "200": { description: "Purge receipt: purged count and the untouched current version.", content: { "application/json": { schema: { $ref: "#/components/schemas/NotePurgeReceipt" } } } },
            "404": { description: "No such entry." },
            "409": { description: "The version is the live row, not a retained prior version." }
          }
        }
      },
      "/v1/guarded-writes": {
        post: {
          operationId: "executeGuardedKnowledgeWrite",
          summary: "Execute one FCAME-1 create-if-absent or compare-and-swap write",
          description: "Requires x-knowledge-tenant-id, Idempotency-Key, and the four x-knowledge-* bound headers. " + "The server stores one immutable terminal receipt and never falls back to local or raw storage.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GuardedWriteEnvelope" }
              }
            }
          },
          responses: {
            "201": { description: "Accepted with one immutable receipt." },
            "200": { description: "Same deterministic operation already accepted; duplicate proof returned." },
            "409": { description: "Terminal rejection or operation/step binding conflict." }
          }
        }
      },
      "/v1/guarded-writes/lookups/title": {
        post: {
          operationId: "lookupGuardedKnowledgeTitle",
          summary: "Bounded exact-title lookup under one frozen FCAME-1 binding",
          description: "Returns zero or one metadata-only item proof. More than one exact title is an ambiguity error; " + "item bodies and titles are never returned.",
          responses: {
            "200": { description: "Exact bounded metadata-only result containing zero or one item proof." },
            "409": { description: "More than one exact title exists under the frozen binding." }
          }
        }
      },
      "/v1/guarded-adoptions": {
        post: {
          operationId: "executeGuardedKnowledgeAdoption",
          summary: "Adopt one exact legacy row or roll it back through its immutable adoption receipt",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GuardedAdoptionEnvelope" }
              }
            }
          },
          responses: {
            "201": { description: "Accepted with one immutable adoption receipt." },
            "200": { description: "Exact deterministic replay; no second effect." },
            "409": { description: "Terminal CAS/binding rejection or operation binding conflict." }
          }
        }
      },
      "/v1/guarded-adoptions/receipts/{deterministicKey}": {
        get: {
          operationId: "reconcileGuardedKnowledgeAdoption",
          summary: "Bounded exact adoption-receipt reconciliation",
          parameters: [
            {
              name: "deterministicKey",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            ...guardedBindingParameters,
            { name: "operation_id", in: "query", required: true, schema: { type: "string" } },
            { name: "step_id", in: "query", required: true, schema: { type: "string" } },
            ...guardedLimitParameters
          ],
          responses: {
            "200": { description: "Exact bounded result containing zero or one immutable receipt." }
          }
        }
      },
      "/v1/guarded-adoptions/items/{id}/binding-state": {
        get: {
          operationId: "readGuardedKnowledgeBindingState",
          summary: "Exact bounded stored-binding-state readback for a full Knowledge id",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            ...guardedBindingParameters,
            ...guardedLimitParameters
          ],
          responses: {
            "200": {
              description: "legacy_unbound, bound_to_requested, or bound_elsewhere; elsewhere does not disclose version/hash."
            },
            "404": { description: "No exact full-ID row." }
          }
        }
      },
      "/v1/guarded-writes/queries": {
        post: {
          operationId: "queryGuardedKnowledge",
          summary: "Bounded private Knowledge query under one frozen FCAME-1 binding",
          description: "The raw selector exists only in this authenticated request body. " + "The response contains hashes, versions, page evidence, and no raw selector or item id.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["contract", "descriptor", "selector", "limits"],
                  additionalProperties: false
                }
              }
            }
          },
          responses: {
            "200": { description: "Exact bounded private result or typed semantic unavailability." },
            "400": { description: "Descriptor, selector, binding digest, page, or bounds mismatch." }
          }
        }
      },
      "/v1/guarded-writes/receipts/{deterministicKey}": {
        get: {
          operationId: "reconcileGuardedKnowledgeWrite",
          summary: "Bounded exact terminal-receipt reconciliation",
          parameters: [
            {
              name: "deterministicKey",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            ...guardedBindingParameters,
            { name: "operation_id", in: "query", required: true, schema: { type: "string" } },
            { name: "step_id", in: "query", required: true, schema: { type: "string" } },
            ...guardedLimitParameters
          ],
          responses: {
            "200": {
              description: "Exact bounded result containing zero or one terminal receipt and completeness."
            }
          }
        }
      },
      "/v1/guarded-writes/items/{id}": {
        get: {
          operationId: "readbackGuardedKnowledgeItem",
          summary: "Exact full-ID readback under the frozen binding",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            ...guardedBindingParameters,
            ...guardedLimitParameters
          ],
          responses: {
            "200": { description: "Exactly one full-ID and binding match." },
            "404": { description: "No exact full-ID and binding match." }
          }
        }
      },
      "/v1/guarded-manifests": {
        post: {
          operationId: "createGuardedKnowledgeManifest",
          summary: "Create an immutable ordered FCAME-1 workflow manifest before step zero",
          responses: {
            "201": { description: "Manifest created." },
            "200": { description: "Exact manifest replay; duplicate proof returned." },
            "409": { description: "manifest_id is already bound to different semantics." }
          }
        }
      },
      "/v1/guarded-manifests/{manifestId}": {
        get: {
          operationId: "reconcileGuardedKnowledgeManifest",
          summary: "Derive bounded workflow completeness from immutable authority receipts",
          description: "External-authority steps remain unverified and keep terminal_complete false until that authority " + "provides a verifiable receipt path.",
          parameters: [
            { name: "manifestId", in: "path", required: true, schema: { type: "string" } },
            ...guardedBindingParameters,
            ...guardedLimitParameters
          ],
          responses: {
            "200": { description: "Manifest plus per-step receipt state and any unsupported authority gap." },
            "404": { description: "No exact manifest and maintainer binding match." }
          }
        }
      },
      "/v1/registry": {
        get: {
          operationId: "getRegistry",
          summary: "Knowledge registry contract",
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }
          }
        }
      }
    }
  };
}

class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
function boundedJson(body, status, bounds, startedAt) {
  if (Date.now() - startedAt > bounds.wall_time_ms) {
    throw new HttpError(408, "guarded phase exceeded its producer wall-time cap.");
  }
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > bounds.max_bytes) {
    throw new HttpError(413, "guarded phase response exceeds its producer byte cap.");
  }
  return new Response(encoded, {
    status,
    headers: { "content-type": "application/json" }
  });
}
function parsePositiveInteger(value, field) {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
}
function guardedBoundsFromHeaders(req) {
  const bounds = {
    max_calls: parsePositiveInteger(req.headers.get("x-knowledge-max-calls"), "x-knowledge-max-calls"),
    max_items: parsePositiveInteger(req.headers.get("x-knowledge-max-items"), "x-knowledge-max-items"),
    max_bytes: parsePositiveInteger(req.headers.get("x-knowledge-max-bytes"), "x-knowledge-max-bytes"),
    wall_time_ms: parsePositiveInteger(req.headers.get("x-knowledge-wall-time-ms"), "x-knowledge-wall-time-ms")
  };
  try {
    assertKnowledgeGuardedBounds(bounds);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded bounds.");
  }
  return bounds;
}
function privateQueryBoundsFromHeaders(req) {
  const bounds = {
    max_calls: parsePositiveInteger(req.headers.get("x-knowledge-max-calls"), "x-knowledge-max-calls"),
    max_items: parsePositiveInteger(req.headers.get("x-knowledge-max-items"), "x-knowledge-max-items"),
    max_bytes: parsePositiveInteger(req.headers.get("x-knowledge-max-bytes"), "x-knowledge-max-bytes"),
    wall_time_ms: parsePositiveInteger(req.headers.get("x-knowledge-wall-time-ms"), "x-knowledge-wall-time-ms")
  };
  try {
    assertKnowledgePrivateQueryBounds(bounds);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "invalid private query bounds.");
  }
  return bounds;
}
function guardedBoundsFromQuery(req, url) {
  const fromHeaders = guardedBoundsFromHeaders(req);
  const fromQuery = {
    max_calls: parsePositiveInteger(url.searchParams.get("max_calls"), "max_calls"),
    max_items: parsePositiveInteger(url.searchParams.get("max_items"), "max_items"),
    max_bytes: parsePositiveInteger(url.searchParams.get("max_bytes"), "max_bytes"),
    wall_time_ms: parsePositiveInteger(url.searchParams.get("wall_time_ms"), "wall_time_ms")
  };
  if (canonicalKnowledgeGuardedJson(fromHeaders) !== canonicalKnowledgeGuardedJson(fromQuery)) {
    throw new HttpError(400, "guarded query bounds must exactly match the bound headers.");
  }
  return fromHeaders;
}
async function readBoundedJson(req, bounds, startedAt) {
  if (!req.body)
    throw new HttpError(400, "guarded write body is required.");
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const remaining = bounds.wall_time_ms - (Date.now() - startedAt);
      if (remaining <= 0)
        throw new HttpError(408, "guarded request exceeded its producer wall-time cap.");
      let timer;
      const result = await Promise.race([
        reader.read(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new HttpError(408, "guarded request exceeded its producer wall-time cap.")), remaining);
        })
      ]).finally(() => {
        if (timer)
          clearTimeout(timer);
      });
      if (result.done)
        break;
      total += result.value.byteLength;
      if (total > bounds.max_bytes) {
        throw new HttpError(413, "guarded request exceeds its producer byte cap.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "guarded request body must be valid JSON.");
  }
}
function guardedBindingFromQuery(url) {
  const binding = {
    authority: {
      classification: url.searchParams.get("authority_classification"),
      authority_id: url.searchParams.get("authority_id")
    },
    tenant_id: url.searchParams.get("tenant_id"),
    scope: url.searchParams.get("scope"),
    parent_id: url.searchParams.get("parent_id")
  };
  try {
    assertKnowledgeGuardedBinding(binding);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded binding.");
  }
  return binding;
}
function assertConfiguredAuthority(binding, authority) {
  if (binding.authority.classification !== authority.classification || binding.authority.authority_id !== authority.authority_id) {
    throw new HttpError(403, "guarded write authority does not match this service authority.");
  }
}
function assertExactRequestKeys(value, field, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalKnowledgeGuardedJson(actual) !== canonicalKnowledgeGuardedJson(wanted)) {
    throw new Error(`${field} keys do not match the FCAME-1 request schema.`);
  }
}
function validateGuardedEnvelope(value, headerBounds, authority, idempotencyKey) {
  try {
    if (!value || typeof value !== "object")
      throw new Error("guarded write envelope is required.");
    const envelope = value;
    assertExactRequestKeys(value, "guarded write envelope", ["contract", "descriptor", "deterministic_key", "limits", "payload"]);
    const descriptor = envelope.descriptor;
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded-write contract.");
    }
    if (!descriptor || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || descriptor.schema !== KNOWLEDGE_PRIVATE_INPUT_SCHEMA) {
      throw new Error("invalid private input descriptor schema.");
    }
    assertExactRequestKeys(descriptor, "private input descriptor", [
      "contract",
      "schema",
      "descriptor_id",
      "operation_id",
      "step_id",
      "verb",
      "target_id",
      "payload_digest",
      "binding_digest",
      "precondition",
      "binding",
      "manifest",
      "expires_at"
    ]);
    if (typeof descriptor.descriptor_id !== "string" || descriptor.descriptor_id.length === 0) {
      throw new Error("private input descriptor id is required.");
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (!Number.isFinite(descriptorExpiresAt) || descriptorExpiresAt <= descriptorNow || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000) {
      throw new Error("private input descriptor is expired or malformed.");
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgeGuardedPrecondition(descriptor.verb, descriptor.precondition);
    assertKnowledgeGuardedPayload(descriptor.verb, envelope.payload);
    if ("metadata" in envelope.payload && envelope.payload.metadata) {
      assertKnowledgeRelationsMetadata(envelope.payload.metadata, descriptor.target_id);
    }
    const limits = normalizeKnowledgeGuardedLimits(envelope.limits);
    if (canonicalKnowledgeGuardedJson(limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new Error("guarded-write limits must be explicit and complete.");
    }
    if (canonicalKnowledgeGuardedJson(limits.submission) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("submission limits must exactly match the producer bound headers.");
    }
    const payloadDigest = knowledgeGuardedDigest(envelope.payload);
    if (payloadDigest !== descriptor.payload_digest) {
      throw new Error("private payload digest does not match the frozen descriptor.");
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      precondition: descriptor.precondition,
      payload_digest: descriptor.payload_digest,
      manifest: descriptor.manifest
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error("private descriptor binding digest does not match.");
    }
    const expectedKey = computeKnowledgeGuardedDeterministicKey({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      payload_digest: descriptor.payload_digest,
      precondition: descriptor.precondition,
      manifest: descriptor.manifest
    });
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error("deterministic key must match both the frozen tuple and Idempotency-Key.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("guarded write envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded write envelope.");
  }
}
function validatePrivateTitleLookupEnvelope(value, headerBounds, authority) {
  try {
    if (!value || typeof value !== "object") {
      throw new Error("private title lookup envelope is required.");
    }
    const envelope = value;
    assertExactRequestKeys(value, "private title lookup envelope", ["contract", "descriptor", "title", "limits"]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded-write contract.");
    }
    const descriptor = envelope.descriptor;
    if (!descriptor || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || descriptor.schema !== KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA) {
      throw new Error("invalid private title lookup descriptor schema.");
    }
    assertExactRequestKeys(descriptor, "private title lookup descriptor", [
      "contract",
      "schema",
      "operation_id",
      "step_id",
      "title_digest",
      "binding_digest",
      "binding",
      "expires_at"
    ]);
    if (typeof descriptor.operation_id !== "string" || descriptor.operation_id.length === 0 || typeof descriptor.step_id !== "string" || descriptor.step_id.length === 0 || typeof envelope.title !== "string" || envelope.title.length === 0 || envelope.title.length > 2048) {
      throw new Error("private title lookup operation, step, and bounded title are required.");
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (!Number.isFinite(descriptorExpiresAt) || descriptorExpiresAt <= descriptorNow || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000) {
      throw new Error("private title lookup descriptor is expired or malformed.");
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgeGuardedBounds(envelope.limits, "private title lookup bounds");
    if (canonicalKnowledgeGuardedJson(envelope.limits) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("private title lookup limits must exactly match the producer bound headers.");
    }
    const titleDigest = knowledgeGuardedContentSha256(envelope.title);
    if (titleDigest !== descriptor.title_digest) {
      throw new Error("private title lookup digest does not match the frozen descriptor.");
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      title_digest: descriptor.title_digest
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error("private title lookup binding digest does not match.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("private title lookup envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid private title lookup envelope.");
  }
}
function validatePrivateQueryEnvelope(value, headerBounds, authority) {
  try {
    if (!value || typeof value !== "object") {
      throw new Error("private query envelope is required.");
    }
    const envelope = value;
    assertExactRequestKeys(value, "private query envelope", ["contract", "descriptor", "selector", "limits"]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded-write contract.");
    }
    const descriptor = envelope.descriptor;
    if (!descriptor || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || descriptor.schema !== KNOWLEDGE_PRIVATE_QUERY_SCHEMA) {
      throw new Error("invalid private query descriptor schema.");
    }
    assertExactRequestKeys(descriptor, "private query descriptor", [
      "contract",
      "schema",
      "operation_id",
      "step_id",
      "query_kind",
      "selector_digest",
      "binding_digest",
      "binding",
      "archive",
      "page",
      "expires_at"
    ]);
    if (typeof descriptor.operation_id !== "string" || descriptor.operation_id.length === 0 || typeof descriptor.step_id !== "string" || descriptor.step_id.length === 0 || !["active", "archived", "all"].includes(descriptor.archive)) {
      throw new Error("private query operation, step, and archive mode are required.");
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (!Number.isFinite(descriptorExpiresAt) || descriptorExpiresAt <= descriptorNow || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000) {
      throw new Error("private query descriptor is expired or malformed.");
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgePrivateQueryBounds(envelope.limits);
    assertKnowledgePrivateQueryPage(descriptor.page, envelope.limits);
    if (canonicalKnowledgeGuardedJson(envelope.limits) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("private query limits must exactly match the producer bound headers.");
    }
    assertKnowledgePrivateQuerySelector(envelope.selector);
    if (envelope.selector.kind !== descriptor.query_kind) {
      throw new Error("private query selector kind does not match the frozen descriptor.");
    }
    const selectorDigest = knowledgeGuardedDigest(envelope.selector);
    if (selectorDigest !== descriptor.selector_digest) {
      throw new Error("private query selector digest does not match the frozen descriptor.");
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      query_kind: descriptor.query_kind,
      selector_digest: descriptor.selector_digest,
      archive: descriptor.archive,
      page: descriptor.page
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error("private query binding digest does not match.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("private query envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid private query envelope.");
  }
}
function validateGuardedAdoptionEnvelope(value, headerBounds, authority, idempotencyKey) {
  try {
    if (!value || typeof value !== "object") {
      throw new Error("guarded adoption envelope is required.");
    }
    const envelope = value;
    assertExactRequestKeys(value, "guarded adoption envelope", [
      "contract",
      "action",
      "deterministic_key",
      "operation_id",
      "step_id",
      "target_id",
      "binding",
      "expected_version",
      "expected_content_sha256",
      "adoption_receipt_id",
      "limits"
    ]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded adoption contract.");
    }
    assertKnowledgeGuardedBinding(envelope.binding);
    assertConfiguredAuthority(envelope.binding, authority);
    const limits = normalizeKnowledgeGuardedLimits(envelope.limits);
    if (canonicalKnowledgeGuardedJson(limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new Error("guarded-adoption limits must be explicit and complete.");
    }
    if (canonicalKnowledgeGuardedJson(limits.submission) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("adoption submission limits must exactly match the producer bound headers.");
    }
    const expectedKey = computeKnowledgeGuardedAdoptionDeterministicKey({
      action: envelope.action,
      operation_id: envelope.operation_id,
      step_id: envelope.step_id,
      target_id: envelope.target_id,
      binding: envelope.binding,
      expected_version: envelope.expected_version,
      expected_content_sha256: envelope.expected_content_sha256,
      adoption_receipt_id: envelope.adoption_receipt_id
    });
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error("adoption deterministic key must match both the exact tuple and Idempotency-Key.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("guarded adoption envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded adoption envelope.");
  }
}
function validateGuardedManifestEnvelope(value, bounds, authority, idempotencyKey) {
  try {
    if (!value || typeof value !== "object")
      throw new Error("guarded manifest envelope is required.");
    const envelope = value;
    assertExactRequestKeys(value, "guarded manifest envelope", ["contract", "maintainer", "manifest", "deterministic_key"]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded manifest contract.");
    }
    assertKnowledgeGuardedBinding(envelope.maintainer);
    assertConfiguredAuthority(envelope.maintainer, authority);
    assertKnowledgeGuardedManifestOptions(envelope.maintainer, envelope.manifest);
    const expectedKey = computeKnowledgeGuardedManifestDeterministicKey(envelope.maintainer, envelope.manifest);
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error("manifest deterministic key must match both the frozen tuple and Idempotency-Key.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > bounds.max_bytes) {
      throw new Error("guarded manifest exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded manifest envelope.");
  }
}
function principalActor(principal) {
  return principal.agent ? `agent:${principal.agent}` : `key:${principal.kid}`;
}
function parseExpectedVersion(req, body) {
  const header = req.headers.get("if-match");
  if (header != null && header.trim() !== "" && header.trim() !== "*") {
    const cleaned = header.trim().replace(/^W\//i, "").replace(/^"(.*)"$/, "$1");
    const parsed2 = Number(cleaned);
    if (!Number.isInteger(parsed2) || parsed2 < 1) {
      throw new HttpError(400, `If-Match must be an entry version number (got ${header}).`);
    }
    return parsed2;
  }
  const fromBody = body.expected_version;
  if (fromBody === undefined || fromBody === null)
    return;
  const parsed = Number(fromBody);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, "expected_version must be a positive integer entry version.");
  }
  return parsed;
}
function createServeHandler(deps) {
  const repo = new NoteRepo(deps.client);
  const guardedRepo = deps.guardedAuthority ? new GuardedWriteRepo(deps.client, deps.guardedAuthority) : null;
  const projectLinksForTenant = (tenantId) => deps.projectLinksAuthority?.(tenantId) ?? createPostgresKnowledgeProjectLinksAuthority({
    client: deps.client,
    itemResolver: (id) => repo.get(id, tenantId),
    options: {
      packageVersion: deps.version,
      authorityId: process.env.HASNA_KNOWLEDGE_PROJECT_AUTHORITY_ID ?? KNOWLEDGE_SERVE_APP,
      tenantId,
      corpusId: process.env.HASNA_KNOWLEDGE_PROJECT_CORPUS_ID ?? "knowledge"
    }
  });
  const backend = "postgresql";
  const authOrThrow = async (req, requiredScopes, expectedTid) => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes,
      ...expectedTid !== undefined ? { expectedTid } : {}
    });
    if (decision.ok === false) {
      throw new HttpError(decision.status, decision.message);
    }
    deps.store.touchLastUsed(decision.principal.kid).catch(() => {});
    return decision.principal;
  };
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    try {
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: deps.version, backend });
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: deps.version, backend });
      }
      if (path === "/ready" && method === "GET") {
        try {
          await deps.client.query("SELECT 1");
          return json({ status: "ready", version: deps.version, backend });
        } catch {
          return json({ status: "unavailable", version: deps.version, backend }, 503);
        }
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(knowledgeOpenApi(deps.version));
      }
      if (path === "/v1/registry" && method === "GET") {
        await authOrThrow(req, ["knowledge:read"]);
        return json(knowledgeRegistryContract({
          sourceSchemes: ["open-files", "s3", "web", "file"],
          storageType: "s3",
          artifactUriPrefix: process.env.HASNA_KNOWLEDGE_S3_PREFIX ?? null
        }));
      }
      if (path === "/v1/guarded-manifests" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        await authOrThrow(req, ["knowledge:write"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedManifestEnvelope(raw, bounds, guardedRepo.authority, req.headers.get("idempotency-key"));
        if (envelope.maintainer.tenant_id !== tenantId) {
          throw new HttpError(403, "manifest tenant does not match the authenticated request tenant.");
        }
        try {
          const submission = await guardedRepo.createManifest(envelope);
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof ManifestBindingConflictError) {
            return boundedJson({
              error: "manifest_binding_conflict",
              manifest: error.manifest
            }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      const guardedManifestMatch = path.match(/^\/v1\/guarded-manifests\/([^/]+)$/);
      if (guardedManifestMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const reconciliation = await guardedRepo.reconcileManifest(decodeURIComponent(guardedManifestMatch[1]), binding, bounds);
        return reconciliation ? boundedJson(reconciliation, 200, bounds, startedAt) : boundedJson({ error: "not_found" }, 404, bounds, startedAt);
      }
      if (path === "/v1/guarded-adoptions" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        const principal = await authOrThrow(req, ["knowledge:write"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedAdoptionEnvelope(raw, bounds, guardedRepo.authority, req.headers.get("idempotency-key"));
        if (envelope.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "adoption tenant does not match the authenticated request tenant.");
        }
        try {
          const submission = await guardedRepo.executeAdoption(envelope, principalActor(principal));
          if (submission.receipt.status === "rejected") {
            if (submission.receipt.code === "not_found") {
              return boundedJson({ error: "not_found" }, 404, bounds, startedAt);
            }
            return boundedJson({ error: "guarded_adoption_rejected", ...submission }, 409, bounds, startedAt);
          }
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof AdoptionOperationBindingConflictError) {
            return boundedJson({
              error: "adoption_operation_conflict",
              receipt: error.receipt
            }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      const guardedAdoptionReceiptMatch = path.match(/^\/v1\/guarded-adoptions\/receipts\/([^/]+)$/);
      if (guardedAdoptionReceiptMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const operationId = url.searchParams.get("operation_id");
        const stepId = url.searchParams.get("step_id");
        if (!operationId || !stepId) {
          throw new HttpError(400, "operation_id and step_id are required for exact adoption reconciliation.");
        }
        const reconciliation = await guardedRepo.reconcileAdoption(decodeURIComponent(guardedAdoptionReceiptMatch[1]), binding, operationId, stepId, bounds);
        return boundedJson(reconciliation, 200, bounds, startedAt);
      }
      const guardedBindingStateMatch = path.match(/^\/v1\/guarded-adoptions\/items\/([^/]+)\/binding-state$/);
      if (guardedBindingStateMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const readback = await guardedRepo.bindingState(decodeURIComponent(guardedBindingStateMatch[1]), binding, bounds);
        return readback ? boundedJson(readback, 200, bounds, startedAt) : boundedJson({ error: "not_found" }, 404, bounds, startedAt);
      }
      if (path === "/v1/guarded-writes" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        const principal = await authOrThrow(req, ["knowledge:write"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedEnvelope(raw, bounds, guardedRepo.authority, req.headers.get("idempotency-key"));
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "descriptor tenant does not match the authenticated request tenant.");
        }
        try {
          const submission = await guardedRepo.execute(envelope, principalActor(principal));
          if (submission.receipt.status === "rejected") {
            return boundedJson({ error: "guarded_write_rejected", ...submission }, 409, bounds, startedAt);
          }
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof OperationBindingConflictError) {
            return boundedJson({
              error: "operation_binding_conflict",
              receipt: error.receipt
            }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      if (path === "/v1/guarded-writes/lookups/title" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        await authOrThrow(req, ["knowledge:read"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validatePrivateTitleLookupEnvelope(raw, bounds, guardedRepo.authority);
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "descriptor tenant does not match the authenticated request tenant.");
        }
        try {
          const result = await guardedRepo.lookupTitle(envelope.title, envelope.descriptor.binding, bounds);
          return boundedJson(result, 200, bounds, startedAt);
        } catch (error) {
          if (error instanceof PrivateTitleLookupAmbiguousError) {
            return boundedJson({ error: "private_title_lookup_ambiguous" }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      if (path === "/v1/guarded-writes/queries" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        await authOrThrow(req, ["knowledge:read"], tenantId);
        const bounds = privateQueryBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validatePrivateQueryEnvelope(raw, bounds, guardedRepo.authority);
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "descriptor tenant does not match the authenticated request tenant.");
        }
        const result = await guardedRepo.query(envelope.selector, envelope.descriptor.selector_digest, envelope.descriptor.archive, envelope.descriptor.page, envelope.descriptor.binding, bounds);
        return boundedJson(result, 200, bounds, startedAt);
      }
      const guardedReceiptMatch = path.match(/^\/v1\/guarded-writes\/receipts\/([^/]+)$/);
      if (guardedReceiptMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const operationId = url.searchParams.get("operation_id");
        const stepId = url.searchParams.get("step_id");
        if (!operationId || !stepId) {
          throw new HttpError(400, "operation_id and step_id are required for exact reconciliation.");
        }
        const reconciliation = await guardedRepo.reconcile(decodeURIComponent(guardedReceiptMatch[1]), binding, operationId, stepId, bounds);
        return boundedJson(reconciliation, 200, bounds, startedAt);
      }
      const guardedItemMatch = path.match(/^\/v1\/guarded-writes\/items\/([^/]+)$/);
      if (guardedItemMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const readback = await guardedRepo.readback(decodeURIComponent(guardedItemMatch[1]), binding, bounds);
        return readback ? boundedJson(readback, 200, bounds, startedAt) : boundedJson({ error: "not_found" }, 404, bounds, startedAt);
      }
      if (path === "/v1/project-registration/capability") {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        return json({ capability: await projectLinksForTenant(principal.tid).capability() });
      }
      if (path === "/v1/project-registration/create") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:write"]);
        const body = await req.json().catch(() => ({}));
        return json({ receipt: await projectLinksForTenant(principal.tid).registerCollection(body) }, 201);
      }
      if (path === "/v1/project-registration/read-exact") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const body = await req.json().catch(() => ({}));
        return json({
          record: await projectLinksForTenant(principal.tid).readCollection(String(body.collection_id ?? ""))
        });
      }
      if (path === "/v1/project-registration/receipts/lookup") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const body = await req.json().catch(() => ({}));
        return json({ receipt: await projectLinksForTenant(principal.tid).lookupReceipt(body) });
      }
      if (path === "/v1/project-registration/compensate") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:write"]);
        const body = await req.json().catch(() => ({}));
        return json({ receipt: await projectLinksForTenant(principal.tid).compensateRegistration(body) }, 201);
      }
      if (path === "/v1/project-registration/verify-inverse") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const body = await req.json().catch(() => ({}));
        return json({
          verification: await projectLinksForTenant(principal.tid).verifyRegistrationInverse(body)
        });
      }
      if (path === "/v1/project-registration/items/bind") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:write"]);
        const body = await req.json().catch(() => ({}));
        return json({ receipt: await projectLinksForTenant(principal.tid).bindItem(body) }, 201);
      }
      if (path === "/v1/project-registration/items/read-exact") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const body = await req.json().catch(() => ({}));
        return json({
          record: await projectLinksForTenant(principal.tid).readItemBinding(String(body.collection_id ?? ""), String(body.item_id ?? ""))
        });
      }
      if (path === "/v1/project-registration/items/compensate") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:write"]);
        const body = await req.json().catch(() => ({}));
        return json({ receipt: await projectLinksForTenant(principal.tid).compensateItemBinding(body) }, 201);
      }
      if (path === "/v1/project-registration/items/verify-inverse") {
        if (method !== "POST")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const body = await req.json().catch(() => ({}));
        return json({
          verification: await projectLinksForTenant(principal.tid).verifyItemBindingInverse(body)
        });
      }
      const exactProjectResourceMatch = path.match(/^\/v1\/projects\/([^/]+)\/resources\/(project|collection|item|taxonomy)\/([^/]+)$/);
      if (exactProjectResourceMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const resource = await projectLinksForTenant(principal.tid).readProjectResource(decodeURIComponent(exactProjectResourceMatch[1]), exactProjectResourceMatch[2], decodeURIComponent(exactProjectResourceMatch[3]));
        return json({ resource });
      }
      const projectResourcesMatch = path.match(/^\/v1\/projects\/([^/]+)\/resources$/);
      if (projectResourcesMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const page = await projectLinksForTenant(principal.tid).listProjectResources(decodeURIComponent(projectResourcesMatch[1]), {
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
          cursor: url.searchParams.get("cursor"),
          kinds: url.searchParams.getAll("kind")
        });
        return json(page);
      }
      if (path === "/v1/notes/search") {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const query = url.searchParams.get("q") ?? "";
        const archiveRaw = url.searchParams.get("archive") ?? "active";
        if (!["active", "archived", "all"].includes(archiveRaw)) {
          throw new HttpError(400, "archive must be active, archived, or all.");
        }
        const result = await repo.search({
          query,
          archive: archiveRaw,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
          offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined
        }, principal.tid);
        return json({ ...result, query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY });
      }
      if (path === "/v1/notes") {
        if (method === "GET") {
          const principal = await authOrThrow(req, ["knowledge:read"]);
          const includeArchived = url.searchParams.get("includeArchived") === "true";
          const archiveRaw = url.searchParams.get("archive") ?? (includeArchived ? "all" : "active");
          const sortRaw = url.searchParams.get("sort") ?? "created";
          const directionRaw = url.searchParams.get("direction") ?? "asc";
          if (!["active", "archived", "all"].includes(archiveRaw)) {
            throw new HttpError(400, "archive must be active, archived, or all.");
          }
          if (!["created", "title"].includes(sortRaw)) {
            throw new HttpError(400, "sort must be created or title.");
          }
          if (!["asc", "desc"].includes(directionRaw)) {
            throw new HttpError(400, "direction must be asc or desc.");
          }
          const tags = url.searchParams.getAll("tags");
          const result = await repo.list({
            limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
            filter: url.searchParams.get("filter") ?? url.searchParams.get("search") ?? undefined,
            tags: tags.length > 0 ? tags : undefined,
            archive: archiveRaw,
            sort: sortRaw,
            direction: directionRaw
          }, principal.tid);
          return json({ ...result, query_capability: KNOWLEDGE_BOUNDED_QUERY_CAPABILITY });
        }
        if (method === "POST") {
          const principal = await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const item = await repo.create(body, { actor: principalActor(principal) });
          return json(item, 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const versionListMatch = path.match(/^\/v1\/notes\/([^/]+)\/versions$/);
      if (versionListMatch) {
        if (method === "GET") {
          const principal = await authOrThrow(req, ["knowledge:read"]);
          const history = await repo.listVersions(decodeURIComponent(versionListMatch[1]), {
            limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined
          }, principal.tid);
          return history ? json(history) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          const principal = await authOrThrow(req, ["knowledge:write"]);
          const id = decodeURIComponent(versionListMatch[1]);
          const purged = await repo.purgeVersions(id, {}, principal.tid);
          if (!purged)
            return json({ error: "not_found" }, 404);
          return json({
            ok: true,
            id,
            purged: purged.purged,
            current_version: purged.current_version,
            message: `${id} purged ${purged.purged} retained version(s); live content at version ${purged.current_version} untouched`
          }, 200);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const versionOneMatch = path.match(/^\/v1\/notes\/([^/]+)\/versions\/(\d+)$/);
      if (versionOneMatch) {
        if (method === "GET") {
          const principal = await authOrThrow(req, ["knowledge:read"]);
          const snapshot = await repo.getVersion(decodeURIComponent(versionOneMatch[1]), Number(versionOneMatch[2]), principal.tid);
          return snapshot ? json(snapshot) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          const principal = await authOrThrow(req, ["knowledge:write"]);
          const id = decodeURIComponent(versionOneMatch[1]);
          const version = Number(versionOneMatch[2]);
          try {
            const purged = await repo.purgeVersions(id, { version }, principal.tid);
            if (!purged)
              return json({ error: "not_found" }, 404);
            return json({
              ok: true,
              id,
              purged: purged.purged,
              current_version: purged.current_version,
              message: purged.purged === 0 ? `no retained version ${version} of ${id}` : `${id} purged retained version ${version}; live content at version ${purged.current_version} untouched`
            }, 200);
          } catch (error) {
            if (error instanceof CannotPurgeLiveVersionError) {
              return json({ error: error.code, version: error.version, current_version: error.current }, 409);
            }
            throw error;
          }
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]);
        if (method === "GET") {
          const principal = await authOrThrow(req, ["knowledge:read"]);
          const item = await repo.get(id, principal.tid);
          return item ? json(item) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          const principal = await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const expectedVersion = parseExpectedVersion(req, body);
          const { expected_version: _ignored, ...patch } = body;
          try {
            const item = await repo.update(id, patch, {
              expectedVersion,
              actor: principalActor(principal)
            });
            return item ? json(item) : json({ error: "not_found" }, 404);
          } catch (error) {
            if (error instanceof VersionConflictError) {
              return json({ error: "version_conflict", expected: error.expected, current: error.current }, 409);
            }
            throw error;
          }
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["knowledge:write"]);
          const ok = await repo.delete(id);
          return ok ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      return json({ error: "not_found", path }, 404);
    } catch (error) {
      if (error instanceof KnowledgeProjectLinksError) {
        return knowledgeProjectLinksErrorResponse(error);
      }
      if (error instanceof HttpError) {
        const reason = error.status === 401 || error.status === 403 ? "unauthorized" : "error";
        return json({ error: reason, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "internal error";
      return json({ error: "internal", message }, 500);
    }
  };
}
function resolveKnowledgeGuardedAuthority(env = process.env) {
  const classification = env.HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION;
  const authorityId = env.HASNA_KNOWLEDGE_AUTHORITY_ID;
  if (!classification && !authorityId)
    return;
  if (!classification || !authorityId) {
    throw new Error("FCAME-1 guarded writes require both HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION " + "and HASNA_KNOWLEDGE_AUTHORITY_ID.");
  }
  const binding = {
    authority: {
      classification,
      authority_id: authorityId
    },
    tenant_id: "validation-only",
    scope: "validation-only",
    parent_id: "validation-only"
  };
  assertKnowledgeGuardedBinding(binding);
  return binding.authority;
}
async function startKnowledgeServe(options = {}) {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const version = resolveVersion();
  normalizePostgresDatabaseUrl(env);
  const client = createKnowledgeDatabaseClient();
  const store = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: KNOWLEDGE_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    keyStatus: store.keyStatus,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.warn(`[knowledge-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`);
      }
    }
  });
  const handler = createServeHandler({
    client,
    verifier,
    store,
    version,
    guardedAuthority: resolveKnowledgeGuardedAuthority(env)
  });
  const BunGlobal = globalThis.Bun;
  if (!BunGlobal?.serve) {
    throw new Error("knowledge-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (backend=postgresql, version=${version})`);
  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    }
  };
}

// src/serve-entry.ts
function handleEarlyArgs(argv) {
  if (argv.includes("--help"))
    return "help";
  if (argv.includes("--version"))
    return "version";
  return "start";
}
function getPackageVersion() {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync3(url, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function printHelp() {
  console.log(`usage: knowledge-serve [--port <n>]

knowledge-serve \u2014 self-hosted HTTP API for @hasna/knowledge.

options:
  --help                show this help and exit
  --version             print the package version and exit
  --port <n>            listen port (default: 8080, or $PORT / HASNA_KNOWLEDGE_SERVE_PORT)
`);
}
async function main(argv = process.argv.slice(2)) {
  const early = handleEarlyArgs(argv);
  if (early === "help") {
    printHelp();
    return;
  }
  if (early === "version") {
    console.log(getPackageVersion());
    return;
  }
  const running = await startKnowledgeServe();
  const shutdown = async (signal) => {
    console.log(`[knowledge-serve] received ${signal}, shutting down`);
    await running.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
if (import.meta.main) {
  main().catch((err) => {
    console.error("knowledge-serve fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
export {
  printHelp,
  main,
  handleEarlyArgs,
  getPackageVersion
};
