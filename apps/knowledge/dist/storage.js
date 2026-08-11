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
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");
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
  return join(homedir(), ".open-knowledge", "db.json");
}
function globalKnowledgeHome() {
  return join(homedir(), ".hasna", "knowledge");
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function legacyGlobalKnowledgeHome() {
  return join(homedir(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function legacyProjectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
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
    configPath: join(home, "config.json"),
    jsonStorePath: join(home, "db.json"),
    knowledgeDbPath: join(home, "knowledge.db"),
    artifactsDir: join(home, "artifacts"),
    cacheDir: join(home, "cache"),
    exportsDir: join(home, "exports"),
    indexesDir: join(home, "indexes"),
    logsDir: join(home, "logs"),
    runsDir: join(home, "runs"),
    schemasDir: join(home, "schemas"),
    wikiDir: join(home, "wiki")
  };
}
function defaultKnowledgeConfig() {
  return {
    version: 1,
    mode: "local",
    hosted: {
      api_url: "https://knowledge.md"
    },
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
  if (!existsSync(workspace.configPath)) {
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
  return JSON.parse(raw);
}
function writeKnowledgeConfig(path, config) {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}
`, { mode: 384 });
  chmodSync(path, 384);
}

// node_modules/@hasna/contracts/dist/client/storage.js
import { isIP } from "net";
import { readFileSync as readFileSync2, statSync } from "fs";
import { join as join2 } from "path";
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function normalizeStorageMode(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "sqlite")
    return { mode: "sqlite" };
  if (normalized === "postgres" || normalized === "postgresql")
    return { mode: "postgres" };
  throw new Error(`Unknown storage mode '${value}'. The runtime-placement axis was removed; ` + `set sqlite for the on-box SQLite file or postgres for a PostgreSQL server (DATABASE_URL).`);
}
function clientTransportEnvKeys(name) {
  const envSegment = envToken(name);
  return {
    modeKeys: [
      `HASNA_${envSegment}_STORAGE_MODE`,
      `HASNA_${envSegment}_MODE`,
      `${envSegment}_STORAGE_MODE`,
      `${envSegment}_MODE`
    ],
    apiUrlKeys: [`HASNA_${envSegment}_API_URL`, `${envSegment}_API_URL`],
    apiKeyKeys: [`HASNA_${envSegment}_API_KEY`, `${envSegment}_API_KEY`]
  };
}
function credentialOverrideEnvKey(name) {
  return `HASNA_${envToken(name)}_API_KEY_OVERRIDE`;
}
var CREDENTIAL_PROFILE_ENV_KEY = "HASNA_PROFILE";

class CredentialResolutionError extends Error {
  appName;
  attempted;
  constructor(appName, message, attempted) {
    super(message);
    this.name = "CredentialResolutionError";
    this.appName = appName;
    this.attempted = attempted;
  }
}
var HASNA_STATE_DIR = ".hasna";
var FLEET_CREDENTIAL_DIR = "cloud";
var CONFIG_DIR = ".config";
var CONFIG_NAMESPACE = "hasna";
var MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
var SAFE_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
var SAFE_PROFILE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
var ILLEGAL_IN_HEADER_VALUE = /[^\t\x20-\x7e]/;
function homeDir(env) {
  const home = env.HOME?.trim();
  return home ? home : null;
}
function credentialDiskSources(name, env) {
  return profileDiskSources(name, env, null);
}
function profileDiskSources(name, env, profile) {
  const home = homeDir(env);
  if (!home || !SAFE_APP_SLUG.test(name))
    return [];
  const stem = profile ? `${name}.${profile}` : name;
  const configStem = profile ? `${name}-${profile}` : name;
  return [
    join2(home, HASNA_STATE_DIR, FLEET_CREDENTIAL_DIR, `${stem}.env`),
    join2(home, CONFIG_DIR, CONFIG_NAMESPACE, `${configStem}-cloud.env`)
  ];
}
function parseEnvFile(text) {
  const values = new Map;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#"))
      continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0)
      continue;
    const key = withoutExport.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      continue;
    let value = withoutExport.slice(equals + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length < 2 || !value.endsWith(quote))
        continue;
      value = value.slice(1, -1);
    }
    if (value.length === 0)
      continue;
    values.set(key, value);
  }
  return values;
}
function readCredentialFile(path, apiKeyKeys) {
  let text;
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_CREDENTIAL_FILE_BYTES)
      return null;
    text = readFileSync2(path, "utf8");
  } catch {
    return null;
  }
  const values = parseEnvFile(text);
  for (const key of apiKeyKeys) {
    const value = values.get(key)?.trim();
    if (value)
      return value;
  }
  return null;
}
function assertUsableCredential(appName, source, value) {
  if (!ILLEGAL_IN_HEADER_VALUE.test(value))
    return;
  throw new CredentialResolutionError(appName, `The credential from ${source} contains characters that cannot be sent in an HTTP header ` + `(a control character or non-ASCII byte). A file written with CR-only line endings is the usual ` + `cause. Rewrite that credential file with one LF-terminated KEY=value line. ` + `The value is not shown here, and is deliberately never logged.`, [source]);
}
var INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
function sealCredential(fields) {
  const { apiKey, ...visible } = fields;
  const sealed = { ...visible };
  Object.defineProperty(sealed, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false
  });
  Object.defineProperty(sealed, INSPECT_CUSTOM, {
    value: () => ({ ...visible, apiKey: "[redacted]" }),
    enumerable: false,
    writable: false,
    configurable: false
  });
  return sealed;
}
function explicitCredential(appName, apiKey) {
  const source = "explicit apiKey option";
  assertUsableCredential(appName, source, apiKey);
  return sealCredential({
    apiKey,
    tier: "argument",
    source,
    deliberate: true,
    deprecated: false,
    diskCandidates: [],
    warning: null
  });
}
function firstEnvValue(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
var DEPRECATION_REGISTRY = Symbol.for("hasna:contracts:credentialDeprecationNotices");
function deprecationNotified() {
  const host = globalThis;
  const existing = host[DEPRECATION_REGISTRY];
  if (existing instanceof Set)
    return existing;
  const created = new Set;
  host[DEPRECATION_REGISTRY] = created;
  return created;
}
function defaultDeprecationSink(message) {
  if (typeof process !== "undefined" && process.stderr) {
    process.stderr.write(`${message}
`);
  }
}
function resolveCredential(name, env, options = {}) {
  const { apiKeyKeys } = clientTransportEnvKeys(name);
  const diskPaths = credentialDiskSources(name, env);
  const explicitKey = options.apiKey?.trim();
  if (explicitKey) {
    assertUsableCredential(name, "the explicit apiKey argument", explicitKey);
    return sealCredential({
      apiKey: explicitKey,
      tier: "argument",
      source: "explicit apiKey argument",
      deliberate: true,
      deprecated: false,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  const overrideKeyName = credentialOverrideEnvKey(name);
  const overrideRaw = env[overrideKeyName];
  if (overrideRaw !== undefined) {
    const override = overrideRaw.trim();
    if (!override) {
      throw new CredentialResolutionError(name, `${overrideKeyName} is set but empty. It is a deliberate override, so it is not resolved around: ` + `either give it a real key or unset it to fall back to the credential on disk.`, [overrideKeyName]);
    }
    assertUsableCredential(name, overrideKeyName, override);
    return sealCredential({
      apiKey: override,
      tier: "override",
      source: overrideKeyName,
      deliberate: true,
      deprecated: false,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  const profile = options.profile?.trim() || env[CREDENTIAL_PROFILE_ENV_KEY]?.trim();
  if (profile) {
    const profileSource = options.profile?.trim() ? "explicit profile argument" : CREDENTIAL_PROFILE_ENV_KEY;
    if (!SAFE_PROFILE.test(profile)) {
      throw new CredentialResolutionError(name, `Profile name from ${profileSource} is not usable in a path. ` + `Use letters, digits, dot, dash, or underscore.`, [profileSource]);
    }
    const paths = profileDiskSources(name, env, profile);
    for (const path of paths) {
      const value = readCredentialFile(path, apiKeyKeys);
      if (value) {
        assertUsableCredential(name, path, value);
        return sealCredential({
          apiKey: value,
          tier: "profile",
          source: path,
          deliberate: true,
          deprecated: false,
          diskCandidates: paths,
          warning: null
        });
      }
    }
    throw new CredentialResolutionError(name, `Profile '${profile}' (from ${profileSource}) has no ${apiKeyKeys[0]} for '${name}'. ` + `Looked in: ${paths.join(", ") || "<no HOME in this environment>"}. ` + `A profile names WHICH identity to use, so it is never resolved around \u2014 ` + `create the profile's credential file or unset ${CREDENTIAL_PROFILE_ENV_KEY}.`, paths);
  }
  const diskHits = diskPaths.map((path) => ({ path, value: readCredentialFile(path, apiKeyKeys) })).filter((hit) => hit.value !== null);
  if (diskHits.length > 0) {
    const winner = diskHits[0];
    assertUsableCredential(name, winner.path, winner.value);
    const divergentSources = [
      ...diskHits.slice(1).filter((hit) => hit.value !== winner.value).map((hit) => hit.path),
      ...(() => {
        const legacyHit = firstEnvValue(env, apiKeyKeys);
        return legacyHit && legacyHit.value !== winner.value ? [legacyHit.key] : [];
      })()
    ];
    const warning = divergentSources.length > 0 ? `Credential sources disagree for '${name}': ${winner.path} and ` + `${divergentSources.join(", ")} hold different keys. ${winner.path} wins, because a file on ` + `disk is re-read on every call while an environment variable is a snapshot. Reconcile them \u2014 ` + `a rotation that updated only one leaves the other to fail 401 wherever it is loaded first.` : null;
    return sealCredential({
      apiKey: winner.value,
      tier: "disk",
      source: winner.path,
      deliberate: false,
      deprecated: false,
      diskCandidates: diskPaths,
      warning
    });
  }
  const legacy = firstEnvValue(env, apiKeyKeys);
  if (legacy) {
    assertUsableCredential(name, legacy.key, legacy.value);
    const where = diskPaths.length > 0 ? `Put the current key in ${diskPaths[0]} \u2014 it is re-read on every call, so rotations take effect immediately.` : `This environment has no HOME, so no credential file could be consulted at all; the disk tier is ` + `unavailable here and this process will keep using the environment snapshot.`;
    const message = `[${name}] DEPRECATED: the API key came from ${legacy.key} in this process's environment. ` + `Environment variables are a snapshot taken when this process started, so a shell that started ` + `before a key rotation keeps using the old key until it exits. ${where}`;
    const sink = options.onDeprecation ?? defaultDeprecationSink;
    const notified = deprecationNotified();
    if (!notified.has(name)) {
      notified.add(name);
      sink(message);
    }
    return sealCredential({
      apiKey: legacy.value,
      tier: "legacy-env",
      source: legacy.key,
      deliberate: false,
      deprecated: true,
      diskCandidates: diskPaths,
      warning: message
    });
  }
  return null;
}
var FLEET_API_DOMAIN_ENV_KEY = "HASNA_FLEET_API_DOMAIN";
var NEUTRAL_FLEET_API_DOMAIN = "your-deployment.example";
var ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
var DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function isValidDnsDomain(value) {
  if (value.length === 0 || value.length > 253 || ASCII_CONTROL_PATTERN.test(value) || /[^\x00-\x7f]/.test(value)) {
    return false;
  }
  return value.split(".").every((label) => label.length <= 63 && !label.startsWith("xn--") && DNS_LABEL_PATTERN.test(label));
}
function resolveFleetApiDomain(env) {
  const raw = env[FLEET_API_DOMAIN_ENV_KEY];
  if (raw === undefined) {
    return {
      domain: NEUTRAL_FLEET_API_DOMAIN,
      source: "default",
      misconfigured: true,
      warning: `${FLEET_API_DOMAIN_ENV_KEY} is not set; using the non-resolving ${NEUTRAL_FLEET_API_DOMAIN} fallback.`
    };
  }
  const configured = raw.trim().toLowerCase();
  if (ASCII_CONTROL_PATTERN.test(raw) || !isValidDnsDomain(configured)) {
    return {
      domain: NEUTRAL_FLEET_API_DOMAIN,
      source: FLEET_API_DOMAIN_ENV_KEY,
      misconfigured: true,
      warning: `${FLEET_API_DOMAIN_ENV_KEY} is blank or invalid; using the non-resolving ${NEUTRAL_FLEET_API_DOMAIN} fallback.`
    };
  }
  return {
    domain: configured,
    source: FLEET_API_DOMAIN_ENV_KEY,
    misconfigured: false,
    warning: null
  };
}
function validateAppSlug(name) {
  if (name.length > 63 || !DNS_LABEL_PATTERN.test(name)) {
    throw new Error("App name must be one lowercase DNS label.");
  }
  return name;
}
function composeCloudHostname(name, domain) {
  const hostname = `${validateAppSlug(name)}.${domain}`;
  if (!isValidDnsDomain(hostname)) {
    throw new Error("Composed cloud hostname must be a valid DNS domain");
  }
  return hostname;
}
function resolveDefaultCloudBaseUrl(name, env) {
  const appSlug = validateAppSlug(name);
  const fleetDomain = resolveFleetApiDomain(env);
  const configuredHostname = `${appSlug}.${fleetDomain.domain}`;
  if (isValidDnsDomain(configuredHostname)) {
    return {
      baseUrl: `https://${configuredHostname}`,
      source: fleetDomain.source,
      misconfigured: fleetDomain.misconfigured,
      warning: fleetDomain.warning
    };
  }
  const fallbackHostname = composeCloudHostname(appSlug, NEUTRAL_FLEET_API_DOMAIN);
  return {
    baseUrl: `https://${fallbackHostname}`,
    source: fleetDomain.source,
    misconfigured: true,
    warning: `${FLEET_API_DOMAIN_ENV_KEY} cannot form a valid composed cloud hostname for app '${appSlug}'; using the non-resolving ${NEUTRAL_FLEET_API_DOMAIN} fallback.`
  };
}
function firstEnv2(env, keys, options = {}) {
  for (const key of keys) {
    const raw = env[key];
    const value = raw?.trim();
    if (value)
      return { key, value: options.preserveRaw ? raw : value };
  }
  return null;
}
function rawAuthority(value) {
  const match = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  if (!match)
    throw new Error("API URL must be absolute.");
  const afterScheme = value.slice(match[0].length);
  const boundary = afterScheme.search(/[/?#]/);
  const authority = boundary === -1 ? afterScheme : afterScheme.slice(0, boundary);
  if (!authority)
    throw new Error("API URL must include a hostname.");
  return authority;
}
function assertCanonicalPort(port) {
  if (!/^[0-9]+$/.test(port) || port.length > 1 && port.startsWith("0")) {
    throw new Error("API URL authority must contain a canonical port between 1 and 65535.");
  }
  const numericPort = Number(port);
  if (!Number.isSafeInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("API URL authority must contain a canonical port between 1 and 65535.");
  }
}
function canonicalAuthorityHostname(authority) {
  let rawHostname;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket === -1) {
      throw new Error("API URL authority must contain a canonical hostname.");
    }
    rawHostname = authority.slice(0, closingBracket + 1);
    const portSuffix = authority.slice(closingBracket + 1);
    if (portSuffix) {
      if (!portSuffix.startsWith(":")) {
        throw new Error("API URL authority must contain a canonical hostname and port.");
      }
      assertCanonicalPort(portSuffix.slice(1));
    }
    if (isIP(rawHostname.slice(1, -1)) !== 6) {
      throw new Error("API URL authority must contain a canonical IPv6 literal.");
    }
  } else {
    const firstColon = authority.indexOf(":");
    const lastColon = authority.lastIndexOf(":");
    if (firstColon !== lastColon) {
      throw new Error("IPv6 API URL authorities must use brackets.");
    }
    if (lastColon !== -1) {
      const port = authority.slice(lastColon + 1);
      assertCanonicalPort(port);
      rawHostname = authority.slice(0, lastColon);
    } else {
      rawHostname = authority;
    }
    const ipVersion = isIP(rawHostname);
    const numericAddressParts = rawHostname.split(".");
    const looksLikeNonCanonicalIpv4 = numericAddressParts.every((part) => /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(part));
    if (ipVersion !== 4 && looksLikeNonCanonicalIpv4 || ipVersion !== 4 && !isValidDnsDomain(rawHostname.toLowerCase())) {
      throw new Error("API URL authority must contain a canonical ASCII hostname.");
    }
  }
  return rawHostname.toLowerCase();
}
function isDeliberateLoopbackHttpAuthority(authority) {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(authority);
}
function toV1BaseUrl(apiUrl) {
  if (ASCII_CONTROL_PATTERN.test(apiUrl)) {
    throw new Error("API URL must not contain ASCII control characters.");
  }
  const input = apiUrl.trim();
  const authority = rawAuthority(input);
  if (authority.includes("@") || authority.includes("\\") || authority.includes("%") || /[^\x00-\x7f]/.test(authority)) {
    throw new Error("API URL authority must be canonical ASCII without credentials.");
  }
  const canonicalHostname = canonicalAuthorityHostname(authority);
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("API URL must not include credentials.");
  }
  if (!url.hostname || url.hostname.endsWith(".")) {
    throw new Error("API URL must include a canonical hostname.");
  }
  if (url.hostname.toLowerCase() !== canonicalHostname) {
    throw new Error("API URL authority must not rely on parser hostname normalization.");
  }
  if (url.hostname.split(".").some((label) => label.toLowerCase().startsWith("xn--"))) {
    throw new Error("API URL must not use IDN or punycode hostnames.");
  }
  if (url.protocol === "http:" && !isDeliberateLoopbackHttpAuthority(authority)) {
    throw new Error("API URL may use http only for an exact loopback authority.");
  }
  if (url.search || url.hash) {
    throw new Error("API URL must not include a query string or fragment.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1"))
    path = path.slice(0, -"/v1".length);
  url.pathname = `${path}/v1`;
  return url.toString().replace(/\/+$/, "");
}
function resolveClientTransport(name, env = process.env, options = {}) {
  const keys = clientTransportEnvKeys(name);
  const modeHit = firstEnv2(env, keys.modeKeys);
  const urlHit = firstEnv2(env, keys.apiUrlKeys, { preserveRaw: true });
  const keyHit = firstEnv2(env, keys.apiKeyKeys);
  let mode = "sqlite";
  let modeSource = "default";
  const warnings = [];
  let credential;
  if (modeHit) {
    mode = normalizeStorageMode(modeHit.value).mode;
    modeSource = modeHit.key;
  } else if (urlHit) {
    credential = resolveCredential(name, env, options.credentials);
    if (credential) {
      mode = "postgres";
      modeSource = `${urlHit.key}+${credential.source}`;
    }
  }
  if (mode === "sqlite") {
    return {
      transport: "sqlite",
      mode,
      modeSource,
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: Boolean(keyHit),
      apiKeySource: keyHit ? keyHit.key : null,
      apiKeyTier: null,
      misconfigured: false,
      warning: warnings.length > 0 ? warnings.join(" ") : null
    };
  }
  if (credential === undefined)
    credential = resolveCredential(name, env, options.credentials);
  if (!credential) {
    const diskHint = credentialDiskSourcesForMessage(name, env);
    warnings.push(`${modeSource}=postgres but no API key could be resolved for '${name}'. A client reaches server data ` + `over HTTP only; refusing to route. Using the local sqlite store. ` + `Looked for a credential file at ${diskHint}, then for ${keys.apiKeyKeys[0]} in the environment.`);
    return {
      transport: "sqlite",
      mode,
      modeSource,
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: false,
      apiKeySource: null,
      apiKeyTier: null,
      misconfigured: true,
      warning: warnings.join(" ")
    };
  }
  if (credential.warning)
    warnings.push(credential.warning);
  let defaultBaseUrl = null;
  let apiUrlSource = urlHit?.key ?? (env[FLEET_API_DOMAIN_ENV_KEY] === undefined ? "default" : FLEET_API_DOMAIN_ENV_KEY);
  let baseUrl;
  try {
    if (!urlHit) {
      defaultBaseUrl = resolveDefaultCloudBaseUrl(name, env);
      apiUrlSource = defaultBaseUrl.source;
    }
    const rawUrl = urlHit?.value ?? defaultBaseUrl.baseUrl;
    baseUrl = toV1BaseUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Invalid API URL from ${apiUrlSource}: ${message}. Using local store.`);
    return {
      transport: "sqlite",
      mode,
      modeSource,
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: true,
      apiKeySource: credential.source,
      apiKeyTier: credential.tier,
      misconfigured: true,
      warning: warnings.join(" ")
    };
  }
  if (defaultBaseUrl?.warning)
    warnings.push(defaultBaseUrl.warning);
  return {
    transport: "http",
    mode,
    modeSource,
    baseUrl,
    apiUrlSource,
    apiKeyPresent: true,
    apiKeySource: credential.source,
    apiKeyTier: credential.tier,
    misconfigured: defaultBaseUrl?.misconfigured ?? false,
    warning: warnings.length > 0 ? warnings.join(" ") : null
  };
}
function credentialDiskSourcesForMessage(name, env) {
  const paths = credentialDiskSources(name, env);
  return paths.length > 0 ? paths.join(" or ") : "<no HOME set in this environment, so no credential file was consulted>";
}

class HasnaHttpError extends Error {
  status;
  method;
  path;
  body;
  credentialSource;
  credentialTier;
  constructor(method, path, status, body, credential) {
    const guidance = credential ? `. ${credential.guidance}` : "";
    super(`Hasna cloud request failed: ${method} ${path} -> ${status}${guidance}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
    this.credentialSource = credential?.source ?? null;
    this.credentialTier = credential?.tier ?? null;
  }
}
function currentCredential(name, apiKey) {
  if (typeof apiKey === "function")
    return apiKey();
  return explicitCredential(name, apiKey);
}
function authFailureGuidance(credential) {
  const origin = `The API key for this request came from ${credential.source}`;
  if (credential.deliberate) {
    return `${origin} \u2014 a credential you selected deliberately. It was NOT substituted with any other key: ` + `falling back here would authenticate as a different principal than the one you named, which is ` + `exactly the failure an override exists to prevent. Rotate that key, or unset the override to use ` + `the credential on disk.`;
  }
  if (credential.deprecated) {
    const target = credential.diskCandidates[0];
    const remedy = target ? `Write the CURRENT key to ${target} \u2014 that file is re-read on every call, so rotations take ` + `effect immediately and in every shell. Do not simply unset ${credential.source}: nothing was ` + `found on disk, so that would leave this client with no credential at all.` : `This environment has no HOME, so no credential file could be consulted; the disk tier is ` + `unavailable here and there is nothing to fall back to. Set HOME, or supply the key explicitly.`;
    return `${origin}, a variable in this process's environment \u2014 which is a snapshot taken when the process ` + `started. A STALE SHELL is the most common cause of this error: this shell exported the key before ` + `it was rotated, and will keep sending the old one until it exits. ${remedy}`;
  }
  return `${origin}, which was re-read from disk on this very call \u2014 so a stale shell is NOT the cause here. ` + `The stored credential is genuinely being rejected: rotate it, or re-run the fleet key distribution ` + `so this machine gets the current key.`;
}
var DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];
var IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
var AUTHORITY_OVERRIDE_HEADERS = new Set([
  "host",
  ":authority",
  "forwarded",
  "x-forwarded-host",
  "x-original-host"
]);
function assertNoAuthorityOverrideHeaders(headers, source) {
  if (!headers)
    return;
  const forbidden = Object.keys(headers).find((name) => AUTHORITY_OVERRIDE_HEADERS.has(name.trim().toLowerCase()));
  if (forbidden) {
    throw new Error(`Authenticated ${source} headers must not set authority header '${forbidden}'.`);
  }
}
function appendQuery(path, query) {
  if (!query)
    return path;
  const params = query instanceof URLSearchParams ? query : new URLSearchParams;
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined)
        continue;
      if (Array.isArray(value)) {
        for (const v of value)
          params.append(key, String(v));
      } else {
        params.append(key, String(value));
      }
    }
  }
  const qs = params.toString();
  if (!qs)
    return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}
var defaultSleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function createHasnaHttpTransport(options) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = toV1BaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 30000;
  const sleep = options.sleepImpl ?? defaultSleep;
  const defaultRetry = options.retry;
  function resolveRetry(callRetry) {
    const chosen = callRetry !== undefined ? callRetry : defaultRetry;
    if (chosen === false)
      return null;
    const r = chosen ?? {};
    return {
      retries: r.retries ?? 2,
      baseDelayMs: r.baseDelayMs ?? 200,
      maxDelayMs: r.maxDelayMs ?? 2000,
      retryStatuses: r.retryStatuses ?? [...DEFAULT_RETRY_STATUSES]
    };
  }
  async function once(method, rel, url, body, opts, credential) {
    assertNoAuthorityOverrideHeaders(options.headers, "transport");
    assertNoAuthorityOverrideHeaders(opts.headers, "request");
    const headers = {
      "x-api-key": credential.apiKey,
      Authorization: `Bearer ${credential.apiKey}`,
      Accept: "application/json",
      ...options.headers ?? {},
      ...opts.headers ?? {}
    };
    if (opts.idempotencyKey)
      headers["Idempotency-Key"] = opts.idempotencyKey;
    const init = {
      method,
      headers,
      redirect: "manual"
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const controller = new AbortController;
    const onAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted)
        controller.abort();
      else
        opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
    init.signal = controller.signal;
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (opts.signal?.aborted)
        return { ok: false, retryable: false, error: err };
      return { ok: false, retryable: true, error: err };
    } finally {
      clearTimeout(timer);
      if (opts.signal)
        opts.signal.removeEventListener("abort", onAbort);
    }
    const text = await response.text();
    let parsed = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      if (response.status >= 300 && response.status < 400) {
        return {
          ok: false,
          retryable: false,
          error: new HasnaHttpError(method, rel, response.status, parsed)
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          retryable: false,
          error: new HasnaHttpError(method, rel, response.status, parsed, {
            source: credential.source,
            tier: credential.tier,
            guidance: authFailureGuidance(credential)
          })
        };
      }
      const retry = resolveRetry(opts.retry);
      const retryable = retry ? retry.retryStatuses.includes(response.status) : false;
      return { ok: false, retryable, error: new HasnaHttpError(method, rel, response.status, parsed) };
    }
    return { ok: true, value: parsed };
  }
  async function request(method, path, body, opts = {}) {
    const upper = method.toUpperCase();
    const rel = appendQuery(path.startsWith("/") ? path : `/${path}`, opts.query);
    const url = `${base}${rel}`;
    const retry = resolveRetry(opts.retry);
    const methodRetryable = IDEMPOTENT_METHODS.has(upper) || Boolean(opts.idempotencyKey);
    const maxAttempts = retry && methodRetryable ? retry.retries + 1 : 1;
    const credential = currentCredential(options.name, options.apiKey);
    let last = null;
    for (let attempt = 1;attempt <= maxAttempts; attempt++) {
      const result = await once(upper, rel, url, body, opts, credential);
      if (result.ok)
        return result.value;
      last = result;
      const canRetry = retry !== null && methodRetryable && result.retryable && attempt < maxAttempts;
      if (!canRetry)
        break;
      const backoff = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (backoff / 2 + 1));
      await sleep(backoff + jitter);
    }
    throw last.error;
  }
  return {
    baseUrl: base,
    request,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    del: (path, body, opts) => request("DELETE", path, body, opts)
  };
}
function createClientTransport(name, env = process.env, overrides) {
  const credentialOptions = overrides?.credentials;
  const resolution = resolveClientTransport(name, env, { ...credentialOptions ? { credentials: credentialOptions } : {} });
  if (resolution.misconfigured) {
    throw new Error(resolution.warning ?? `Client for '${name}' is misconfigured for the API client.`);
  }
  if (resolution.transport === "sqlite" || !resolution.baseUrl) {
    return { transport: "sqlite", client: null, resolution };
  }
  const credentialProvider = () => {
    const resolved = resolveCredential(name, env, credentialOptions);
    if (!resolved) {
      throw new Error(`Client for '${name}' resolved to the http transport but no API key is available any more. ` + `Looked at ${credentialDiskSourcesForMessage(name, env)}, then the environment. ` + `A credential file that was removed after this client was built is the usual cause.`);
    }
    return resolved;
  };
  return {
    transport: "http",
    client: createHasnaHttpTransport({
      name,
      baseUrl: resolution.baseUrl,
      apiKey: credentialProvider,
      ...overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {},
      ...overrides?.headers ? { headers: overrides.headers } : {},
      ...overrides?.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {},
      ...overrides?.retry !== undefined ? { retry: overrides.retry } : {},
      ...overrides?.sleepImpl ? { sleepImpl: overrides.sleepImpl } : {}
    }),
    resolution
  };
}
function resourcePath(resource) {
  const trimmed = resource.replace(/^\/+|\/+$/g, "");
  if (!trimmed)
    throw new Error("resource must be a non-empty path segment");
  return `/${trimmed}`;
}
function entityPath(resource, id) {
  if (id === undefined || id === null || `${id}`.length === 0) {
    throw new Error("id must be a non-empty string");
  }
  return `${resourcePath(resource)}/${encodeURIComponent(String(id))}`;
}
function newIdempotencyKey() {
  const g = globalThis;
  if (g.crypto?.randomUUID)
    return g.crypto.randomUUID();
  return `idmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
function extractItems(raw) {
  if (Array.isArray(raw))
    return raw;
  if (raw && typeof raw === "object") {
    const obj = raw;
    for (const key of ["items", "data", "results", "rows", "records"]) {
      if (Array.isArray(obj[key]))
        return obj[key];
    }
  }
  return [];
}
function extractTotal(raw) {
  if (raw && typeof raw === "object") {
    const obj = raw;
    for (const key of ["total", "count", "totalCount", "total_count"]) {
      if (typeof obj[key] === "number")
        return obj[key];
    }
  }
  return null;
}
function extractCursor(raw) {
  if (raw && typeof raw === "object") {
    const obj = raw;
    for (const key of ["cursor", "nextCursor", "next_cursor", "next"]) {
      if (typeof obj[key] === "string")
        return obj[key];
    }
  }
  return null;
}
function createHasnaStorageClient(name, transport) {
  return {
    name,
    baseUrl: transport.baseUrl,
    transport,
    async list(resource, options = {}) {
      const raw = await transport.get(resourcePath(resource), options);
      return {
        items: extractItems(raw),
        total: extractTotal(raw),
        cursor: extractCursor(raw),
        raw
      };
    },
    async get(resource, id, options = {}) {
      try {
        return await transport.get(entityPath(resource, id), options);
      } catch (error) {
        if (error instanceof HasnaHttpError && error.status === 404)
          return null;
        throw error;
      }
    },
    async create(resource, body, options = {}) {
      const { idempotencyKey, ...rest } = options;
      return transport.post(resourcePath(resource), body, {
        ...rest,
        idempotencyKey: idempotencyKey ?? newIdempotencyKey()
      });
    },
    async update(resource, id, patch, options = {}) {
      const { method = "PATCH", idempotencyKey, ...rest } = options;
      const call = method === "PUT" ? transport.put : transport.patch;
      return call(entityPath(resource, id), patch, { ...rest, ...idempotencyKey ? { idempotencyKey } : {} });
    },
    async delete(resource, id, options = {}) {
      try {
        await transport.del(entityPath(resource, id), undefined, options);
      } catch (error) {
        if (error instanceof HasnaHttpError && error.status === 404)
          return;
        throw error;
      }
    }
  };
}
function resolveStorageClient(name, env = process.env, overrides) {
  const wired = createClientTransport(name, env, overrides);
  if (wired.transport === "http") {
    return { transport: "http", client: createHasnaStorageClient(name, wired.client) };
  }
  return { transport: "sqlite", client: null };
}

// node_modules/@hasna/contracts/dist/client/transport.js
function envToken2(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function clientTransportEnvKeys2(name) {
  const envSegment = envToken2(name);
  return {
    modeKeys: [
      `HASNA_${envSegment}_STORAGE_MODE`,
      `HASNA_${envSegment}_MODE`,
      `${envSegment}_STORAGE_MODE`,
      `${envSegment}_MODE`
    ],
    apiUrlKeys: [`HASNA_${envSegment}_API_URL`, `${envSegment}_API_URL`],
    apiKeyKeys: [`HASNA_${envSegment}_API_KEY`, `${envSegment}_API_KEY`]
  };
}
function credentialOverrideEnvKey2(name) {
  return `HASNA_${envToken2(name)}_API_KEY_OVERRIDE`;
}
var CREDENTIAL_PROFILE_ENV_KEY2 = "HASNA_PROFILE";
var MAX_CREDENTIAL_FILE_BYTES2 = 64 * 1024;
var INSPECT_CUSTOM2 = Symbol.for("nodejs.util.inspect.custom");
var DEPRECATION_REGISTRY2 = Symbol.for("hasna:contracts:credentialDeprecationNotices");
var IDEMPOTENT_METHODS2 = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
var AUTHORITY_OVERRIDE_HEADERS2 = new Set([
  "host",
  ":authority",
  "forwarded",
  "x-forwarded-host",
  "x-original-host"
]);

// node_modules/@hasna/contracts/dist/mode.js
function normalizeStorageMode2(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "sqlite")
    return { mode: "sqlite" };
  if (normalized === "postgres" || normalized === "postgresql")
    return { mode: "postgres" };
  throw new Error(`Unknown storage mode '${value}'. The runtime-placement axis was removed; ` + `set sqlite for the on-box SQLite file or postgres for a PostgreSQL server (DATABASE_URL).`);
}

// src/generated/storage-kit/mode.ts
function normalizeStorageMode3(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "sqlite")
    return { mode: "sqlite" };
  if (normalized === "postgres" || normalized === "postgresql")
    return { mode: "postgres" };
  throw new Error(`Unknown storage mode '${value}'. The runtime-placement axis was removed; ` + `set sqlite for the on-box SQLite file or postgres for a PostgreSQL server (DATABASE_URL).`);
}
function envToken3(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function storageEnvKeys(name) {
  const token = envToken3(name);
  return {
    modeKeys: [`HASNA_${token}_STORAGE_MODE`, `${token}_STORAGE_MODE`],
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`, `${token}_DATABASE_URL`]
  };
}
function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
function resolveStorageMode(name, env = process.env) {
  const { modeKeys, databaseUrlKeys } = storageEnvKeys(name);
  const dbHit = firstEnv(env, databaseUrlKeys);
  const databaseUrlPresent = Boolean(dbHit);
  const databaseUrlSource = dbHit ? dbHit.key : null;
  const modeHit = firstEnv(env, modeKeys);
  if (!modeHit) {
    return {
      mode: databaseUrlPresent ? "postgres" : "sqlite",
      source: databaseUrlPresent ? databaseUrlSource : "default",
      databaseUrlPresent,
      databaseUrlSource,
      warning: null
    };
  }
  const { mode } = normalizeStorageMode3(modeHit.value);
  const warnings = [];
  if (mode === "postgres" && !databaseUrlPresent) {
    warnings.push(`postgres storage needs ${databaseUrlKeys[0]} (reads and writes go to PostgreSQL).`);
  }
  if (modeHit.key !== modeKeys[0]) {
    warnings.push(`Using alias env ${modeHit.key}; the canonical key is ${modeKeys[0]}.`);
  }
  return {
    mode,
    source: modeHit.key,
    databaseUrlPresent,
    databaseUrlSource,
    warning: warnings.length > 0 ? warnings.join(" ") : null
  };
}
function resolveDatabaseUrl(name, env = process.env) {
  const { databaseUrlKeys } = storageEnvKeys(name);
  const hit = firstEnv(env, databaseUrlKeys);
  return hit ? hit.value : null;
}
// src/generated/storage-kit/tls.ts
import { readFileSync as readFileSync3 } from "fs";
function sslModeFromConnectionString(connectionString) {
  const queryStart = connectionString.indexOf("?");
  const params = new URLSearchParams(queryStart === -1 ? "" : connectionString.slice(queryStart + 1));
  const sslmode = params.get("sslmode")?.trim().toLowerCase();
  if (sslmode) {
    switch (sslmode) {
      case "disable":
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        return sslmode;
      case "allow":
        return "prefer";
      default:
        throw new Error(`Unknown sslmode '${sslmode}' in connection string.`);
    }
  }
  const ssl = params.get("ssl")?.trim().toLowerCase();
  if (ssl && ["1", "true", "yes", "on", "require"].includes(ssl))
    return "require";
  return "disable";
}
function loadCaBundle(options) {
  const env = options.env ?? process.env;
  if (options.ca && options.ca.trim())
    return options.ca;
  const path = options.caCertPath ?? env.PGSSLROOTCERT ?? env.NODE_EXTRA_CA_CERTS;
  if (path && path.trim())
    return readFileSync3(path.trim(), "utf8");
  return null;
}
function resolveTlsConfig(connectionString, options = {}) {
  const mode = sslModeFromConnectionString(connectionString);
  if (mode === "disable" || mode === "prefer") {
    return;
  }
  const ca = loadCaBundle(options);
  if (mode === "require") {
    return ca ? { rejectUnauthorized: false, ca } : { rejectUnauthorized: false };
  }
  if (!ca) {
    throw new Error(`sslmode=${mode} requires a CA bundle. Set PGSSLROOTCERT (or pass caCertPath/ca) to the ` + `Amazon RDS global bundle: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`);
  }
  return { rejectUnauthorized: true, ca };
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
import pg from "pg";
function createPgPool(options) {
  const ssl = resolveTlsConfig(options.connectionString, {
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    ...options.env !== undefined ? { env: options.env } : {}
  });
  const config = { connectionString: options.connectionString };
  if (ssl !== undefined)
    config.ssl = ssl;
  if (options.max !== undefined)
    config.max = options.max;
  if (options.idleTimeoutMillis !== undefined)
    config.idleTimeoutMillis = options.idleTimeoutMillis;
  if (options.connectionTimeoutMillis !== undefined)
    config.connectionTimeoutMillis = options.connectionTimeoutMillis;
  if (options.applicationName !== undefined)
    config.application_name = options.applicationName;
  return new pg.Pool(config);
}
function createServerPoolFromEnv(appName, options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveStorageMode(appName, env);
  if (resolution.mode !== "postgres") {
    throw new Error(`createServerPoolFromEnv requires ${appName} storage mode 'postgres', got '${resolution.mode}'. ` + `Set HASNA_${appName.toUpperCase().replace(/-/g, "_")}_STORAGE_MODE=postgres.`);
  }
  const connectionString = resolveDatabaseUrl(appName, env);
  if (!connectionString) {
    throw new Error(`postgres storage for ${appName} needs a database URL. Set ` + `HASNA_${appName.toUpperCase().replace(/-/g, "_")}_DATABASE_URL.`);
  }
  const pool = createPgPool({
    connectionString,
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    env,
    ...options.max !== undefined ? { max: options.max } : {},
    ...options.idleTimeoutMillis !== undefined ? { idleTimeoutMillis: options.idleTimeoutMillis } : {},
    ...options.connectionTimeoutMillis !== undefined ? { connectionTimeoutMillis: options.connectionTimeoutMillis } : {},
    ...options.applicationName !== undefined ? { applicationName: options.applicationName } : {}
  });
  return {
    client: createQueryClient(pool),
    connectionSource: resolution.databaseUrlSource ?? "unknown"
  };
}
// src/generated/storage-kit/migrations.ts
import { createHash } from "crypto";
var DEFAULT_MIGRATION_LEDGER_TABLE = "schema_migrations";
function checksumSql(sql) {
  const normalized = sql.trim().replace(/\r\n/g, `
`);
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}
function defineMigration(id, sql) {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumSql(sql) });
}

