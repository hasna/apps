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

// src/paths.ts
import { homedir } from "os";
import { join } from "path";
var PATH_KIND_ENV = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME"
};
var PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function assertApp(app) {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(`paths: invalid app slug "${app}" \u2014 expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`);
  }
}
function assertKind(kind) {
  if (!Object.keys(PATH_KIND_ENV).includes(kind)) {
    throw new TypeError(`paths: invalid path kind "${kind}" \u2014 expected one of ${Object.keys(PATH_KIND_ENV).join(", ")}`);
  }
}
function effectiveHome(env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}
function kindEnv(kind) {
  assertKind(kind);
  return PATH_KIND_ENV[kind];
}
function baseDir(kind, options) {
  assertKind(kind);
  const env = options.env ?? process.env;
  const override = env[PATH_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0)
    return override;
  const home = options.home ?? effectiveHome(options.env);
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return join(home, ".hasna");
  }
  switch (kind) {
    case "config":
      return join(home, ".config", "hasna");
    case "data":
      return join(home, ".local", "share", "hasna");
    case "state":
      return join(home, ".local", "state", "hasna");
    case "cache":
      return join(home, ".cache", "hasna");
  }
}
function resolveDir(kind, options) {
  assertKind(kind);
  assertApp(options.app);
  const appSegment = options.internal === true ? join("internal", options.app) : options.app;
  return join(baseDir(kind, options), appSegment);
}
function dataDir(options) {
  return resolveDir("data", options);
}
function configDir(options) {
  return resolveDir("config", options);
}
function stateDir(options) {
  return resolveDir("state", options);
}
function cacheDir(options) {
  return resolveDir("cache", options);
}
export {
  stateDir,
  resolveDir,
  kindEnv,
  effectiveHome,
  dataDir,
  configDir,
  cacheDir,
  baseDir,
  PATH_KIND_ENV
};
