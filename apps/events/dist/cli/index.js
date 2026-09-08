#!/usr/bin/env bun
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

// src/redaction.ts
function redactPaths(event, paths, replacement = "[REDACTED]") {
  if (paths.length === 0)
    return event;
  const copy = structuredClone(event);
  for (const path of paths) {
    setPath(copy, path, replacement);
  }
  return copy;
}
function redactSensitiveKeys(event, replacement = "[REDACTED]") {
  return redactValue(event, replacement);
}
function shouldRedactKey(key) {
  return /secret|token|password|api[_-]?key|authorization/i.test(key);
}
function redactValue(value, replacement) {
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, replacement));
  if (!value || typeof value !== "object")
    return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    shouldRedactKey(key) ? replacement : redactValue(item, replacement)
  ]));
}
function setPath(input, path, replacement) {
  const parts = path.split(".");
  let cursor = input;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== "object")
      return;
    cursor = next;
  }
  const last = parts.at(-1);
  if (last && last in cursor)
    cursor[last] = replacement;
}

// ../contracts/dist/client/transport.js
import { isIP as isIP2 } from "net";
import { spawnSync } from "child_process";
import { closeSync, fstatSync, openSync, readFileSync } from "fs";
import { O_NOFOLLOW, O_NONBLOCK, O_RDONLY } from "constants";
import { createRequire } from "module";
import { hostname as osHostname } from "os";
import { isAbsolute, join as join3 } from "path";
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
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
function credentialPointerEnvKey(name) {
  return `HASNA_${envToken(name)}_API_KEY_REF`;
}
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
  return home ? join3(home, HASNA_HOME_DIR) : null;
}
function appConfigDir(name, env) {
  const configRoot = absoluteOverride(env, HASNA_CONFIG_HOME_ENV_KEY);
  if (configRoot)
    return join3(configRoot, name);
  const root = hasnaHomeDir(env);
  return root ? join3(root, name, CONFIG_SUBDIR) : null;
}
function credentialDiskSourceList(name, env, profile = null) {
  if (!SAFE_APP_SLUG.test(name))
    return [];
  const directory = appConfigDir(name, env);
  if (!directory)
    return [];
  const file = profile ? `${CREDENTIALS_FILE}-${profile}` : CREDENTIALS_FILE;
  return [{ path: join3(directory, file), tier: "disk" }];
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
function defaultFleetGatewayBaseUrl(name) {
  return `${DEFAULT_FLEET_GATEWAY_ORIGIN}/${validateAppSlug(name)}`;
}
function isValidDnsDomain(value) {
  if (value.length === 0 || value.length > 253 || ASCII_CONTROL_PATTERN.test(value) || /[^\x00-\x7f]/.test(value)) {
    return false;
  }
  return value.split(".").every((label) => label.length <= 63 && !label.startsWith("xn--") && DNS_LABEL_PATTERN.test(label));
}
function validateAppSlug(name) {
  if (name.length > 63 || !DNS_LABEL_PATTERN.test(name)) {
    throw new Error("App name must be one lowercase DNS label.");
  }
  return name;
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
    if (isIP2(rawHostname.slice(1, -1)) !== 6) {
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
    const ipVersion = isIP2(rawHostname);
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
function credentialDiskSourcesForMessage(name, env) {
  const paths = credentialDiskSources(name, env);
  return paths.length > 0 ? paths.join(" or ") : "<no HOME or HASNA_HOME set in this environment, so no credential file was consulted>";
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
var CREDENTIAL_PROFILE_ENV_KEY = "HASNA_PROFILE", CredentialResolutionError, CredentialFileUnsafeError, HASNA_HOME_ENV_KEY = "HASNA_HOME", HASNA_CONFIG_HOME_ENV_KEY = "HASNA_CONFIG_HOME", KEYCHAIN_STATION_ENV_KEY = "HASNA_STATION", HASNA_HOME_DIR = ".hasna", CONFIG_SUBDIR = "config", CREDENTIALS_FILE = "credentials", KEYCHAIN_SECURITY_BIN = "/usr/bin/security", KEYCHAIN_SERVICE_PREFIX = "hasna.credentials", KEYCHAIN_ITEM_NOT_FOUND_STATUS = 44, KEYCHAIN_SPAWN_TIMEOUT_MS = 1e4, MAX_CREDENTIAL_FILE_BYTES, SAFE_APP_SLUG, SAFE_PROFILE, ILLEGAL_IN_HEADER_VALUE, VAULT_POINTER_SHAPE, CREDENTIAL_SHAPED_KEY, INSPECT_CUSTOM, CREDENTIAL_SEAL, CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE = "caller-supplied CredentialProvider", AMBIENT_ENVIRONMENT, SECRETS_PACKAGE_SPECIFIER, requireSecretsSdk, DEFAULT_FLEET_GATEWAY_ORIGIN = "https://api.hasna.com", DEFAULT_AUTHORITY_SOURCE = "default", ASCII_CONTROL_PATTERN, DNS_LABEL_PATTERN, ClientTransportConfigurationError, HasnaHttpError, DEFAULT_RETRY_STATUSES, IDEMPOTENT_METHODS, AUTHORITY_OVERRIDE_HEADERS, defaultSleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
var init_transport = __esm(() => {
  CredentialResolutionError = class CredentialResolutionError extends Error {
    appName;
    attempted;
    constructor(appName, message, attempted) {
      super(message);
      this.name = "CredentialResolutionError";
      this.appName = appName;
      this.attempted = attempted;
    }
  };
  CredentialFileUnsafeError = class CredentialFileUnsafeError extends Error {
    path;
    constructor(path, reason) {
      super(`Refusing unsafe credential/config file ${path}: ${reason}.`);
      this.name = "CredentialFileUnsafeError";
      this.path = path;
    }
  };
  MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
  SAFE_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  SAFE_PROFILE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
  ILLEGAL_IN_HEADER_VALUE = /[^\t\x20-\x7e]/;
  VAULT_POINTER_SHAPE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-_.]*){2,}$/;
  CREDENTIAL_SHAPED_KEY = /(?:^|_)(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)(?:_|$)/;
  INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");
  CREDENTIAL_SEAL = Symbol.for("hasna:contracts:sealedCredential");
  AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");
  SECRETS_PACKAGE_SPECIFIER = "@hasna/" + "secrets";
  requireSecretsSdk = createRequire(import.meta.url);
  ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
  DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  ClientTransportConfigurationError = class ClientTransportConfigurationError extends Error {
    appName;
    sources;
    constructor(appName, message, sources = []) {
      super(message);
      this.name = "ClientTransportConfigurationError";
      this.appName = appName;
      this.sources = Object.freeze([...sources]);
    }
  };
  HasnaHttpError = class HasnaHttpError extends Error {
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
  };
  DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];
  IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
  AUTHORITY_OVERRIDE_HEADERS = new Set([
    "host",
    ":authority",
    "forwarded",
    "x-forwarded-host",
    "x-original-host"
  ]);
});

// src/intake/protocol.ts
import { createHash } from "crypto";
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
    throw new IntakeError("invalid_identity");
  return value;
}
function sourceIdentity(value) {
  if (typeof value !== "string" || !SOURCE_ID_PATTERN.test(value))
    throw new IntakeError("invalid_source_identity");
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
  return { sink_id: uuid(b.sink_id), producer_id: uuid(b.producer_id), corpus_id: sourceIdentity(b.corpus_id), source_authority_id: sourceIdentity(b.source_authority_id) };
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
var INTAKE_PROTOCOL = "hasna.events.intake.v1", CANONICAL_ENCODING = "hasna.sorted-json.v1", MAX_ENVELOPE_BYTES, MAX_REQUEST_BYTES, IntakeError, SOURCE_ID_PATTERN;
var init_protocol = __esm(() => {
  MAX_ENVELOPE_BYTES = 256 * 1024;
  MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES * 2 + 8192;
  IntakeError = class IntakeError extends Error {
    code;
    status;
    constructor(code, status = 400) {
      super(code);
      this.code = code;
      this.status = status;
    }
  };
  SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$(?![\s\S])/;
});

// src/intake/generated.ts
function acceptEvent(client, body, options) {
  return client.request("POST", "/intake/events", body, options);
}
function intakeCapability(client, options) {
  return client.request("GET", "/intake/capability", undefined, options);
}
function readReceipt(client, options) {
  return client.request("GET", "/intake/receipts", undefined, options);
}

// src/intake/client.ts
function createIntakeClient(options) {
  const binding = Object.freeze(validateBinding(options.binding));
  const tenant = boundedText(options.tenantId, 256);
  const { client, resolution } = createClientTransport("events", options.env ?? process.env, { credentials: options.credentials, retry: false, timeoutMs: 15000 });
  const headers = { "x-events-sink-id": binding.sink_id, "x-events-producer-id": binding.producer_id, "x-events-corpus-id": binding.corpus_id, "x-events-source-authority-id": binding.source_authority_id, "x-events-tenant-id": tenant };
  return Object.freeze({
    baseUrl: resolution.baseUrl,
    async capability() {
      const r = object(await intakeCapability(client, { headers, retry: false }));
      if (r.protocol !== INTAKE_PROTOCOL || r.tenant_id !== tenant || JSON.stringify(validateBinding(r)) !== JSON.stringify(binding) || typeof r.kid !== "string" || !r.kid)
        throw new IntakeError("intake_capability_mismatch", 502);
    },
    async accept(raw, signal) {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding))
        throw new IntakeError("client_binding_mismatch");
      const response = await acceptEvent(client, request, { headers, retry: false, signal });
      return validateReceipt(response, request, tenant);
    },
    async receipt(raw, signal) {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding))
        throw new IntakeError("client_binding_mismatch");
      const response = await readReceipt(client, { headers, query: { event_id: request.event_id }, retry: false, signal });
      return validateReceipt(response, request, tenant);
    }
  });
}
var init_client = __esm(() => {
  init_transport();
  init_protocol();
  init_protocol();
});

// src/intake/cli.ts
var exports_cli = {};
__export(exports_cli, {
  runIntakeCli: () => runIntakeCli
});
async function runIntakeCli(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(`events intake capability|accept|receipt --tenant-id ID --sink-id UUID --producer-id UUID --corpus-id ID --source-authority-id ID
accept and receipt read one frozen IntakeRequest JSON object from stdin. Uses saved Events API credentials; no local store.`);
    return;
  }
  try {
    const [operation, ...rest] = args;
    if (!["capability", "accept", "receipt"].includes(operation))
      throw new Error;
    const opts = {};
    for (let i = 0;i < rest.length; i += 2) {
      const k = rest[i], v = rest[i + 1];
      if (!k || !v || Object.hasOwn(opts, k))
        throw new Error;
      opts[k] = v;
    }
    const keys = ["--tenant-id", "--sink-id", "--producer-id", "--corpus-id", "--source-authority-id"];
    if (Object.keys(opts).length !== keys.length || keys.some((k) => !opts[k]))
      throw new Error;
    const binding = validateBinding({ sink_id: opts["--sink-id"], producer_id: opts["--producer-id"], corpus_id: opts["--corpus-id"], source_authority_id: opts["--source-authority-id"] });
    const client = createIntakeClient({ binding, tenantId: opts["--tenant-id"] });
    if (operation === "capability") {
      await client.capability();
      console.log(JSON.stringify({ status: "authorized_capability" }));
      return;
    }
    if (process.stdin.isTTY)
      throw new Error;
    let bytes = 0;
    const chunks = [];
    for await (const raw of process.stdin) {
      const chunk = Buffer.from(raw);
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES)
        throw new Error;
      chunks.push(chunk);
    }
    const request = validateRequest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
    console.log(JSON.stringify(operation === "accept" ? await client.accept(request) : await client.receipt(request)));
  } catch {
    throw new IntakeError("intake_operation_unconfirmed");
  }
}
var init_cli = __esm(() => {
  init_client();
});

// src/cli/index.ts
import { readFileSync as readFileSync3 } from "fs";
import { dirname, join as join7 } from "path";
import { fileURLToPath } from "url";

// src/index.ts
import { randomUUID as randomUUID2 } from "crypto";

