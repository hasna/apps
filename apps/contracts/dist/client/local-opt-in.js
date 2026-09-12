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

// src/client/errors.ts
var CLIENT_RESOLUTION_CODES = [
  "CREDENTIAL_ABSENT",
  "CREDENTIAL_UNREADABLE",
  "CREDENTIAL_REJECTED",
  "AUTHORITY_MISSING",
  "AUTHORITY_INVALID",
  "AUTHORITY_CONFLICT",
  "LOCAL_OPT_IN_CONFLICT",
  "TRANSPORT_UNAVAILABLE",
  "NOT_AVAILABLE_HOSTED"
];
var CLIENT_RESOLUTION_EXIT_CODES = Object.freeze({
  CREDENTIAL_ABSENT: 2,
  CREDENTIAL_UNREADABLE: 3,
  CREDENTIAL_REJECTED: 4,
  AUTHORITY_MISSING: 5,
  AUTHORITY_INVALID: 5,
  AUTHORITY_CONFLICT: 5,
  LOCAL_OPT_IN_CONFLICT: 6,
  TRANSPORT_UNAVAILABLE: 7,
  NOT_AVAILABLE_HOSTED: 8
});
var CLIENT_RESOLUTION_CODE_DESCRIPTIONS = Object.freeze({
  CREDENTIAL_ABSENT: "no credential in the Keychain, the credentials file, or the environment, and the local opt-in is off",
  CREDENTIAL_UNREADABLE: "a credential source exists but cannot be read or holds an unusable value",
  CREDENTIAL_REJECTED: "the authority rejected the presented credential (401/403)",
  AUTHORITY_MISSING: "no service authority is configured and the fleet gateway default cannot be composed",
  AUTHORITY_INVALID: "a declared service authority is not a usable HTTPS URL",
  AUTHORITY_CONFLICT: "configured service authorities disagree or changed during a request",
  LOCAL_OPT_IN_CONFLICT: "the local opt-in and hosted client configuration were both declared",
  TRANSPORT_UNAVAILABLE: "the service authority could not be reached",
  NOT_AVAILABLE_HOSTED: "the command is server-only and has no hosted client path"
});
function isClientResolutionCode(value) {
  return typeof value === "string" && CLIENT_RESOLUTION_CODES.includes(value);
}
function exitCodeForClientResolutionCode(code) {
  return CLIENT_RESOLUTION_EXIT_CODES[code];
}

class ClientResolutionError extends Error {
  code;
  exitCode;
  app;
  sources;
  remedy;
  constructor(code, app, message, options = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    if (!isClientResolutionCode(code)) {
      throw new TypeError(`Unknown client resolution code: ${String(code)}`);
    }
    this.name = "ClientResolutionError";
    this.code = code;
    this.exitCode = CLIENT_RESOLUTION_EXIT_CODES[code];
    this.app = app;
    this.sources = Object.freeze([...options.sources ?? []]);
    this.remedy = options.remedy ?? null;
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      exitCode: this.exitCode,
      app: this.app,
      message: this.message,
      sources: [...this.sources],
      remedy: this.remedy
    };
  }
}
function isClientResolutionError(value) {
  return value instanceof ClientResolutionError;
}
function clientResolutionCodeOf(error) {
  if (!error || typeof error !== "object")
    return null;
  const code = error.code;
  return isClientResolutionCode(code) ? code : null;
}
function clientResolutionExitCode(error, fallback = 1) {
  const code = clientResolutionCodeOf(error);
  return code ? CLIENT_RESOLUTION_EXIT_CODES[code] : fallback;
}
function formatClientResolutionFailure(error, options = {}) {
  const app = options.app ?? error.app ?? "client";
  if (options.json) {
    return JSON.stringify({ ...error.toJSON(), app });
  }
  const oneLine = (text) => text.replace(/\s*\n\s*/g, " ").trim();
  const remedy = error.remedy ? ` ${oneLine(error.remedy)}` : "";
  return `${app}: ${error.code}: ${oneLine(error.message)}${remedy}`;
}

// src/env-token.ts
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}

