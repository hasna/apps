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

// src/client/app-home.ts
import { isAbsolute, join } from "path";
var APP_HOME_SCOPES = ["public", "internal"];
var HASNA_HOME_ENV_KEY = "HASNA_HOME";
var HASNA_CONFIG_HOME_ENV_KEY = "HASNA_CONFIG_HOME";
var HASNA_DATA_HOME_ENV_KEY = "HASNA_DATA_HOME";
var HASNA_STATE_HOME_ENV_KEY = "HASNA_STATE_HOME";
var HASNA_CACHE_HOME_ENV_KEY = "HASNA_CACHE_HOME";
var APP_HOME_ENV_KEYS = [
  HASNA_HOME_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  HASNA_DATA_HOME_ENV_KEY,
  HASNA_STATE_HOME_ENV_KEY,
  HASNA_CACHE_HOME_ENV_KEY
];
var PUBLIC_HOME_DIR_NAME = ".hasna";
var INTERNAL_HOME_DIR_NAME = ".hasna-internal";
var APP_CONFIG_SUBDIR = "config";
var APP_STATE_SUBDIR = "state";
var APP_CACHE_SUBDIR = "cache";
var APP_CREDENTIALS_FILE = "credentials";
var APP_HOME_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
function appScopeForPackageName(packageName) {
  if (packageName.startsWith("@hasna/"))
    return "public";
  if (packageName.startsWith("@hasna-internal/"))
    return "internal";
  return null;
}
function scopeHomeDirName(scope) {
  return scope === "internal" ? INTERNAL_HOME_DIR_NAME : PUBLIC_HOME_DIR_NAME;
}

class AppHomeUnresolvableError extends Error {
  appName;
  constructor(appName, message) {
    super(message);
    this.name = "AppHomeUnresolvableError";
    this.appName = appName;
  }
}
function absoluteOverride(env, key) {
  const value = env[key]?.trim();
  return value && isAbsolute(value) ? value : null;
}
function homeDir(env) {
  const home = env.HOME?.trim();
  return home ? home : null;
}
function resolveAppHome(name, env = process.env, options = {}) {
  if (!APP_HOME_SLUG_PATTERN.test(name)) {
    throw new AppHomeUnresolvableError(name, `App name '${name}' is not a safe path segment; use a lowercase dashed slug.`);
  }
  const scope = options.scope ?? "public";
  const rootOverride = absoluteOverride(env, HASNA_HOME_ENV_KEY);
  const home = homeDir(env);
  const root = rootOverride ?? (home ? join(home, scopeHomeDirName(scope)) : null);
  if (!root)
    return null;
  const appHome = join(root, name);
  const layer = (key, fallback) => {
    const override = absoluteOverride(env, key);
    return override ? { path: join(override, name), source: key } : { path: fallback, source: "home" };
  };
  const config = layer(HASNA_CONFIG_HOME_ENV_KEY, join(appHome, APP_CONFIG_SUBDIR));
  const data = layer(HASNA_DATA_HOME_ENV_KEY, appHome);
  const state = layer(HASNA_STATE_HOME_ENV_KEY, join(appHome, APP_STATE_SUBDIR));
  const cache = layer(HASNA_CACHE_HOME_ENV_KEY, join(appHome, APP_CACHE_SUBDIR));
  return Object.freeze({
    name,
    scope,
    root,
    home: appHome,
    config: config.path,
    credentials: join(config.path, APP_CREDENTIALS_FILE),
    data: data.path,
    state: state.path,
    cache: cache.path,
    localDb: join(data.path, `${name}.db`),
    sources: Object.freeze({
      root: rootOverride ? HASNA_HOME_ENV_KEY : "HOME",
      config: config.source,
      data: data.source,
      state: state.source,
      cache: cache.source
    })
  });
}
function appPaths(name, env = process.env, options = {}) {
  const resolved = resolveAppHome(name, env, options);
  if (!resolved) {
    throw new AppHomeUnresolvableError(name, `No HOME or ${HASNA_HOME_ENV_KEY} in this environment, so no home can be resolved for '${name}'.`);
  }
  return resolved;
}
export {
  scopeHomeDirName,
  resolveAppHome,
  appScopeForPackageName,
  appPaths,
  PUBLIC_HOME_DIR_NAME,
  INTERNAL_HOME_DIR_NAME,
  HASNA_STATE_HOME_ENV_KEY,
  HASNA_HOME_ENV_KEY,
  HASNA_DATA_HOME_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  HASNA_CACHE_HOME_ENV_KEY,
  AppHomeUnresolvableError,
  APP_STATE_SUBDIR,
  APP_HOME_SLUG_PATTERN,
  APP_HOME_SCOPES,
  APP_HOME_ENV_KEYS,
  APP_CREDENTIALS_FILE,
  APP_CONFIG_SUBDIR,
  APP_CACHE_SUBDIR
};
