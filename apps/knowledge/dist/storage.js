// @bun
var __defProp = Object.defineProperty;
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
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// src/knowledge-db.ts
import { Database } from "bun:sqlite";

// src/workspace.ts
import { chmodSync, existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir as homedir2 } from "os";
import { dirname, join as join2, resolve as resolve2 } from "path";

// src/paths.ts
import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { homedir as pathsResolverHomedir } from "os";
import { join as pathsResolverJoin } from "path";
var PATHS_RESOLVER_KIND_ENV = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME"
};
var PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function pathsResolverAssertApp(app) {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(`paths: invalid app slug "${app}" \u2014 expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`);
  }
}
function pathsResolverAssertKind(kind) {
  if (!Object.keys(PATHS_RESOLVER_KIND_ENV).includes(kind)) {
    throw new TypeError(`paths: invalid path kind "${kind}" \u2014 expected one of ${Object.keys(PATHS_RESOLVER_KIND_ENV).join(", ")}`);
  }
}
function pathsResolverBaseDir(kind, options) {
  pathsResolverAssertKind(kind);
  const env = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0)
    return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    switch (kind) {
      case "config":
      case "data":
        return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
      case "cache":
        return pathsResolverJoin(home, "Library", "Caches", "Hasna");
      case "state":
        return pathsResolverJoin(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "config":
      return pathsResolverJoin(home, ".config", "hasna");
    case "data":
      return pathsResolverJoin(home, ".local", "share", "hasna");
    case "state":
      return pathsResolverJoin(home, ".local", "state", "hasna");
    case "cache":
      return pathsResolverJoin(home, ".cache", "hasna");
  }
}
function pathsResolverResolve(kind, options) {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
function dataDir(options) {
  return pathsResolverResolve("data", options);
}
var KNOWLEDGE_DATA_HOME_ENV = "HASNA_KNOWLEDGE_HOME";
function getHomeDir(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home)
    throw new Error("Could not resolve the user home directory");
  return home;
}
function getResolverDataHome(env = process.env) {
  return dataDir({ app: "knowledge", home: getHomeDir(env), env });
}
function getLegacyDataHome(env = process.env) {
  return join(getHomeDir(env), ".hasna", "knowledge");
}
function adoptResolverDataHome(resolved, env = process.env) {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0)
    return true;
  return existsSync(join(resolved, "knowledge.db")) || existsSync(join(resolved, "config.json"));
}
function getExactDataHome(env = process.env) {
  const dir = env[KNOWLEDGE_DATA_HOME_ENV]?.trim();
  if (dir)
    return resolve(dir);
  return;
}
function getDataHome(env = process.env) {
  const exact = getExactDataHome(env);
  if (exact)
    return exact;
  const resolved = getResolverDataHome(env);
  return adoptResolverDataHome(resolved, env) ? resolve(resolved) : getLegacyDataHome(env);
}