// src/client/env-keys.ts
function clientTransportEnvKeys(name) {
  const envSegment = envToken(name);
  return {
    apiUrlKeys: [`HASNA_${envSegment}_API_URL`, `${envSegment}_API_URL`],
    apiKeyKeys: [`HASNA_${envSegment}_API_KEY`, `${envSegment}_API_KEY`]
  };
}
function credentialOverrideEnvKey(name) {
  return `HASNA_${envToken(name)}_API_KEY_OVERRIDE`;
}
var CREDENTIAL_PROFILE_ENV_KEY = "HASNA_PROFILE";
function credentialPointerEnvKey(name) {
  return `HASNA_${envToken(name)}_API_KEY_REF`;
}

// src/client/local-opt-in.ts
function localOptInEnvKey(name) {
  return `HASNA_${envToken(name)}_LOCAL`;
}
function localOptInAliasEnvKey(name) {
  return `${envToken(name)}_LOCAL`;
}
var LOCAL_OPT_IN_TRUE_VALUES = ["1", "true", "yes"];
var LOCAL_OPT_IN_FALSE_VALUES = ["", "0", "false", "no"];
function hostedClientEnvKeys(name) {
  const keys = clientTransportEnvKeys(name);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(name),
    credentialPointerEnvKey(name),
    CREDENTIAL_PROFILE_ENV_KEY
  ];
}
function ownStringValue(env, key) {
  if (!Object.prototype.hasOwnProperty.call(env, key))
    return;
  const descriptor = Object.getOwnPropertyDescriptor(env, key);
  if (!descriptor || !("value" in descriptor))
    return;
  const value = descriptor.value;
  return typeof value === "string" ? value : undefined;
}
function flagState(raw) {
  if (raw === undefined)
    return "unset";
  const normalized = raw.trim().toLowerCase();
  if (LOCAL_OPT_IN_TRUE_VALUES.includes(normalized))
    return "on";
  if (LOCAL_OPT_IN_FALSE_VALUES.includes(normalized))
    return "off";
  return "unrecognized";
}
function describeLocalOptIn(name, env = process.env) {
  const envKey = localOptInEnvKey(name);
  const aliasKey = localOptInAliasEnvKey(name);
  const canonical = flagState(ownStringValue(env, envKey));
  const alias = flagState(ownStringValue(env, aliasKey));
  const recognized = canonical !== "unrecognized" && alias !== "unrecognized";
  let on = false;
  let source = null;
  const conflicts = [];
  if (canonical === "on") {
    on = true;
    source = envKey;
    if (alias === "off")
      conflicts.push(aliasKey);
  } else if (canonical === "off") {
    if (alias === "on")
      conflicts.push(aliasKey);
  } else if (alias === "on") {
    on = true;
    source = aliasKey;
  }
  if (on) {
    for (const key of hostedClientEnvKeys(name)) {
      if (ownStringValue(env, key) !== undefined)
        conflicts.push(key);
    }
  }
  const state = conflicts.length > 0 ? "conflict" : on ? "on" : "off";
  return { state, envKey, source, conflicts, recognized };
}
function selectsLocalStore(name, env = process.env) {
  const described = describeLocalOptIn(name, env);
  if (described.state === "conflict") {
    throw new ClientResolutionError("LOCAL_OPT_IN_CONFLICT", name, `${described.source ?? described.envKey} selects the on-box store for '${name}', but ${described.conflicts.join(", ")} ` + `${described.conflicts.length === 1 ? "is" : "are"} also declared; a process runs against exactly one store.`, {
      sources: [described.source ?? described.envKey, ...described.conflicts],
      remedy: `Unset ${described.envKey} to use the hosted service, or unset the hosted keys to use the on-box store.`
    });
  }
  return described.state === "on";
}
function localStoreNotice(name, storePath) {
  return `local mode (${localOptInEnvKey(name)}=1): on-box store ${storePath}; hosted data is NOT visible`;
}
export {
  selectsLocalStore,
  localStoreNotice,
  localOptInEnvKey,
  localOptInAliasEnvKey,
  hostedClientEnvKeys,
  describeLocalOptIn,
  LOCAL_OPT_IN_TRUE_VALUES,
  LOCAL_OPT_IN_FALSE_VALUES
};