class MigrationLedger {
  client;
  migrations;
  ledgerTable;
  constructor(client, migrations, options = {}) {
    this.client = client;
    this.migrations = migrations;
    this.ledgerTable = options.ledgerTable ?? DEFAULT_MIGRATION_LEDGER_TABLE;
    const seen = new Set;
    for (const migration of migrations) {
      if (seen.has(migration.id))
        throw new Error(`Duplicate migration id: ${migration.id}`);
      seen.add(migration.id);
    }
  }
  async ensureLedger() {
    await this.client.execute(`CREATE TABLE IF NOT EXISTS ${this.ledgerTable} (
         id TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`);
  }
  async listApplied() {
    await this.ensureLedger();
    return this.readApplied();
  }
  async readApplied() {
    const rows = await this.client.many(`SELECT id, checksum, applied_at FROM ${this.ledgerTable} ORDER BY id ASC`);
    return rows.map((row) => ({
      id: row.id,
      checksum: row.checksum,
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at)
    }));
  }
  buildPlan(applied) {
    const known = new Set(this.migrations.map((m) => m.id));
    for (const row of applied) {
      if (!known.has(row.id)) {
        throw new Error(`Applied migration '${row.id}' is not recognized by this build (downgrade?).`);
      }
    }
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    for (const migration of this.migrations) {
      const existing = appliedById.get(migration.id);
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch for '${migration.id}': the SQL changed after it was applied.`);
      }
    }
    return this.migrations.map((migration) => ({
      migration,
      state: appliedById.has(migration.id) ? "already_applied" : "pending"
    }));
  }
  async migrate(opts = {}) {
    const dryRun = opts.dryRun === true;
    await this.ensureLedger();
    const applied = await this.readApplied();
    const plan = this.buildPlan(applied);
    if (dryRun)
      return { dryRun, applied, plan };
    for (const item of plan) {
      if (item.state === "already_applied")
        continue;
      await this.client.execute(item.migration.sql);
      await this.client.execute(`INSERT INTO ${this.ledgerTable} (id, checksum, applied_at) VALUES ($1, $2, now())`, [item.migration.id, item.migration.checksum]);
    }
    return { dryRun, applied: await this.readApplied(), plan };
  }
}
function createMigrationLedger(client, migrations, options = {}) {
  return new MigrationLedger(client, migrations, options);
}
// src/generated/storage-kit/health.ts
async function checkHealth(client) {
  const start = Date.now();
  try {
    await client.get("SELECT 1 AS ok");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function checkReady(client, migrations, options = {}) {
  const start = Date.now();
  try {
    const ledger = new MigrationLedger(client, migrations, options);
    const result = await ledger.migrate({ dryRun: true });
    const pending = result.plan.filter((item) => item.state === "pending").map((item) => item.migration.id);
    return { ok: pending.length === 0, latencyMs: Date.now() - start, pendingMigrations: pending };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      pendingMigrations: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// src/generated/storage-kit/index.ts
var KIT_VERSION = "0.8.5";

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
  throw new KnowledgeNetworkGuardError(`knowledge: refused a non-loopback ${url.protocol.replace(":", "")} request while ${NETWORK_GUARD_ENV}=test ` + "(target host withheld on purpose). This process resolved to the cloud backend under test, which means a " + "read or write was about to leave the machine and reach the live store. Select the mode explicitly " + `(${"HASNA_KNOWLEDGE_STORAGE_MODE"}=sqlite) or point the API URL at 127.0.0.1 for a hermetic test.`, { scheme: url.protocol.replace(":", ""), port: url.port });
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

// src/knowledge-mode.ts
var KNOWLEDGE_APP_SLUG = "knowledge";
var ENV_KEYS = clientTransportEnvKeys2(KNOWLEDGE_APP_SLUG);
var KNOWLEDGE_MODE_ENV_KEYS = ENV_KEYS.modeKeys;
var KNOWLEDGE_API_URL_ENV_KEYS = ENV_KEYS.apiUrlKeys;
var KNOWLEDGE_API_KEY_ENV_KEYS = ENV_KEYS.apiKeyKeys;
function presentEnvNames(env, keys) {
  return keys.filter((key) => (env[key] ?? "").trim().length > 0);
}
function resolveKnowledgeModeSelection(env = process.env) {
  const pointers = [
    ...presentEnvNames(env, KNOWLEDGE_API_URL_ENV_KEYS),
    ...presentEnvNames(env, KNOWLEDGE_API_KEY_ENV_KEYS)
  ];
  const canonicalModeKey = KNOWLEDGE_MODE_ENV_KEYS[0];
  for (const name of KNOWLEDGE_MODE_ENV_KEYS) {
    const value = env[name]?.trim();
    if (!value)
      continue;
    let normalized;
    try {
      normalized = normalizeStorageMode3(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`knowledge: ${name}=${value} is not a valid mode. ${message} ` + `Unset ${name} to use the default sqlite backend, or set ${name}=sqlite or ${name}=postgres.`);
    }
    const warnings = [];
    if (name !== canonicalModeKey) {
      warnings.push(`Using alias env ${name}; the canonical key is ${canonicalModeKey}.`);
    }
    if (normalized.mode === "sqlite" && pointers.length > 0) {
      warnings.push(`${name}=sqlite pins the on-box store; ${pointers.join(", ")} are set but ignored.`);
    }
    return {
      mode: normalized.mode,
      source: { kind: "env", name, value },
      pointer_env_present: pointers,
      pointer_ignored: normalized.mode === "sqlite" && pointers.length > 0,
      warning: warnings.length > 0 ? warnings.join(" ") : null
    };
  }
  return {
    mode: "sqlite",
    source: { kind: "default", name: null, value: null },
    pointer_env_present: pointers,
    pointer_ignored: pointers.length > 0,
    warning: pointers.length > 0 ? `${pointers.join(", ")} are set but do NOT select a backend: mode is sqlite by default. ` + `Set ${canonicalModeKey}=postgres to route reads and writes to the API, or unset those vars to silence this note.` : null
  };
}
var SERVER_MODE_CANDIDATES = ["postgres"];
var LOCAL_MODE_CANDIDATES = ["sqlite"];
var derivedTokenCache = new Map;
function deriveToken(candidates, normalize, constantName) {
  const useCache = normalize === normalizeStorageMode2;
  if (useCache) {
    const hit = derivedTokenCache.get(candidates);
    if (hit !== undefined)
      return hit;
  }
  for (const candidate of candidates) {
    try {
      normalize(candidate);
      if (useCache)
        derivedTokenCache.set(candidates, candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`knowledge: no known storage token is accepted by the installed @hasna/contracts ` + `(tried ${candidates.join(", ")}). The storage-mode enum has changed; add the new ` + `token to ${constantName} in src/knowledge-mode.ts.`);
}
function serverStorageMode(normalize = normalizeStorageMode2) {
  return deriveToken(SERVER_MODE_CANDIDATES, normalize, "SERVER_MODE_CANDIDATES");
}
function localStorageMode(normalize = normalizeStorageMode2) {
  return deriveToken(LOCAL_MODE_CANDIDATES, normalize, "LOCAL_MODE_CANDIDATES");
}
function contractsStorageModeFor(mode2, normalize = normalizeStorageMode2) {
  return mode2 === "postgres" ? serverStorageMode(normalize) : localStorageMode(normalize);
}
function pinnedTransportEnv(env, mode2) {
  return { ...env, [KNOWLEDGE_MODE_ENV_KEYS[0]]: contractsStorageModeFor(mode2) };
}
function knowledgeModeReport(env = process.env) {
  const resolution = resolveKnowledgeModeSelection(env);
  return {
    ...resolution,
    store_transport: resolution.mode === "postgres" ? "api" : "local",
    api_key_present: presentEnvNames(env, KNOWLEDGE_API_KEY_ENV_KEYS).length > 0,
    network_guard_active: isNetworkGuardActive(env)
  };
}

// src/query-contract.ts
var KNOWLEDGE_BOUNDED_QUERY_CAPABILITY = "hasna.knowledge.bounded-query.v1";
function hasKnowledgeBoundedQueryCapability(value) {
  return Boolean(value && typeof value === "object" && value.query_capability === KNOWLEDGE_BOUNDED_QUERY_CAPABILITY);
}

// src/cloud-store.ts
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
      const query2 = toQuery({ ...options, limit, offset });
      const res = await client.list(KNOWLEDGE_RESOURCE, { query: query2 });
      if (!Number.isInteger(res.total) || Number(res.total) < 0) {
        throw new Error("knowledge cloud list response is missing a valid producer total.");
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
        throw new Error("knowledge cloud search response is missing producer rank or total evidence.");
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
function resolveKnowledgeCloudStore(env = process.env) {
  const client = resolveKnowledgeCloudClient(env);
  return client ? wrap(client) : null;
}
function resolveKnowledgeGuardedTransport(env = process.env) {
  return resolveKnowledgeCloudClient(env, { guarded: true })?.transport ?? null;
}
function guardedTransportEnv(env) {
  const guardedEnv = { ...env };
  delete guardedEnv.HOME;
  delete guardedEnv.USERPROFILE;
  delete guardedEnv[CREDENTIAL_PROFILE_ENV_KEY2];
  delete guardedEnv[credentialOverrideEnvKey2(KNOWLEDGE_APP_SLUG)];
  return guardedEnv;
}
function resolveKnowledgeCloudClient(env, options = {}) {
  if (resolveKnowledgeModeSelection(env).mode !== "postgres")
    return null;
  const transportEnv = options.guarded ? guardedTransportEnv(env) : env;
  const resolved = resolveStorageClient(KNOWLEDGE_APP_SLUG, pinnedTransportEnv(transportEnv, "postgres"), transportOverrides(transportEnv));
  if (resolved.transport !== "http")
    return null;
  return resolved.client;
}
function isKnowledgeApiMode(env = process.env) {
  if (resolveKnowledgeModeSelection(env).mode !== "postgres")
    return false;
  return resolveStorageClient(KNOWLEDGE_APP_SLUG, pinnedTransportEnv(env, "postgres"), transportOverrides(env)).transport === "http";
}
async function fetchAllCloudItems(store) {
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
function assertLocalCatalogMode(operation = "catalog") {
  if (isKnowledgeApiMode()) {
    const modeKey = KNOWLEDGE_MODE_ENV_KEYS[0];
    throw new Error(`knowledge: ${operation} builds/reads the on-box sqlite RAG catalog (source ingestion, chunk embeddings, ` + `wiki compilation, cross-machine sync, machine registry). That local indexing pipeline is not available in ` + `cloud mode. In cloud mode the shared corpus is the cloud knowledge-items: 'add/list/get/update/delete' item ` + `commands AND 'search/ask/build/context' over that shared corpus all route to the cloud. Set ${modeKey}=local ` + `(or unset it \u2014 local is the default) to use the full local catalog pipeline; run 'knowledge mode' to see ` + `which variable selected the current backend.`);
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
  assertLocalCatalogMode("opening the local knowledge.db catalog");
  ensureParentDir(path);
  const db = new Database(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}
function openKnowledgeDbReadonly(path) {
  assertLocalCatalogMode("reading the local knowledge.db catalog");
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
var KNOWLEDGE_STORAGE_MODE_ENV = "HASNA_KNOWLEDGE_STORAGE_MODE";
var KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV = "KNOWLEDGE_STORAGE_MODE";
var STORAGE_MODE_ENV = [KNOWLEDGE_STORAGE_MODE_ENV, KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV];
function readEnv(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}
function normalizeStorageMode4(value) {
  const normalized = value?.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "sqlite")
    return "sqlite";
  if (normalized === "postgres" || normalized === "postgresql")
    return "postgres";
  return;
}
function openScopedDb(options = {}) {
  const workspace = ensureKnowledgeWorkspace(resolveScopedWorkspace(options.scope, options.cwd).home);
  migrateKnowledgeDb(workspace.knowledgeDbPath);
  return {
    db: openKnowledgeDb(workspace.knowledgeDbPath),
    path: workspace.knowledgeDbPath,
    scope: options.scope ?? "global"
  };
}
function getStorageMode() {
  const mode2 = normalizeStorageMode4(readEnv(KNOWLEDGE_STORAGE_MODE_ENV)) ?? normalizeStorageMode4(readEnv(KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV));
  if (mode2)
    return mode2;
  return "sqlite";
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
      mode: getStorageMode(),
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
// src/db/remote-storage.ts
var KNOWLEDGE_APP_NAME = "knowledge";
function createKnowledgeCloudClient() {
  return createServerPoolFromEnv(KNOWLEDGE_APP_NAME, { applicationName: "@hasna/knowledge" }).client;
}
// src/project-links.ts
import { createHash as createHash2 } from "crypto";
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
function sqliteKnowledgeProjectLinksSchemaSql() {
  return `
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS knowledge_projects (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      project_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, project_id),
      UNIQUE(authority_id, tenant_id, corpus_id, source_project_id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_project_collections (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      collection_slug TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      membership_rule TEXT NOT NULL CHECK(membership_rule = 'explicit_collection_binding'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id),
      UNIQUE(authority_id, tenant_id, corpus_id, project_id, collection_slug),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, project_id)
        REFERENCES knowledge_projects(authority_id, tenant_id, corpus_id, project_id)
        ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS knowledge_project_collection_memberships (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      bound_receipt_id TEXT NOT NULL,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      bound_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id, item_id),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, collection_id)
        REFERENCES knowledge_project_collections(authority_id, tenant_id, corpus_id, collection_id)
        ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS knowledge_project_link_receipts (
      receipt_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL CHECK(authority = 'knowledge'),
      route TEXT NOT NULL CHECK(route = 'knowledge.project-registration.v1'),
      package_version TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('register_collection', 'bind_item')),
      resource_kind TEXT NOT NULL CHECK(resource_kind IN ('collection', 'item')),
      direction TEXT NOT NULL CHECK(direction IN ('forward', 'inverse')),
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'terminal_nonacceptance')),
      reason TEXT,
      source_project_id TEXT,
      project_id TEXT,
      collection_id TEXT,
      item_id TEXT,
      result_revision TEXT,
      result_digest TEXT,
      accepted_receipt_id TEXT,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE(authority_id, tenant_id, corpus_id, operation_id, step_id, action, direction)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_project_link_receipts_lookup
      ON knowledge_project_link_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        action, direction, idempotency_key
      );
    CREATE TRIGGER IF NOT EXISTS knowledge_project_link_receipts_immutable_update
      BEFORE UPDATE ON knowledge_project_link_receipts
      BEGIN
        SELECT RAISE(ABORT, 'knowledge project link receipts are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS knowledge_project_link_receipts_immutable_delete
      BEFORE DELETE ON knowledge_project_link_receipts
      BEGIN
        SELECT RAISE(ABORT, 'knowledge project link receipts are immutable');
      END;
  `;
}
function postgresKnowledgeProjectLinksSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS knowledge_projects (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      project_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, project_id),
      UNIQUE(authority_id, tenant_id, corpus_id, source_project_id)
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_project_collections (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      collection_slug TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      membership_rule TEXT NOT NULL CHECK(membership_rule = 'explicit_collection_binding'),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id),
      UNIQUE(authority_id, tenant_id, corpus_id, project_id, collection_slug),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, project_id)
        REFERENCES knowledge_projects(authority_id, tenant_id, corpus_id, project_id)
        ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_project_collection_memberships (
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      bound_receipt_id TEXT NOT NULL,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      bound_at TEXT NOT NULL,
      PRIMARY KEY(authority_id, tenant_id, corpus_id, collection_id, item_id),
      FOREIGN KEY(authority_id, tenant_id, corpus_id, collection_id)
        REFERENCES knowledge_project_collections(authority_id, tenant_id, corpus_id, collection_id)
        ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_project_link_receipts (
      receipt_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL CHECK(authority = 'knowledge'),
      route TEXT NOT NULL CHECK(route = 'knowledge.project-registration.v1'),
      package_version TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('register_collection', 'bind_item')),
      resource_kind TEXT NOT NULL CHECK(resource_kind IN ('collection', 'item')),
      direction TEXT NOT NULL CHECK(direction IN ('forward', 'inverse')),
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'terminal_nonacceptance')),
      reason TEXT,
      source_project_id TEXT,
      project_id TEXT,
      collection_id TEXT,
      item_id TEXT,
      result_revision TEXT,
      result_digest TEXT,
      accepted_receipt_id TEXT,
      created_by_operation INTEGER NOT NULL CHECK(created_by_operation IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE(authority_id, tenant_id, corpus_id, operation_id, step_id, action, direction)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_project_link_receipts_lookup
      ON knowledge_project_link_receipts (
        authority_id, tenant_id, corpus_id, operation_id, step_id,
        action, direction, idempotency_key
      )`,
    `CREATE OR REPLACE FUNCTION knowledge_project_link_receipts_immutable()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'knowledge project link receipts are immutable';
      END;
      $$`,
    `DROP TRIGGER IF EXISTS knowledge_project_link_receipts_immutable
      ON knowledge_project_link_receipts`,
    `CREATE TRIGGER knowledge_project_link_receipts_immutable
      BEFORE UPDATE OR DELETE ON knowledge_project_link_receipts
      FOR EACH ROW EXECUTE FUNCTION knowledge_project_link_receipts_immutable()`
  ];
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
  return createHash2("sha256").update(canonicalKnowledgeProjectLinksJson(value)).digest("hex");
}
function stableUuid(namespace) {
  const hex = createHash2("sha256").update(namespace).digest("hex").slice(0, 32).split("");
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
function createLocalKnowledgeProjectLinksAuthority(input) {
  if (input.databasePath !== ":memory:") {
    ensureParentDir(input.databasePath);
  }
  const require2 = import.meta.require;
  if (typeof require2 !== "function") {
    throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CONFLICT", "the local Knowledge project-links authority requires the Bun runtime.");
  }
  const { Database: BunDatabase } = require2("bun:sqlite");
  const db = new BunDatabase(input.databasePath, { create: true });
  db.exec(sqliteKnowledgeProjectLinksSchemaSql());
  return new PackageOwnedKnowledgeProjectLinksAuthority(new SqliteProjectLinksSql(db), (id) => input.itemStore.get(id), input.options);
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

class KnowledgeProjectLinksHttpClient {
  options;
  fetchImpl;
  root;
  constructor(options) {
    this.options = options;
    this.fetchImpl = options.fetch ?? guardedFetch;
    this.root = options.baseUrl.replace(/\/+$/, "");
  }
  async close() {}
  headers(extra = {}) {
    const headers = new Headers(this.options.headers);
    headers.set("accept", "application/json");
    if (this.options.apiKey)
      headers.set("x-api-key", this.options.apiKey);
    for (const [key, value] of Object.entries(extra))
      headers.set(key, value);
    return headers;
  }
  async request(path, init = {}) {
    const response = await this.fetchImpl(`${this.root}${path}`, {
      ...init,
      headers: this.headers(init.body ? { "content-type": "application/json" } : {})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new KnowledgeProjectLinksError(typeof body.error === "string" ? body.error : "KNOWLEDGE_PROJECT_LINKS_CONFLICT", typeof body.message === "string" ? body.message : `Knowledge project-links HTTP ${response.status}`, body.details && typeof body.details === "object" ? body.details : {});
    }
    return body;
  }
  async capability() {
    const body = await this.request("/v1/project-registration/capability");
    return body.capability;
  }
  async registerCollection(request) {
    const body = await this.request("/v1/project-registration/create", { method: "POST", body: JSON.stringify(request) });
    return body.receipt;
  }
  async readCollection(collectionId) {
    const body = await this.request("/v1/project-registration/read-exact", { method: "POST", body: JSON.stringify({ collection_id: collectionId }) });
    return body.record;
  }
  async lookupReceipt(request) {
    const body = await this.request("/v1/project-registration/receipts/lookup", { method: "POST", body: JSON.stringify(request) });
    return body.receipt;
  }
  async compensateRegistration(request) {
    const body = await this.request("/v1/project-registration/compensate", { method: "POST", body: JSON.stringify(request) });
    return body.receipt;
  }
  async verifyRegistrationInverse(request) {
    const body = await this.request("/v1/project-registration/verify-inverse", { method: "POST", body: JSON.stringify(request) });
    return body.verification;
  }
  async bindItem(request) {
    const body = await this.request("/v1/project-registration/items/bind", { method: "POST", body: JSON.stringify(request) });
    return body.receipt;
  }
  async readItemBinding(collectionId, itemId) {
    const body = await this.request("/v1/project-registration/items/read-exact", { method: "POST", body: JSON.stringify({ collection_id: collectionId, item_id: itemId }) });
    return body.record;
  }
  async compensateItemBinding(request) {
    const body = await this.request("/v1/project-registration/items/compensate", { method: "POST", body: JSON.stringify(request) });
    return body.receipt;
  }
  async verifyItemBindingInverse(request) {
    const body = await this.request("/v1/project-registration/items/verify-inverse", { method: "POST", body: JSON.stringify(request) });
    return body.verification;
  }
  async listProjectResources(projectId, options = {}) {
    const query2 = new URLSearchParams;
    if (options.limit !== undefined)
      query2.set("limit", String(options.limit));
    if (options.cursor)
      query2.set("cursor", options.cursor);
    for (const kind of options.kinds ?? [])
      query2.append("kind", kind);
    const suffix = query2.size > 0 ? `?${query2.toString()}` : "";
    return this.request(`/v1/projects/${encodeURIComponent(projectId)}/resources${suffix}`);
  }
  async readProjectResource(projectId, kind, resourceId) {
    const body = await this.request(`/v1/projects/${encodeURIComponent(projectId)}/resources/${kind}/${encodeURIComponent(resourceId)}`);
    return body.resource;
  }
  async readAllProjectResources(projectId, options = {}) {
    const resources = [];
    const seen = new Set;
    let cursor = null;
    let expectedTotal = null;
    let expectedRevision = null;
    let expectedPopulationDigest = null;
    do {
      const page = await this.listProjectResources(projectId, { ...options, cursor });
      expectedTotal ??= page.total;
      expectedRevision ??= page.collection_revision;
      expectedPopulationDigest ??= page.population_digest;
      if (page.total !== expectedTotal || page.collection_revision !== expectedRevision || page.population_digest !== expectedPopulationDigest) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE", "project resources changed while the complete HTTP population was being read.");
      }
      for (const resource of page.resources) {
        if (seen.has(resource.key)) {
          throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "project resources HTTP pagination returned a duplicate stable key.");
        }
        seen.add(resource.key);
        resources.push(resource);
      }
      if (page.has_more && !page.next_cursor) {
        throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "project resources HTTP page claims more data without a cursor.");
      }
      cursor = page.next_cursor;
    } while (cursor);
    if (expectedTotal === null || resources.length !== expectedTotal) {
      throw new KnowledgeProjectLinksError("KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION", "complete HTTP resource enumeration did not match the producer total.");
    }
    return resources;
  }
}
function createKnowledgeProjectLinksHttpClient(options) {
  return new KnowledgeProjectLinksHttpClient(options);
}