// src/workspace.ts
var HASNA_KNOWLEDGE_APP_PATH = join2(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join2(".hasna", "apps", "knowledge");
function projectKey(cwd = process.cwd()) {
  const slugified = resolve2(cwd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slugified || "project";
}
var EXAMPLE_KNOWLEDGE_CANONICAL = {
  division: "xyz",
  app_type: "opensource",
  app: "knowledge",
  env: "prod",
  local_path: HASNA_KNOWLEDGE_APP_PATH,
  s3: {
    bucket: "example-knowledge-prod",
    region: "us-east-1",
    profile: "example-infra",
    prefix: ".hasna/knowledge",
    server_side_encryption: "AES256"
  },
  secrets: {
    env: "example/knowledge/prod/env",
    aws: "example/knowledge/prod/aws",
    s3: "example/knowledge/prod/s3",
    rds: null,
    future_rds: "example/knowledge/prod/rds"
  },
  source_owner: "open-files",
  evidence_doc: "docs/canonical-secrets-bootstrap-2026-06-08.md"
};
function canonicalExampleKnowledgeStorage() {
  return {
    type: "s3",
    artifacts_root: "artifacts",
    s3: {
      bucket: EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket,
      prefix: EXAMPLE_KNOWLEDGE_CANONICAL.s3.prefix,
      region: EXAMPLE_KNOWLEDGE_CANONICAL.s3.region,
      profile: EXAMPLE_KNOWLEDGE_CANONICAL.s3.profile,
      server_side_encryption: EXAMPLE_KNOWLEDGE_CANONICAL.s3.server_side_encryption
    }
  };
}
function legacyGlobalStorePath() {
  return join2(homedir2(), ".open-knowledge", "db.json");
}
function globalKnowledgeHome() {
  return getDataHome();
}
function projectKnowledgeHome(cwd = process.cwd(), home = undefined) {
  const knowledgeRoot = home === undefined ? globalKnowledgeHome() : join2(home, ".hasna", "knowledge");
  return join2(knowledgeRoot, "projects", projectKey(cwd));
}
function previousProjectKnowledgeHome(cwd = process.cwd()) {
  return resolve2(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function legacyGlobalKnowledgeHome() {
  return join2(homedir2(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function legacyProjectKnowledgeHome(cwd = process.cwd()) {
  return resolve2(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function resolveLegacyScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(legacyProjectKnowledgeHome(cwd));
  }
  return workspaceForHome(legacyGlobalKnowledgeHome());
}
function workspaceForHome(home) {
  return {
    home,
    configPath: join2(home, "config.json"),
    jsonStorePath: join2(home, "db.json"),
    knowledgeDbPath: join2(home, "knowledge.db"),
    artifactsDir: join2(home, "artifacts"),
    cacheDir: join2(home, "cache"),
    exportsDir: join2(home, "exports"),
    indexesDir: join2(home, "indexes"),
    logsDir: join2(home, "logs"),
    runsDir: join2(home, "runs"),
    schemasDir: join2(home, "schemas"),
    wikiDir: join2(home, "wiki")
  };
}
function defaultKnowledgeConfig() {
  return {
    version: 1,
    storage: {
      type: "local",
      artifacts_root: "artifacts"
    },
    sources: {
      preferred_ref: "open-files",
      allowed_schemes: ["open-files", "s3", "file", "https", "http"]
    },
    providers: {
      default_model: "openai:gpt-5.2",
      aliases: {
        fast: "openai:gpt-5-mini",
        reasoning: "anthropic:claude-opus-4-6",
        sonnet: "anthropic:claude-sonnet-4-6",
        deepseek: "deepseek:deepseek-chat",
        "deepseek-reasoning": "deepseek:deepseek-reasoner"
      },
      openai: {
        api_key_env: "OPENAI_API_KEY",
        default_model: "gpt-5.2"
      },
      anthropic: {
        api_key_env: "ANTHROPIC_API_KEY",
        default_model: "claude-sonnet-4-6"
      },
      deepseek: {
        api_key_env: "DEEPSEEK_API_KEY",
        default_model: "deepseek-chat"
      }
    },
    embeddings: {
      default_model: "openai:text-embedding-3-small",
      dimensions: 1536,
      batch_size: 64,
      max_parallel_calls: 4
    },
    safety: {
      network: {
        web_search_enabled: false,
        s3_reads_enabled: false,
        allowed_s3_buckets: []
      },
      redaction: {
        enabled: true
      },
      approvals: {
        generated_writes_require_approval: true
      }
    }
  };
}
function ensureKnowledgeWorkspace(home) {
  const workspace = workspaceForHome(home);
  mkdirSync(workspace.home, { recursive: true, mode: 448 });
  for (const dir of [
    workspace.artifactsDir,
    workspace.cacheDir,
    workspace.exportsDir,
    workspace.indexesDir,
    workspace.logsDir,
    workspace.runsDir,
    workspace.schemasDir,
    workspace.wikiDir
  ]) {
    mkdirSync(dir, { recursive: true, mode: 448 });
  }
  if (!existsSync2(workspace.configPath)) {
    writeFileSync(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}
`, { mode: 384 });
    chmodSync(workspace.configPath, 384);
  }
  return workspace;
}
function resolveScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(projectKnowledgeHome(cwd));
  }
  return workspaceForHome(globalKnowledgeHome());
}
function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}
function readKnowledgeConfig(path) {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  const { mode: _retiredMode, hosted: _retiredHostedConfig, ...config } = parsed;
  return config;
}
function writeKnowledgeConfig(path, config) {
  ensureParentDir(path);
  const { mode: _retiredMode, hosted: _retiredHostedConfig, ...sanitized } = config;
  writeFileSync(path, `${JSON.stringify(sanitized, null, 2)}
`, { mode: 384 });
  chmodSync(path, 384);
}

// src/http-store.ts
import {
  createHasnaStorageClient
} from "@hasna/contracts/client/storage";
import {
  createHasnaHttpTransport,
  CREDENTIAL_PROFILE_ENV_KEY,
  credentialOverrideEnvKey
} from "@hasna/contracts/client";

// src/net-guard.ts
var NETWORK_GUARD_ENV = "NODE_ENV";

class KnowledgeNetworkGuardError extends Error {
  scheme;
  port;
  constructor(message, details) {
    super(message);
    this.name = "KnowledgeNetworkGuardError";
    this.scheme = details.scheme;
    this.port = details.port;
  }
}
function isNetworkGuardActive(env = process.env) {
  return (env[NETWORK_GUARD_ENV] ?? "").trim().toLowerCase() === "test";
}
function isIpv4Loopback(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4)
    return false;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255))
    return false;
  return parts[0] === "127";
}
function isLoopbackHostname(hostname) {
  const host = hostname.trim().toLowerCase();
  if (host.length === 0)
    return false;
  if (host === "localhost" || host.endsWith(".localhost"))
    return true;
  if (isIpv4Loopback(host))
    return true;
  if (!host.startsWith("[") || !host.endsWith("]"))
    return false;
  const v6 = host.slice(1, -1);
  if (v6 === "::1" || /^(0:){7}1$/.test(v6))
    return true;
  const tail = v6.split(":").pop() ?? "";
  if (/^(::ffff:|::)/.test(v6) && isIpv4Loopback(tail))
    return true;
  return /^::(ffff:)?7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(v6);
}
function targetUrl(input) {
  if (typeof input === "string")
    return input;
  if (input instanceof URL)
    return input.href;
  return input.url;
}
function assertOutboundRequestAllowed(input, env = process.env) {
  if (!isNetworkGuardActive(env))
    return;
  const raw = targetUrl(input);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new KnowledgeNetworkGuardError(`knowledge: refused an outbound request with an unparseable target while ${NETWORK_GUARD_ENV}=test. ` + "Under test, only loopback requests are permitted.", { scheme: "unknown", port: "" });
  }
  if (isLoopbackHostname(url.hostname))
    return;
  throw new KnowledgeNetworkGuardError(`knowledge: refused a non-loopback ${url.protocol.replace(":", "")} request while ${NETWORK_GUARD_ENV}=test ` + "(target host withheld on purpose). This process selected the HTTP API under test, which means a " + "read or write was about to leave the machine and reach the live store. Set " + "HASNA_KNOWLEDGE_LOCAL=1 to select the on-box store under test, or point HASNA_KNOWLEDGE_API_URL " + "at 127.0.0.1 for a hermetic test.", { scheme: url.protocol.replace(":", ""), port: url.port });
}
var REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
var MAX_GUARDED_REDIRECTS = 5;
function requestMethod(input, init) {
  if (init?.method)
    return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL))
    return input.method.toUpperCase();
  return "GET";
}
async function guardedFetch(input, init) {
  assertOutboundRequestAllowed(input);
  if (!isNetworkGuardActive() || init?.redirect !== undefined) {
    return fetch(input, init);
  }
  let from = targetUrl(input);
  let method = requestMethod(input, init);
  let body = init?.body;
  let response = await fetch(input, { ...init ?? {}, redirect: "manual" });
  for (let hop = 0;REDIRECT_STATUSES.has(response.status); hop++) {
    const location = response.headers.get("location");
    if (!location)
      return response;
    const next = new URL(location, from).href;
    assertOutboundRequestAllowed(next);
    if (hop >= MAX_GUARDED_REDIRECTS) {
      const url = new URL(next);
      throw new KnowledgeNetworkGuardError(`knowledge: refused to follow more than ${MAX_GUARDED_REDIRECTS} redirects while ${NETWORK_GUARD_ENV}=test ` + "(target host withheld on purpose). Under test the guard follows redirects itself so every hop is " + "checked, and a chain this long is a loop, not a route.", { scheme: url.protocol.replace(":", ""), port: url.port });
    }
    if (response.status === 303 || (response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
    }
    const hopInit = { ...init ?? {}, method, redirect: "manual" };
    if (body === undefined)
      delete hopInit.body;
    else
      hopInit.body = body;
    response = await fetch(next, hopInit);
    from = next;
  }
  return response;
}

// src/client-transport.ts
var KNOWLEDGE_APP_SLUG = "knowledge";
var KNOWLEDGE_API_URL_ENV = "HASNA_KNOWLEDGE_API_URL";
var KNOWLEDGE_API_KEY_ENV = "HASNA_KNOWLEDGE_API_KEY";
var KNOWLEDGE_DATABASE_URL_ENV = "HASNA_KNOWLEDGE_DATABASE_URL";
var KNOWLEDGE_LOCAL_ENV = "HASNA_KNOWLEDGE_LOCAL";
var KNOWLEDGE_API_URL_ENV_KEYS = [KNOWLEDGE_API_URL_ENV];
var KNOWLEDGE_API_KEY_ENV_KEYS = [KNOWLEDGE_API_KEY_ENV];
var RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS = [
  "HASNA_KNOWLEDGE_STORAGE_MODE",
  "HASNA_KNOWLEDGE_MODE",
  "KNOWLEDGE_STORAGE_MODE",
  "KNOWLEDGE_MODE"
];
function isPresent(env, key) {
  if (!Object.prototype.hasOwnProperty.call(env, key))
    return false;
  return (env[key] ?? "").trim().length > 0;
}
function firstDefined(env, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined)
      return key;
  }
  return null;
}

class RetiredKnowledgeStorageSelectorError extends Error {
  envKey;
  code = "retired_knowledge_storage_selector";
  constructor(envKey) {
    super(`knowledge: ${envKey} was retired and must be unset. ` + `Clients select the HTTP API when ${KNOWLEDGE_API_URL_ENV} and ${KNOWLEDGE_API_KEY_ENV} are set, ` + `or the on-box store under the explicit opt-in ${KNOWLEDGE_LOCAL_ENV}=1; ` + `with neither, they fail closed. ` + `Servers select PostgreSQL with ${KNOWLEDGE_DATABASE_URL_ENV}.`);
    this.envKey = envKey;
    this.name = "RetiredKnowledgeStorageSelectorError";
  }
}
function assertNoRetiredKnowledgeStorageSelector(env = process.env) {
  const retired = firstDefined(env, RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS);
  if (retired)
    throw new RetiredKnowledgeStorageSelectorError(retired);
}
function resolveKnowledgeClientTransport(env = process.env) {
  assertNoRetiredKnowledgeStorageSelector(env);
  const apiUrlPresent = isPresent(env, KNOWLEDGE_API_URL_ENV);
  const apiKeyPresent = isPresent(env, KNOWLEDGE_API_KEY_ENV);
  const localOptInPresent = isPresent(env, KNOWLEDGE_LOCAL_ENV);
  if (apiUrlPresent && !apiKeyPresent) {
    throw new Error(`knowledge: ${KNOWLEDGE_API_URL_ENV} selects the HTTP API, but ${KNOWLEDGE_API_KEY_ENV} is missing. ` + `Set ${KNOWLEDGE_API_KEY_ENV}, or unset ${KNOWLEDGE_API_URL_ENV} and set ${KNOWLEDGE_LOCAL_ENV}=1 ` + `to explicitly use the on-box store.`);
  }
  if (!apiUrlPresent && !localOptInPresent) {
    throw new Error(`knowledge: no hosted API configuration and no explicit on-box choice. ` + `Set ${KNOWLEDGE_API_URL_ENV} and ${KNOWLEDGE_API_KEY_ENV} to use the server API, ` + `or set ${KNOWLEDGE_LOCAL_ENV}=1 to explicitly use the on-box store. ` + `Refusing to serve the on-box store without an explicit choice.`);
  }
  return {
    transport: apiUrlPresent ? "http" : "sqlite",
    source: apiUrlPresent ? KNOWLEDGE_API_URL_ENV : KNOWLEDGE_LOCAL_ENV,
    api_url_present: apiUrlPresent,
    api_key_present: apiKeyPresent,
    local_opt_in_present: localOptInPresent,
    network_guard_active: isNetworkGuardActive(env)
  };
}

// src/query-contract.ts
var KNOWLEDGE_BOUNDED_QUERY_CAPABILITY = "hasna.knowledge.bounded-query.v1";
function hasKnowledgeBoundedQueryCapability(value) {
  return Boolean(value && typeof value === "object" && value.query_capability === KNOWLEDGE_BOUNDED_QUERY_CAPABILITY);
}

// src/http-store.ts
function transportOverrides(env) {
  return {
    fetchImpl: guardedFetch,
    ...isNetworkGuardActive(env) ? { retry: false } : {}
  };
}
var KNOWLEDGE_RESOURCE = "notes";

class KnowledgeVersionConflictError extends Error {
  expected;
  current;
  code = "version_conflict";
  constructor(expected, current) {
    super(`version_conflict: this edit was written against version ${expected} but the stored entry is now at version ${current}. ` + "Nothing was written. Re-read the entry and re-apply only if the fields you are changing are untouched between the two versions.");
    this.expected = expected;
    this.current = current;
    this.name = "KnowledgeVersionConflictError";
  }
}

class KnowledgeBoundedQueryCapabilityError extends Error {
  operation;
  fields;
  code = "bounded_query_capability_required";
  constructor(operation, fields) {
    super(`bounded_query_capability_required: the Knowledge server did not prove support for ${operation} field(s): ` + `${fields.join(", ")}. Refusing to accept a possibly unfiltered response; update the server and retry.`);
    this.operation = operation;
    this.fields = fields;
    this.name = "KnowledgeBoundedQueryCapabilityError";
  }
}
function toQuery(options) {
  const q = {};
  if (options.search) {
    q.filter = options.search;
    q.search = options.search;
  }
  if (options.tags?.length)
    q.tags = options.tags;
  if (options.archive) {
    q.archive = options.archive;
    if (options.archive === "all")
      q.includeArchived = true;
  }
  if (options.sort)
    q.sort = options.sort;
  if (options.direction)
    q.direction = options.direction;
  if (options.limit !== undefined)
    q.limit = options.limit;
  if (options.offset !== undefined)
    q.offset = options.offset;
  return q;
}
function listFieldsRequiringCapability(options) {
  const fields = [];
  if (options.tags?.length)
    fields.push("tags");
  if (options.sort !== undefined)
    fields.push("sort");
  if (options.direction !== undefined)
    fields.push("direction");
  if (options.archive === "archived")
    fields.push("archive=archived");
  return fields;
}
function boundedQueryInteger(value, fallback, field, minimum, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}
function wrap(client) {
  return {
    baseUrl: client.baseUrl,
    async list(options = {}) {
      const limit = boundedQueryInteger(options.limit, 200, "limit", 1, 200);
      const offset = boundedQueryInteger(options.offset, 0, "offset", 0, 1e4);
      const query = toQuery({ ...options, limit, offset });
      const res = await client.list(KNOWLEDGE_RESOURCE, { query });
      if (!Number.isInteger(res.total) || Number(res.total) < 0) {
        throw new Error("knowledge HTTP list response is missing a valid producer total.");
      }
      const requiredFields = listFieldsRequiringCapability(options);
      if (requiredFields.length > 0 && !hasKnowledgeBoundedQueryCapability(res.raw)) {
        throw new KnowledgeBoundedQueryCapabilityError("list", requiredFields);
      }
      return { items: res.items, total: Number(res.total) };
    },
    async search(options) {
      const limit = boundedQueryInteger(options.limit, 20, "limit", 1, 200);
      const offset = boundedQueryInteger(options.offset, 0, "offset", 0, 1e4);
      const response = await client.transport.get(`/${KNOWLEDGE_RESOURCE}/search`, {
        query: {
          q: options.query,
          archive: options.archive ?? "active",
          limit,
          offset
        }
      });
      if (!Number.isInteger(response.total) || response.total < 0 || !Array.isArray(response.items) || response.items.some((hit) => !hit || typeof hit !== "object" || !hit.item || typeof hit.rank !== "number" || !Number.isFinite(hit.rank))) {
        throw new Error("knowledge HTTP search response is missing producer rank or total evidence.");
      }
      if (!hasKnowledgeBoundedQueryCapability(response)) {
        throw new KnowledgeBoundedQueryCapabilityError("search", ["q", "rank", "total"]);
      }
      return { items: response.items, total: response.total };
    },
    async get(idOrShort) {
      return client.get(KNOWLEDGE_RESOURCE, idOrShort);
    },
    async create(input) {
      return client.create(KNOWLEDGE_RESOURCE, {
        ...input.id ? { id: input.id } : {},
        title: input.title,
        content: input.content,
        url: input.url ?? null,
        tags: input.tags ?? [],
        ...input.metadata ? { metadata: input.metadata } : {}
      });
    },
    async update(idOrShort, patch, options = {}) {
      try {
        return await client.update(KNOWLEDGE_RESOURCE, idOrShort, patch, {
          ...options.expectedVersion !== undefined ? { headers: { "if-match": String(options.expectedVersion) } } : {}
        });
      } catch (error) {
        if (isNotFound(error))
          return null;
        const conflict = asVersionConflict(error);
        if (conflict)
          throw conflict;
        throw error;
      }
    },
    async delete(idOrShort) {
      const existing = await client.get(KNOWLEDGE_RESOURCE, idOrShort);
      if (!existing)
        return false;
      await client.delete(KNOWLEDGE_RESOURCE, existing.id);
      return true;
    },
    async listVersions(idOrShort, options = {}) {
      try {
        return await client.transport.get(`/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions`, { query: { limit: options.limit, offset: options.offset } });
      } catch (error) {
        if (isNotFound(error))
          return null;
        throw error;
      }
    },
    async getVersion(idOrShort, version) {
      try {
        return await client.transport.get(`/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions/${version}`);
      } catch (error) {
        if (isNotFound(error))
          return null;
        throw error;
      }
    },
    async purgeVersions(idOrShort, options = {}) {
      try {
        const path = options.version === undefined ? `/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions` : `/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions/${options.version}`;
        return await client.transport.request("DELETE", path);
      } catch (error) {
        if (isNotFound(error))
          return null;
        throw error;
      }
    }
  };
}
function asVersionConflict(error) {
  if (!error || typeof error !== "object")
    return null;
  if (error.status !== 409)
    return null;
  const body = error.body;
  const parsed = typeof body === "string" ? safeJson(body) : body;
  const shape = parsed ?? {};
  if (shape.error !== "version_conflict")
    return null;
  return new KnowledgeVersionConflictError(Number(shape.expected ?? 0), Number(shape.current ?? 0));
}
function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function isNotFound(error) {
  return Boolean(error && typeof error === "object" && error.status === 404);
}
function resolveKnowledgeHttpStore(env = process.env) {
  const client = resolveKnowledgeHttpClient(env);
  return client ? wrap(client) : null;
}
function resolveKnowledgeGuardedTransport(env = process.env) {
  return resolveKnowledgeHttpClient(env, { guarded: true })?.transport ?? null;
}
function guardedTransportEnv(env) {
  const guardedEnv = { ...env };
  delete guardedEnv.HOME;
  delete guardedEnv.USERPROFILE;
  delete guardedEnv[CREDENTIAL_PROFILE_ENV_KEY];
  delete guardedEnv[credentialOverrideEnvKey(KNOWLEDGE_APP_SLUG)];
  return guardedEnv;
}
function resolveKnowledgeHttpClient(env, options = {}) {
  if (resolveKnowledgeClientTransport(env).transport !== "http")
    return null;
  const transportEnv = options.guarded ? guardedTransportEnv(env) : env;
  const apiUrl = transportEnv[KNOWLEDGE_API_URL_ENV]?.trim();
  const apiKey = transportEnv[KNOWLEDGE_API_KEY_ENV]?.trim();
  if (!apiUrl || !apiKey) {
    throw new Error("knowledge HTTP transport configuration changed during resolution");
  }
  return createHasnaStorageClient(KNOWLEDGE_APP_SLUG, createHasnaHttpTransport({
    name: KNOWLEDGE_APP_SLUG,
    baseUrl: apiUrl,
    apiKey,
    ...transportOverrides(transportEnv)
  }));
}
function usesKnowledgeHttpTransport(env = process.env) {
  return resolveKnowledgeClientTransport(env).transport === "http";
}
async function fetchAllHttpItems(store) {
  const pageSize = 200;
  const all = [];
  for (let offset = 0;; offset += pageSize) {
    const { items } = await store.list({ archive: "all", limit: pageSize, offset });
    all.push(...items);
    if (items.length < pageSize)
      break;
    if (offset > 1e5)
      break;
  }
  return all;
}

// src/knowledge-db.ts
function assertSqliteClientTransport(operation = "catalog") {
  if (usesKnowledgeHttpTransport()) {
    throw new Error(`knowledge: ${operation} builds/reads the on-box sqlite RAG catalog (source ingestion, chunk embeddings, ` + `wiki compilation, cross-machine sync, machine registry). That local indexing pipeline is not available in ` + `the HTTP client. Shared item commands route through the server API. Unset ${KNOWLEDGE_API_URL_ENV} ` + `to use the full on-box catalog pipeline; run 'knowledge transport' to inspect the current route.`);
  }
}
var CURRENT_SCHEMA_VERSION = 10;
var CHUNKS_FTS_TOKENIZE = "porter unicode61 remove_diacritics 2";
var MIGRATION_1 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  acl_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_revisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  hash TEXT,
  extracted_text_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_id, revision)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  wiki_page_id TEXT,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artifact_uri TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_backlinks (
  from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_page_id, to_page_id)
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  source_uri TEXT NOT NULL,
  quote TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_indexes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  artifact_uri TEXT,
  shard_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, name, shard_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redaction_findings (
  id TEXT PRIMARY KEY,
  source_uri TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT PRIMARY KEY,
  artifact_uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content_type TEXT,
  hash TEXT,
  size_bytes INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  title,
  source_uri,
  content='',
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (1, datetime('now'));
`;
var MIGRATION_2 = `
DROP TABLE IF EXISTS chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (2, datetime('now'));
`;
var MIGRATION_3 = `
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uri TEXT,
  decision TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_uri TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  approved_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action);
CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (3, datetime('now'));
`;
var MIGRATION_4 = `
CREATE TABLE IF NOT EXISTS vector_index_entries (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  vector_norm REAL NOT NULL,
  source_uri TEXT,
  source_ref TEXT,
  revision TEXT,
  hash TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  token_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri);
CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (4, datetime('now'));
`;
var MIGRATION_5 = `
CREATE TABLE IF NOT EXISTS reindex_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_uri TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, target_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_reindex_queue_status ON reindex_queue(status);
CREATE INDEX IF NOT EXISTS idx_reindex_queue_kind_target ON reindex_queue(kind, target_id);
CREATE INDEX IF NOT EXISTS idx_reindex_queue_source_uri ON reindex_queue(source_uri);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (5, datetime('now'));
`;
var MIGRATION_6 = `
CREATE TABLE IF NOT EXISTS knowledge_machines (
  machine_id TEXT PRIMARY KEY,
  hostname TEXT,
  platform TEXT,
  user_label TEXT,
  workspace_home TEXT,
  tailscale_dns TEXT,
  tailscale_ips_json TEXT NOT NULL DEFAULT '[]',
  ssh_target TEXT,
  last_seen_at TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_snapshots (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  workspace_home TEXT NOT NULL,
  sqlite_schema_version INTEGER NOT NULL,
  artifact_root_uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tables_json TEXT NOT NULL,
  artifact_hashes_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_changes (
  id TEXT PRIMARY KEY,
  origin_machine_id TEXT NOT NULL,
  updated_by_machine_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_hash TEXT,
  next_hash TEXT,
  source_ref TEXT,
  source_revision_id TEXT,
  artifact_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_machine_id TEXT NOT NULL,
  remote_machine_id TEXT NOT NULL,
  local_hash TEXT,
  remote_hash TEXT,
  base_hash TEXT,
  status TEXT NOT NULL,
  resolution_strategy TEXT,
  proposed_patch_uri TEXT,
  approved_by TEXT,
  resolved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_machines_last_seen ON knowledge_machines(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_machine_created ON knowledge_sync_snapshots(machine_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_hash ON knowledge_sync_snapshots(content_hash);
CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON knowledge_sync_changes(entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_origin ON knowledge_sync_changes(origin_machine_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON knowledge_sync_changes(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (6, datetime('now'));
`;
var MIGRATION_7_TABLES_AND_INDEXES = `
CREATE TABLE IF NOT EXISTS knowledge_sync_table_clocks (
  table_name TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  logical_clock INTEGER NOT NULL DEFAULT 0,
  high_water_hash TEXT,
  high_water_bundle_id TEXT,
  origin_machine_id TEXT,
  updated_by_machine_id TEXT,
  last_applied_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(table_name, machine_id)
);

CREATE TABLE IF NOT EXISTS knowledge_sync_imports (
  bundle_id TEXT PRIMARY KEY,
  source_machine_id TEXT NOT NULL,
  target_machine_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  table_clocks_json TEXT NOT NULL,
  tables_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_bundle ON knowledge_sync_changes(bundle_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_clock ON knowledge_sync_changes(entity_kind, logical_clock);
CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_machine ON knowledge_sync_table_clocks(machine_id);
CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_updated ON knowledge_sync_table_clocks(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_source ON knowledge_sync_imports(source_machine_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_target ON knowledge_sync_imports(target_machine_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_status ON knowledge_sync_imports(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (7, datetime('now'));
`;
var MIGRATION_8_TABLES_AND_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_wiki_pages_lifecycle_status ON wiki_pages(status, valid_to);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_last_verified ON wiki_pages(last_verified_at);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_supersedes ON wiki_pages(supersedes);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_superseded_by ON wiki_pages(superseded_by);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (8, datetime('now'));
`;
var MIGRATION_9_REBUILD_FTS = `
BEGIN;

CREATE TEMP TABLE _chunks_fts_backup AS
  SELECT chunk_id, text, title, source_uri FROM chunks_fts;

DROP TABLE chunks_fts;

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='${CHUNKS_FTS_TOKENIZE}'
);

INSERT INTO chunks_fts (chunk_id, text, title, source_uri)
  SELECT chunk_id, text, title, source_uri FROM _chunks_fts_backup;

DROP TABLE _chunks_fts_backup;

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (9, datetime('now'));

COMMIT;
`;
var MIGRATION_10_PROMOTION_INBOX = `
CREATE TABLE IF NOT EXISTS knowledge_promotion_candidates (
  id TEXT PRIMARY KEY,
  record_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  requires_approval INTEGER NOT NULL DEFAULT 0,
  checks_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  duplicate_of TEXT,
  approved_by TEXT,
  promoted_record_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  promoted_at TEXT
);

CREATE TABLE IF NOT EXISTS durable_knowledge_records (
  id TEXT PRIMARY KEY,
  record_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  promoted_from_candidate_id TEXT NOT NULL UNIQUE
    REFERENCES knowledge_promotion_candidates(id) ON DELETE RESTRICT,
  approved_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotion_candidates_status
  ON knowledge_promotion_candidates(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_promotion_candidates_kind_key
  ON knowledge_promotion_candidates(record_kind, canonical_key);
CREATE INDEX IF NOT EXISTS idx_promotion_candidates_hash
  ON knowledge_promotion_candidates(record_kind, content_hash);
CREATE INDEX IF NOT EXISTS idx_durable_records_kind_key
  ON durable_knowledge_records(record_kind, canonical_key, status);
CREATE INDEX IF NOT EXISTS idx_durable_records_hash
  ON durable_knowledge_records(record_kind, content_hash, status);
CREATE INDEX IF NOT EXISTS idx_durable_records_validity
  ON durable_knowledge_records(status, valid_to);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (10, datetime('now'));
`;
function openKnowledgeDb(path) {
  assertSqliteClientTransport("opening the local knowledge.db catalog");
  ensureParentDir(path);
  const db = new Database(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}
function openKnowledgeDbReadonly(path) {
  assertSqliteClientTransport("reading the local knowledge.db catalog");
  return new Database(path, { readonly: true });
}
function migrateKnowledgeDb(path) {
  const db = openKnowledgeDb(path);
  try {
    db.exec(MIGRATION_1);
    if (getSchemaVersion(db) < 2)
      db.exec(MIGRATION_2);
    if (getSchemaVersion(db) < 3)
      db.exec(MIGRATION_3);
    if (getSchemaVersion(db) < 4)
      db.exec(MIGRATION_4);
    if (getSchemaVersion(db) < 5)
      db.exec(MIGRATION_5);
    if (getSchemaVersion(db) < 6)
      db.exec(MIGRATION_6);
    if (needsMigration7(db))
      applyMigration7(db);
    if (needsMigration8(db))
      applyMigration8(db);
    if (needsMigration9(db))
      applyMigration9(db);
    if (needsMigration10(db))
      applyMigration10(db);
    return { path, schema_version: getSchemaVersion(db) };
  } finally {
    db.close();
  }
}
function getSchemaVersion(db) {
  const row = db.query("SELECT MAX(version) AS version FROM schema_versions").get();
  return row?.version ?? 0;
}
function count(db, table) {
  const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}
function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
function tableExists(db, table) {
  const row = db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?").get(table);
  return Boolean(row);
}
function columnExists(db, table, column) {
  if (!tableExists(db, table))
    return false;
  const columns = db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  return columns.some((row) => row.name === column);
}
function ensureColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition};`);
  }
}
function needsMigration7(db) {
  return getSchemaVersion(db) < 7 || !columnExists(db, "knowledge_sync_changes", "logical_clock") || !columnExists(db, "knowledge_sync_changes", "bundle_id") || !tableExists(db, "knowledge_sync_table_clocks") || !tableExists(db, "knowledge_sync_imports");
}
function applyMigration7(db) {
  if (!tableExists(db, "knowledge_sync_changes"))
    db.exec(MIGRATION_6);
  ensureColumn(db, "knowledge_sync_changes", "logical_clock", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "knowledge_sync_changes", "bundle_id", "TEXT");
  db.exec(MIGRATION_7_TABLES_AND_INDEXES);
}
function needsMigration8(db) {
  return getSchemaVersion(db) < 8 || !columnExists(db, "wiki_pages", "valid_from") || !columnExists(db, "wiki_pages", "valid_to") || !columnExists(db, "wiki_pages", "supersedes") || !columnExists(db, "wiki_pages", "superseded_by") || !columnExists(db, "wiki_pages", "confidence") || !columnExists(db, "wiki_pages", "last_verified_at");
}
function applyMigration8(db) {
  if (!tableExists(db, "wiki_pages"))
    db.exec(MIGRATION_1);
  ensureColumn(db, "wiki_pages", "valid_from", "TEXT");
  ensureColumn(db, "wiki_pages", "valid_to", "TEXT");
  ensureColumn(db, "wiki_pages", "supersedes", "TEXT");
  ensureColumn(db, "wiki_pages", "superseded_by", "TEXT");
  ensureColumn(db, "wiki_pages", "confidence", "REAL");
  ensureColumn(db, "wiki_pages", "last_verified_at", "TEXT");
  db.exec(`
    UPDATE wiki_pages
    SET valid_from = COALESCE(valid_from, created_at),
        last_verified_at = COALESCE(last_verified_at, updated_at),
        confidence = COALESCE(confidence, 0.8)
    WHERE valid_from IS NULL OR last_verified_at IS NULL OR confidence IS NULL;
  `);
  db.exec(MIGRATION_8_TABLES_AND_INDEXES);
}
function ftsUsesDiacriticFolding(db) {
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get("chunks_fts");
  return Boolean(row?.sql && row.sql.includes("remove_diacritics"));
}
function needsMigration9(db) {
  if (!tableExists(db, "chunks_fts"))
    return false;
  return getSchemaVersion(db) < 9 || !ftsUsesDiacriticFolding(db);
}
function applyMigration9(db) {
  if (!tableExists(db, "chunks_fts"))
    return;
  if (ftsUsesDiacriticFolding(db)) {
    db.exec("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (9, datetime('now'));");
    return;
  }
  db.exec(MIGRATION_9_REBUILD_FTS);
}
function needsMigration10(db) {
  return getSchemaVersion(db) < 10 || !tableExists(db, "knowledge_promotion_candidates") || !tableExists(db, "durable_knowledge_records");
}
function applyMigration10(db) {
  db.exec(MIGRATION_10_PROMOTION_INBOX);
}
function getKnowledgeDbStats(path) {
  const db = openKnowledgeDb(path);
  try {
    return {
      schema_version: getSchemaVersion(db),
      sources: count(db, "sources"),
      source_revisions: count(db, "source_revisions"),
      chunks: count(db, "chunks"),
      wiki_pages: count(db, "wiki_pages"),
      citations: count(db, "citations"),
      indexes: count(db, "knowledge_indexes"),
      runs: count(db, "runs"),
      run_events: count(db, "run_events"),
      redaction_findings: count(db, "redaction_findings"),
      audit_events: count(db, "audit_events"),
      approval_gates: count(db, "approval_gates"),
      storage_objects: count(db, "storage_objects"),
      embeddings: count(db, "chunk_embeddings"),
      vector_entries: count(db, "vector_index_entries"),
      reindex_queue: count(db, "reindex_queue"),
      knowledge_machines: count(db, "knowledge_machines"),
      sync_snapshots: count(db, "knowledge_sync_snapshots"),
      sync_changes: count(db, "knowledge_sync_changes"),
      sync_conflicts: count(db, "knowledge_sync_conflicts"),
      sync_table_clocks: count(db, "knowledge_sync_table_clocks"),
      sync_imports: count(db, "knowledge_sync_imports"),
      promotion_candidates: count(db, "knowledge_promotion_candidates"),
      durable_records: count(db, "durable_knowledge_records")
    };
  } finally {
    db.close();
  }
}

// src/db/storage-sync.ts
var STORAGE_TABLES = [
  "sources",
  "wiki_pages",
  "source_revisions",
  "chunks",
  "chunk_embeddings",
  "wiki_backlinks",
  "citations",
  "knowledge_indexes",
  "runs",
  "run_events",
  "provider_usage",
  "redaction_findings",
  "storage_objects",
  "audit_events",
  "approval_gates",
  "vector_index_entries",
  "reindex_queue",
  "knowledge_machines",
  "knowledge_sync_snapshots",
  "knowledge_sync_changes",
  "knowledge_sync_conflicts",
  "knowledge_sync_table_clocks",
  "knowledge_sync_imports"
];
var KNOWLEDGE_STORAGE_TABLES = STORAGE_TABLES;
function openScopedDb(options = {}) {
  const workspace = ensureKnowledgeWorkspace(resolveScopedWorkspace(options.scope, options.cwd).home);
  migrateKnowledgeDb(workspace.knowledgeDbPath);
  return {
    db: openKnowledgeDb(workspace.knowledgeDbPath),
    path: workspace.knowledgeDbPath,
    scope: options.scope ?? "global"
  };
}
function getSyncMetaAll(options = {}) {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    return local.db.query("SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction").all();
  } finally {
    local.db.close();
  }
}
function getStorageStatus(options = {}) {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    const sync = local.db.query("SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction").all();
    return {
      backend: "sqlite",
      service: "knowledge",
      scope: local.scope,
      databasePath: local.path,
      tables: STORAGE_TABLES,
      sync
    };
  } finally {
    local.db.close();
  }
}
function resolveTables(tables) {
  if (!tables || tables.length === 0)
    return [...STORAGE_TABLES];
  const allowed = new Set(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0)
    throw new Error(`Unknown knowledge sync table(s): ${invalid.join(", ")}`);
  return requested;
}
function parseStorageTables(value) {
  if (!value)
    return;
  return resolveTables(Array.isArray(value) ? value : value.split(","));
}
function ensureSyncMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _knowledge_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}
export {
  resolveTables,
  parseStorageTables,
  getSyncMetaAll,
  getStorageStatus,
  STORAGE_TABLES,
  KNOWLEDGE_STORAGE_TABLES
};
