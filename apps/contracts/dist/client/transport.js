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

// src/client/transport.ts
import { isIP } from "net";

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

// src/client/credentials.ts
import { spawnSync } from "child_process";
import { closeSync, fstatSync, openSync, readFileSync } from "fs";
import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from "constants";
import { createRequire } from "module";
import { hostname as osHostname } from "os";
import { isAbsolute, join } from "path";
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

class CredentialFileUnsafeError extends Error {
  path;
  constructor(path, reason) {
    super(`Refusing unsafe credential/config file ${path}: ${reason}.`);
    this.name = "CredentialFileUnsafeError";
    this.path = path;
  }
}
var HASNA_HOME_ENV_KEY = "HASNA_HOME";
var HASNA_CONFIG_HOME_ENV_KEY = "HASNA_CONFIG_HOME";
var KEYCHAIN_STATION_ENV_KEY = "HASNA_STATION";
var HASNA_HOME_DIR = ".hasna";
var CONFIG_SUBDIR = "config";
var CREDENTIALS_FILE = "credentials";
var KEYCHAIN_SECURITY_BIN = "/usr/bin/security";
var KEYCHAIN_SERVICE_PREFIX = "hasna.credentials";
var KEYCHAIN_ITEM_NOT_FOUND_STATUS = 44;
var KEYCHAIN_SPAWN_TIMEOUT_MS = 1e4;
var MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
var SAFE_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
var SAFE_PROFILE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
var ILLEGAL_IN_HEADER_VALUE = /[^\t\x20-\x7e]/;
var VAULT_POINTER_SHAPE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-_.]*){2,}$/;
function homeDir(env) {
  const home = env.HOME?.trim();
  return home ? home : null;
}
function absoluteOverride(env, key) {
  const value = env[key]?.trim();
  return value && isAbsolute(value) ? value : null;
}
function hasnaHomeDir(env) {
  const override = absoluteOverride(env, HASNA_HOME_ENV_KEY);
  if (override)
    return override;
  const home = homeDir(env);
  return home ? join(home, HASNA_HOME_DIR) : null;
}
function appConfigDir(name, env) {
  const configRoot = absoluteOverride(env, HASNA_CONFIG_HOME_ENV_KEY);
  if (configRoot)
    return join(configRoot, name);
  const root = hasnaHomeDir(env);
  return root ? join(root, name, CONFIG_SUBDIR) : null;
}
function credentialDiskSourceList(name, env, profile = null) {
  if (!SAFE_APP_SLUG.test(name))
    return [];
  const directory = appConfigDir(name, env);
  if (!directory)
    return [];
  const file = profile ? `${CREDENTIALS_FILE}-${profile}` : CREDENTIALS_FILE;
  return [{ path: join(directory, file), tier: "disk" }];
}
function credentialDiskSources(name, env) {
  return credentialDiskSourceList(name, env, null).map((s) => s.path);
}
function profileDiskSources(name, env, profile) {
  return credentialDiskSourceList(name, env, profile).map((s) => s.path);
}
function parseEnvFile(text) {
  const values = new Map;
  const unusable = new Set;
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
      if (value.length < 2 || !value.endsWith(quote)) {
        unusable.add(key);
        continue;
      }
      value = value.slice(1, -1);
    }
    if (value.trim().length === 0) {
      unusable.add(key);
      continue;
    }
    if (values.has(key) && values.get(key) !== value)
      unusable.add(key);
    values.set(key, value);
  }
  return { values, unusable };
}
function configFileModeAllowed(mode) {
  const permissions = mode & 4095;
  return permissions === 256 || permissions === 384;
}
function configFileReadsCoherent(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
function readAppConfigFile(path) {
  const unsafe = (reason) => {
    throw new CredentialFileUnsafeError(path, reason);
  };
  let fd = -1;
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR")
      return null;
    if (code === "ELOOP")
      unsafe("the path is a symlink");
    unsafe(`the path could not be opened (${code ?? "unknown error"})`);
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile())
      unsafe("the path is not a regular file");
    if (!configFileModeAllowed(before.mode)) {
      unsafe(`permission mode ${(before.mode & 4095).toString(8).padStart(4, "0")} is not owner-only 0400 or 0600`);
    }
    const uid = process.getuid?.() ?? process.geteuid?.();
    if (uid !== undefined && before.uid !== uid)
      unsafe("the file is not owned by the current user");
    if (before.size > MAX_CREDENTIAL_FILE_BYTES)
      unsafe("the file exceeds the size limit");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (!configFileReadsCoherent(before, after)) {
      unsafe("the file changed while being read");
    }
    return parseEnvFile(bytes.toString("utf8"));
  } finally {
    if (fd !== -1)
      closeSync(fd);
  }
}
function readCredentialFile(path, apiKeyKeys) {
  const parsed = readAppConfigFile(path);
  if (!parsed)
    return null;
  for (const key of apiKeyKeys) {
    if (parsed.unusable.has(key)) {
      throw new CredentialFileUnsafeError(path, `${key} is declared but blank or malformed`);
    }
  }
  const values = apiKeyKeys.map((key) => parsed.values.get(key)?.trim()).filter((value) => Boolean(value));
  if (new Set(values).size > 1) {
    throw new CredentialFileUnsafeError(path, "credential aliases disagree");
  }
  return values[0] ?? null;
}
var CREDENTIAL_SHAPED_KEY = /(?:^|_)(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)(?:_|$)/;
function appConfigDiskValue(name, env, keys) {
  const wanted = keys.filter((key) => !CREDENTIAL_SHAPED_KEY.test(key));
  if (wanted.length === 0)
    return null;
  for (const path of credentialDiskSources(name, env)) {
    const parsed = readAppConfigFile(path);
    if (!parsed)
      continue;
    if (wanted.some((key) => parsed.unusable.has(key))) {
      return { key: wanted.find((key) => parsed.unusable.has(key)), value: "", path, unusable: true };
    }
    const values = wanted.map((key) => parsed.values.get(key)?.trim()).filter((value) => Boolean(value));
    if (new Set(values).size > 1)
      throw new CredentialFileUnsafeError(path, "configuration aliases disagree");
    for (const key of wanted) {
      if (parsed.unusable.has(key))
        return { key, value: "", path, unusable: true };
      const value = parsed.values.get(key)?.trim();
      if (value)
        return { key, value, path };
    }
  }
  return null;
}
function assertUsableCredential(appName, source, value) {
  if (VAULT_POINTER_SHAPE.test(value)) {
    throw new CredentialResolutionError(appName, `The credential from ${source} looks like a secrets-vault pointer (a path-shaped reference like ` + `'namespace/app/live/api_key'). A vault path is NEVER accepted as a literal API key. ` + `Use ${credentialPointerEnvKey(appName)} to resolve the key through the vault, or provide the actual key value.`, [source]);
  }
  if (!ILLEGAL_IN_HEADER_VALUE.test(value))
    return;
  throw new CredentialResolutionError(appName, `The credential from ${source} contains characters that cannot be sent in an HTTP header ` + `(a control character or non-ASCII byte). A file written with CR-only line endings is the usual ` + `cause. Rewrite that credential file with one LF-terminated KEY=value line. ` + `The value is not shown here, and is deliberately never logged.`, [source]);
}
var INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
var CREDENTIAL_SEAL = Symbol.for("hasna:contracts:sealedCredential");
var CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE = "caller-supplied CredentialProvider";
function sealCredential(fields) {
  const { apiKey } = fields;
  const visible = {
    tier: fields.tier,
    source: fields.source,
    deliberate: fields.deliberate,
    diskCandidates: Object.freeze([...fields.diskCandidates]),
    warning: fields.warning
  };
  const sealed = { ...visible };
  Object.defineProperty(sealed, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false
  });
  if (fields.pointerVaultKey !== undefined) {
    Object.defineProperty(sealed, "pointerVaultKey", {
      value: fields.pointerVaultKey,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
  Object.defineProperty(sealed, INSPECT_CUSTOM, {
    value: () => ({ ...visible, apiKey: "[redacted]" }),
    enumerable: false,
    writable: false,
    configurable: false
  });
  Object.defineProperty(sealed, CREDENTIAL_SEAL, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return Object.freeze(sealed);
}
function isSealedCredential(credential) {
  return credential[CREDENTIAL_SEAL] === true;
}
function explicitCredential(appName, apiKey) {
  const source = "explicit apiKey option";
  assertUsableCredential(appName, source, apiKey);
  return sealCredential({
    apiKey,
    tier: "argument",
    source,
    deliberate: true,
    diskCandidates: [],
    warning: null
  });
}
function validateAndSealResolvedCredential(appName, credential) {
  const apiKey = credential.apiKey;
  assertUsableCredential(appName, CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE, apiKey);
  if (!isSealedCredential(credential)) {
    return sealCredential({
      apiKey,
      tier: "argument",
      source: CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE,
      deliberate: true,
      diskCandidates: [],
      warning: null
    });
  }
  return sealCredential({
    apiKey,
    tier: credential.tier,
    source: credential.source,
    deliberate: credential.deliberate,
    diskCandidates: credential.diskCandidates,
    warning: credential.warning,
    ...credential.pointerVaultKey !== undefined ? { pointerVaultKey: credential.pointerVaultKey } : {}
  });
}
function firstEnvValue(env, keys) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(env, key))
      continue;
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
var AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");
function isAmbientEnvironment(env) {
  return env === process.env || env[AMBIENT_ENVIRONMENT] === true;
}
function defaultKeychainRunner(argv) {
  const result = spawnSync(KEYCHAIN_SECURITY_BIN, [...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: KEYCHAIN_SPAWN_TIMEOUT_MS
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.error ? result.error.message : result.stderr ?? ""
  };
}
function keychainTierEnabled(env, options) {
  if ((options.platform ?? process.platform) !== "darwin")
    return false;
  if (options.enabled !== undefined)
    return options.enabled;
  return options.run !== undefined || isAmbientEnvironment(env);
}
function keychainAccount(env, options) {
  const station = env[KEYCHAIN_STATION_ENV_KEY]?.trim();
  if (station)
    return station;
  const host = (options.hostname ?? osHostname)().split(".")[0]?.trim() ?? "";
  if (host)
    return host;
  const user = env.USER?.trim();
  return user || null;
}
function keychainFailureHint(text) {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0)?.trim() ?? "";
  const clean = line.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  return clean ? `: ${clean}` : "";
}
function readKeychainItem(name, env, kind, options) {
  if (!SAFE_APP_SLUG.test(name) || !keychainTierEnabled(env, options))
    return null;
  const account = keychainAccount(env, options);
  if (!account)
    return null;
  const service = `${KEYCHAIN_SERVICE_PREFIX}.${name}.${kind}`;
  const source = `keychain:${service}@${account}`;
  const run = options.run ?? defaultKeychainRunner;
  let result;
  try {
    result = run(["find-generic-password", "-a", account, "-s", service, "-w"]);
  } catch (error) {
    const reason = keychainFailureHint(error instanceof Error ? error.message : String(error));
    throw new CredentialResolutionError(name, `The Keychain lookup for ${source} could not run${reason}. A Keychain failure is never resolved ` + `around: fix the keychain, or delete the item to fall through to the credential on disk.`, [source]);
  }
  if (result.status === KEYCHAIN_ITEM_NOT_FOUND_STATUS)
    return null;
  if (result.status !== 0) {
    throw new CredentialResolutionError(name, `The Keychain lookup for ${source} failed (security exited ` + `${result.status ?? "without a status"}${keychainFailureHint(result.stderr)}). A Keychain item that ` + `exists but cannot be read is never resolved around: unlock the keychain, run from a session that ` + `may use it, or delete the item to fall through to the credential on disk.`, [source]);
  }
  const value = result.stdout.trim();
  if (!value) {
    throw new CredentialResolutionError(name, `${source} exists but holds an empty value; a declared item never falls through to another ` + `identity. Store a value in it or delete the item.`, [source]);
  }
  return { value, source };
}
function keychainConfigValue(name, env, options = {}) {
  return readKeychainItem(name, env, "api-url", options);
}
function snapshotClientEnvironment(name, env) {
  const keys = clientTransportEnvKeys(name);
  const ambient = isAmbientEnvironment(env);
  const snapshot = Object.create(null);
  for (const key of [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(name),
    credentialPointerEnvKey(name),
    CREDENTIAL_PROFILE_ENV_KEY,
    "HOME",
    HASNA_HOME_ENV_KEY,
    HASNA_CONFIG_HOME_ENV_KEY,
    KEYCHAIN_STATION_ENV_KEY,
    "USER"
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    if (!descriptor)
      continue;
    if (!("value" in descriptor)) {
      throw new CredentialResolutionError(name, `${key} is accessor-backed; client configuration requires own data properties.`, [key]);
    }
    if (descriptor.value !== undefined && typeof descriptor.value !== "string") {
      throw new CredentialResolutionError(name, `${key} must be a string data property.`, [key]);
    }
    snapshot[key] = descriptor.value;
  }
  if (ambient) {
    Object.defineProperty(snapshot, AMBIENT_ENVIRONMENT, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
  return Object.freeze(snapshot);
}
function resolveCredential(name, env, options = {}) {
  env = snapshotClientEnvironment(name, env);
  const { apiKeyKeys } = clientTransportEnvKeys(name);
  const diskPaths = credentialDiskSources(name, env);
  if (options.apiKey !== undefined) {
    const explicitKey = options.apiKey.trim();
    if (!explicitKey) {
      throw new CredentialResolutionError(name, "The explicit apiKey argument is blank; an explicit credential never falls through to another identity.", ["explicit apiKey argument"]);
    }
    assertUsableCredential(name, "the explicit apiKey argument", explicitKey);
    return sealCredential({
      apiKey: explicitKey,
      tier: "argument",
      source: "explicit apiKey argument",
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  const overrideKeyName = credentialOverrideEnvKey(name);
  const overrideRaw = Object.prototype.hasOwnProperty.call(env, overrideKeyName) ? env[overrideKeyName] : undefined;
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
      diskCandidates: diskPaths,
      warning: null
    });
  }
  const pointerKeyName = credentialPointerEnvKey(name);
  const pointerRaw = Object.prototype.hasOwnProperty.call(env, pointerKeyName) ? env[pointerKeyName] : undefined;
  if (pointerRaw !== undefined) {
    const pointer = pointerRaw.trim();
    if (!pointer) {
      throw new CredentialResolutionError(name, `${pointerKeyName} is set but empty. It is a deliberate vault pointer, so it is not resolved around: ` + `either give it a vault item key or unset it to fall back to the credential on disk.`, [pointerKeyName]);
    }
    if (!VAULT_POINTER_SHAPE.test(pointer)) {
      throw new CredentialResolutionError(name, `${pointerKeyName} must name a vault ITEM KEY (a path-shaped reference like ` + `'namespace/app/live/api_key'), not a credential value. A pointer that carries a literal is refused.`, [pointerKeyName]);
    }
    return sealCredential({
      apiKey: "",
      pointerVaultKey: pointer,
      tier: "pointer",
      source: pointerKeyName,
      deliberate: true,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  if (options.profile !== undefined && !options.profile.trim()) {
    throw new CredentialResolutionError(name, "The explicit profile argument is blank; an explicit identity selection never falls through.", ["explicit profile argument"]);
  }
  const profileRaw = Object.prototype.hasOwnProperty.call(env, CREDENTIAL_PROFILE_ENV_KEY) ? env[CREDENTIAL_PROFILE_ENV_KEY] : undefined;
  if (profileRaw !== undefined && !profileRaw.trim()) {
    throw new CredentialResolutionError(name, `${CREDENTIAL_PROFILE_ENV_KEY} is set but blank.`, [CREDENTIAL_PROFILE_ENV_KEY]);
  }
  const profile = options.profile?.trim() || profileRaw?.trim();
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
          diskCandidates: paths,
          warning: null
        });
      }
    }
    throw new CredentialResolutionError(name, `Profile '${profile}' (from ${profileSource}) has no ${apiKeyKeys[0]} for '${name}'. ` + `Looked in: ${paths.join(", ") || "<no HOME in this environment>"}. ` + `A profile names WHICH identity to use, so it is never resolved around \u2014 ` + `create the profile's credential file or unset ${CREDENTIAL_PROFILE_ENV_KEY}.`, paths);
  }
  const definedEnvEntries = apiKeyKeys.filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined).map((key) => ({ key, value: String(env[key]).trim() }));
  const blankEnv = definedEnvEntries.find((entry) => entry.value.length === 0);
  if (blankEnv) {
    throw new CredentialResolutionError(name, `${blankEnv.key} is set but blank; a declared credential never falls through to another alias or identity.`, [blankEnv.key]);
  }
  if (definedEnvEntries.length > 1 && new Set(definedEnvEntries.map((entry) => entry.value)).size > 1) {
    throw new CredentialResolutionError(name, `${definedEnvEntries.map((entry) => entry.key).join(" and ")} disagree; credential aliases must be identical or only one may be set.`, definedEnvEntries.map((entry) => entry.key));
  }
  const envHit = firstEnvValue(env, apiKeyKeys);
  const keychainHit = readKeychainItem(name, env, "api-key", options.keychain ?? {});
  if (keychainHit) {
    assertUsableCredential(name, keychainHit.source, keychainHit.value);
    const warning = envHit && envHit.value !== keychainHit.value ? `Credential sources disagree for '${name}': ${keychainHit.source} and ${envHit.key} hold ` + `different keys. ${keychainHit.source} wins, because the Keychain is re-read on every call while ` + `an environment variable is a snapshot. Reconcile them \u2014 a rotation that updated only one leaves ` + `the other to fail 401 wherever it is loaded first.` : null;
    return sealCredential({
      apiKey: keychainHit.value,
      tier: "keychain",
      source: keychainHit.source,
      deliberate: false,
      diskCandidates: diskPaths,
      warning
    });
  }
  const diskSourceList = credentialDiskSourceList(name, env, null);
  const diskHits = diskSourceList.map((src) => ({ src, value: readCredentialFile(src.path, apiKeyKeys) })).filter((hit) => hit.value !== null);
  if (diskHits.length > 0) {
    const winner = diskHits[0];
    assertUsableCredential(name, winner.src.path, winner.value);
    const divergentSources = [
      ...diskHits.slice(1).filter((hit) => hit.value !== winner.value).map((hit) => hit.src.path),
      ...envHit && envHit.value !== winner.value ? [envHit.key] : []
    ];
    const warning = divergentSources.length > 0 ? `Credential sources disagree for '${name}': ${winner.src.path} and ` + `${divergentSources.join(", ")} hold different keys. ${winner.src.path} wins, because a file on ` + `disk is re-read on every call while an environment variable is a snapshot. Reconcile them \u2014 ` + `a rotation that updated only one leaves the other to fail 401 wherever it is loaded first.` : null;
    return sealCredential({
      apiKey: winner.value,
      tier: winner.src.tier,
      source: winner.src.path,
      deliberate: false,
      diskCandidates: diskPaths,
      warning
    });
  }
  if (envHit) {
    assertUsableCredential(name, envHit.key, envHit.value);
    return sealCredential({
      apiKey: envHit.value,
      tier: "env",
      source: envHit.key,
      deliberate: false,
      diskCandidates: diskPaths,
      warning: null
    });
  }
  return null;
}
var SECRETS_PACKAGE_SPECIFIER = "@hasna/" + "secrets";
var requireSecretsSdk = createRequire(import.meta.url);
async function completePointerCredential(name, pointerResolution, env = process.env) {
  const vaultKey = pointerResolution.pointerVaultKey;
  const pointerEnvKey = pointerResolution.source;
  if (!vaultKey) {
    throw new CredentialResolutionError(name, `Pointer resolution from ${pointerEnvKey} carries no vault item key; this is a defect in the resolver.`, [pointerEnvKey]);
  }
  let secretsSdk;
  try {
    secretsSdk = requireSecretsSdk(SECRETS_PACKAGE_SPECIFIER);
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the secrets SDK (@hasna/secrets) is not installed ` + `in this process. A vault pointer is TERMINAL: install @hasna/secrets to resolve it, or unset ${pointerEnvKey}.`, [pointerEnvKey]);
  }
  let client;
  try {
    client = secretsSdk.createSecretsClientFromEnv(env);
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the secrets client could not be configured from this ` + `environment (the secrets service URL and key env are missing or invalid). A vault pointer is TERMINAL and ` + `never falls through to a literal or disk credential.`, [pointerEnvKey]);
  }
  let secret;
  try {
    secret = await client.getSecret({ key: vaultKey });
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the vault could not be reached or the item is ` + `unavailable. A vault pointer is TERMINAL and never falls through to a literal or disk credential.`, [pointerEnvKey]);
  }
  const value = secret.value;
  if (!value) {
    throw new CredentialResolutionError(name, `${pointerEnvKey} resolved vault item '${vaultKey}', but it holds no value. A vault pointer is TERMINAL.`, [pointerEnvKey]);
  }
  assertUsableCredential(name, `${pointerEnvKey} -> vault:${vaultKey}`, value);
  return sealCredential({
    apiKey: value,
    tier: "pointer",
    source: `${pointerEnvKey} -> vault:${vaultKey}`,
    deliberate: true,
    diskCandidates: pointerResolution.diskCandidates,
    warning: null
  });
}

// src/client/transport.ts
var FLEET_API_DOMAIN_ENV_KEY = "HASNA_FLEET_API_DOMAIN";
var NEUTRAL_FLEET_API_DOMAIN = "your-deployment.example";
var DEFAULT_FLEET_GATEWAY_ORIGIN = "https://api.hasna.com";
var DEFAULT_AUTHORITY_SOURCE = "default";
function defaultFleetGatewayBaseUrl(name) {
  return `${DEFAULT_FLEET_GATEWAY_ORIGIN}/${validateAppSlug(name)}`;
}
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
function fleetApiDomain(env = process.env) {
  return resolveFleetApiDomain(env).domain;
}
function defaultCloudBaseUrl(name, env = process.env) {
  return resolveDefaultCloudBaseUrl(name, env).baseUrl;
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
var CLIENT_TRANSPORTS = ["http"];

class ClientTransportConfigurationError extends Error {
  appName;
  sources;
  constructor(appName, message, sources = []) {
    super(message);
    this.name = "ClientTransportConfigurationError";
    this.appName = appName;
    this.sources = Object.freeze([...sources]);
  }
}
function resolveClientTransportSnapshot(name, env = process.env, options = {}) {
  env = snapshotClientEnvironment(name, env);
  const keys = clientTransportEnvKeys(name);
  const definedUrlEntries = keys.apiUrlKeys.filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined).map((key) => ({ key, raw: String(env[key]) }));
  const blankUrl = definedUrlEntries.find((entry) => entry.raw.trim().length === 0);
  if (blankUrl) {
    throw new ClientTransportConfigurationError(name, `${blankUrl.key} is set but blank; public clients require an explicit HTTPS API URL and never select local storage.`, [blankUrl.key]);
  }
  const controlledUrl = definedUrlEntries.find((entry) => ASCII_CONTROL_PATTERN.test(entry.raw));
  if (controlledUrl) {
    throw new ClientTransportConfigurationError(name, `${controlledUrl.key} contains ASCII control characters.`, [controlledUrl.key]);
  }
  const usableUrlEntries = definedUrlEntries.map((entry) => ({ key: entry.key, value: entry.raw.trim() }));
  if (usableUrlEntries.length > 1 && new Set(usableUrlEntries.map((entry) => entry.value)).size > 1) {
    throw new ClientTransportConfigurationError(name, `${usableUrlEntries.map((entry) => entry.key).join(" and ")} disagree; client authority aliases must be identical or only one may be set.`, usableUrlEntries.map((entry) => entry.key));
  }
  const envUrlHit = usableUrlEntries[0] ?? null;
  const keychainUrlHit = keychainConfigValue(name, env, options.credentials?.keychain);
  const diskConfigUrlHit = appConfigDiskValue(name, env, keys.apiUrlKeys);
  if (diskConfigUrlHit?.unusable) {
    throw new ClientTransportConfigurationError(name, `${diskConfigUrlHit.key} in ${diskConfigUrlHit.path} is declared but blank or malformed; public clients require a valid HTTPS service authority.`, [diskConfigUrlHit.path]);
  }
  const urlCandidates = [
    ...envUrlHit ? [envUrlHit] : [],
    ...keychainUrlHit ? [{ key: keychainUrlHit.source, value: keychainUrlHit.value }] : [],
    ...diskConfigUrlHit ? [{ key: diskConfigUrlHit.path, value: diskConfigUrlHit.value.trim() }] : []
  ];
  const configuredUrl = urlCandidates[0] ?? null;
  const divergentUrls = urlCandidates.filter((candidate) => candidate.value !== configuredUrl?.value);
  if (configuredUrl && divergentUrls.length > 0) {
    throw new ClientTransportConfigurationError(name, `${configuredUrl.key} and ${divergentUrls.map((candidate) => candidate.key).join(" and ")} select different service authorities; refusing to send a credential written for one authority to the other.`, urlCandidates.map((candidate) => candidate.key));
  }
  const warnings = [];
  if (configuredUrl && !envUrlHit) {
    warnings.push(`No ${keys.apiUrlKeys[0]} in the environment; the server URL in ${configuredUrl.key} was used, so this client connects to the server. ` + `Keep that entry aligned with the intended service authority.`);
  }
  const credential = resolveCredential(name, env, options.credentials);
  if (!credential) {
    const diskHint = credentialDiskSourcesForMessage(name, env);
    const lead = configuredUrl ? `${configuredUrl.key} selects the HTTP server for '${name}', but no API key could be resolved` : `${keys.apiUrlKeys[0]} is not set and no API key could be resolved for '${name}'; a credential is required before the default fleet gateway authority applies`;
    warnings.push(`${lead}; refusing to create an unauthenticated client \u2014 public clients never fall back to SQLite or another local store. ` + `Looked in the Keychain (macOS only), then for a credential file at ${diskHint}, then for ${keys.apiKeyKeys[0]} in the environment.`);
    throw new ClientTransportConfigurationError(name, warnings.join(" "), [configuredUrl?.key ?? keys.apiUrlKeys[0]]);
  }
  if (credential.warning)
    warnings.push(credential.warning);
  let urlHit;
  if (configuredUrl) {
    urlHit = configuredUrl;
  } else {
    try {
      urlHit = { key: DEFAULT_AUTHORITY_SOURCE, value: defaultFleetGatewayBaseUrl(name) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ClientTransportConfigurationError(name, `No ${keys.apiUrlKeys[0]} is configured and the default fleet gateway authority cannot be composed for '${name}': ${message}`, [keys.apiUrlKeys[0]]);
    }
  }
  const apiUrlSource = urlHit.key;
  let baseUrl;
  try {
    baseUrl = toV1BaseUrl(urlHit.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ClientTransportConfigurationError(name, `Invalid API URL from ${apiUrlSource}: ${message}`, [apiUrlSource]);
  }
  return {
    resolution: {
      transport: "http",
      transportSource: urlHit.key,
      baseUrl,
      apiUrlSource,
      apiKeyPresent: true,
      apiKeySource: credential.source,
      apiKeyTier: credential.tier,
      misconfigured: false,
      warning: warnings.length > 0 ? warnings.join(" ") : null
    },
    credential
  };
}
function resolveClientTransport(name, env = process.env, options = {}) {
  return resolveClientTransportSnapshot(name, env, options).resolution;
}
function credentialDiskSourcesForMessage(name, env) {
  const paths = credentialDiskSources(name, env);
  return paths.length > 0 ? paths.join(" or ") : "<no HOME or HASNA_HOME set in this environment, so no credential file was consulted>";
}

class HasnaHttpError extends Error {
  status;
  method;
  path;
  credentialSource;
  credentialTier;
  constructor(method, path, status, body, credential) {
    const guidance = credential ? `. ${credential.guidance}` : "";
    super(`Hasna cloud request failed: ${method} ${path} -> ${status}${guidance}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    Object.defineProperty(this, "body", {
      value: body,
      enumerable: status !== 401 && status !== 403,
      writable: false,
      configurable: false
    });
    this.credentialSource = credential?.source ?? null;
    this.credentialTier = credential?.tier ?? null;
  }
}
function currentCredential(name, apiKey) {
  if (typeof apiKey === "function") {
    return validateAndSealResolvedCredential(name, apiKey());
  }
  return explicitCredential(name, apiKey);
}
async function resolveRequestCredential(name, apiKey, env = process.env) {
  const resolved = currentCredential(name, apiKey);
  if (resolved.tier === "pointer") {
    return completePointerCredential(name, resolved, env);
  }
  return resolved;
}
function authFailureGuidance(credential) {
  const origin = `The API key for this request came from ${credential.source}`;
  if (credential.deliberate) {
    const remedy = credential.source === CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE ? `Fix that provider so it returns the current key, or replace it with resolveCredential() ` + `so diagnostics can name the original source.` : `Rotate that key, or unset the override to use the credential on disk.`;
    return `${origin} \u2014 a credential you selected deliberately. It was NOT substituted with any other key: ` + `falling back here would authenticate as a different principal than the one you named, which is ` + `exactly the failure an override exists to prevent. ${remedy}`;
  }
  if (credential.tier === "env") {
    const target = credential.diskCandidates[0];
    const remedy = target ? `Store the CURRENT key in the Keychain or write it to ${target} \u2014 both are re-read on every call, so ` + `rotations take effect immediately and in every shell. Do not simply unset ${credential.source}: ` + `nothing was found in the Keychain or on disk, so that would leave this client with no credential at all.` : `This environment has no HOME or HASNA_HOME, so no credential file could be consulted; the disk tier is ` + `unavailable here and there is nothing to fall back to. Set HOME, or supply the key explicitly.`;
    return `${origin}, a variable in this process's environment. If a wrapper injected it for this one process, the ` + `wrapper re-reads its store on every invocation and the stored key itself is being rejected \u2014 rotate it. ` + `If this SHELL exported it, the export is a snapshot taken when the shell started: a STALE SHELL that ` + `exported the key before it was rotated keeps sending the old one until it exits. ${remedy}`;
  }
  if (credential.tier === "keychain") {
    return `${origin}, which was re-read from the Keychain on this very call \u2014 so a stale shell is NOT the cause ` + `here. The stored item is genuinely being rejected: update it with the current key, or re-run the fleet ` + `key distribution so this machine gets the current key.`;
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
var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function createHasnaHttpTransportInternal(options, requestBindingProvider) {
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
    const authenticationFailure = response.status === 401 || response.status === 403;
    let parsed = undefined;
    if (authenticationFailure) {
      try {
        await response.body?.cancel();
      } catch {}
    } else {
      const text = await response.text();
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
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
      if (authenticationFailure) {
        return {
          ok: false,
          retryable: false,
          error: new HasnaHttpError(method, rel, response.status, undefined, {
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
    const retry = resolveRetry(opts.retry);
    const methodRetryable = IDEMPOTENT_METHODS.has(upper) || Boolean(opts.idempotencyKey);
    const maxAttempts = retry && methodRetryable ? retry.retries + 1 : 1;
    const binding = requestBindingProvider ? await requestBindingProvider() : {
      baseUrl: base,
      credential: await resolveRequestCredential(options.name, options.apiKey)
    };
    const url = `${binding.baseUrl}${rel}`;
    const credential = binding.credential;
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
function createHasnaHttpTransport(options) {
  return createHasnaHttpTransportInternal(options);
}
function createClientTransport(name, env = process.env, overrides) {
  const credentialOptions = overrides?.credentials;
  const snapshotOptions = { ...credentialOptions ? { credentials: credentialOptions } : {} };
  const resolution = resolveClientTransportSnapshot(name, env, snapshotOptions).resolution;
  const sameBinding = (left, right) => left.resolution.baseUrl === right.resolution.baseUrl && left.credential.apiKey === right.credential.apiKey && left.credential.pointerVaultKey === right.credential.pointerVaultKey && left.credential.source === right.credential.source && left.credential.tier === right.credential.tier;
  const unstableConfiguration = () => new ClientTransportConfigurationError(name, "The configured service authority or credential changed while a request was being prepared; no authenticated request was sent.");
  const requestBindingProvider = async () => {
    const first = resolveClientTransportSnapshot(name, env, snapshotOptions);
    const reviewed = resolveClientTransportSnapshot(name, env, snapshotOptions);
    if (!sameBinding(first, reviewed))
      throw unstableConfiguration();
    if (reviewed.resolution.baseUrl !== resolution.baseUrl) {
      throw new ClientTransportConfigurationError(name, "The configured service authority changed; rebuild the client before sending credentials.");
    }
    const credential = await resolveRequestCredential(name, () => reviewed.credential, env);
    const immediatelyBeforeDispatch = resolveClientTransportSnapshot(name, env, snapshotOptions);
    if (!sameBinding(reviewed, immediatelyBeforeDispatch))
      throw unstableConfiguration();
    if (immediatelyBeforeDispatch.resolution.baseUrl !== resolution.baseUrl) {
      throw new ClientTransportConfigurationError(name, "The configured service authority changed; rebuild the client before sending credentials.");
    }
    return { baseUrl: immediatelyBeforeDispatch.resolution.baseUrl, credential };
  };
  return {
    transport: "http",
    client: createHasnaHttpTransportInternal({
      name,
      baseUrl: resolution.baseUrl,
      apiKey: () => {
        throw new Error("The authenticated request binding provider was not invoked.");
      },
      ...overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {},
      ...overrides?.headers ? { headers: overrides.headers } : {},
      ...overrides?.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {},
      ...overrides?.retry !== undefined ? { retry: overrides.retry } : {},
      ...overrides?.sleepImpl ? { sleepImpl: overrides.sleepImpl } : {}
    }, requestBindingProvider),
    resolution
  };
}
export {
  toV1BaseUrl,
  resolveCredential,
  resolveClientTransport,
  keychainConfigValue,
  fleetApiDomain,
  explicitCredential,
  defaultFleetGatewayBaseUrl,
  defaultCloudBaseUrl,
  credentialPointerEnvKey,
  credentialOverrideEnvKey,
  credentialDiskSources,
  credentialDiskSourceList,
  createHasnaHttpTransport,
  createClientTransport,
  completePointerCredential,
  clientTransportEnvKeys,
  appendQuery,
  appConfigDiskValue,
  KEYCHAIN_STATION_ENV_KEY,
  HasnaHttpError,
  HASNA_HOME_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  DEFAULT_FLEET_GATEWAY_ORIGIN,
  DEFAULT_AUTHORITY_SOURCE,
  CredentialResolutionError,
  ClientTransportConfigurationError,
  CREDENTIAL_PROFILE_ENV_KEY,
  CLIENT_TRANSPORTS
};