// src/filter.ts
function getPathValue(input, path) {
  return path.split(".").reduce((value, part) => {
    if (value && typeof value === "object" && part in value) {
      return value[part];
    }
    return;
  }, input);
}
function getFieldValues(input, path) {
  const values = [];
  const push = (value) => {
    if (!values.some((item) => Object.is(item, value)))
      values.push(value);
  };
  if (path.includes(".") && path in input)
    push(input[path]);
  const nestedValue = getPathValue(input, path);
  if (nestedValue !== undefined || !path.includes("."))
    push(nestedValue);
  return values;
}
function wildcardToRegExp(pattern, options = {}) {
  let body = "";
  for (let index = 0;index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        body += ".*";
        index += 1;
      } else {
        body += options.segmentSafe ? "[^/]*" : ".*";
      }
    } else {
      body += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${body}$`);
}
function matchString(value, matcher, options = {}) {
  if (matcher === undefined)
    return true;
  if (value === undefined)
    return false;
  const matchers = Array.isArray(matcher) ? matcher : [matcher];
  return matchers.some((item) => wildcardToRegExp(item, options).test(value));
}
function matchRecord(input, matcher) {
  if (!matcher)
    return true;
  return Object.entries(matcher).every(([path, expected]) => {
    const actualValues = getFieldValues(input, path);
    return matchField(actualValues, expected, path);
  });
}
function matchField(actualValues, expected, path) {
  if (isNegativeMatcher(expected)) {
    return !actualValues.some((actual) => matchPositiveField(actual, expected.not, path));
  }
  return actualValues.some((actual) => matchPositiveField(actual, expected, path));
}
function matchPositiveField(actual, expected, path) {
  if (typeof expected === "string" || Array.isArray(expected)) {
    return stringCandidates(actual).some((candidate) => matchString(candidate, expected, {
      segmentSafe: path.endsWith("_path") || path.endsWith(".path")
    }));
  }
  if (Array.isArray(actual)) {
    return actual.some((item) => item === expected);
  }
  return actual === expected;
}
function stringCandidates(actual) {
  if (actual === undefined)
    return [];
  if (Array.isArray(actual)) {
    return actual.flatMap((item) => isPrimitiveFieldValue(item) ? [String(item)] : []);
  }
  return [String(actual)];
}
function isPrimitiveFieldValue(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function isNegativeMatcher(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "not" in value);
}
function eventMatchesFilter(event, filter) {
  return matchString(event.source, filter.source) && matchString(event.type, filter.type) && matchString(event.subject, filter.subject) && matchString(event.severity, filter.severity) && matchRecord(event.data, filter.data) && matchRecord(event.metadata, filter.metadata);
}
function channelMatchesEvent(channel, event) {
  if (!channel.enabled)
    return false;
  if (!channel.filters || channel.filters.length === 0)
    return true;
  return channel.filters.some((filter) => eventMatchesFilter(event, filter));
}

// src/storage.ts
import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import { Buffer as Buffer2 } from "buffer";
import { existsSync as existsSync2 } from "fs";
import { join as join2 } from "path";

// src/app-home.ts
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
var HASNA_EVENTS_DIR_ENV = "HASNA_EVENTS_DIR";
var HASNA_EVENTS_HOME_ENV = "HASNA_EVENTS_HOME";
var EVENTS_STORE_SENTINEL_FILE = "events.json";
function effectiveHome() {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}
function legacyHomeDir() {
  return join(effectiveHome(), ".hasna", "events");
}
function resolverHome() {
  return dataDir({ app: "events", home: effectiveHome() || undefined });
}
function adoptResolverHome(resolved, env = process.env) {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0)
    return true;
  return existsSync(join(resolved, EVENTS_STORE_SENTINEL_FILE));
}
function exactEventsHome() {
  const dir = process.env[HASNA_EVENTS_DIR_ENV];
  if (dir && dir.trim())
    return dir.trim();
  const home = process.env[HASNA_EVENTS_HOME_ENV];
  if (home && home.trim())
    return home.trim();
  return;
}
function getEventsHome() {
  const exact = exactEventsHome();
  if (exact)
    return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}

// src/storage.ts
var LOCAL_JSON_EVENT_CURSOR_PREFIX = "local-json-v1:";
var DEFAULT_EVENT_PAGE_LIMIT = 100;
var MAX_EVENT_PAGE_LIMIT = 1000;
function getEventsDataDir(override) {
  return override || getEventsHome();
}
function getActiveEventsDirEnv() {
  if (process.env[HASNA_EVENTS_DIR_ENV])
    return HASNA_EVENTS_DIR_ENV;
  if (process.env[HASNA_EVENTS_HOME_ENV])
    return HASNA_EVENTS_HOME_ENV;
  return null;
}

class JsonEventsStore {
  dataDir;
  runtime;
  channelsPath;
  eventsPath;
  deliveriesPath;
  constructor(dataDir2 = getEventsDataDir()) {
    this.dataDir = dataDir2;
    this.runtime = localJsonRuntime(dataDir2);
    this.channelsPath = join2(dataDir2, "channels.json");
    this.eventsPath = join2(dataDir2, "events.json");
    this.deliveriesPath = join2(dataDir2, "deliveries.json");
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 448 });
    await chmod(this.dataDir, 448).catch(() => {
      return;
    });
    await this.ensureArrayFile(this.channelsPath);
    await this.ensureArrayFile(this.eventsPath);
    await this.ensureArrayFile(this.deliveriesPath);
  }
  async addChannel(channel) {
    await this.init();
    const channels = await this.readJson(this.channelsPath, []);
    const index = channels.findIndex((item) => item.id === channel.id);
    if (index >= 0) {
      channels[index] = { ...channel, createdAt: channels[index].createdAt, updatedAt: new Date().toISOString() };
    } else {
      channels.push(channel);
    }
    await this.writeJson(this.channelsPath, channels);
    return index >= 0 ? channels[index] : channel;
  }
  async listChannels() {
    await this.init();
    return this.readJson(this.channelsPath, []);
  }
  async getChannel(id) {
    const channels = await this.listChannels();
    return channels.find((channel) => channel.id === id);
  }
  async removeChannel(id) {
    await this.init();
    const channels = await this.readJson(this.channelsPath, []);
    const next = channels.filter((channel) => channel.id !== id);
    await this.writeJson(this.channelsPath, next);
    return next.length !== channels.length;
  }
  async appendEvent(event) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    events.push(event);
    await this.writeJson(this.eventsPath, events);
    return event;
  }
  async appendEventOnce(event, options = {}) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    const dedupe = options.dedupe !== false;
    if (dedupe) {
      const existing = findEventByIdentity(events, { id: event.id, dedupeKey: event.dedupeKey });
      if (existing) {
        return {
          event: existing,
          stored: false,
          deduped: true,
          identity: { id: existing.id, dedupeKey: existing.dedupeKey }
        };
      }
    }
    events.push(event);
    await this.writeJson(this.eventsPath, events);
    return {
      event,
      stored: true,
      deduped: false,
      identity: { id: event.id, dedupeKey: event.dedupeKey }
    };
  }
  async listEvents(options = {}) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    return queryEvents(events, options);
  }
  async listEventsPage(options = {}) {
    await this.init();
    const events = await this.readJson(this.eventsPath, []);
    const queried = queryEvents(events, {
      eventId: options.eventId,
      source: options.source,
      type: options.type
    });
    const offset = decodeLocalJsonEventCursor(options.cursor, options);
    const limit = normalizeEventPageLimit(options.limit);
    const pageEvents = queried.slice(offset, offset + limit);
    const nextOffset = offset + pageEvents.length;
    const hasMore = nextOffset < queried.length;
    return {
      events: pageEvents,
      cursor: options.cursor,
      nextCursor: hasMore ? encodeLocalJsonEventCursor(nextOffset, options) : undefined,
      hasMore
    };
  }
  async findEventByIdentity(identity) {
    const events = await this.listEvents();
    return findEventByIdentity(events, identity);
  }
  async appendDelivery(result) {
    await this.init();
    const deliveries = await this.readJson(this.deliveriesPath, []);
    deliveries.push(result);
    await this.writeJson(this.deliveriesPath, deliveries);
    return result;
  }
  async listDeliveries() {
    await this.init();
    return this.readJson(this.deliveriesPath, []);
  }
  async exportData() {
    return {
      channels: await this.listChannels(),
      events: await this.listEvents(),
      deliveries: await this.listDeliveries()
    };
  }
  async ensureArrayFile(path) {
    if (!existsSync2(path)) {
      await writeFile(path, `[]
`, { encoding: "utf-8", mode: 384 });
    }
    await chmod(path, 384).catch(() => {
      return;
    });
  }
  async readJson(path, fallback) {
    try {
      const raw = await readFile(path, "utf-8");
      if (!raw.trim())
        return fallback;
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT")
        return fallback;
      throw error;
    }
  }
  async writeJson(path, value) {
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}
`, { encoding: "utf-8", mode: 384 });
    await rename(tempPath, path);
    await chmod(path, 384).catch(() => {
      return;
    });
  }
}
function localJsonRuntime(dataDir2 = getEventsDataDir()) {
  return {
    mode: "local-files",
    name: "json-events-store",
    remote: false,
    localFiles: true,
    localSqlite: false,
    postgres: false,
    s3: false,
    aws: false,
    durable: true,
    idempotency: "best-effort-local",
    replayCursors: true,
    description: `Local JSON files in ${dataDir2}; no SQLite, Postgres, S3, or AWS runtime is configured by this store.`
  };
}
function encodeLocalJsonEventCursor(offset, options = {}) {
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error(`Invalid event cursor offset: ${offset}`);
  const payload = {
    offset,
    eventId: options.eventId,
    source: options.source,
    type: options.type
  };
  return `${LOCAL_JSON_EVENT_CURSOR_PREFIX}${Buffer2.from(JSON.stringify(payload), "utf-8").toString("base64url")}`;
}
function decodeLocalJsonEventCursor(cursor, options = {}) {
  if (!cursor)
    return 0;
  if (!cursor.startsWith(LOCAL_JSON_EVENT_CURSOR_PREFIX))
    throw new Error(`Invalid local JSON event cursor: ${cursor}`);
  const rawPayload = cursor.slice(LOCAL_JSON_EVENT_CURSOR_PREFIX.length);
  let payload;
  try {
    payload = JSON.parse(Buffer2.from(rawPayload, "base64url").toString("utf-8"));
  } catch {
    throw new Error(`Invalid local JSON event cursor: ${cursor}`);
  }
  const offset = payload.offset;
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error(`Invalid local JSON event cursor: ${cursor}`);
  assertCursorFilter("eventId", payload.eventId, options.eventId);
  assertCursorFilter("source", payload.source, options.source);
  assertCursorFilter("type", payload.type, options.type);
  return offset;
}
function normalizeEventPageLimit(limit) {
  if (limit === undefined)
    return DEFAULT_EVENT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error(`Event page limit must be a positive integer, got ${limit}`);
  return Math.min(limit, MAX_EVENT_PAGE_LIMIT);
}
function queryEvents(events, options) {
  let rows = events;
  if (options.eventId)
    rows = rows.filter((event) => event.id === options.eventId);
  if (options.source)
    rows = rows.filter((event) => event.source === options.source);
  if (options.type)
    rows = rows.filter((event) => event.type === options.type);
  if (options.cursor) {
    const offset = decodeLocalJsonEventCursor(options.cursor, options);
    rows = rows.slice(offset);
  }
  if (options.limit !== undefined)
    rows = rows.slice(0, normalizeEventPageLimit(options.limit));
  return rows;
}
function assertCursorFilter(name, cursorValue, optionValue) {
  if (cursorValue !== optionValue)
    throw new Error(`Local JSON event cursor ${name} filter mismatch`);
}
function findEventByIdentity(events, identity) {
  return events.find((event) => identity.id !== undefined && event.id === identity.id || identity.dedupeKey !== undefined && event.dedupeKey === identity.dedupeKey);
}
async function getEventsStatus(dataDir2) {
  const store = new JsonEventsStore(dataDir2);
  await store.init();
  const [channels, events, deliveries] = await Promise.all([
    store.listChannels(),
    store.listEvents(),
    store.listDeliveries()
  ]);
  const transports = channels.reduce((counts, channel) => {
    counts[channel.transport] = (counts[channel.transport] ?? 0) + 1;
    return counts;
  }, {});
  return {
    service: "events",
    schemaVersion: "1.0",
    dataDir: store.dataDir,
    storage: store.runtime,
    env: {
      primary: HASNA_EVENTS_DIR_ENV,
      fallback: HASNA_EVENTS_HOME_ENV,
      active: getActiveEventsDirEnv()
    },
    files: {
      channels: statusFile(store.dataDir, "channels.json", channels.length),
      events: statusFile(store.dataDir, "events.json", events.length),
      deliveries: statusFile(store.dataDir, "deliveries.json", deliveries.length)
    },
    counts: {
      channels: channels.length,
      enabledChannels: channels.filter((channel) => channel.enabled).length,
      disabledChannels: channels.filter((channel) => !channel.enabled).length,
      events: events.length,
      deliveries: deliveries.length
    },
    transports,
    safety: {
      includesEventPayloads: false,
      includesWebhookSecrets: false,
      listOutputsRedactSecrets: true,
      statusOutputIsMetadataOnly: true
    }
  };
}
function statusFile(dataDir2, fileName, records) {
  const path = join2(dataDir2, fileName);
  return { path, exists: existsSync2(path), records };
}

// src/transports.ts
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { request as nodeHttpRequest } from "http";
import { request as nodeHttpsRequest } from "https";

// src/signing.ts
import { createHmac, timingSafeEqual } from "crypto";
var DEFAULT_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
function buildSignatureBase(timestamp, body) {
  return `${timestamp}.${body}`;
}
function signPayload(secret, timestamp, body) {
  const digest = createHmac("sha256", secret).update(buildSignatureBase(timestamp, body)).digest("hex");
  return `sha256=${digest}`;
}

