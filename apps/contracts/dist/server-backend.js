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
function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
function resolveServerDataBackend(name, env = process.env) {
  const { databaseUrlKeys } = serverDataBackendEnvKeys(name);
  const databaseUrl = firstEnv(env, databaseUrlKeys);
  if (!databaseUrl) {
    return {
      backend: "sqlite",
      source: "default",
      databaseUrlPresent: false,
      databaseUrlSource: null
    };
  }
  return {
    backend: "postgresql",
    source: databaseUrl.key,
    databaseUrlPresent: true,
    databaseUrlSource: databaseUrl.key
  };
}
function resolveDatabaseUrl(name, env = process.env) {
  const hit = firstEnv(env, serverDataBackendEnvKeys(name).databaseUrlKeys);
  return hit?.value ?? null;
}
export {
  serverDataBackendEnvKeys,
  resolveServerDataBackend,
  resolveDatabaseUrl,
  envToken
};
