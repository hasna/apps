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

// src/env-token.ts
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}

// src/server-backend.ts
function serverDataBackendEnvKeys(name) {
  const token = envToken(name);
  return {
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`, `${token}_DATABASE_URL`]
  };
}
function definedDatabaseUrlEntries(env, keys) {
  return keys.filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined).map((key) => ({ key, value: String(env[key]) }));
}
function assertPostgresqlDatabaseUrl(name, entries) {
  const canonicalKey = serverDataBackendEnvKeys(name).databaseUrlKeys[0];
  if (entries.length === 0) {
    throw new Error(`${canonicalKey} is required; Hasna servers use authoritative PostgreSQL and never default to SQLite.`);
  }
  const blank = entries.filter((entry) => entry.value.trim().length === 0);
  if (blank.length > 0) {
    throw new Error(`${blank.map((entry) => entry.key).join(" and ")} is set but blank; a PostgreSQL database URL is required.`);
  }
  const controlled = entries.find((entry) => /[\u0000-\u001f\u007f]/.test(entry.value));
  if (controlled)
    throw new Error(`${controlled.key} must not contain ASCII control characters.`);
  const normalized = entries.map((entry) => ({ key: entry.key, value: entry.value.trim() }));
  if (normalized.length > 1 && new Set(normalized.map((entry) => entry.value)).size > 1) {
    throw new Error(`${normalized.map((entry) => entry.key).join(" and ")} disagree; database URL aliases must be identical or only one may be set.`);
  }
  const selected = normalized[0];
  let parsed;
  try {
    parsed = new URL(selected.value);
  } catch {
    throw new Error(`${selected.key} must be an absolute PostgreSQL connection URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${selected.key} must use the postgres or postgresql scheme.`);
  }
  if (!parsed.hostname || parsed.pathname.length <= 1) {
    throw new Error(`${selected.key} must name a PostgreSQL host and database.`);
  }
  return selected;
}
function resolveServerDataBackend(name, env = process.env) {
  const { databaseUrlKeys } = serverDataBackendEnvKeys(name);
  const databaseUrl = assertPostgresqlDatabaseUrl(name, definedDatabaseUrlEntries(env, databaseUrlKeys));
  return {
    backend: "postgresql",
    source: databaseUrl.key,
    databaseUrlPresent: true,
    databaseUrlSource: databaseUrl.key
  };
}
function resolveDatabaseUrl(name, env = process.env) {
  const keys = serverDataBackendEnvKeys(name).databaseUrlKeys;
  return assertPostgresqlDatabaseUrl(name, definedDatabaseUrlEntries(env, keys)).value;
}
export {
  serverDataBackendEnvKeys,
  resolveServerDataBackend,
  resolveDatabaseUrl,
  envToken
};