// src/ssrf.ts
import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
var DEFAULT_MAX_REDIRECTS = 5;
var IPV4_PRIVATE_RANGES = [
  [0, 16777215],
  [167772160, 184549375],
  [1681915904, 1686110207],
  [2130706432, 2147483647],
  [2851995648, 2852061183],
  [2886729728, 2887778303],
  [3221225472, 3221225727],
  [3221225984, 3221226239],
  [3227017984, 3227018239],
  [3232235520, 3232301055],
  [3323068416, 3323199487],
  [3325256704, 3325256959],
  [3405803776, 3405804031],
  [3758096384, 4294967295]
];
var IPV6_SPECIAL_PREFIXES = [
  { groups: [0, 0, 0, 0, 0, 0, 0, 0], bits: 128 },
  { groups: [0, 0, 0, 0, 0, 0, 0, 1], bits: 128 },
  { groups: [0, 0, 0, 0, 0, 65535, 0, 0], bits: 96 },
  { groups: [100, 65435, 0, 0, 0, 0, 0, 0], bits: 96 },
  { groups: [256, 0, 0, 0, 0, 0, 0, 0], bits: 64 },
  { groups: [8193, 0, 0, 0, 0, 0, 0, 0], bits: 32 },
  { groups: [8193, 2, 0, 0, 0, 0, 0, 0], bits: 48 },
  { groups: [8193, 16, 0, 0, 0, 0, 0, 0], bits: 28 },
  { groups: [8193, 3512, 0, 0, 0, 0, 0, 0], bits: 32 },
  { groups: [8194, 0, 0, 0, 0, 0, 0, 0], bits: 16 },
  { groups: [16383, 0, 0, 0, 0, 0, 0, 0], bits: 20 },
  { groups: [64512, 0, 0, 0, 0, 0, 0, 0], bits: 7 },
  { groups: [65152, 0, 0, 0, 0, 0, 0, 0], bits: 10 },
  { groups: [65216, 0, 0, 0, 0, 0, 0, 0], bits: 10 },
  { groups: [65280, 0, 0, 0, 0, 0, 0, 0], bits: 8 }
];
function isPrivateAddress(address) {
  const normalized = stripZoneId(address);
  const version = isIP(normalized);
  if (version === 4) {
    const integer = ipv4ToInt(normalized);
    if (integer === undefined)
      return true;
    return IPV4_PRIVATE_RANGES.some(([low, high]) => integer >= low && integer <= high);
  }
  if (version === 6) {
    const groups = ipv6Groups(normalized);
    if (!groups)
      return true;
    for (const prefix of IPV6_SPECIAL_PREFIXES) {
      if (!ipv6MatchesPrefix(groups, prefix.groups, prefix.bits))
        continue;
      if (prefix.bits === 96 && groups[5] === 65535) {
        return isPrivateAddress(ipv4IntToString(groups[6] << 16 | groups[7]));
      }
      if (prefix.bits === 16 && groups[0] === 8194) {
        return isPrivateAddress(ipv4IntToString(groups[1] << 16 | groups[2]));
      }
      return true;
    }
    return false;
  }
  return true;
}
async function resolveWebhookTarget(url, policy = {}) {
  const hostname = normalizeHostname(url.hostname);
  const allowlist = (policy.allowPrivateHosts ?? []).map((entry) => normalizeHostname(entry.toLowerCase()));
  if (allowlist.includes(hostname)) {
    const version2 = isIP(hostname);
    if (version2 === 4 || version2 === 6) {
      return { hostname, addresses: [hostname] };
    }
    const lookup2 = policy.lookup ?? defaultTargetLookup;
    let resolved2;
    try {
      resolved2 = await lookup2(hostname);
    } catch {
      throw new Error(`Webhook target ${hostname} could not be resolved`);
    }
    if (!Array.isArray(resolved2) || resolved2.length === 0) {
      throw new Error(`Webhook target ${hostname} resolved to no addresses`);
    }
    const addresses = resolved2.map((entry) => normalizeHostname(entry.address));
    return { hostname, addresses };
  }
  const version = isIP(hostname);
  if (version === 4 || version === 6) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Webhook target ${hostname} is a private or special-use address`);
    }
    return { hostname, addresses: [hostname] };
  }
  const lookup = policy.lookup ?? defaultTargetLookup;
  let resolved;
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new Error(`Webhook target ${hostname} could not be resolved`);
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error(`Webhook target ${hostname} resolved to no addresses`);
  }
  const allowed = [];
  for (const entry of resolved) {
    const address = normalizeHostname(entry.address);
    if (isPrivateAddress(address)) {
      if (allowlist.includes(address)) {
        allowed.push(address);
        continue;
      }
      throw new Error(`Webhook target ${hostname} resolves to private or special-use address ${address}`);
    }
    allowed.push(address);
  }
  if (allowed.length === 0) {
    throw new Error(`Webhook target ${hostname} resolved to no public addresses`);
  }
  return { hostname, addresses: allowed };
}
function normalizeMaxRedirects(value) {
  if (value === undefined)
    return DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(value) || value < 0)
    throw new Error("webhookTargetPolicy.maxRedirects must be a non-negative integer");
  return value;
}
var defaultTargetLookup = async (hostname) => {
  return dnsLookup(hostname, { all: true, verbatim: false });
};
function normalizeHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]"))
    return lower.slice(1, -1);
  return lower;
}
function stripZoneId(address) {
  const percent = address.indexOf("%");
  return percent === -1 ? address : address.slice(0, percent);
}
function ipv4ToInt(address) {
  const parts = address.split(".");
  if (parts.length !== 4)
    return;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part))
      return;
    const octet = Number(part);
    if (octet > 255)
      return;
    value = value << 8 | octet;
  }
  return value >>> 0;
}
function ipv4IntToString(integer) {
  return [
    integer >>> 24 & 255,
    integer >>> 16 & 255,
    integer >>> 8 & 255,
    integer & 255
  ].join(".");
}
function ipv6Groups(address) {
  const raw = stripZoneId(address);
  const doubleColon = raw.indexOf("::");
  const headText = doubleColon === -1 ? raw : raw.slice(0, doubleColon);
  const tailText = doubleColon === -1 ? "" : raw.slice(doubleColon + 2);
  const parseGroups = (text) => {
    if (text === "")
      return [];
    const out = [];
    for (const part of text.split(":")) {
      if (part.includes(".")) {
        const v4 = ipv4ToInt(part);
        if (v4 === undefined)
          return;
        out.push(v4 >>> 16 & 65535, v4 & 65535);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part))
          return;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };
  const head = parseGroups(headText);
  if (!head)
    return;
  const tail = parseGroups(tailText);
  if (!tail)
    return;
  const total = head.length + tail.length;
  if (doubleColon === -1) {
    return total === 8 ? head : undefined;
  }
  if (total >= 8)
    return;
  return [...head, ...new Array(8 - total).fill(0), ...tail];
}
function ipv6MatchesPrefix(groups, prefixGroups, prefixBits) {
  let remaining = prefixBits;
  for (let index = 0;index < prefixGroups.length && remaining > 0; index += 1) {
    const take = Math.min(16, remaining);
    const mask = 65535 << 16 - take & 65535;
    if ((groups[index] & mask) !== (prefixGroups[index] & mask))
      return false;
    remaining -= take;
  }
  return true;
}

// src/transports.ts
function now() {
  return new Date().toISOString();
}
function truncate(value, max = 4096) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
function buildWebhookRequest(event, channel, options = {}) {
  if (!channel.webhook)
    throw new Error(`Channel ${channel.id} has no webhook config`);
  for (const name of Object.keys(channel.webhook.headers ?? {})) {
    if (/^x-hasna-/i.test(name)) {
      throw new Error(`Webhook header ${name} is reserved for signed delivery metadata`);
    }
  }
  const body = JSON.stringify(event);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "@hasna/events",
    "X-Hasna-Event-Id": event.id,
    "X-Hasna-Event-Type": event.type,
    ...channel.webhook.headers,
    "X-Hasna-Timestamp": timestamp
  };
  const secret = options.secret ?? channel.webhook.secret;
  if (secret) {
    headers["X-Hasna-Signature"] = signPayload(secret, timestamp, body);
  }
  return { body, headers };
}
function normalizeWebhookUrl(raw) {
  const url = new URL(raw);
  if (url.username !== "" || url.password !== "") {
    url.username = "";
    url.password = "";
  }
  return url.toString();
}
async function dispatchWebhook(event, channel, options = {}) {
  if (!channel.webhook)
    throw new Error(`Channel ${channel.id} has no webhook config`);
  const webhookUrl = normalizeWebhookUrl(channel.webhook.url);
  const startedAt = now();
  let secret = channel.webhook.secret;
  if (channel.webhook.secretRef) {
    if (!options.secretResolver) {
      return failedAttempt(startedAt, "Webhook secret reference has no runtime resolver");
    }
    try {
      secret = await options.secretResolver(channel.webhook.secretRef);
    } catch {
      return failedAttempt(startedAt, "Webhook secret reference could not be resolved");
    }
    if (!secret)
      return failedAttempt(startedAt, "Webhook secret reference could not be resolved");
  }
  const timestamp = (options.now?.() ?? new Date).toISOString();
  const { body, headers } = buildWebhookRequest(event, channel, { secret, timestamp });
  const validateTargets = options.webhookTargetPolicy !== undefined || options.fetchImpl === undefined;
  if (validateTargets) {
    return dispatchValidatedWebhook(event, channel, { body, headers, startedAt, options });
  }
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), channel.webhook.timeoutMs ?? 15000);
  try {
    const response = await (options.fetchImpl ?? fetch)(webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });
    const responseBody = truncate(await response.text());
    return {
      attempt: 1,
      status: response.ok ? "success" : "failed",
      startedAt,
      completedAt: now(),
      responseStatus: response.status,
      responseBody,
      error: response.ok ? undefined : `Webhook returned HTTP ${response.status}`
    };
  } catch (error) {
    return {
      attempt: 1,
      status: "failed",
      startedAt,
      completedAt: now(),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function redirectKeepsBody(status) {
  return status === 307 || status === 308;
}
async function pinnedNativeRequest(target, addresses, method, headers, body, signal, tls) {
  const isHttps = target.protocol === "https:";
  if (!isHttps && target.protocol !== "http:") {
    throw new Error(`Webhook target uses unsupported protocol ${target.protocol}`);
  }
  const defaultPort = isHttps ? 443 : 80;
  const port = target.port ? Number(target.port) : defaultPort;
  const requestOptions = {
    hostname: target.hostname,
    port,
    path: `${target.pathname}${target.search}`,
    method,
    headers,
    ...tls?.ca ? { ca: tls.ca } : {},
    lookup: (hostname, _options, callback) => {
      const entries = addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4
      }));
      callback(null, entries);
    }
  };
  return new Promise((resolve2, reject) => {
    const request = isHttps ? nodeHttpsRequest(requestOptions, onResponse) : nodeHttpRequest(requestOptions, onResponse);
    const onAbort = () => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      request.destroy(error);
    };
    if (signal.aborted)
      onAbort();
    else
      signal.addEventListener("abort", onAbort, { once: true });
    request.on("error", reject);
    if (body !== undefined)
      request.write(body);
    request.end();
    function onResponse(response) {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("error", reject);
      response.on("end", () => {
        const headersRecord = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string")
            headersRecord[name] = value;
          else if (Array.isArray(value))
            headersRecord[name] = value.join(", ");
        }
        resolve2(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 200, headers: headersRecord }));
      });
    }
  });
}
async function dispatchValidatedWebhook(event, channel, input) {
  const { body, headers, startedAt, options } = input;
  const webhook = channel.webhook;
  if (!webhook)
    throw new Error(`Channel ${channel.id} has no webhook config`);
  const policy = options.webhookTargetPolicy ?? {};
  const maxRedirects = normalizeMaxRedirects(policy.maxRedirects);
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs ?? 15000);
  try {
    let target = new URL(normalizeWebhookUrl(webhook.url));
    let requestHeaders = headers;
    let method = "POST";
    let requestBody = body;
    let redirectsFollowed = 0;
    for (;; ) {
      const resolved = await resolveWebhookTarget(target, policy).catch((error) => {
        throw new Error(`Webhook target rejected by SSRF guard: ${error.message}`);
      });
      const response = options.fetchImpl ? await options.fetchImpl(target, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
        redirect: "manual"
      }) : await pinnedNativeRequest(target, resolved.addresses, method, requestHeaders, requestBody, controller.signal, options.tls);
      const location = response.headers.get("location");
      if (isRedirectStatus(response.status) && location) {
        if (redirectsFollowed >= maxRedirects) {
          return failedAttempt(startedAt, `Webhook target exceeded ${maxRedirects} redirects`);
        }
        redirectsFollowed += 1;
        const next = new URL(location, target);
        target = next;
        if (!redirectKeepsBody(response.status)) {
          method = "GET";
          requestBody = undefined;
          requestHeaders = Object.fromEntries(Object.entries(requestHeaders).filter(([name]) => name.toLowerCase() !== "content-type" && name.toLowerCase() !== "content-length"));
        }
        continue;
      }
      const responseBody = truncate(await response.text());
      return {
        attempt: 1,
        status: response.ok ? "success" : "failed",
        startedAt,
        completedAt: now(),
        responseStatus: response.status,
        responseBody,
        error: response.ok ? undefined : `Webhook returned HTTP ${response.status}`
      };
    }
  } catch (error) {
    return {
      attempt: 1,
      status: "failed",
      startedAt,
      completedAt: now(),
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
function failedAttempt(startedAt, error) {
  return {
    attempt: 1,
    status: "failed",
    startedAt,
    completedAt: now(),
    error
  };
}
async function dispatchCommand(event, channel) {
  if (!channel.command)
    throw new Error(`Channel ${channel.id} has no command config`);
  const startedAt = now();
  const eventJson = JSON.stringify(event);
  const env = {
    ...process.env,
    ...channel.command.env,
    HASNA_CHANNEL_ID: channel.id,
    HASNA_EVENT_ID: event.id,
    HASNA_EVENT_TYPE: event.type,
    HASNA_EVENT_SOURCE: event.source,
    HASNA_EVENT_SUBJECT: event.subject ?? "",
    HASNA_EVENT_SEVERITY: event.severity,
    HASNA_EVENT_TIME: event.time,
    HASNA_EVENT_DEDUPE_KEY: event.dedupeKey ?? "",
    HASNA_EVENT_SCHEMA_VERSION: event.schemaVersion,
    HASNA_EVENT_JSON: eventJson
  };
  return new Promise((resolve2) => {
    const child = spawn(channel.command.command, channel.command.args ?? [], {
      cwd: channel.command.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), channel.command.timeoutMs ?? 15000);
    child.stdin.end(eventJson);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve2({
        attempt: 1,
        status: "failed",
        startedAt,
        completedAt: now(),
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        error: error.message
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const success = code === 0;
      resolve2({
        attempt: 1,
        status: success ? "success" : "failed",
        startedAt,
        completedAt: now(),
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        error: success ? undefined : `Command exited with ${signal ? `signal ${signal}` : `code ${code}`}`
      });
    });
  });
}
async function dispatchChannel(event, channel, options = {}) {
  if (channel.transport === "webhook")
    return dispatchWebhook(event, channel, options);
  if (channel.transport === "command")
    return dispatchCommand(event, channel);
  return {
    attempt: 1,
    status: "skipped",
    startedAt: now(),
    completedAt: now(),
    error: `Unsupported transport: ${channel.transport}`
  };
}
function createDeliveryResult(event, channel, attempts) {
  const status = attempts.some((attempt) => attempt.status === "success") ? "success" : attempts.every((attempt) => attempt.status === "skipped") ? "skipped" : "failed";
  return {
    id: randomUUID(),
    eventId: event.id,
    channelId: channel.id,
    transport: channel.transport,
    status,
    attempts,
    createdAt: attempts[0]?.startedAt ?? now(),
    completedAt: attempts.at(-1)?.completedAt ?? now()
  };
}

// src/catalog.ts
class EventValidationError extends Error {
  eventType;
  issues;
  constructor(eventType, issues) {
    const detail = issues.map((issue) => `${issue.path || "<root>"}: ${issue.message}`).join("; ");
    super(`Event validation failed for type "${eventType}": ${detail}`);
    this.name = "EventValidationError";
    this.eventType = eventType;
    this.issues = issues;
  }
}

class EventTypeCatalog {
  definitions = new Map;
  register(definition) {
    this.definitions.set(definition.type, definition);
    return this;
  }
  unregister(type) {
    return this.definitions.delete(type);
  }
  has(type) {
    return this.definitions.has(type);
  }
  get(type) {
    return this.definitions.get(type);
  }
  list() {
    return [...this.definitions.values()];
  }
  validateEvent(event) {
    const definition = this.definitions.get(event.type);
    if (!definition)
      return { ok: true };
    return definition.validate(event.data, event);
  }
  assertEventValid(event) {
    const result = this.validateEvent(event);
    if (!result.ok) {
      throw new EventValidationError(event.type, result.issues);
    }
  }
}
var defaultEventTypeCatalog = new EventTypeCatalog;

// src/index.ts
init_client();

// src/app-event.ts
var APP_EVENT_V1_MAX_DATA_BYTES = 32 * 1024;

// src/index.ts
function createEvent(input) {
  return {
    id: input.id ?? randomUUID2(),
    source: input.source,
    type: input.type,
    time: normalizeTime(input.time),
    subject: input.subject,
    severity: input.severity ?? "info",
    data: input.data ?? {},
    message: input.message,
    dedupeKey: input.dedupeKey,
    schemaVersion: input.schemaVersion ?? "1.0",
    metadata: input.metadata ?? {}
  };
}

class EventsClient {
  store;
  redactors;
  transportOptions;
  catalog;
  validateCatalogTypes;
  constructor(options = {}) {
    this.store = options.store ?? new JsonEventsStore(options.dataDir);
    this.redactors = options.redactors ?? [];
    this.transportOptions = {
      fetchImpl: options.fetchImpl,
      secretResolver: options.secretResolver,
      now: options.now,
      tls: options.tls,
      webhookTargetPolicy: options.webhookTargetPolicy
    };
    this.catalog = options.catalog ?? defaultEventTypeCatalog;
    this.validateCatalogTypes = options.validateCatalogTypes ?? false;
  }
  async addChannel(input) {
    const timestamp = new Date().toISOString();
    return this.store.addChannel({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    });
  }
  async listChannels() {
    return this.store.listChannels();
  }
  async removeChannel(id) {
    return this.store.removeChannel(id);
  }
  async emit(input, options = {}) {
    const event = options.redactSensitiveData === false ? createEvent(input) : redactSensitiveKeys(createEvent(input));
    if (options.validate ?? this.validateCatalogTypes) {
      this.catalog.assertEventValid(event);
    }
    const append = await this.appendEvent(event, { dedupe: options.dedupe !== false });
    if (append.deduped) {
      return { event: append.event, deliveries: [], deduped: true };
    }
    const deliveries = options.deliver === false ? [] : await this.deliver(append.event);
    return { event: append.event, deliveries, deduped: false };
  }
  async listEvents(options = {}) {
    if (Object.keys(options).length === 0)
      return this.store.listEvents();
    return queryClientEvents(await this.store.listEvents(), options);
  }
  async listEventsPage(options = {}) {
    if (this.store.listEventsPage)
      return this.store.listEventsPage(options);
    const events = queryClientEvents(await this.store.listEvents(), {
      eventId: options.eventId,
      source: options.source,
      type: options.type
    });
    const offset = decodeLocalJsonEventCursor(options.cursor, options);
    const limit = normalizeEventPageLimit(options.limit);
    const pageEvents = events.slice(offset, offset + limit);
    const nextOffset = offset + pageEvents.length;
    const hasMore = nextOffset < events.length;
    return {
      events: pageEvents,
      cursor: options.cursor,
      nextCursor: hasMore ? encodeLocalJsonEventCursor(nextOffset, options) : undefined,
      hasMore
    };
  }
  async listDeliveries() {
    return this.store.listDeliveries();
  }
  async deliver(event) {
    const channels = await this.store.listChannels();
    const selected = channels.filter((channel) => channelMatchesEvent(channel, event));
    const deliveries = [];
    for (const channel of selected) {
      const eventForChannel = await this.applyRedaction(event, channel);
      const result = await this.deliverWithRetry(eventForChannel, channel);
      await this.store.appendDelivery(result);
      deliveries.push(result);
    }
    return deliveries;
  }
  async matchChannel(id, input = {}) {
    const channel = await this.store.getChannel(id);
    if (!channel)
      throw new Error(`Channel not found: ${id}`);
    const event = createEvent({
      source: input.source ?? "hasna.events",
      type: input.type ?? "events.test",
      subject: input.subject ?? id,
      severity: input.severity ?? "info",
      data: input.data ?? { test: true },
      message: input.message ?? "Hasna events test delivery",
      dedupeKey: input.dedupeKey,
      schemaVersion: input.schemaVersion,
      metadata: input.metadata,
      time: input.time,
      id: input.id
    });
    const matched = channelMatchesEvent(channel, event);
    return {
      channelId: channel.id,
      matched,
      event,
      filters: channel.filters,
      reason: matched ? undefined : channel.enabled ? "event did not match channel filters" : "channel is disabled"
    };
  }
  async testChannel(id, input = {}, options = {}) {
    const channel = await this.store.getChannel(id);
    if (!channel)
      throw new Error(`Channel not found: ${id}`);
    const match = await this.matchChannel(id, input);
    const event = match.event;
    if (options.honorFilters && !match.matched) {
      const timestamp = new Date().toISOString();
      const result2 = createDeliveryResult(event, channel, [{
        attempt: 1,
        status: "skipped",
        startedAt: timestamp,
        completedAt: timestamp,
        error: match.reason
      }]);
      result2.metadata = { reason: "filter_mismatch" };
      await this.store.appendDelivery(result2);
      return result2;
    }
    const eventForChannel = await this.applyRedaction(event, channel);
    const result = await this.deliverWithRetry(eventForChannel, channel);
    await this.store.appendDelivery(result);
    return result;
  }
  async replay(options = {}) {
    const page = options.cursor || options.limit !== undefined ? await this.listEventsPage(options) : { events: await this.listEvents(options), hasMore: false };
    if (options.dryRun)
      return { events: page.events, deliveries: [], cursor: page.cursor, nextCursor: page.nextCursor, hasMore: page.hasMore };
    const deliveries = [];
    for (const event of page.events) {
      deliveries.push(...await this.deliver(event));
    }
    return { events: page.events, deliveries, cursor: page.cursor, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }
  async appendEvent(event, options) {
    if (this.store.appendEventOnce) {
      return this.store.appendEventOnce(event, { dedupe: options.dedupe });
    }
    if (options.dedupe) {
      const existing = await this.store.findEventByIdentity({ id: event.id, dedupeKey: event.dedupeKey });
      if (existing) {
        return {
          event: existing,
          stored: false,
          deduped: true,
          identity: { id: existing.id, dedupeKey: existing.dedupeKey }
        };
      }
    }
    const stored = await this.store.appendEvent(event);
    return {
      event: stored,
      stored: true,
      deduped: false,
      identity: { id: stored.id, dedupeKey: stored.dedupeKey }
    };
  }
  async applyRedaction(event, channel) {
    let next = redactPaths(event, channel.redact?.paths ?? [], channel.redact?.replacement ?? "[REDACTED]");
    for (const redactor of this.redactors) {
      next = await redactor(next, channel);
    }
    return next;
  }
  async deliverWithRetry(event, channel) {
    const policy = normalizeRetryPolicy(channel.retry);
    const attempts = [];
    for (let index = 0;index < policy.maxAttempts; index += 1) {
      const attempt = await dispatchChannel(event, channel, this.transportOptions);
      attempt.attempt = index + 1;
      if (attempt.status === "failed" && index + 1 < policy.maxAttempts) {
        attempt.nextBackoffMs = Math.round(policy.backoffMs * policy.multiplier ** index);
      }
      attempts.push(attempt);
      if (attempt.status !== "failed")
        break;
      if (attempt.nextBackoffMs)
        await Bun.sleep(attempt.nextBackoffMs);
    }
    return createDeliveryResult(event, channel, attempts);
  }
}
function sanitizeChannelForOutput(channel) {
  const copy = structuredClone(channel);
  if (copy.webhook?.secret)
    copy.webhook.secret = "[REDACTED]";
  if (copy.command?.env) {
    copy.command.env = Object.fromEntries(Object.entries(copy.command.env).map(([key, value]) => [key, shouldRedactKey(key) ? "[REDACTED]" : value]));
  }
  return copy;
}
function sanitizeChannelsForOutput(channels) {
  return channels.map(sanitizeChannelForOutput);
}
function queryClientEvents(events, options) {
  let rows = events;
  if (options.eventId)
    rows = rows.filter((event) => event.id === options.eventId);
  if (options.source)
    rows = rows.filter((event) => event.source === options.source);
  if (options.type)
    rows = rows.filter((event) => event.type === options.type);
  if (options.cursor)
    rows = rows.slice(decodeLocalJsonEventCursor(options.cursor, options));
  if (options.limit !== undefined)
    rows = rows.slice(0, normalizeEventPageLimit(options.limit));
  return rows;
}
function normalizeTime(value) {
  if (!value)
    return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}
function normalizeRetryPolicy(policy) {
  return {
    maxAttempts: Math.max(1, policy?.maxAttempts ?? 1),
    backoffMs: Math.max(0, policy?.backoffMs ?? 250),
    multiplier: Math.max(1, policy?.multiplier ?? 2)
  };
}

// src/durable.ts
import { Database } from "bun:sqlite";
import { createHash as createHash2, randomUUID as randomUUID3 } from "crypto";
import {
  chmodSync,
  closeSync as closeSync2,
  existsSync as existsSync3,
  fsyncSync,
  mkdirSync,
  openSync as openSync2,
  readdirSync,
  readFileSync as readFileSync2,
  renameSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { basename, join as join4 } from "path";
var DURABLE_SCHEMA_VERSION = 1;
var MAX_RETRY_ATTEMPTS = 1000;
var MAX_RETRY_DELAY_MS = 365 * 24 * 60 * 60 * 1000;
var MAX_RETRY_MULTIPLIER = 100;
var SCHEMA_V1_TABLE_SQL = {
  channels: `CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  events: `CREATE TABLE events (
    id TEXT PRIMARY KEY,
    dedupe_key TEXT,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    time TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  outbox: `CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    channel_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    channel_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'delivered', 'dead')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at INTEGER NOT NULL,
    lease_owner TEXT,
    lease_expires_at INTEGER,
    attempts_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id, channel_id)
  )`,
  deliveries: `CREATE TABLE deliveries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    channel_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`
};
var SCHEMA_V1_INDEX_SQL = {
  events_dedupe_key_unique: `CREATE UNIQUE INDEX events_dedupe_key_unique
    ON events(dedupe_key) WHERE dedupe_key IS NOT NULL`,
  events_source_type_idx: "CREATE INDEX events_source_type_idx ON events(source, type)",
  outbox_due_idx: "CREATE INDEX outbox_due_idx ON outbox(status, available_at, lease_expires_at)"
};
var SCHEMA_V1_COLUMNS = {
  channels: [
    { name: "id", type: "TEXT", notnull: 0, defaultValue: null, pk: 1 },
    { name: "enabled", type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
    { name: "config_json", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "created_at", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "updated_at", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 }
  ],
  events: [
    { name: "id", type: "TEXT", notnull: 0, defaultValue: null, pk: 1 },
    { name: "dedupe_key", type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
    { name: "source", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "type", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "time", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "envelope_json", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "created_at", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 }
  ],
  outbox: [
    { name: "id", type: "TEXT", notnull: 0, defaultValue: null, pk: 1 },
    { name: "event_id", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "channel_id", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "event_json", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "channel_json", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "status", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "attempt_count", type: "INTEGER", notnull: 1, defaultValue: "0", pk: 0 },
    { name: "available_at", type: "INTEGER", notnull: 1, defaultValue: null, pk: 0 },
    { name: "lease_owner", type: "TEXT", notnull: 0, defaultValue: null, pk: 0 },
    { name: "lease_expires_at", type: "INTEGER", notnull: 0, defaultValue: null, pk: 0 },
    { name: "attempts_json", type: "TEXT", notnull: 1, defaultValue: "'[]'", pk: 0 },
    { name: "created_at", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "updated_at", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 }
  ],
  deliveries: [
    { name: "id", type: "TEXT", notnull: 0, defaultValue: null, pk: 1 },
    { name: "event_id", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "channel_id", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "result_json", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 },
    { name: "created_at", type: "TEXT", notnull: 1, defaultValue: null, pk: 0 }
  ]
};
var EVENT_FOREIGN_KEY = {
  table: "events",
  from: "event_id",
  to: "id",
  onUpdate: "NO ACTION",
  onDelete: "NO ACTION",
  match: "NONE"
};
var SCHEMA_V1_FOREIGN_KEYS = {
  channels: [],
  events: [],
  outbox: [EVENT_FOREIGN_KEY],
  deliveries: [EVENT_FOREIGN_KEY]
};
var SCHEMA_V1_INDEXES = {
  channels: [
    { name: "sqlite_autoindex_channels_1", unique: 1, origin: "pk", partial: 0, columns: ["id"] }
  ],
  events: [
    { name: "events_dedupe_key_unique", unique: 1, origin: "c", partial: 1, columns: ["dedupe_key"] },
    { name: "events_source_type_idx", unique: 0, origin: "c", partial: 0, columns: ["source", "type"] },
    { name: "sqlite_autoindex_events_1", unique: 1, origin: "pk", partial: 0, columns: ["id"] }
  ],
  outbox: [
    { name: "outbox_due_idx", unique: 0, origin: "c", partial: 0, columns: ["status", "available_at", "lease_expires_at"] },
    { name: "sqlite_autoindex_outbox_1", unique: 1, origin: "pk", partial: 0, columns: ["id"] },
    { name: "sqlite_autoindex_outbox_2", unique: 1, origin: "u", partial: 0, columns: ["event_id", "channel_id"] }
  ],
  deliveries: [
    { name: "sqlite_autoindex_deliveries_1", unique: 1, origin: "pk", partial: 0, columns: ["id"] }
  ]
};
function defaultWebhookSecretResolver(reference) {
  if (!reference.startsWith("env:"))
    throw new Error("Unsupported webhook secret reference scheme");
  const name = reference.slice("env:".length);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new Error("Invalid webhook secret environment reference");
  return process.env[name];
}

class DurableEventsBroker {
  dataDir;
  databasePath;
  db;
  now;
  transportOptions;
  constructor(options) {
    if (!options.dataDir)
      throw new Error("DurableEventsBroker requires dataDir");
    this.dataDir = options.dataDir;
    this.databasePath = join4(options.dataDir, options.databaseName ?? "events.sqlite");
    this.now = options.now ?? (() => new Date);
    this.transportOptions = {
      fetchImpl: options.fetchImpl,
      secretResolver: options.secretResolver ?? defaultWebhookSecretResolver,
      now: this.now,
      tls: options.tls,
      webhookTargetPolicy: options.webhookTargetPolicy
    };
    mkdirSync(this.dataDir, { recursive: true, mode: 448 });
    chmodSync(this.dataDir, 448);
    this.db = new Database(this.databasePath, { create: true, strict: true });
    try {
      this.db.exec("PRAGMA busy_timeout = 5000;");
      this.ensureSchema();
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = FULL;");
      this.db.exec("PRAGMA foreign_keys = ON;");
      this.secureDatabaseFiles();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  addChannel(input) {
    if (input.transport !== "webhook") {
      throw new Error("Durable SQLite channels support only webhook transport");
    }
    if (input.webhook?.secret !== undefined) {
      throw new Error("Durable SQLite channels reject inline webhook secrets; use webhook.secretRef");
    }
    if (input.transport === "webhook" && !input.webhook?.secretRef) {
      throw new Error("Durable SQLite webhook channels require webhook.secretRef");
    }
    if (input.webhook?.secretRef && !/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(input.webhook.secretRef)) {
      throw new Error("Durable SQLite webhook secretRef must be a runtime reference");
    }
    if (input.webhook)
      validateDurableWebhookConfig(input.webhook);
    if (input.retry !== undefined)
      validateRetryPolicy(input.retry);
    const timestamp = this.now().toISOString();
    const existing = this.db.query("SELECT config_json FROM channels WHERE id = ?").get(input.id);
    const existingChannel = existing ? parseJson(existing.config_json) : undefined;
    const channel = {
      ...input,
      createdAt: existingChannel?.createdAt ?? input.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.immediate(() => {
      this.db.query(`
        INSERT INTO channels (id, enabled, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `).run(channel.id, channel.enabled ? 1 : 0, JSON.stringify(channel), channel.createdAt, channel.updatedAt);
    });
    this.secureDatabaseFiles();
    return channel;
  }
  listChannels() {
    const rows = this.db.query("SELECT config_json FROM channels ORDER BY id").all();
    return rows.map((row) => parseJson(row.config_json));
  }
  enqueue(input, options = {}) {
    const event = redactSensitiveKeys(createEvent({ ...input, time: input.time ?? this.now() }));
    const result = this.immediate(() => {
      if (options.dedupe !== false) {
        const existing = this.findEvent(event.id, event.dedupeKey);
        if (existing) {
          const storedEvent = parseJson(existing.envelope_json);
          return {
            event: storedEvent,
            deduped: true,
            queued: this.queueMatchingChannels(storedEvent)
          };
        }
      }
      this.db.query(`
        INSERT INTO events (id, dedupe_key, source, type, time, envelope_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(event.id, event.dedupeKey ?? null, event.source, event.type, event.time, JSON.stringify(event), this.now().toISOString());
      const queued = this.queueMatchingChannels(event);
      return { event, deduped: false, queued };
    });
    this.secureDatabaseFiles();
    return result;
  }
  async drain(options = {}) {
    const workerId = options.workerId ?? randomUUID3();
    const limit = normalizePositiveInteger(options.limit, 100, "limit");
    const leaseMs = normalizePositiveInteger(options.leaseMs, 60000, "leaseMs");
    const attemptedIds = new Set;
    const summary = {
      workerId,
      claimed: 0,
      delivered: 0,
      retried: 0,
      dead: 0,
      lost: 0,
      deliveries: []
    };
    while (summary.claimed < limit) {
      const [job] = this.claim({ workerId, limit: 1, leaseMs, excludeIds: [...attemptedIds] });
      if (!job)
        break;
      attemptedIds.add(job.id);
      summary.claimed += 1;
      let attempt;
      try {
        attempt = await dispatchChannel(job.event, job.channel, this.transportOptions);
      } catch {
        const timestamp = this.now().toISOString();
        attempt = {
          attempt: job.attempt,
          status: "failed",
          startedAt: timestamp,
          completedAt: timestamp,
          error: "Webhook delivery failed"
        };
      }
      attempt.attempt = job.attempt;
      attempt = sanitizeDurableAttempt(attempt);
      const settled = this.settle(job, attempt);
      if (settled.status === "delivered")
        summary.delivered += 1;
      if (settled.status === "retry")
        summary.retried += 1;
      if (settled.status === "dead")
        summary.dead += 1;
      if (settled.status === "lost")
        summary.lost += 1;
      if (settled.delivery)
        summary.deliveries.push(settled.delivery);
    }
    this.secureDatabaseFiles();
    return summary;
  }
  importSpool(options = {}) {
    const inboxDir = join4(this.dataDir, "spool", "inbox");
    if (!existsSync3(inboxDir))
      return { scanned: 0, imported: 0, deduped: 0, queued: 0, quarantined: 0 };
    const limit = normalizePositiveInteger(options.limit, 100, "limit");
    const names = readdirSync(inboxDir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort().slice(0, limit);
    const result = { scanned: names.length, imported: 0, deduped: 0, queued: 0, quarantined: 0 };
    for (const name of names) {
      const path = join4(inboxDir, name);
      let event;
      try {
        event = parseSpoolEnvelope(readFileSync2(path, "utf8"));
      } catch (error) {
        if (isNodeError(error, "ENOENT"))
          continue;
        quarantineSpoolRecord(this.dataDir, path, "malformed");
        result.quarantined += 1;
        continue;
      }
      if (spoolFileName(event) !== name) {
        quarantineSpoolRecord(this.dataDir, path, "identity-mismatch");
        result.quarantined += 1;
        continue;
      }
      const enqueued = this.enqueue(event);
      if (enqueued.deduped)
        result.deduped += 1;
      else
        result.imported += 1;
      result.queued += enqueued.queued;
      try {
        unlinkSync(path);
      } catch (error) {
        if (!isNodeError(error, "ENOENT"))
          throw error;
      }
    }
    if (names.length > 0)
      syncDirectory(inboxDir);
    this.secureDatabaseFiles();
    return result;
  }
  retryDead(options = {}) {
    const limit = normalizePositiveInteger(options.limit, 100, "limit");
    return this.immediate(() => {
      const conditions = ["status = 'dead'"];
      const bindings = [];
      if (options.eventId) {
        conditions.push("event_id = ?");
        bindings.push(options.eventId);
      }
      if (options.channelId) {
        conditions.push("channel_id = ?");
        bindings.push(options.channelId);
      }
      const rows = this.db.query(`
        SELECT id FROM outbox
        WHERE ${conditions.join(" AND ")}
        ORDER BY updated_at, id
        LIMIT ?
      `).all(...bindings, limit);
      let requeued = 0;
      for (const row of rows) {
        const updated = this.db.query(`
          UPDATE outbox
          SET status = 'pending', attempt_count = 0, attempts_json = '[]',
              available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
              updated_at = ?
          WHERE id = ? AND status = 'dead'
        `).run(this.now().getTime(), this.now().toISOString(), row.id);
        requeued += Number(updated.changes);
      }
      return { matched: rows.length, requeued };
    });
  }
  status() {
    const channels = this.count("SELECT COUNT(*) AS count FROM channels");
    const enabledChannels = this.count("SELECT COUNT(*) AS count FROM channels WHERE enabled = 1");
    const events = this.count("SELECT COUNT(*) AS count FROM events");
    const statusRows = this.db.query("SELECT status, COUNT(*) AS count FROM outbox GROUP BY status").all();
    const statuses = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)]));
    return {
      service: "events",
      storage: "local-sqlite",
      schemaVersion: DURABLE_SCHEMA_VERSION,
      databasePath: this.databasePath,
      counts: {
        channels,
        enabledChannels,
        events,
        pending: statuses.pending ?? 0,
        leased: statuses.leased ?? 0,
        delivered: statuses.delivered ?? 0,
        dead: statuses.dead ?? 0
      },
      safety: {
        statusOmitsEventPayloads: true,
        databasePersistsEventEnvelopes: true,
        includesResolvedSecrets: false,
        inlineWebhookSecretsAllowed: false
      }
    };
  }
  nextWakeAt() {
    const row = this.db.query(`
      SELECT MIN(
        CASE WHEN o.status = 'leased' THEN o.lease_expires_at ELSE o.available_at END
      ) AS next_at
      FROM outbox o
      JOIN channels c ON c.id = o.channel_id AND c.enabled = 1
      WHERE o.status IN ('pending', 'leased')
    `).get();
    return row?.next_at === null || row?.next_at === undefined ? undefined : Number(row.next_at);
  }
  claim(options) {
    return this.immediate(() => {
      const nowMs = this.now().getTime();
      const excludeIds = options.excludeIds ?? [];
      const exclusion = excludeIds.length > 0 ? ` AND o.id NOT IN (${excludeIds.map(() => "?").join(", ")})` : "";
      const rows = this.db.query(`
        SELECT o.id, o.event_json, c.config_json AS channel_json,
               o.attempt_count, o.attempts_json
        FROM outbox o
        JOIN channels c ON c.id = o.channel_id AND c.enabled = 1
        WHERE ((o.status = 'pending' AND o.available_at <= ?)
           OR (o.status = 'leased' AND o.lease_expires_at <= ?))
          ${exclusion}
        ORDER BY o.available_at, o.created_at, o.id
        LIMIT ?
      `).all(nowMs, nowMs, ...excludeIds, options.limit);
      const jobs = [];
      for (const row of rows) {
        const nextAttempt = Number(row.attempt_count) + 1;
        const channel = parseJson(row.channel_json);
        const transportTimeoutMs = channel.webhook?.timeoutMs ?? channel.command?.timeoutMs ?? 15000;
        const leaseMs = Math.max(options.leaseMs, transportTimeoutMs + 5000);
        const update = this.db.query(`
          UPDATE outbox
          SET status = 'leased', attempt_count = ?, lease_owner = ?,
              lease_expires_at = ?, updated_at = ?
          WHERE id = ?
            AND ((status = 'pending' AND available_at <= ?)
              OR (status = 'leased' AND lease_expires_at <= ?))
        `).run(nextAttempt, options.workerId, nowMs + leaseMs, this.now().toISOString(), row.id, nowMs, nowMs);
        if (Number(update.changes) !== 1)
          continue;
        jobs.push({
          id: row.id,
          event: parseJson(row.event_json),
          channel,
          attempt: nextAttempt,
          workerId: options.workerId
        });
      }
      return jobs;
    });
  }
  settle(job, attempt) {
    return this.immediate(() => {
      const row = this.db.query(`
        SELECT attempts_json FROM outbox
        WHERE id = ? AND status = 'leased' AND lease_owner = ?
      `).get(job.id, job.workerId);
      if (!row)
        return { status: "lost" };
      const attempts = parseJson(row.attempts_json);
      attempts.push(attempt);
      if (attempt.status === "success") {
        const delivery2 = createDeliveryResult(job.event, job.channel, attempts);
        this.completeOutbox(job, "delivered", attempts, delivery2);
        return { status: "delivered", delivery: delivery2 };
      }
      const retry = normalizeRetryPolicy2(job.channel.retry);
      if (job.attempt < retry.maxAttempts) {
        const backoffMs = retryBackoffMs(retry, job.attempt);
        attempt.nextBackoffMs = backoffMs;
        this.db.query(`
          UPDATE outbox
          SET status = 'pending', available_at = ?, attempts_json = ?,
              lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND lease_owner = ?
        `).run(this.now().getTime() + backoffMs, JSON.stringify(attempts), this.now().toISOString(), job.id, job.workerId);
        return { status: "retry" };
      }
      const delivery = createDeliveryResult(job.event, job.channel, attempts);
      this.completeOutbox(job, "dead", attempts, delivery);
      return { status: "dead", delivery };
    });
  }
  completeOutbox(job, status, attempts, delivery) {
    const timestamp = this.now().toISOString();
    this.db.query(`
      UPDATE outbox
      SET status = ?, attempts_json = ?, lease_owner = NULL,
          lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND lease_owner = ?
    `).run(status, JSON.stringify(attempts), timestamp, job.id, job.workerId);
    this.db.query(`
      INSERT INTO deliveries (id, event_id, channel_id, result_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(delivery.id, job.event.id, job.channel.id, JSON.stringify(delivery), timestamp);
  }
  findEvent(id, dedupeKey) {
    if (dedupeKey === undefined) {
      return this.db.query("SELECT envelope_json FROM events WHERE id = ? LIMIT 1").get(id);
    }
    return this.db.query(`
      SELECT envelope_json FROM events
      WHERE id = ? OR dedupe_key = ?
      LIMIT 1
    `).get(id, dedupeKey);
  }
  queueMatchingChannels(event) {
    const channels = this.db.query("SELECT config_json FROM channels WHERE enabled = 1 ORDER BY id").all();
    let queued = 0;
    for (const row of channels) {
      const channel = parseJson(row.config_json);
      if (!channelMatchesEvent(channel, event))
        continue;
      const channelEvent = redactPaths(event, channel.redact?.paths ?? [], channel.redact?.replacement ?? "[REDACTED]");
      const timestamp = this.now().toISOString();
      const inserted = this.db.query(`
        INSERT OR IGNORE INTO outbox (
          id, event_id, channel_id, event_json, channel_json, status,
          attempt_count, available_at, attempts_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, '[]', ?, ?)
      `).run(randomUUID3(), event.id, channel.id, JSON.stringify(channelEvent), JSON.stringify(channel), this.now().getTime(), timestamp, timestamp);
      queued += Number(inserted.changes);
    }
    return queued;
  }
  count(sql) {
    const row = this.db.query(sql).get();
    return Number(row?.count ?? 0);
  }
  immediate(operation) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }
  ensureSchema() {
    const version = this.readSchemaVersion();
    if (!Number.isInteger(version) || version < 0) {
      throw new Error("Durable SQLite schema version is invalid");
    }
    if (version > DURABLE_SCHEMA_VERSION) {
      throw new Error(`Durable SQLite schema version ${version} is newer than supported version ${DURABLE_SCHEMA_VERSION}`);
    }
    if (version === 0) {
      this.immediate(() => {
        if (this.readSchemaVersion() !== 0) {
          throw new Error("Durable SQLite schema version changed during initialization");
        }
        this.assertEmptyApplicationSchema();
        this.createSchemaV1();
        this.assertSchemaV1();
        this.db.exec(`PRAGMA user_version = ${DURABLE_SCHEMA_VERSION};`);
        if (this.readSchemaVersion() !== DURABLE_SCHEMA_VERSION) {
          throw new Error("Durable SQLite schema version could not be recorded");
        }
      });
      return;
    }
    this.assertSchemaV1();
  }
  createSchemaV1() {
    for (const sql of Object.values(SCHEMA_V1_TABLE_SQL))
      this.db.exec(`${sql};`);
    for (const sql of Object.values(SCHEMA_V1_INDEX_SQL))
      this.db.exec(`${sql};`);
  }
  assertSchemaV1() {
    const objects = this.applicationSchemaObjects();
    const expectedObjects = [
      ...Object.entries(SCHEMA_V1_TABLE_SQL).map(([name, sql]) => ({ type: "table", name, table: name, sql })),
      ...Object.entries(SCHEMA_V1_INDEX_SQL).map(([name, sql]) => ({
        type: "index",
        name,
        table: schemaIndexTable(name),
        sql
      }))
    ].sort(compareSchemaObjects);
    assertSchemaShape("application objects", objects.map(({ type, name, table }) => ({ type, name, table })), expectedObjects.map(({ type, name, table }) => ({ type, name, table })));
    for (const table of Object.keys(SCHEMA_V1_TABLE_SQL)) {
      const columns = this.db.query(`PRAGMA table_info(${schemaIdentifier(table)})`).all().map((column) => ({
        name: column.name,
        type: column.type,
        notnull: Number(column.notnull),
        defaultValue: column.dflt_value,
        pk: Number(column.pk)
      }));
      assertSchemaShape(`${table} columns`, columns, SCHEMA_V1_COLUMNS[table]);
      const foreignKeys = this.db.query(`PRAGMA foreign_key_list(${schemaIdentifier(table)})`).all().map((foreignKey) => ({
        table: foreignKey.table,
        from: foreignKey.from,
        to: foreignKey.to,
        onUpdate: foreignKey.on_update,
        onDelete: foreignKey.on_delete,
        match: foreignKey.match
      })).sort((left, right) => `${left.from}:${left.table}`.localeCompare(`${right.from}:${right.table}`));
      assertSchemaShape(`${table} foreign keys`, foreignKeys, SCHEMA_V1_FOREIGN_KEYS[table]);
      const indexes = this.db.query(`PRAGMA index_list(${schemaIdentifier(table)})`).all().map((index) => ({
        name: index.name,
        unique: Number(index.unique),
        origin: index.origin,
        partial: Number(index.partial),
        columns: this.db.query(`PRAGMA index_info(${schemaIdentifier(index.name)})`).all().sort((left, right) => Number(left.seqno) - Number(right.seqno)).map((column) => column.name)
      })).sort((left, right) => left.name.localeCompare(right.name));
      const expectedIndexes = [...SCHEMA_V1_INDEXES[table]].sort((left, right) => left.name.localeCompare(right.name));
      assertSchemaShape(`${table} indexes`, indexes, expectedIndexes);
    }
    for (const expected of expectedObjects) {
      const actual = objects.find((object2) => object2.type === expected.type && object2.name === expected.name);
      if (!actual?.sql || normalizeSchemaSql(actual.sql) !== normalizeSchemaSql(expected.sql)) {
        throw incompatibleSchema(`${expected.type} ${expected.name} SQL`);
      }
    }
  }
  readSchemaVersion() {
    const row = this.db.query("PRAGMA user_version").get();
    return Number(row?.user_version);
  }
  applicationSchemaObjects() {
    return this.db.query(`
      SELECT type, name, tbl_name, sql
      FROM sqlite_master
      WHERE substr(name, 1, 7) <> 'sqlite_'
      ORDER BY type, name
    `).all().map((row) => ({
      type: row.type,
      name: row.name,
      table: row.tbl_name,
      sql: row.sql
    }));
  }
  assertEmptyApplicationSchema() {
    if (this.applicationSchemaObjects().length !== 0) {
      throw new Error("Durable SQLite schema version 0 requires an empty application schema");
    }
  }
  secureDatabaseFiles() {
    for (const path of [this.databasePath, `${this.databasePath}-wal`, `${this.databasePath}-shm`]) {
      if (!existsSync3(path))
        continue;
      chmodSync(path, 384);
    }
  }
}
function schemaIndexTable(name) {
  if (name === "events_dedupe_key_unique" || name === "events_source_type_idx")
    return "events";
  if (name === "outbox_due_idx")
    return "outbox";
  throw new Error(`Unknown durable schema index: ${name}`);
}
function schemaIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    throw new Error("Invalid durable schema identifier");
  return value;
}
function compareSchemaObjects(left, right) {
  return `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`);
}
function normalizeSchemaSql(sql) {
  return sql.trim().replace(/;$/, "").replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").toLowerCase();
}
function assertSchemaShape(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw incompatibleSchema(label);
}
function incompatibleSchema(detail) {
  return new Error(`Durable SQLite schema version 1 is incompatible: ${detail}`);
}
function normalizePositiveInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1)
    throw new Error(`${name} must be a positive integer`);
  return resolved;
}
function normalizeRetryPolicy2(policy) {
  const normalized = {
    maxAttempts: policy?.maxAttempts ?? 1,
    backoffMs: policy?.backoffMs ?? 250,
    multiplier: policy?.multiplier ?? 2
  };
  validateRetryPolicy(normalized);
  return normalized;
}
function validateRetryPolicy(policy) {
  const maxAttempts = policy.maxAttempts ?? 1;
  const backoffMs = policy.backoffMs ?? 250;
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_RETRY_ATTEMPTS) {
    throw new Error(`retry.maxAttempts must be an integer from 1 to ${MAX_RETRY_ATTEMPTS}`);
  }
  if (!Number.isInteger(backoffMs) || backoffMs < 0 || backoffMs > MAX_RETRY_DELAY_MS) {
    throw new Error(`retry.backoffMs must be an integer from 0 to ${MAX_RETRY_DELAY_MS}`);
  }
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > MAX_RETRY_MULTIPLIER) {
    throw new Error(`retry.multiplier must be finite and from 1 to ${MAX_RETRY_MULTIPLIER}`);
  }
  if (maxAttempts > 1)
    retryBackoffMs({ maxAttempts, backoffMs, multiplier }, maxAttempts - 1);
}
function retryBackoffMs(policy, attempt) {
  const delay = Math.round(policy.backoffMs * policy.multiplier ** (attempt - 1));
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > MAX_RETRY_DELAY_MS) {
    throw new Error(`retry policy must not produce a delay above ${MAX_RETRY_DELAY_MS}ms`);
  }
  return delay;
}
function parseJson(value) {
  return JSON.parse(value);
}
function validateDurableWebhookConfig(webhook) {
  let url;
  try {
    url = new URL(webhook.url);
  } catch {
    throw new Error("Durable webhook URL must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Durable webhook URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Durable webhook URL must not contain credentials");
  }
  for (const name of url.searchParams.keys()) {
    if (/authorization|cookie|api[-_]?key|token|secret|credential|signature/i.test(name)) {
      throw new Error("Durable webhook URL must not contain credential query parameters");
    }
  }
  for (const name of Object.keys(webhook.headers ?? {})) {
    if (/^x-hasna-/i.test(name)) {
      throw new Error("Durable webhook X-Hasna headers are reserved for signed delivery metadata");
    }
    if (/authorization|cookie|api[-_]?key|token|secret|credential/i.test(name)) {
      throw new Error("Durable webhook credential headers are not persisted; use webhook.secretRef");
    }
  }
}
function sanitizeDurableAttempt(attempt) {
  const { responseBody: _responseBody, stdout: _stdout, stderr: _stderr, ...metadata } = attempt;
  if (metadata.status === "failed") {
    metadata.error = metadata.responseStatus === undefined ? "Webhook delivery failed" : `Webhook returned HTTP ${metadata.responseStatus}`;
  }
  return metadata;
}
function parseSpoolEnvelope(raw) {
  const value = parseJson(raw);
  if (!value || typeof value !== "object")
    throw new Error("Invalid durable event spool record");
  for (const field of ["id", "source", "type", "time", "schemaVersion"]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error("Invalid durable event spool record");
    }
  }
  if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
    throw new Error("Invalid durable event spool record");
  }
  if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)) {
    throw new Error("Invalid durable event spool record");
  }
  return value;
}
function syncDirectory(path) {
  const descriptor = openSync2(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync2(descriptor);
  }
}
function quarantineSpoolRecord(dataDir2, path, reason) {
  const spoolDir = join4(dataDir2, "spool");
  const quarantineDir = join4(spoolDir, "quarantine");
  mkdirSync(quarantineDir, { recursive: true, mode: 448 });
  chmodSync(spoolDir, 448);
  chmodSync(quarantineDir, 448);
  const name = basename(path);
  const base = name.replace(/\.json$/, "");
  const suffix = `${Date.now()}-${randomUUID3().slice(0, 8)}`;
  const destination = join4(quarantineDir, `${base}.${suffix}.json`);
  renameSync(path, destination);
  const metadata = {
    quarantinedAt: new Date().toISOString(),
    originalName: name,
    reason
  };
  writeFileSync(join4(quarantineDir, `${base}.${suffix}.meta.json`), `${JSON.stringify(metadata, null, 2)}
`, { mode: 384 });
  syncDirectory(quarantineDir);
}
function isNodeError(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
function spoolFileName(event) {
  const identity = event.dedupeKey ?? event.id;
  return `${createHash2("sha256").update(identity, "utf8").digest("hex")}.json`;
}

// src/durable-worker.ts
import { chmodSync as chmodSync2, mkdirSync as mkdirSync2, watch } from "fs";
import { randomUUID as randomUUID5 } from "crypto";
import { join as join6 } from "path";

// src/durable-spool.ts
import { createHash as createHash3, randomUUID as randomUUID4 } from "crypto";
import {
  chmod as chmod2,
  link,
  mkdir as mkdir2,
  open,
  readdir,
  readFile as readFile2,
  stat,
  unlink
} from "fs/promises";
import { join as join5 } from "path";

class DurableEventSpool {
  dataDir;
  inboxDir;
  constructor(options) {
    if (!options.dataDir)
      throw new Error("DurableEventSpool requires dataDir");
    this.dataDir = options.dataDir;
    this.inboxDir = join5(options.dataDir, "spool", "inbox");
  }
  async enqueue(input) {
    const event = redactSensitiveKeys(createSpoolEvent(input));
    await this.ensureInbox();
    const finalPath = this.pathFor(event);
    const tempPath = join5(this.inboxDir, `.tmp-${process.pid}-${randomUUID4()}`);
    const handle = await open(tempPath, "wx", 384);
    try {
      await handle.writeFile(`${JSON.stringify(event)}
`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    let stored = false;
    try {
      await link(tempPath, finalPath);
      stored = true;
    } catch (error) {
      if (!isNodeError2(error, "EEXIST")) {
        await unlink(tempPath).catch(() => {
          return;
        });
        throw error;
      }
      await this.assertSameIdentity(finalPath, event);
    }
    await unlink(tempPath);
    await this.syncInbox();
    return { event, stored, deduped: !stored };
  }
  async recover(options = {}) {
    await this.ensureInbox();
    const olderThanMs = Math.max(0, options.olderThanMs ?? 60000);
    const threshold = Date.now() - olderThanMs;
    const result = { recovered: 0, deduped: 0, cleaned: 0 };
    const names = (await readdir(this.inboxDir)).filter((name) => name.startsWith(".tmp-")).sort();
    for (const name of names) {
      const tempPath = join5(this.inboxDir, name);
      const details = await stat(tempPath).catch(() => {
        return;
      });
      if (!details || details.mtimeMs > threshold)
        continue;
      let event;
      try {
        event = parseEnvelope(await readFile2(tempPath, "utf8"));
      } catch {
        await unlink(tempPath).catch(() => {
          return;
        });
        result.cleaned += 1;
        continue;
      }
      const finalPath = this.pathFor(event);
      try {
        await link(tempPath, finalPath);
        result.recovered += 1;
      } catch (error) {
        if (!isNodeError2(error, "EEXIST"))
          throw error;
        await this.assertSameIdentity(finalPath, event);
        result.deduped += 1;
      }
      await unlink(tempPath).catch(() => {
        return;
      });
    }
    if (result.recovered || result.deduped || result.cleaned)
      await this.syncInbox();
    return result;
  }
  async close() {}
  pathFor(event) {
    const identity = event.dedupeKey ?? event.id;
    const digest = createHash3("sha256").update(identity, "utf8").digest("hex");
    return join5(this.inboxDir, `${digest}.json`);
  }
  async assertSameIdentity(path, event) {
    const existing = parseEnvelope(await readFile2(path, "utf8"));
    const matches = existing.id === event.id || event.dedupeKey !== undefined && existing.dedupeKey === event.dedupeKey;
    if (!matches)
      throw new Error("Durable spool identity collision");
  }
  async ensureInbox() {
    const spoolDir = join5(this.dataDir, "spool");
    await mkdir2(this.inboxDir, { recursive: true, mode: 448 });
    await chmod2(this.dataDir, 448);
    await chmod2(spoolDir, 448);
    await chmod2(this.inboxDir, 448);
    await this.syncDirectory(this.dataDir);
    await this.syncDirectory(spoolDir);
  }
  async syncInbox() {
    await this.syncDirectory(this.inboxDir);
  }
  async syncDirectory(path) {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
function createSpoolEvent(input) {
  return {
    id: input.id ?? randomUUID4(),
    source: input.source,
    type: input.type,
    time: input.time instanceof Date ? input.time.toISOString() : input.time ?? new Date().toISOString(),
    subject: input.subject,
    severity: input.severity ?? "info",
    data: input.data ?? {},
    message: input.message,
    dedupeKey: input.dedupeKey,
    schemaVersion: input.schemaVersion ?? "1.0",
    metadata: input.metadata ?? {}
  };
}
function parseEnvelope(raw) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object")
    throw new Error("Invalid durable event spool record");
  for (const field of ["id", "source", "type", "time", "schemaVersion"]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error("Invalid durable event spool record");
    }
  }
  if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
    throw new Error("Invalid durable event spool record");
  }
  if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)) {
    throw new Error("Invalid durable event spool record");
  }
  return value;
}
function isNodeError2(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

// src/durable-worker.ts
var MAX_TIMER_DELAY_MS = 2147483647;
async function runDurableWorker(options) {
  const workerId = options.workerId ?? randomUUID5();
  const limit = positiveInteger(options.limit, 100, "limit");
  const leaseMs = positiveInteger(options.leaseMs, 60000, "leaseMs");
  const debounceMs = nonNegativeInteger(options.debounceMs, 50, "debounceMs");
  const reconcileMs = positiveInteger(options.reconcileMs, 30000, "reconcileMs");
  const watchRestartMs = positiveInteger(options.watchRestartMs, 1000, "watchRestartMs");
  const spool = new DurableEventSpool({ dataDir: options.broker.dataDir });
  const inboxDir = spool.inboxDir;
  mkdirSync2(inboxDir, { recursive: true, mode: 448 });
  chmodSync2(join6(options.broker.dataDir, "spool"), 448);
  chmodSync2(inboxDir, 448);
  const totals = {
    workerId,
    cycles: 0,
    imported: 0,
    deduped: 0,
    delivered: 0,
    retried: 0,
    dead: 0,
    lost: 0
  };
  return new Promise((resolve2, reject) => {
    let watcher;
    let debounceTimer;
    let retryTimer;
    let reconcileTimer;
    let restartTimer;
    let running = false;
    let rerun = false;
    let stopped = false;
    const clearRetryTimer = () => {
      if (retryTimer)
        clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    const stop = () => {
      if (stopped)
        return;
      stopped = true;
      watcher?.close();
      if (debounceTimer)
        clearTimeout(debounceTimer);
      clearRetryTimer();
      if (reconcileTimer)
        clearInterval(reconcileTimer);
      if (restartTimer)
        clearTimeout(restartTimer);
      options.signal.removeEventListener("abort", stop);
      if (!running)
        resolve2(totals);
    };
    const scheduleRetryWake = () => {
      clearRetryTimer();
      if (stopped)
        return;
      const nextWakeAt = options.broker.nextWakeAt();
      if (nextWakeAt === undefined)
        return;
      const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, nextWakeAt - Date.now()));
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        runCycle();
      }, delay);
    };
    const runCycle = async () => {
      if (stopped)
        return;
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      clearRetryTimer();
      try {
        await spool.recover();
        const imported = options.broker.importSpool({ limit });
        const drained = await options.broker.drain({ workerId, limit, leaseMs });
        const cycle = { imported, drained };
        totals.cycles += 1;
        totals.imported += imported.imported;
        totals.deduped += imported.deduped;
        totals.delivered += drained.delivered;
        totals.retried += drained.retried;
        totals.dead += drained.dead;
        totals.lost += drained.lost;
        await options.onCycle?.(cycle);
        if (imported.scanned >= limit || drained.claimed >= limit)
          rerun = true;
      } catch (error) {
        reject(error);
        stop();
        return;
      } finally {
        running = false;
      }
      if (stopped) {
        resolve2(totals);
      } else if (rerun) {
        rerun = false;
        queueMicrotask(() => {
          runCycle();
        });
      } else {
        scheduleRetryWake();
      }
    };
    const scheduleDebouncedCycle = () => {
      if (stopped)
        return;
      if (debounceTimer)
        clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        runCycle();
      }, debounceMs);
    };
    const startWatcher = () => {
      if (stopped)
        return;
      watcher?.close();
      try {
        watcher = watch(inboxDir, () => scheduleDebouncedCycle());
        watcher.on("error", () => {
          watcher?.close();
          watcher = undefined;
          scheduleDebouncedCycle();
          if (!stopped)
            restartTimer = setTimeout(startWatcher, watchRestartMs);
        });
      } catch {
        scheduleDebouncedCycle();
        if (!stopped)
          restartTimer = setTimeout(startWatcher, watchRestartMs);
      }
    };
    options.signal.addEventListener("abort", stop, { once: true });
    if (options.signal.aborted) {
      stop();
      return;
    }
    startWatcher();
    reconcileTimer = setInterval(() => {
      runCycle();
    }, reconcileMs);
    runCycle();
  });
}
function positiveInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1)
    throw new Error(`${name} must be a positive integer`);
  return resolved;
}
function nonNegativeInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return resolved;
}

// src/filter-options.ts
function parseFieldMatchers(values, label, typed = false) {
  if (!values?.length)
    return;
  const result = {};
  for (const value of values) {
    const parsed = parseMatcherExpression(value, label);
    const path = parsed.path;
    if (path in result)
      throw new Error(`Duplicate ${label} filter path: ${path}`);
    const matcherValue = typed ? parseTypedMatcherValue(parsed.rawValue, label) : parsed.rawValue;
    result[path] = parsed.negated ? { not: matcherValue } : matcherValue;
  }
  return result;
}
function parseFilterOptions(options) {
  const filter2 = {};
  if (options.source)
    filter2.source = options.source;
  if (options.type)
    filter2.type = options.type;
  if (options.subject)
    filter2.subject = options.subject;
  if (options.severity)
    filter2.severity = options.severity;
  const data = mergeMatchers(parseFieldMatchers(options.data, "data"), parseFieldMatchers(options.dataJson, "data-json", true));
  const metadata = mergeMatchers(parseFieldMatchers(options.metadata, "metadata"), parseFieldMatchers(options.metadataJson, "metadata-json", true));
  if (Object.keys(data).length > 0)
    filter2.data = data;
  if (Object.keys(metadata).length > 0)
    filter2.metadata = metadata;
  return Object.keys(filter2).length > 0 ? [filter2] : undefined;
}
function mergeMatchers(...records) {
  const result = {};
  for (const record of records) {
    if (!record)
      continue;
    for (const [path, value] of Object.entries(record)) {
      if (path in result)
        throw new Error(`Duplicate filter path: ${path}`);
      result[path] = value;
    }
  }
  return result;
}
function parseTypedMatcherValue(value, label) {
  const parsed = JSON.parse(value);
  if (parsed === null || typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean" || Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
    return parsed;
  }
  throw new Error(`${label} filter JSON values must be string, string[], number, boolean, or null`);
}
function parseMatcherExpression(value, label) {
  const negativeSeparator = value.indexOf("!=");
  if (negativeSeparator > 0) {
    return {
      path: value.slice(0, negativeSeparator),
      rawValue: value.slice(negativeSeparator + 2),
      negated: true
    };
  }
  const separator = value.indexOf("=");
  if (separator <= 0)
    throw new Error(`Invalid ${label} filter, expected path=value or path!=value: ${value}`);
  return {
    path: value.slice(0, separator),
    rawValue: value.slice(separator + 1),
    negated: false
  };
}

// src/cli-webhook-policy.ts
function webhookTargetPolicyFromEnv() {
  const value = process.env.HASNA_EVENTS_ALLOW_PRIVATE_WEBHOOK_TARGETS;
  if (!value)
    return;
  const hosts = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return hosts.length > 0 ? { allowPrivateHosts: hosts } : undefined;
}

// src/cli/index.ts
function version() {
  try {
    const packagePath = join7(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync3(packagePath, "utf-8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function parseGlobalArgs(argv) {
  const rest = [];
  let json = false;
  let dir;
  for (let index = 0;index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-")) {
      rest.push(...argv.slice(index));
      break;
    }
    if (arg === "--json" || arg === "-j") {
      json = true;
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg === "--dir") {
      dir = argv[++index];
    } else {
      rest.push(...argv.slice(index));
      break;
    }
  }
  return { json, dir, rest };
}
function takeOption(args, name) {
  const equalsPrefix = `${name}=`;
  const equalsIndex = args.findIndex((arg) => arg.startsWith(equalsPrefix));
  if (equalsIndex !== -1) {
    const value2 = args[equalsIndex]?.slice(equalsPrefix.length);
    args.splice(equalsIndex, 1);
    return value2;
  }
  const index = args.indexOf(name);
  if (index === -1)
    return;
  const value = args[index + 1];
  if (value === undefined)
    throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}
function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1)
    return false;
  args.splice(index, 1);
  return true;
}
function takeMany(args, name) {
  const values = [];
  while (args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`))) {
    const value = takeOption(args, name);
    if (value !== undefined)
      values.push(value);
  }
  return values;
}
function parseJsonOption(value, fallback) {
  if (!value)
    return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed;
}
function parseFilter(args) {
  return parseFilterOptions({
    type: takeOption(args, "--type") ?? takeOption(args, "--event-type"),
    source: takeOption(args, "--source"),
    subject: takeOption(args, "--subject"),
    severity: takeOption(args, "--severity"),
    data: takeMany(args, "--data"),
    metadata: takeMany(args, "--metadata"),
    dataJson: takeMany(args, "--data-json"),
    metadataJson: takeMany(args, "--metadata-json")
  });
}
function parseHeaders(values) {
  if (values.length === 0)
    return;
  const headers = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator === -1)
      throw new Error(`Invalid header, expected name=value: ${value}`);
    headers[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return headers;
}
function output(parsed, value, human) {
  if (parsed.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  human();
}
function commandName(options) {
  return options.programName ?? "events";
}
function printHelp(options = {}) {
  const name = commandName(options);
  console.log(`${name} ${version()}

Usage:
  ${name} intake capability|accept|receipt --help
  ${name} [--dir <path>] [--json] channels add <url|command> [options]
  ${name} [--dir <path>] [--json] channels list
  ${name} [--dir <path>] [--json] channels remove <id>
  ${name} [--dir <path>] [--json] channels test <id>
  ${name} [--dir <path>] [--json] channels match <id>
  ${name} [--dir <path>] [--json] channels status
  ${name} [--dir <path>] [--json] status
  ${name} [--dir <path>] [--json] events emit <type>${options.source ? "" : " --source <source>"} [options]
  ${name} [--dir <path>] [--json] events list [--limit <n>]
  ${name} [--dir <path>] [--json] events replay [--id <event-id>] [--cursor <cursor>] [--limit <n>] [--dry-run]
  ${name} [--dir <path>] [--json] durable channel <url> [options]
  ${name} [--dir <path>] [--json] durable enqueue <type> --source <source> [options]
  ${name} [--dir <path>] [--json] durable import [--limit <n>]
  ${name} [--dir <path>] [--json] durable drain [--limit <n>] [--lease-ms <ms>]
  ${name} [--dir <path>] [--json] durable work [--limit <n>] [--lease-ms <ms>] [--reconcile-ms <ms>]
  ${name} [--dir <path>] [--json] durable retry-dead [--event-id <id>] [--channel-id <id>] [--limit <n>]
  ${name} [--dir <path>] [--json] durable status

Global options (must precede the command group):
  --dir <path>              Data directory
  -j, --json               Print JSON output
  -h, --help               Show help
  -v, --version            Show version

Environment:
  HASNA_EVENTS_DIR                               Primary data-directory override
  HASNA_EVENTS_HOME                              Legacy data-directory fallback
  HASNA_EVENTS_ALLOW_PRIVATE_WEBHOOK_TARGETS     Admin allowlist for intentional private webhook
                                                 ingress (comma-separated hostnames or IPs).
                                                 Webhook targets default-deny private/special-use
                                                 addresses.
  Default directory                              ${getEventsDataDir()}`);
}
function printChannelsHelp(options = {}) {
  const name = commandName(options);
  console.log(`${name} channels

Usage:
  ${name} [--dir <path>] [--json] channels add <url|command> [options]
  ${name} [--dir <path>] [--json] channels list
  ${name} [--dir <path>] [--json] channels remove <id>
  ${name} [--dir <path>] [--json] channels test <id>
  ${name} [--dir <path>] [--json] channels match <id>
  ${name} [--dir <path>] [--json] channels status

Commands:
  add                       Add or replace a channel
  list                      List configured channels
  remove                    Remove a channel
  test                      Send a sample event to one channel
  match                     Preview a sample event without delivery
  status                    Show channel storage status

Run '${name} channels add --help' for add options.

Test and match options:
  --source <source>         Event source (default: ${options.source ?? "hasna.events"})
  --type <type>             Event type (default: events.test)
  --subject <subject>       Event subject (default: channel id)
  --message <message>       Event message
  --data <json>             Event data object
  --metadata <json>         Event metadata object
  --honor-filters           Test only: skip delivery on a filter mismatch`);
}
function printChannelAddHelp(options = {}) {
  const name = commandName(options);
  console.log(`${name} channels add

Usage:
  ${name} [--dir <path>] [--json] channels add <url|command> [options]
  ${name} [--dir <path>] [--json] channels add <command> --transport command [options] -- [command-args...]

Options:
  --id <id>                 Channel id (default: generated UUID)
  --name <name>             Display name
  --transport <kind>        webhook or command (default: webhook)
  --type <pattern>          Event type filter, supports wildcards
  --event-type <pattern>    Alias for --type
  --source <source>         Event source filter
  --subject <subject>       Event subject filter
  --severity <severity>     Event severity filter
  --data <path=value>       String data filter; repeatable; != negates
  --metadata <path=value>   String metadata filter; repeatable; != negates
  --data-json <path=json>   Typed JSON data filter; repeatable; != negates
  --metadata-json <path=json> Typed JSON metadata filter; repeatable; != negates
  --secret <secret>         Webhook signing secret
  --header <name=value>     Webhook header, repeatable
  --arg <arg>               Command argument, repeatable; values may begin with dashes
  --timeout-ms <ms>         Transport timeout (default: 15000)
  --retry-attempts <n>      Maximum delivery attempts (default: 1)
  --retry-backoff-ms <ms>   Initial retry backoff (default: 250)
  --redact <path>           Redaction path, repeatable
  --disabled                Create channel disabled

Examples:
  ${name} channels add https://example.com/channels/hasna --id ops --retry-attempts 3 --retry-backoff-ms 500
  ${name} channels add bun --id command-hook --transport command --arg run --arg ./handler.ts --arg --json
  ${name} channels add bun --id command-hook --transport command --arg=--json
  ${name} channels add bun --id command-hook --transport command -- run ./handler.ts --json`);
}
function printEventsHelp(options = {}) {
  const name = commandName(options);
  console.log(`${name} events

Usage:
  ${name} [--dir <path>] [--json] events emit <type>${options.source ? "" : " --source <source>"} [options]
  ${name} [--dir <path>] [--json] events list [--limit <n>]
  ${name} [--dir <path>] [--json] events replay [--id <event-id>] [--cursor <cursor>] [--limit <n>] [--dry-run]

Emit options:
  --source <source>         Event source${options.source ? ` (default: ${options.source})` : ""}
  --subject <subject>       Event subject
  --severity <severity>     debug|info|notice|warning|error|critical (default: info)
  --message <message>       Human-readable event message
  --dedupe-key <key>        Deduplicate repeated events
  --data <json>             JSON object payload
  --metadata <json>         JSON object metadata
  --no-deliver              Record without delivering channels

List options:
  --source <source>         Filter by exact source
  --type <type>             Filter by exact type
  --limit <n>               Most recent events; 0 or omitted lists all

Replay options:
  --id <event-id>           Filter by exact event id
  --source <source>         Filter by exact source
  --type <type>             Filter by exact type
  --cursor <cursor>         Opaque cursor returned by a previous replay page
  --limit <n>               Maximum events to replay
  --dry-run                 Preview replay matches without delivery`);
}
async function runEventsCli(argv = process.argv.slice(2), options = {}) {
  const parsed = parseGlobalArgs(argv);
  const [group, command, ...tail] = parsed.rest;
  if (!group || group === "--help" || group === "-h") {
    printHelp(options);
    return;
  }
  if (group === "--version" || group === "-v") {
    console.log(version());
    return;
  }
  if (group === "status") {
    const status = await getEventsStatus(parsed.dir);
    output(parsed, status, () => {
      console.log(`events ${status.counts.events} event(s), ${status.counts.channels} channel(s), ${status.counts.deliveries} delivery record(s)`);
      console.log(`dataDir: ${status.dataDir}`);
    });
    return;
  }
  if (group === "durable") {
    if (!command || command === "--help" || command === "-h" || tail.includes("--help") || tail.includes("-h")) {
      printDurableHelp(options);
      return;
    }
    const broker = new DurableEventsBroker({
      dataDir: parsed.dir ?? getEventsDataDir(),
      webhookTargetPolicy: webhookTargetPolicyFromEnv()
    });
    try {
      await handleDurable(broker, command, tail, parsed);
    } finally {
      broker.close();
    }
    return;
  }
  if (group === "intake") {
    if (parsed.dir !== undefined)
      throw new Error("intake does not accept a local directory selector");
    const { runIntakeCli: runIntakeCli2 } = await Promise.resolve().then(() => (init_cli(), exports_cli));
    await runIntakeCli2(command ? [command, ...tail] : ["--help"]);
    return;
  }
  const store = new JsonEventsStore(parsed.dir);
  const client = new EventsClient({ store, webhookTargetPolicy: webhookTargetPolicyFromEnv() });
  if (group === "channels") {
    if (!command || command === "--help" || command === "-h") {
      printChannelsHelp(options);
      return;
    }
    if (command === "add" && (tail[0] === "--help" || tail[0] === "-h")) {
      printChannelAddHelp(options);
      return;
    }
    if (tail.includes("--help") || tail.includes("-h")) {
      printChannelsHelp(options);
      return;
    }
    await handleChannels(client, command, tail, parsed, options);
    return;
  }
  if (group === "events") {
    if (!command || command === "--help" || command === "-h") {
      printEventsHelp(options);
      return;
    }
    if (tail.includes("--help") || tail.includes("-h")) {
      printEventsHelp(options);
      return;
    }
    await handleEvents(client, command, tail, parsed, options);
    return;
  }
  throw new Error(`Unknown command group: ${group}`);
}
function printDurableHelp(options = {}) {
  const name = commandName(options);
  console.log(`${name} durable

Usage:
  ${name} [--dir <path>] [--json] durable channel <url> --id <id> --source <source> --type <type> --secret-ref <ref> [options]
  ${name} [--dir <path>] [--json] durable enqueue <type> --source <source> [options]
  ${name} [--dir <path>] [--json] durable import [--limit <n>]
  ${name} [--dir <path>] [--json] durable drain [--limit <n>] [--lease-ms <ms>]
  ${name} [--dir <path>] [--json] durable work [--limit <n>] [--lease-ms <ms>] [--reconcile-ms <ms>]
  ${name} [--dir <path>] [--json] durable retry-dead [--event-id <id>] [--channel-id <id>] [--limit <n>]
  ${name} [--dir <path>] [--json] durable status

Channel options:
  --id <id>                 Required stable channel id
  --source <source>         Required exact source filter
  --type <type>             Required exact event type filter
  --secret-ref <ref>        Runtime secret reference, e.g. env:HASNA_WEBHOOK_SECRET
  --timeout-ms <ms>         Webhook timeout (default: 15000)
  --retry-attempts <n>      Maximum durable attempts (default: 1)
  --retry-backoff-ms <ms>   Initial persisted backoff (default: 250)
  --disabled                Persist the route disabled

Enqueue options:
  --id <id>                 Stable event id
  --subject <subject>       Stable event subject
  --time <iso-time>         Event occurrence time
  --schema-version <value>  Envelope schema version
  --dedupe-key <key>        Stable business idempotency key
  --data <json>             Event data object
  --metadata <json>         Event metadata object`);
}
async function handleDurable(broker, command, tail, parsed) {
  if (command === "channel") {
    const args = [...tail];
    const target = args.shift();
    if (!target)
      throw new Error("durable channel requires a webhook URL");
    const id = takeOption(args, "--id");
    const source = takeOption(args, "--source");
    const type = takeOption(args, "--type");
    if (!id || !source || !type)
      throw new Error("durable channel requires --id, --source, and --type");
    if (source.includes("*") || type.includes("*"))
      throw new Error("durable channel source/type filters must be exact");
    const secretRef = takeOption(args, "--secret-ref");
    if (!secretRef)
      throw new Error("durable channel requires --secret-ref");
    const timeoutMs = numberOption(takeOption(args, "--timeout-ms"));
    const retryAttempts = numberOption(takeOption(args, "--retry-attempts"));
    const retryBackoffMs2 = numberOption(takeOption(args, "--retry-backoff-ms"));
    const channel = broker.addChannel({
      id,
      enabled: !takeFlag(args, "--disabled"),
      transport: "webhook",
      filters: [{ source, type }],
      webhook: { url: target, secretRef, timeoutMs },
      retry: retryAttempts || retryBackoffMs2 ? { maxAttempts: retryAttempts, backoffMs: retryBackoffMs2 } : undefined
    });
    output(parsed, sanitizeChannelForOutput(channel), () => console.log(`Added durable webhook channel ${channel.id}`));
    return;
  }
  if (command === "enqueue") {
    const args = [...tail];
    const type = args.shift();
    if (!type)
      throw new Error("durable enqueue requires an event type");
    const source = takeOption(args, "--source");
    if (!source)
      throw new Error("durable enqueue requires --source");
    const result = broker.enqueue({
      id: takeOption(args, "--id"),
      source,
      type,
      time: takeOption(args, "--time"),
      subject: takeOption(args, "--subject"),
      dedupeKey: takeOption(args, "--dedupe-key"),
      schemaVersion: takeOption(args, "--schema-version"),
      data: parseJsonOption(takeOption(args, "--data"), {}),
      metadata: parseJsonOption(takeOption(args, "--metadata"), {})
    });
    output(parsed, result, () => console.log(`${result.deduped ? "Deduped" : "Enqueued"} ${result.event.id} to ${result.queued} channel(s)`));
    return;
  }
  if (command === "import") {
    const args = [...tail];
    const result = broker.importSpool({ limit: numberOption(takeOption(args, "--limit")) });
    output(parsed, result, () => console.log(`Imported ${result.imported}, deduped ${result.deduped}, queued ${result.queued}, quarantined ${result.quarantined}`));
    return;
  }
  if (command === "drain") {
    const args = [...tail];
    const limit = numberOption(takeOption(args, "--limit"));
    const imported = broker.importSpool({ limit });
    const drained = await broker.drain({
      limit,
      leaseMs: numberOption(takeOption(args, "--lease-ms")),
      workerId: takeOption(args, "--worker-id")
    });
    const result = { imported, drained };
    output(parsed, result, () => console.log(`Claimed ${drained.claimed}, delivered ${drained.delivered}, retried ${drained.retried}, dead ${drained.dead}`));
    return;
  }
  if (command === "work") {
    const args = [...tail];
    const controller = new AbortController;
    const stop = () => controller.abort();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    try {
      const result = await runDurableWorker({
        broker,
        signal: controller.signal,
        limit: numberOption(takeOption(args, "--limit")),
        leaseMs: numberOption(takeOption(args, "--lease-ms")),
        workerId: takeOption(args, "--worker-id"),
        debounceMs: numberOption(takeOption(args, "--debounce-ms")),
        reconcileMs: numberOption(takeOption(args, "--reconcile-ms")),
        watchRestartMs: numberOption(takeOption(args, "--watch-restart-ms"))
      });
      output(parsed, result, () => console.log(`Worker stopped after ${result.cycles} cycle(s), delivered ${result.delivered}`));
    } finally {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    }
    return;
  }
  if (command === "status") {
    const result = broker.status();
    output(parsed, result, () => console.log(`events durable: ${result.counts.pending} pending, ${result.counts.leased} leased, ${result.counts.dead} dead`));
    return;
  }
  if (command === "retry-dead") {
    const args = [...tail];
    const result = broker.retryDead({
      eventId: takeOption(args, "--event-id"),
      channelId: takeOption(args, "--channel-id"),
      limit: numberOption(takeOption(args, "--limit"))
    });
    output(parsed, result, () => console.log(`Requeued ${result.requeued} dead delivery job(s)`));
    return;
  }
  throw new Error(`Unknown durable command: ${command}`);
}
async function handleChannels(client, command, tail, parsed, options) {
  if (command === "add") {
    const { args, delimiterArgs } = splitDelimiter(tail);
    const transport = takeOption(args, "--transport") ?? "webhook";
    const id = takeOption(args, "--id") ?? crypto.randomUUID();
    const name = takeOption(args, "--name");
    const secret = takeOption(args, "--secret");
    const timeoutMs = numberOption(takeOption(args, "--timeout-ms"));
    const retryAttempts = numberOption(takeOption(args, "--retry-attempts"));
    const retryBackoffMs2 = numberOption(takeOption(args, "--retry-backoff-ms"));
    const disabled = takeFlag(args, "--disabled");
    const headerValues = takeMany(args, "--header");
    const commandArgs = takeMany(args, "--arg");
    const redactions = takeMany(args, "--redact");
    const filters = parseFilter(args);
    const target = args[0];
    if (!target)
      throw new Error("channels add requires a URL or command target");
    const now2 = new Date().toISOString();
    const channel = {
      id,
      name,
      enabled: !disabled,
      transport,
      filters,
      retry: retryAttempts || retryBackoffMs2 ? { maxAttempts: retryAttempts, backoffMs: retryBackoffMs2 } : undefined,
      redact: redactions.length > 0 ? { paths: redactions } : undefined,
      createdAt: now2,
      updatedAt: now2
    };
    if (transport === "webhook") {
      channel.webhook = { url: target, secret, headers: parseHeaders(headerValues), timeoutMs };
    } else if (transport === "command") {
      channel.command = { command: target, args: [...args.slice(1), ...commandArgs, ...delimiterArgs], timeoutMs };
    } else {
      throw new Error(`Transport ${transport} is reserved for future use and cannot be added yet`);
    }
    const saved = await client.addChannel(channel);
    output(parsed, sanitizeChannelForOutput(saved), () => console.log(`Added ${saved.transport} channel ${saved.id}`));
    return;
  }
  if (command === "list") {
    const channels = await client.listChannels();
    output(parsed, sanitizeChannelsForOutput(channels), () => {
      if (channels.length === 0) {
        console.log("No channels configured.");
        return;
      }
      for (const channel of channels) {
        const target = channel.webhook?.url ?? channel.command?.command ?? channel.transport;
        console.log(`${channel.id}	${channel.enabled ? "enabled" : "disabled"}	${channel.transport}	${target}`);
      }
    });
    return;
  }
  if (command === "status") {
    const status = await getEventsStatus(parsed.dir);
    output(parsed, status, () => {
      console.log(`events dataDir: ${status.dataDir}`);
      console.log(`${status.counts.enabledChannels}/${status.counts.channels} channel(s) enabled`);
    });
    return;
  }
  if (command === "remove") {
    const id = tail[0];
    if (!id)
      throw new Error("channels remove requires a channel id");
    const removed = await client.removeChannel(id);
    output(parsed, { removed }, () => console.log(removed ? `Removed ${id}` : `Channel not found: ${id}`));
    return;
  }
  if (command === "test") {
    const args = [...tail];
    const id = args.shift();
    if (!id)
      throw new Error("channels test requires a channel id");
    const honorFilters = takeFlag(args, "--honor-filters");
    const result = await client.testChannel(id, {
      source: takeOption(args, "--source") ?? options.source ?? "hasna.events",
      type: takeOption(args, "--type") ?? "events.test",
      subject: takeOption(args, "--subject") ?? id,
      message: takeOption(args, "--message") ?? "Hasna events test delivery",
      data: parseJsonOption(takeOption(args, "--data"), { test: true }),
      metadata: parseJsonOption(takeOption(args, "--metadata"), {})
    }, { honorFilters });
    output(parsed, result, () => console.log(`${result.status}: ${result.channelId}`));
    if (result.status === "failed")
      process.exitCode = 1;
    return;
  }
  if (command === "match") {
    const args = [...tail];
    const id = args.shift();
    if (!id)
      throw new Error("channels match requires a channel id");
    const result = await client.matchChannel(id, {
      source: takeOption(args, "--source") ?? options.source ?? "hasna.events",
      type: takeOption(args, "--type") ?? "events.test",
      subject: takeOption(args, "--subject") ?? id,
      message: takeOption(args, "--message") ?? "Hasna events match preview",
      data: parseJsonOption(takeOption(args, "--data"), { test: true }),
      metadata: parseJsonOption(takeOption(args, "--metadata"), {})
    });
    output(parsed, result, () => console.log(`${result.matched ? "matched" : "skipped"}: ${result.channelId}`));
    return;
  }
  throw new Error(`Unknown channels command: ${command ?? ""}`);
}
function splitDelimiter(values) {
  const delimiterIndex = values.indexOf("--");
  if (delimiterIndex === -1)
    return { args: [...values], delimiterArgs: [] };
  return {
    args: values.slice(0, delimiterIndex),
    delimiterArgs: values.slice(delimiterIndex + 1)
  };
}
async function handleEvents(client, command, tail, parsed, options) {
  if (command === "emit") {
    const args = [...tail];
    const type = args.shift();
    if (!type)
      throw new Error("events emit requires an event type");
    const source = takeOption(args, "--source") ?? options.source;
    if (!source)
      throw new Error("events emit requires --source");
    const noDeliver = takeFlag(args, "--no-deliver");
    const result = await client.emit({
      type,
      source,
      subject: takeOption(args, "--subject"),
      severity: severityOption(takeOption(args, "--severity")),
      message: takeOption(args, "--message"),
      dedupeKey: takeOption(args, "--dedupe-key"),
      data: parseJsonOption(takeOption(args, "--data"), {}),
      metadata: parseJsonOption(takeOption(args, "--metadata"), {})
    }, { deliver: !noDeliver });
    output(parsed, result, () => console.log(`${result.deduped ? "Deduped" : "Emitted"} ${result.event.id} to ${result.deliveries.length} channel(s)`));
    return;
  }
  if (command === "list") {
    const args = [...tail];
    const limit = numberOption(takeOption(args, "--limit"));
    const type = takeOption(args, "--type");
    const source = takeOption(args, "--source");
    let events = await client.listEvents();
    if (type)
      events = events.filter((event) => event.type === type);
    if (source)
      events = events.filter((event) => event.source === source);
    if (limit)
      events = events.slice(-limit);
    output(parsed, events, () => {
      if (events.length === 0) {
        console.log("No events recorded.");
        return;
      }
      for (const event of events) {
        console.log(`${event.time}	${event.id}	${event.source}	${event.type}	${event.severity}`);
      }
    });
    return;
  }
  if (command === "replay") {
    const args = [...tail];
    const result = await client.replay({
      eventId: takeOption(args, "--id"),
      source: takeOption(args, "--source"),
      type: takeOption(args, "--type"),
      cursor: takeOption(args, "--cursor"),
      limit: numberOption(takeOption(args, "--limit")),
      dryRun: takeFlag(args, "--dry-run")
    });
    output(parsed, result, () => console.log(replaySummary(result.events.length, result.deliveries.length, result.nextCursor)));
    return;
  }
  throw new Error(`Unknown events command: ${command ?? ""}`);
}
function numberOption(value) {
  if (value === undefined)
    return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Expected a number, got ${value}`);
  return parsed;
}
function severityOption(value) {
  if (!value)
    return;
  const allowed = new Set(["debug", "info", "notice", "warning", "error", "critical"]);
  if (!allowed.has(value))
    throw new Error(`Invalid severity: ${value}`);
  return value;
}
function replaySummary(events, deliveries, nextCursor) {
  const suffix = nextCursor ? `, next cursor: ${nextCursor}` : "";
  return `Replayed ${events} event(s), ${deliveries} delivery result(s)${suffix}`;
}
if (import.meta.main) {
  runEventsCli().catch((error) => {
    const parsed = parseGlobalArgs(process.argv.slice(2));
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(1);
  });
}
export {
  runEventsCli
};