// src/db/pg-migrations.ts
var PG_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    acl_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    artifact_uri TEXT,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS source_revisions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    hash TEXT,
    extracted_text_uri TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(source_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_count INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_backlinks (
    from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(from_page_id, to_page_id)
  )`,
  `CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    source_uri TEXT NOT NULL,
    quote TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_indexes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    artifact_uri TEXT,
    shard_key TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, name, shard_key)
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    prompt TEXT,
    status TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    cost_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS provider_usage (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS redaction_findings (
    id TEXT PRIMARY KEY,
    source_uri TEXT,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    severity TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS storage_objects (
    id TEXT PRIMARY KEY,
    artifact_uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    content_type TEXT,
    hash TEXT,
    size_bytes INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    action TEXT NOT NULL,
    target_uri TEXT,
    decision TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS approval_gates (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_uri TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    approved_by TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS vector_index_entries (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    vector_norm DOUBLE PRECISION NOT NULL,
    source_uri TEXT,
    source_ref TEXT,
    revision TEXT,
    hash TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    token_count INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,
  `CREATE TABLE IF NOT EXISTS reindex_queue (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_uri TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, target_id, reason)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_machines (
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
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_snapshots (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    workspace_home TEXT NOT NULL,
    sqlite_schema_version INTEGER NOT NULL,
    artifact_root_uri TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    tables_json TEXT NOT NULL,
    artifact_hashes_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_changes (
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
    logical_clock INTEGER NOT NULL DEFAULT 0,
    bundle_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS logical_clock INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS bundle_id TEXT`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_conflicts (
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
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_table_clocks (
    table_name TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    logical_clock INTEGER NOT NULL DEFAULT 0,
    high_water_hash TEXT,
    high_water_bundle_id TEXT,
    origin_machine_id TEXT,
    updated_by_machine_id TEXT,
    last_applied_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(table_name, machine_id)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_imports (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_revisions_source ON source_revisions(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_source_revision ON chunks(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_wiki_page ON chunks(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_wiki_page ON citations(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_chunk ON citations(chunk_id)`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_usage_run ON provider_usage(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_status ON reindex_queue(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_kind_target ON reindex_queue(kind, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_source_uri ON reindex_queue(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_machines_last_seen ON knowledge_machines(last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_machine_created ON knowledge_sync_snapshots(machine_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_hash ON knowledge_sync_snapshots(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON knowledge_sync_changes(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_origin ON knowledge_sync_changes(origin_machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON knowledge_sync_changes(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_bundle ON knowledge_sync_changes(bundle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_clock ON knowledge_sync_changes(entity_kind, logical_clock)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_machine ON knowledge_sync_table_clocks(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_updated ON knowledge_sync_table_clocks(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_source ON knowledge_sync_imports(source_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_target ON knowledge_sync_imports(target_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_status ON knowledge_sync_imports(status)`,
  `CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    short_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    url TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_short_id ON knowledge_items(short_id)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_archived ON knowledge_items(archived)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_created ON knowledge_items(created_at)`,
  `ALTER TABLE knowledge_items
     ADD COLUMN IF NOT EXISTS search_vector tsvector
     GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
       setweight(to_tsvector('english', coalesce(content, '')), 'B')
     ) STORED`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_search_vector
     ON knowledge_items USING GIN (search_vector)`,
  `ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
  `CREATE TABLE IF NOT EXISTS knowledge_item_versions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    tenant_id TEXT,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    body_uri TEXT,
    content_hash TEXT NOT NULL,
    content_bytes INTEGER NOT NULL,
    url TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    actor TEXT,
    reason TEXT,
    valid_from TEXT,
    valid_to TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE(item_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_item_versions_item
     ON knowledge_item_versions(item_id, version DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_item_versions_hash
     ON knowledge_item_versions(content_hash)`,
  `CREATE OR REPLACE FUNCTION knowledge_items_version_snapshot()
   RETURNS TRIGGER AS $knowledge_item_version$
   BEGIN
     IF (OLD.title, OLD.content, OLD.url, OLD.tags, OLD.metadata, OLD.archived)
        IS NOT DISTINCT FROM
        (NEW.title, NEW.content, NEW.url, NEW.tags, NEW.metadata, NEW.archived) THEN
       -- No content-bearing change: no version, no snapshot. Pin the counter so
       -- a caller cannot move it on a write the trigger otherwise ignores.
       NEW.version := OLD.version;
       RETURN NEW;
     END IF;

     INSERT INTO knowledge_item_versions
       (id, item_id, tenant_id, version, title, content, content_hash, content_bytes,
        url, tags, metadata, archived, actor, reason, valid_from, valid_to)
     VALUES
       (gen_random_uuid()::text,
        OLD.id,
        to_jsonb(OLD)->>'tenant_id',
        OLD.version,
        OLD.title,
        OLD.content,
        encode(sha256(convert_to(coalesce(OLD.content, ''), 'UTF8')), 'hex'),
        octet_length(coalesce(OLD.content, '')),
        OLD.url,
        OLD.tags,
        OLD.metadata,
        OLD.archived,
        NULLIF(current_setting('hasna.actor', true), ''),
        NULLIF(current_setting('hasna.reason', true), ''),
        OLD.updated_at,
        to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

     -- The bump and the snapshot are ONE write. The counter advances by exactly
     -- one and only here, so a caller can neither skip it nor forge it.
     NEW.version := OLD.version + 1;

     -- updated_at is TEXT and the application fills it with toISOString(), so
     -- the trigger must write the SAME shape. NOW()::text renders as
     -- '2026-07-28 21:29:56.01+00'; space (0x20) sorts below 'T' (0x54), so a
     -- column carrying both formats orders every trigger-written row before
     -- every application-written one regardless of actual time, and valid_from
     -- (copied verbatim from the row below) would stop being comparable with
     -- valid_to. One format, no casts needed at read time.
     --
     -- Only stamped when the caller did NOT set it. Import, sync replay, and
     -- backfill carry a SOURCE timestamp and kept it before this trigger
     -- existed; silently replacing it would be a regression. A writer that says
     -- nothing still gets a truthful advance.
     IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
       NEW.updated_at := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
     END IF;
     RETURN NEW;
   END
   $knowledge_item_version$ LANGUAGE plpgsql`,
  `DO $knowledge_item_version_trigger$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_knowledge_items_version'
          AND tgrelid = 'knowledge_items'::regclass
     ) THEN
       CREATE TRIGGER trg_knowledge_items_version
         BEFORE UPDATE ON knowledge_items
         FOR EACH ROW EXECUTE FUNCTION knowledge_items_version_snapshot();
     END IF;
   END
   $knowledge_item_version_trigger$`,
  `ALTER TABLE knowledge_items ENABLE ALWAYS TRIGGER trg_knowledge_items_version`,
  `CREATE OR REPLACE FUNCTION knowledge_item_versions_append_only()
   RETURNS TRIGGER AS $knowledge_item_versions_append_only$
   BEGIN
     RAISE EXCEPTION 'knowledge_item_versions is append-only: version % of item % cannot be rewritten',
       OLD.version, OLD.item_id
       USING ERRCODE = 'restrict_violation';
   END
   $knowledge_item_versions_append_only$ LANGUAGE plpgsql`,
  `DO $knowledge_item_versions_guard$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_knowledge_item_versions_append_only'
          AND tgrelid = 'knowledge_item_versions'::regclass
     ) THEN
       CREATE TRIGGER trg_knowledge_item_versions_append_only
         BEFORE UPDATE ON knowledge_item_versions
         FOR EACH ROW EXECUTE FUNCTION knowledge_item_versions_append_only();
     END IF;
   END
   $knowledge_item_versions_guard$`,
  `ALTER TABLE knowledge_item_versions ENABLE ALWAYS TRIGGER trg_knowledge_item_versions_append_only`,
  `ALTER TABLE knowledge_items
     ADD COLUMN IF NOT EXISTS authority_classification TEXT,
     ADD COLUMN IF NOT EXISTS authority_id TEXT,
     ADD COLUMN IF NOT EXISTS tenant_id TEXT,
     ADD COLUMN IF NOT EXISTS scope TEXT,
     ADD COLUMN IF NOT EXISTS parent_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_guarded_binding
     ON knowledge_items(authority_classification, authority_id, tenant_id, scope, parent_id, id)`,
  `CREATE TABLE IF NOT EXISTS knowledge_guarded_write_manifests (
    manifest_id TEXT PRIMARY KEY,
    manifest_receipt_id TEXT NOT NULL UNIQUE,
    deterministic_key TEXT NOT NULL UNIQUE,
    operation_id TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,
    maintainer_authority_classification TEXT NOT NULL,
    maintainer_authority_id TEXT NOT NULL,
    maintainer_tenant_id TEXT NOT NULL,
    maintainer_scope TEXT NOT NULL,
    maintainer_parent_id TEXT NOT NULL,
    step_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    CHECK (maintainer_authority_classification IN ('user_hosted', 'hasna_saas')),
    CHECK (step_count BETWEEN 2 AND 64)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_guarded_write_manifest_steps (
    manifest_id TEXT NOT NULL REFERENCES knowledge_guarded_write_manifests(manifest_id),
    ordinal INTEGER NOT NULL,
    operation_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    deterministic_key TEXT NOT NULL,
    verb TEXT NOT NULL,
    target_id TEXT NOT NULL,
    semantic_digest TEXT NOT NULL,
    precondition_kind TEXT NOT NULL,
    expected_version INTEGER,
    dependencies JSONB NOT NULL,
    limits JSONB NOT NULL,
    authority_classification TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    recovery_strategy TEXT NOT NULL,
    recovery_operation_id TEXT NOT NULL,
    recovery_step_id TEXT NOT NULL,
    recovery_deterministic_key TEXT NOT NULL,
    recovery_verb TEXT NOT NULL,
    recovery_target_id TEXT NOT NULL,
    recovery_semantic_digest TEXT NOT NULL,
    recovery_precondition_kind TEXT NOT NULL,
    recovery_expected_version INTEGER,
    recovery_authority_classification TEXT NOT NULL,
    recovery_authority_id TEXT NOT NULL,
    recovery_tenant_id TEXT NOT NULL,
    recovery_scope TEXT NOT NULL,
    recovery_parent_id TEXT NOT NULL,
    recovery_limits JSONB NOT NULL,
    recovery_receipt_scope TEXT,
    recovery_compensates_receipt_id TEXT,
    PRIMARY KEY (manifest_id, ordinal),
    UNIQUE (manifest_id, deterministic_key),
    CHECK (ordinal >= 0),
    CHECK (authority_classification IN ('user_hosted', 'hasna_saas')),
    CHECK (recovery_authority_classification IN ('user_hosted', 'hasna_saas')),
    CHECK (verb IN ('create', 'update')),
    CHECK (recovery_verb IN ('create', 'update')),
    CHECK (
      (verb = 'create' AND precondition_kind = 'absent' AND expected_version IS NULL)
      OR
      (verb = 'update' AND precondition_kind = 'version' AND expected_version >= 1)
    ),
    CHECK (
      (
        recovery_verb = 'create'
        AND recovery_precondition_kind = 'absent'
        AND recovery_expected_version IS NULL
      )
      OR
      (
        recovery_verb = 'update'
        AND recovery_precondition_kind = 'version'
        AND recovery_expected_version >= 1
      )
    ),
    CHECK (recovery_strategy IN ('forward_repair', 'receipt_scoped_compensation')),
    CHECK (
      (recovery_strategy = 'forward_repair' AND recovery_receipt_scope IS NULL)
      OR
      (
        recovery_strategy = 'receipt_scoped_compensation'
        AND recovery_receipt_scope = 'accepted_step_receipt'
        AND recovery_compensates_receipt_id IS NOT NULL
      )
    ),
    CHECK (
      recovery_strategy = 'receipt_scoped_compensation'
      OR recovery_compensates_receipt_id IS NULL
    )
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_guarded_manifest_step_operation
     ON knowledge_guarded_write_manifest_steps(
       authority_classification, authority_id, tenant_id, scope, parent_id, operation_id, step_id
     )`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_manifest_immutable()
   RETURNS TRIGGER AS $knowledge_guarded_manifest_immutable$
   BEGIN
     RAISE EXCEPTION 'knowledge guarded workflow manifests are immutable'
       USING ERRCODE = 'restrict_violation';
   END
   $knowledge_guarded_manifest_immutable$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_knowledge_guarded_manifest_immutable ON knowledge_guarded_write_manifests`,
  `CREATE TRIGGER trg_knowledge_guarded_manifest_immutable
     BEFORE UPDATE OR DELETE ON knowledge_guarded_write_manifests
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_manifest_immutable()`,
  `ALTER TABLE knowledge_guarded_write_manifests ENABLE ALWAYS TRIGGER trg_knowledge_guarded_manifest_immutable`,
  `DROP TRIGGER IF EXISTS trg_knowledge_guarded_manifest_steps_immutable
     ON knowledge_guarded_write_manifest_steps`,
  `CREATE TRIGGER trg_knowledge_guarded_manifest_steps_immutable
     BEFORE UPDATE OR DELETE ON knowledge_guarded_write_manifest_steps
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_manifest_immutable()`,
  `ALTER TABLE knowledge_guarded_write_manifest_steps
     ENABLE ALWAYS TRIGGER trg_knowledge_guarded_manifest_steps_immutable`,
  `CREATE TABLE IF NOT EXISTS knowledge_guarded_write_claims (
    deterministic_key TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    authority_classification TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    verb TEXT NOT NULL,
    target_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    precondition_kind TEXT NOT NULL,
    expected_version INTEGER,
    manifest_id TEXT,
    manifest_ordinal INTEGER,
    manifest_phase TEXT,
    compensates_receipt_id TEXT,
    receipt_id TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    FOREIGN KEY (manifest_id, manifest_ordinal)
      REFERENCES knowledge_guarded_write_manifest_steps(manifest_id, ordinal),
    CHECK (authority_classification IN ('user_hosted', 'hasna_saas')),
    CHECK (verb IN ('create', 'update')),
    CHECK (
      (verb = 'create' AND precondition_kind = 'absent' AND expected_version IS NULL)
      OR
      (verb = 'update' AND precondition_kind = 'version' AND expected_version >= 1)
    ),
    CHECK (
      (
        manifest_id IS NULL AND manifest_ordinal IS NULL
        AND manifest_phase IS NULL AND compensates_receipt_id IS NULL
      )
      OR (
        manifest_id IS NOT NULL AND manifest_ordinal IS NOT NULL
        AND manifest_phase IN ('primary', 'recovery')
        AND (
          (manifest_phase = 'primary' AND compensates_receipt_id IS NULL)
          OR manifest_phase = 'recovery'
        )
      )
    ),
    UNIQUE(authority_classification, authority_id, tenant_id, scope, parent_id, operation_id, step_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_guarded_claim_receipt
     ON knowledge_guarded_write_claims(receipt_id) WHERE receipt_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS knowledge_guarded_write_receipts (
    receipt_id TEXT PRIMARY KEY,
    deterministic_key TEXT NOT NULL UNIQUE,
    operation_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    verb TEXT NOT NULL,
    target_id TEXT NOT NULL,
    authority_classification TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    precondition_kind TEXT NOT NULL,
    expected_version INTEGER,
    manifest_id TEXT,
    manifest_ordinal INTEGER,
    manifest_phase TEXT,
    compensates_receipt_id TEXT,
    status TEXT NOT NULL,
    code TEXT NOT NULL,
    effect_count INTEGER NOT NULL,
    result_id TEXT,
    result_version INTEGER,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    FOREIGN KEY (manifest_id, manifest_ordinal)
      REFERENCES knowledge_guarded_write_manifest_steps(manifest_id, ordinal),
    CHECK (authority_classification IN ('user_hosted', 'hasna_saas')),
    CHECK (verb IN ('create', 'update')),
    CHECK (
      (verb = 'create' AND precondition_kind = 'absent' AND expected_version IS NULL)
      OR
      (verb = 'update' AND precondition_kind = 'version' AND expected_version >= 1)
    ),
    CHECK (
      (
        manifest_id IS NULL AND manifest_ordinal IS NULL
        AND manifest_phase IS NULL AND compensates_receipt_id IS NULL
      )
      OR (
        manifest_id IS NOT NULL AND manifest_ordinal IS NOT NULL
        AND manifest_phase IN ('primary', 'recovery')
        AND (
          (manifest_phase = 'primary' AND compensates_receipt_id IS NULL)
          OR manifest_phase = 'recovery'
        )
      )
    ),
    CHECK (status IN ('accepted', 'rejected')),
    CHECK (effect_count IN (0, 1)),
    CHECK (
      (status = 'accepted' AND effect_count = 1 AND result_id IS NOT NULL AND result_version IS NOT NULL)
      OR
      (status = 'rejected' AND effect_count = 0 AND result_id IS NULL AND result_version IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_guarded_receipt_operation
     ON knowledge_guarded_write_receipts(
       authority_classification, authority_id, tenant_id, scope, parent_id, operation_id, step_id
     )`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_claim_once()
   RETURNS TRIGGER AS $knowledge_guarded_claim_once$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'knowledge guarded write claims are immutable'
         USING ERRCODE = 'restrict_violation';
     END IF;
     IF (OLD.deterministic_key, OLD.operation_id, OLD.step_id,
         OLD.authority_classification, OLD.authority_id, OLD.tenant_id,
         OLD.scope, OLD.parent_id, OLD.verb, OLD.target_id,
         OLD.payload_digest, OLD.precondition_kind, OLD.expected_version,
         OLD.manifest_id, OLD.manifest_ordinal, OLD.manifest_phase,
         OLD.compensates_receipt_id, OLD.created_at)
        IS DISTINCT FROM
        (NEW.deterministic_key, NEW.operation_id, NEW.step_id,
         NEW.authority_classification, NEW.authority_id, NEW.tenant_id,
         NEW.scope, NEW.parent_id, NEW.verb, NEW.target_id,
         NEW.payload_digest, NEW.precondition_kind, NEW.expected_version,
         NEW.manifest_id, NEW.manifest_ordinal, NEW.manifest_phase,
         NEW.compensates_receipt_id, NEW.created_at)
        OR OLD.receipt_id IS NOT NULL
        OR NEW.receipt_id IS NULL THEN
       RAISE EXCEPTION 'knowledge guarded write claim may only bind one terminal receipt'
         USING ERRCODE = 'restrict_violation';
     END IF;
     RETURN NEW;
   END
   $knowledge_guarded_claim_once$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_knowledge_guarded_claim_once ON knowledge_guarded_write_claims`,
  `CREATE TRIGGER trg_knowledge_guarded_claim_once
     BEFORE UPDATE OR DELETE ON knowledge_guarded_write_claims
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_claim_once()`,
  `ALTER TABLE knowledge_guarded_write_claims ENABLE ALWAYS TRIGGER trg_knowledge_guarded_claim_once`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_receipts_immutable()
   RETURNS TRIGGER AS $knowledge_guarded_receipts_immutable$
   BEGIN
     RAISE EXCEPTION 'knowledge guarded write receipts are immutable'
       USING ERRCODE = 'restrict_violation';
   END
   $knowledge_guarded_receipts_immutable$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_knowledge_guarded_receipts_immutable ON knowledge_guarded_write_receipts`,
  `CREATE TRIGGER trg_knowledge_guarded_receipts_immutable
     BEFORE UPDATE OR DELETE ON knowledge_guarded_write_receipts
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_receipts_immutable()`,
  `ALTER TABLE knowledge_guarded_write_receipts ENABLE ALWAYS TRIGGER trg_knowledge_guarded_receipts_immutable`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_item_authority()
   RETURNS TRIGGER AS $knowledge_guarded_item_authority$
   DECLARE
     claim_key TEXT;
     claim_matches BOOLEAN;
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF OLD.authority_classification IS NULL THEN
         RETURN OLD;
       END IF;
       RAISE EXCEPTION 'guarded knowledge items cannot be deleted outside a declared FCAME-1 action'
         USING ERRCODE = 'restrict_violation';
     END IF;

     IF TG_OP = 'INSERT' AND NEW.authority_classification IS NULL THEN
       RETURN NEW;
     END IF;

     IF TG_OP = 'UPDATE'
        AND OLD.authority_classification IS NULL
        AND NEW.authority_classification IS NULL THEN
       RETURN NEW;
     END IF;

     IF NEW.authority_classification IS NULL OR NEW.authority_id IS NULL
        OR NEW.tenant_id IS NULL OR NEW.scope IS NULL OR NEW.parent_id IS NULL THEN
       RAISE EXCEPTION 'guarded knowledge item binding must be complete'
         USING ERRCODE = 'check_violation';
     END IF;

     IF TG_OP = 'UPDATE' AND (
       OLD.id IS DISTINCT FROM NEW.id
       OR OLD.authority_classification IS DISTINCT FROM NEW.authority_classification
       OR OLD.authority_id IS DISTINCT FROM NEW.authority_id
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.scope IS DISTINCT FROM NEW.scope
       OR OLD.parent_id IS DISTINCT FROM NEW.parent_id
     ) THEN
       RAISE EXCEPTION 'guarded knowledge item identity and binding are immutable'
         USING ERRCODE = 'restrict_violation';
     END IF;

     claim_key := NULLIF(
       current_setting('hasna.knowledge_guarded_deterministic_key', true),
       ''
     );
     IF claim_key IS NULL THEN
       RAISE EXCEPTION 'guarded knowledge item mutation requires an FCAME-1 operation claim'
         USING ERRCODE = 'insufficient_privilege';
     END IF;

     SELECT EXISTS (
       SELECT 1
         FROM knowledge_guarded_write_claims AS claim
        WHERE claim.deterministic_key = claim_key
          AND claim.receipt_id IS NULL
          AND claim.target_id = NEW.id
          AND claim.authority_classification = NEW.authority_classification
          AND claim.authority_id = NEW.authority_id
          AND claim.tenant_id = NEW.tenant_id
          AND claim.scope = NEW.scope
          AND claim.parent_id = NEW.parent_id
          AND (
            (
              TG_OP = 'INSERT'
              AND claim.verb = 'create'
              AND claim.precondition_kind = 'absent'
            )
            OR (
              TG_OP = 'UPDATE'
              AND claim.verb = 'update'
              AND claim.precondition_kind = 'version'
              AND claim.expected_version = OLD.version
            )
          )
     ) INTO claim_matches;
     IF NOT claim_matches THEN
       RAISE EXCEPTION 'guarded knowledge item mutation does not match its live FCAME-1 operation claim'
         USING ERRCODE = 'insufficient_privilege';
     END IF;
     RETURN NEW;
   END
   $knowledge_guarded_item_authority$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_knowledge_items_00_guarded_authority ON knowledge_items`,
  `CREATE TRIGGER trg_knowledge_items_00_guarded_authority
     BEFORE INSERT OR UPDATE OR DELETE ON knowledge_items
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_item_authority()`,
  `ALTER TABLE knowledge_items ENABLE ALWAYS TRIGGER trg_knowledge_items_00_guarded_authority`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_item_authority()
   RETURNS TRIGGER AS $knowledge_guarded_item_authority$
   DECLARE
     claim_key TEXT;
     claim_matches BOOLEAN;
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF OLD.authority_classification IS NULL THEN
         RETURN OLD;
       END IF;
       RAISE EXCEPTION 'guarded knowledge items cannot be deleted outside a declared FCAME-1 action'
         USING ERRCODE = 'restrict_violation';
     END IF;

     IF TG_OP = 'INSERT' AND NEW.authority_classification IS NULL THEN
       RETURN NEW;
     END IF;

     IF TG_OP = 'UPDATE'
        AND OLD.authority_classification IS NULL
        AND NEW.authority_classification IS NULL THEN
       RETURN NEW;
     END IF;

     IF NEW.authority_classification IS NULL OR NEW.authority_id IS NULL
        OR NEW.tenant_id IS NULL OR NEW.scope IS NULL OR NEW.parent_id IS NULL THEN
       RAISE EXCEPTION 'guarded knowledge item binding must be complete'
         USING ERRCODE = 'check_violation';
     END IF;

     IF TG_OP = 'UPDATE' AND (
       OLD.id IS DISTINCT FROM NEW.id
       OR OLD.authority_classification IS DISTINCT FROM NEW.authority_classification
       OR OLD.authority_id IS DISTINCT FROM NEW.authority_id
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.scope IS DISTINCT FROM NEW.scope
       OR OLD.parent_id IS DISTINCT FROM NEW.parent_id
     ) THEN
       RAISE EXCEPTION 'guarded knowledge item identity and binding are immutable'
         USING ERRCODE = 'restrict_violation';
     END IF;

     claim_key := NULLIF(
       current_setting('hasna.knowledge_guarded_deterministic_key', true),
       ''
     );
     IF claim_key IS NULL THEN
       RAISE EXCEPTION 'guarded knowledge item mutation requires an FCAME-1 operation claim'
         USING ERRCODE = 'insufficient_privilege';
     END IF;

     SELECT EXISTS (
       SELECT 1
         FROM knowledge_guarded_write_claims AS claim
        WHERE claim.deterministic_key = claim_key
          AND claim.receipt_id IS NULL
          AND claim.target_id = NEW.id
          AND claim.authority_classification = NEW.authority_classification
          AND claim.authority_id = NEW.authority_id
          AND claim.tenant_id = NEW.tenant_id::text
          AND claim.scope = NEW.scope
          AND claim.parent_id = NEW.parent_id
          AND (
            (
              TG_OP = 'INSERT'
              AND claim.verb = 'create'
              AND claim.precondition_kind = 'absent'
            )
            OR (
              TG_OP = 'UPDATE'
              AND claim.verb = 'update'
              AND claim.precondition_kind = 'version'
              AND claim.expected_version = OLD.version
            )
          )
     ) INTO claim_matches;
     IF NOT claim_matches THEN
       RAISE EXCEPTION 'guarded knowledge item mutation does not match its live FCAME-1 operation claim'
         USING ERRCODE = 'insufficient_privilege';
     END IF;
     RETURN NEW;
   END
   $knowledge_guarded_item_authority$ LANGUAGE plpgsql`,
  `ALTER TABLE knowledge_items
     ADD COLUMN IF NOT EXISTS guarded_adoption_receipt_id TEXT`,
  `CREATE TABLE IF NOT EXISTS knowledge_guarded_adoption_claims (
    deterministic_key TEXT PRIMARY KEY,
    planned_receipt_id TEXT NOT NULL UNIQUE,
    operation_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    authority_classification TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    expected_version INTEGER NOT NULL,
    expected_content_sha256 TEXT NOT NULL,
    adoption_receipt_id TEXT,
    receipt_id TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    CHECK (action IN ('adopt', 'rollback')),
    CHECK (authority_classification IN ('user_hosted', 'hasna_saas')),
    CHECK (expected_version >= 1),
    CHECK (expected_content_sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (
      (action = 'adopt' AND adoption_receipt_id IS NULL)
      OR (action = 'rollback' AND adoption_receipt_id IS NOT NULL)
    ),
    UNIQUE(authority_classification, authority_id, tenant_id, scope, parent_id, operation_id, step_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_guarded_adoption_claim_receipt
     ON knowledge_guarded_adoption_claims(receipt_id) WHERE receipt_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS knowledge_guarded_adoption_receipts (
    receipt_id TEXT PRIMARY KEY,
    deterministic_key TEXT NOT NULL UNIQUE,
    operation_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    authority_classification TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    expected_version INTEGER NOT NULL,
    expected_content_sha256 TEXT NOT NULL,
    adoption_receipt_id TEXT,
    prior_tenant_id TEXT,
    status TEXT NOT NULL,
    code TEXT NOT NULL,
    effect_count INTEGER NOT NULL,
    result_version INTEGER,
    result_content_sha256 TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    CHECK (action IN ('adopt', 'rollback')),
    CHECK (authority_classification IN ('user_hosted', 'hasna_saas')),
    CHECK (expected_version >= 1),
    CHECK (expected_content_sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (
      (action = 'adopt' AND adoption_receipt_id IS NULL)
      OR (action = 'rollback' AND adoption_receipt_id IS NOT NULL)
    ),
    CHECK (status IN ('accepted', 'rejected')),
    CHECK (effect_count IN (0, 1)),
    CHECK (
      (
        status = 'accepted' AND effect_count = 1
        AND result_version IS NOT NULL AND result_content_sha256 IS NOT NULL
      )
      OR (
        status = 'rejected' AND effect_count = 0
        AND result_version IS NULL AND result_content_sha256 IS NULL
      )
    )
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_guarded_adoption_receipt_operation
     ON knowledge_guarded_adoption_receipts(
       authority_classification, authority_id, tenant_id, scope, parent_id, operation_id, step_id
     )`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_adoption_claim_once()
   RETURNS TRIGGER AS $knowledge_guarded_adoption_claim_once$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'knowledge guarded adoption claims are immutable'
         USING ERRCODE = 'restrict_violation';
     END IF;
    IF (OLD.deterministic_key, OLD.planned_receipt_id,
         OLD.operation_id, OLD.step_id, OLD.action,
         OLD.target_id, OLD.authority_classification, OLD.authority_id,
         OLD.tenant_id, OLD.scope, OLD.parent_id, OLD.expected_version,
         OLD.expected_content_sha256, OLD.adoption_receipt_id, OLD.created_at)
        IS DISTINCT FROM
        (NEW.deterministic_key, NEW.planned_receipt_id,
         NEW.operation_id, NEW.step_id, NEW.action,
         NEW.target_id, NEW.authority_classification, NEW.authority_id,
         NEW.tenant_id, NEW.scope, NEW.parent_id, NEW.expected_version,
         NEW.expected_content_sha256, NEW.adoption_receipt_id, NEW.created_at)
        OR OLD.receipt_id IS NOT NULL
        OR NEW.receipt_id IS NULL THEN
       RAISE EXCEPTION 'knowledge guarded adoption claim may only bind one terminal receipt'
         USING ERRCODE = 'restrict_violation';
     END IF;
     RETURN NEW;
   END
   $knowledge_guarded_adoption_claim_once$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_knowledge_guarded_adoption_claim_once
     ON knowledge_guarded_adoption_claims`,
  `CREATE TRIGGER trg_knowledge_guarded_adoption_claim_once
     BEFORE UPDATE OR DELETE ON knowledge_guarded_adoption_claims
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_adoption_claim_once()`,
  `ALTER TABLE knowledge_guarded_adoption_claims
     ENABLE ALWAYS TRIGGER trg_knowledge_guarded_adoption_claim_once`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_adoption_receipts_immutable()
   RETURNS TRIGGER AS $knowledge_guarded_adoption_receipts_immutable$
   BEGIN
     RAISE EXCEPTION 'knowledge guarded adoption receipts are immutable'
       USING ERRCODE = 'restrict_violation';
   END
   $knowledge_guarded_adoption_receipts_immutable$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_knowledge_guarded_adoption_receipts_immutable
     ON knowledge_guarded_adoption_receipts`,
  `CREATE TRIGGER trg_knowledge_guarded_adoption_receipts_immutable
     BEFORE UPDATE OR DELETE ON knowledge_guarded_adoption_receipts
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_adoption_receipts_immutable()`,
  `ALTER TABLE knowledge_guarded_adoption_receipts
     ENABLE ALWAYS TRIGGER trg_knowledge_guarded_adoption_receipts_immutable`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_item_authority()
   RETURNS TRIGGER AS $knowledge_guarded_item_authority$
   DECLARE
     claim_key TEXT;
     adoption_key TEXT;
     claim_matches BOOLEAN;
     binding_changed BOOLEAN;
   BEGIN
     IF TG_OP = 'DELETE' THEN
       IF OLD.authority_classification IS NULL THEN
         RETURN OLD;
       END IF;
       RAISE EXCEPTION 'guarded knowledge items cannot be deleted outside a declared FCAME-1 action'
         USING ERRCODE = 'restrict_violation';
     END IF;

     IF TG_OP = 'INSERT' AND NEW.authority_classification IS NULL THEN
       RETURN NEW;
     END IF;

     IF TG_OP = 'UPDATE'
        AND OLD.authority_classification IS NULL
        AND NEW.authority_classification IS NULL THEN
       RETURN NEW;
     END IF;

     binding_changed := TG_OP = 'UPDATE' AND (
       OLD.id IS DISTINCT FROM NEW.id
       OR OLD.authority_classification IS DISTINCT FROM NEW.authority_classification
       OR OLD.authority_id IS DISTINCT FROM NEW.authority_id
       OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.scope IS DISTINCT FROM NEW.scope
       OR OLD.parent_id IS DISTINCT FROM NEW.parent_id
     );

     IF binding_changed THEN
       adoption_key := NULLIF(
         current_setting('hasna.knowledge_guarded_adoption_key', true),
         ''
       );
       IF adoption_key IS NULL THEN
         RAISE EXCEPTION 'guarded knowledge item identity and binding are immutable'
           USING ERRCODE = 'restrict_violation';
       END IF;
       SELECT EXISTS (
         SELECT 1
           FROM knowledge_guarded_adoption_claims AS claim
          WHERE claim.deterministic_key = adoption_key
            AND claim.receipt_id IS NULL
            AND claim.target_id = OLD.id
            AND claim.expected_version = OLD.version
            AND claim.expected_content_sha256 =
              encode(sha256(convert_to(coalesce(OLD.content, ''), 'UTF8')), 'hex')
            AND (
              OLD.short_id, OLD.title, OLD.content, OLD.url, OLD.tags,
              OLD.metadata, OLD.archived, OLD.created_at, OLD.updated_at, OLD.version
            ) IS NOT DISTINCT FROM (
              NEW.short_id, NEW.title, NEW.content, NEW.url, NEW.tags,
              NEW.metadata, NEW.archived, NEW.created_at, NEW.updated_at, NEW.version
            )
            AND (
              (
                claim.action = 'adopt'
                AND OLD.authority_classification IS NULL
                AND OLD.authority_id IS NULL
                AND OLD.scope IS NULL
                AND OLD.parent_id IS NULL
                AND (
                  OLD.tenant_id IS NULL
                  OR OLD.tenant_id::text = claim.tenant_id
                )
                AND NEW.authority_classification = claim.authority_classification
                AND NEW.authority_id = claim.authority_id
                AND NEW.tenant_id::text = claim.tenant_id
                AND NEW.scope = claim.scope
                AND NEW.parent_id = claim.parent_id
                AND NEW.guarded_adoption_receipt_id = claim.planned_receipt_id
              )
              OR (
                claim.action = 'rollback'
                AND claim.adoption_receipt_id IS NOT NULL
                AND OLD.authority_classification = claim.authority_classification
                AND OLD.authority_id = claim.authority_id
                AND OLD.tenant_id::text = claim.tenant_id
                AND OLD.scope = claim.scope
                AND OLD.parent_id = claim.parent_id
                AND OLD.guarded_adoption_receipt_id = claim.adoption_receipt_id
                AND NEW.authority_classification IS NULL
                AND NEW.authority_id IS NULL
                AND NEW.scope IS NULL
                AND NEW.parent_id IS NULL
                AND NEW.guarded_adoption_receipt_id IS NULL
                AND NEW.tenant_id::text IS NOT DISTINCT FROM (
                  SELECT receipt.prior_tenant_id
                    FROM knowledge_guarded_adoption_receipts AS receipt
                   WHERE receipt.receipt_id = claim.adoption_receipt_id
                     AND receipt.action = 'adopt'
                     AND receipt.status = 'accepted'
                     AND receipt.effect_count = 1
                )
              )
            )
       ) INTO claim_matches;
       IF NOT claim_matches THEN
         RAISE EXCEPTION 'guarded knowledge item binding transition does not match its live adoption claim'
           USING ERRCODE = 'insufficient_privilege';
       END IF;
       RETURN NEW;
     END IF;

     IF NEW.authority_classification IS NULL OR NEW.authority_id IS NULL
        OR NEW.tenant_id IS NULL OR NEW.scope IS NULL OR NEW.parent_id IS NULL THEN
       RAISE EXCEPTION 'guarded knowledge item binding must be complete'
         USING ERRCODE = 'check_violation';
     END IF;

     claim_key := NULLIF(
       current_setting('hasna.knowledge_guarded_deterministic_key', true),
       ''
     );
     IF claim_key IS NULL THEN
       RAISE EXCEPTION 'guarded knowledge item mutation requires an FCAME-1 operation claim'
         USING ERRCODE = 'insufficient_privilege';
     END IF;

     SELECT EXISTS (
       SELECT 1
         FROM knowledge_guarded_write_claims AS claim
        WHERE claim.deterministic_key = claim_key
          AND claim.receipt_id IS NULL
          AND claim.target_id = NEW.id
          AND claim.authority_classification = NEW.authority_classification
          AND claim.authority_id = NEW.authority_id
          AND claim.tenant_id = NEW.tenant_id::text
          AND claim.scope = NEW.scope
          AND claim.parent_id = NEW.parent_id
          AND (
            (
              TG_OP = 'INSERT'
              AND claim.verb = 'create'
              AND claim.precondition_kind = 'absent'
            )
            OR (
              TG_OP = 'UPDATE'
              AND claim.verb = 'update'
              AND claim.precondition_kind = 'version'
              AND claim.expected_version = OLD.version
            )
          )
     ) INTO claim_matches;
     IF NOT claim_matches THEN
       RAISE EXCEPTION 'guarded knowledge item mutation does not match its live FCAME-1 operation claim'
         USING ERRCODE = 'insufficient_privilege';
     END IF;
     RETURN NEW;
   END
   $knowledge_guarded_item_authority$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_adoption_claim_once()
   RETURNS TRIGGER AS $knowledge_guarded_adoption_claim_once$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'knowledge guarded adoption claims are immutable'
         USING ERRCODE = 'restrict_violation';
     END IF;
     IF (OLD.deterministic_key, OLD.planned_receipt_id,
         OLD.operation_id, OLD.step_id, OLD.action,
         OLD.target_id, OLD.authority_classification, OLD.authority_id,
         OLD.tenant_id, OLD.scope, OLD.parent_id, OLD.expected_version,
         OLD.expected_content_sha256, OLD.adoption_receipt_id, OLD.created_at)
        IS DISTINCT FROM
        (NEW.deterministic_key, NEW.planned_receipt_id,
         NEW.operation_id, NEW.step_id, NEW.action,
         NEW.target_id, NEW.authority_classification, NEW.authority_id,
         NEW.tenant_id, NEW.scope, NEW.parent_id, NEW.expected_version,
         NEW.expected_content_sha256, NEW.adoption_receipt_id, NEW.created_at)
        OR OLD.receipt_id IS NOT NULL
        OR NEW.receipt_id IS NULL THEN
       RAISE EXCEPTION 'knowledge guarded adoption claim may only bind one terminal receipt'
         USING ERRCODE = 'restrict_violation';
     END IF;
     IF NEW.receipt_id IS DISTINCT FROM OLD.planned_receipt_id THEN
       RAISE EXCEPTION 'knowledge guarded adoption claim receipt must match its planned terminal receipt'
         USING ERRCODE = 'restrict_violation';
     END IF;
     RETURN NEW;
   END
   $knowledge_guarded_adoption_claim_once$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION knowledge_guarded_item_id_immutable()
   RETURNS TRIGGER AS $knowledge_guarded_item_id_immutable$
   BEGIN
     IF OLD.id IS DISTINCT FROM NEW.id
        AND NULLIF(
          current_setting('hasna.knowledge_guarded_adoption_key', true),
          ''
        ) IS NOT NULL THEN
       RAISE EXCEPTION 'guarded knowledge item identity and binding are immutable'
         USING ERRCODE = 'restrict_violation';
     END IF;
     RETURN NEW;
   END
   $knowledge_guarded_item_id_immutable$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_knowledge_guarded_00_item_id_immutable
     ON knowledge_items`,
  `CREATE TRIGGER trg_knowledge_guarded_00_item_id_immutable
     BEFORE UPDATE OF id ON knowledge_items
     FOR EACH ROW EXECUTE FUNCTION knowledge_guarded_item_id_immutable()`,
  `ALTER TABLE knowledge_items
     ENABLE ALWAYS TRIGGER trg_knowledge_guarded_00_item_id_immutable`,
  `ALTER TABLE knowledge_items
     DROP CONSTRAINT IF EXISTS knowledge_items_relation_metadata_contract`,
  `ALTER TABLE knowledge_items
     ADD CONSTRAINT knowledge_items_relation_metadata_contract CHECK (
       metadata -> 'hasna_knowledge_relations' IS NULL
       OR (
         jsonb_typeof(metadata -> 'hasna_knowledge_relations') = 'object'
         AND metadata #>> '{hasna_knowledge_relations,schema}' = 'hasna.knowledge.relations.v1'
         AND (
           metadata #>> '{hasna_knowledge_relations,supersedes_item_id}' IS NOT NULL
           OR metadata #>> '{hasna_knowledge_relations,canonical_item_id}' IS NOT NULL
         )
         AND (
           (metadata -> 'hasna_knowledge_relations')
           - ARRAY['schema', 'supersedes_item_id', 'canonical_item_id']
         ) = '{}'::jsonb
         AND (
           metadata #>> '{hasna_knowledge_relations,supersedes_item_id}' IS NULL
           OR (
             btrim(metadata #>> '{hasna_knowledge_relations,supersedes_item_id}') <> ''
             AND metadata #>> '{hasna_knowledge_relations,supersedes_item_id}' <> id
           )
         )
         AND (
           metadata #>> '{hasna_knowledge_relations,canonical_item_id}' IS NULL
           OR (
             btrim(metadata #>> '{hasna_knowledge_relations,canonical_item_id}') <> ''
             AND metadata #>> '{hasna_knowledge_relations,canonical_item_id}' <> id
           )
         )
       )
     )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_guarded_title
     ON knowledge_items (
       authority_classification, authority_id, tenant_id, scope, parent_id,
       title, archived, id
     )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_guarded_supersedes
     ON knowledge_items (
       authority_classification, authority_id, tenant_id, scope, parent_id,
       (metadata #>> '{hasna_knowledge_relations,supersedes_item_id}'),
       archived, id
     )
     WHERE metadata #>> '{hasna_knowledge_relations,schema}'
       = 'hasna.knowledge.relations.v1'`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_guarded_canonical
     ON knowledge_items (
       authority_classification, authority_id, tenant_id, scope, parent_id,
       (metadata #>> '{hasna_knowledge_relations,canonical_item_id}'),
       archived, id
     )
     WHERE metadata #>> '{hasna_knowledge_relations,schema}'
       = 'hasna.knowledge.relations.v1'`,
  ...postgresKnowledgeProjectLinksSchemaStatements()
];
export {
  wrapExecutor,
  storageEnvKeys,
  resolveTlsConfig,
  resolveTables,
  resolveStorageMode,
  resolveDatabaseUrl,
  parseStorageTables,
  normalizeStorageMode3 as normalizeStorageMode,
  normalizeStorageMode3 as normalizeCloudStorageMode,
  getSyncMetaAll,
  getStorageStatus,
  getStorageMode,
  defineMigration,
  createMigrationLedger,
  createKnowledgeCloudClient,
  checksumSql,
  checkReady,
  checkHealth,
  STORAGE_TABLES,
  STORAGE_MODE_ENV,
  PG_MIGRATIONS,
  MigrationLedger,
  KNOWLEDGE_STORAGE_TABLES,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_APP_NAME,
  KIT_VERSION
};
