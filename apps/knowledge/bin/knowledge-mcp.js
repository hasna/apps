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
var __require = import.meta.require;

// src/anchored-fs.ts
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { basename, dirname, isAbsolute, normalize, resolve, sep } from "path";
function fail(detail) {
  throw new AnchoredFilesystemError(detail);
}
function errno(error) {
  return error?.code;
}
function assertAnchoredFilesystemPlatform(platform = process.platform) {
  if (platform !== "linux" && platform !== "darwin") {
    fail(`directory-FD anchoring is unsupported on ${platform}; local filesystem access is disabled`);
  }
}
function fdBase() {
  assertAnchoredFilesystemPlatform();
  if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_DIRECTORY !== "number") {
    return fail("directory-FD anchoring is unavailable on this platform");
  }
  if (existsSync("/proc/self/fd"))
    return "/proc/self/fd";
  if (existsSync("/dev/fd"))
    return "/dev/fd";
  return fail("directory-FD anchoring is unavailable on this platform");
}
function fireTestHook(event, detail) {
  anchoredFsTestHook?.(event, detail);
}
function fdPath(fd, name) {
  const base = `${fdBase()}/${fd}`;
  return name === undefined ? base : `${base}/${name}`;
}
function identity(stat) {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode & 511 };
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function sameIdentityAndMode(left, right) {
  return sameIdentity(left, right) && left.mode === right.mode;
}
function assertDirectoryStat(stat, detail) {
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail(detail);
}
function assertRegularStat(stat, detail) {
  if (!stat.isFile() || stat.isSymbolicLink())
    fail(detail);
}
function absoluteSegments(path) {
  if (!isAbsolute(path) || normalize(path) !== path || resolve(path) !== path) {
    return fail("anchored path must be absolute and traversal-free");
  }
  return path.split(sep).filter(Boolean);
}
function openDirectoryPath(path, create, mode = 448) {
  assertAnchoredFilesystemPlatform();
  const segments = absoluteSegments(path);
  let current;
  try {
    current = openSync("/", DIRECTORY_FLAGS);
    for (const segment of segments) {
      const child = fdPath(current, segment);
      if (create) {
        try {
          mkdirSync(child, { mode });
        } catch (error) {
          if (errno(error) !== "EEXIST")
            throw error;
        }
      }
      let next;
      try {
        next = openSync(child, DIRECTORY_FLAGS);
      } catch (error) {
        if (errno(error) === "ENOENT")
          throw error;
        return fail("directory component could not be opened without following links");
      }
      assertDirectoryStat(fstatSync(next), "opened path component is not a directory");
      closeSync(current);
      current = next;
    }
    const result = current;
    current = undefined;
    return result;
  } finally {
    if (current !== undefined)
      closeSync(current);
  }
}
function pathDirectoryIdentity(path) {
  let fd;
  try {
    fd = openDirectoryPath(path, false);
    return identity(fstatSync(fd));
  } catch (error) {
    if (errno(error) === "ENOENT")
      return;
    throw error;
  } finally {
    if (fd !== undefined)
      closeSync(fd);
  }
}
function assertDirectoryName(path, expected) {
  const current = pathDirectoryIdentity(path);
  if (!current || !sameIdentityAndMode(current, expected)) {
    fail("anchored directory identity or confidentiality mode changed during the operation");
  }
}
function lstatChild(fd, name) {
  try {
    return lstatSync(fdPath(fd, name));
  } catch (error) {
    if (errno(error) === "ENOENT")
      return;
    throw error;
  }
}
function openVerifiedRegular(parentFd, name, flags) {
  const before = lstatChild(parentFd, name);
  if (!before) {
    const missing = new Error(`ENOENT: no such file, open '${name}'`);
    missing.code = "ENOENT";
    throw missing;
  }
  assertRegularStat(before, "anchored file must be a non-symlink regular file");
  let fd;
  try {
    fd = openSync(fdPath(parentFd, name), flags | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    assertRegularStat(opened, "opened file must be regular");
    const named = lstatChild(parentFd, name);
    if (!named || !sameIdentity(identity(opened), identity(named))) {
      fail("file identity changed while it was opened");
    }
    const result = fd;
    fd = undefined;
    return result;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError || errno(error) === "ENOENT")
      throw error;
    return fail("file could not be opened without following links");
  } finally {
    if (fd !== undefined)
      closeSync(fd);
  }
}
function readAnchoredRegularFileSnapshot(path, maxBytes = MAX_ANCHORED_CONFIG_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_ANCHORED_ARTIFACT_BYTES) {
    return fail("anchored regular file byte limit is invalid");
  }
  const parent = dirname(path);
  let parentFd;
  let fileFd;
  try {
    try {
      parentFd = openDirectoryPath(parent, false);
    } catch (error) {
      if (errno(error) === "ENOENT")
        return;
      throw error;
    }
    const parentIdentity = identity(fstatSync(parentFd));
    if (!lstatChild(parentFd, basename(path)))
      return;
    fileFd = openVerifiedRegular(parentFd, basename(path), FILE_READ_FLAGS);
    const opened = fstatSync(fileFd);
    if (opened.size > maxBytes)
      fail(`anchored regular file exceeds the ${maxBytes} byte hard limit`);
    fireTestHook("snapshot-before-read", path);
    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(fileFd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (count === 0)
        break;
      bytesRead += count;
    }
    fireTestHook("snapshot-after-read", path);
    if (bytesRead > maxBytes) {
      fail(`anchored regular file exceeds the ${maxBytes} byte hard limit`);
    }
    const after = fstatSync(fileFd);
    const named = lstatChild(parentFd, basename(path));
    if (bytesRead !== opened.size || opened.nlink !== 1 || after.nlink !== 1 || !named || !named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || !sameIdentity(identity(opened), identity(after)) || !sameIdentity(identity(opened), identity(named)) || named.mode !== opened.mode || after.size !== opened.size || named.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || named.mtimeMs !== opened.mtimeMs || named.ctimeMs !== opened.ctimeMs) {
      fail("anchored regular file identity or contents changed during the bounded snapshot read");
    }
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    assertDirectoryName(parent, parentIdentity);
    return { content, identity: identity(opened) };
  } finally {
    if (fileFd !== undefined)
      closeSync(fileFd);
    if (parentFd !== undefined)
      closeSync(parentFd);
  }
}
var AnchoredFilesystemError, DIRECTORY_FLAGS, FILE_READ_FLAGS, MAX_ANCHORED_CONFIG_BYTES = 1048576, MAX_ANCHORED_ARTIFACT_BYTES = 8388608, ANCHORED_FILESYSTEM_SUPPORT, anchoredFsTestHook;
var init_anchored_fs = __esm(() => {
  AnchoredFilesystemError = class AnchoredFilesystemError extends Error {
    name = "AnchoredFilesystemError";
  };
  DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  FILE_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
  ANCHORED_FILESYSTEM_SUPPORT = Object.freeze({
    supportedPlatforms: ["linux", "darwin"],
    unsupportedBehavior: "fail-closed-before-filesystem-io"
  });
});

// src/input-limits.ts
import { isProxy } from "util/types";
function cloneBoundedDataGraph(value, options = {}) {
  const label = options.label === "Provider response" ? "Provider response" : options.label === "Stored data" ? "Stored data" : "Input";
  const maxBytes = options.maxBytes ?? MAX_INGEST_BODY_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_INGEST_BODY_BYTES) {
    throw new Error(`${label} byte limit must be between 0 and ${MAX_INGEST_BODY_BYTES}.`);
  }
  const active = new WeakSet;
  const clones = new WeakMap;
  const completedExpansionBytes = new WeakMap;
  let nodes = 0;
  let properties = 0;
  const boundedAdd = (left, right) => {
    const total = left + right;
    if (total > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes} byte hard limit.`);
    }
    return total;
  };
  const primitiveBytes = (entry) => {
    const serialized = JSON.stringify(entry);
    if (serialized === undefined) {
      throw new Error(`${label} contains unsupported non-data values.`);
    }
    const bytes = Buffer.byteLength(serialized);
    if (bytes > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes} byte hard limit.`);
    }
    return bytes;
  };
  const clone = (entry, depth) => {
    if (entry === undefined) {
      throw new Error(`${label} contains undefined, which is not JSON data.`);
    }
    if (entry === null || typeof entry === "boolean") {
      return {
        value: entry,
        expansionBytes: primitiveBytes(entry)
      };
    }
    if (typeof entry === "string") {
      return { value: entry, expansionBytes: primitiveBytes(entry) };
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry))
        throw new Error(`${label} contains a non-finite number.`);
      return { value: entry, expansionBytes: primitiveBytes(entry) };
    }
    if (typeof entry !== "object") {
      throw new Error(`${label} contains unsupported non-data values.`);
    }
    if (isProxy(entry))
      throw new Error(`${label} proxy inputs are unsupported.`);
    if (active.has(entry))
      throw new Error(`${label} cyclic graphs are unsupported.`);
    const existing = clones.get(entry);
    if (existing) {
      const expansionBytes2 = completedExpansionBytes.get(entry);
      if (expansionBytes2 === undefined) {
        throw new Error(`${label} cyclic graphs are unsupported.`);
      }
      return { value: existing, expansionBytes: expansionBytes2 };
    }
    if (++nodes > MAX_JSON_NODES) {
      throw new Error(`${label} exceeds the ${MAX_JSON_NODES} node hard limit.`);
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`${label} exceeds the ${MAX_JSON_DEPTH} level depth hard limit.`);
    }
    const array = Array.isArray(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (array && prototype !== Array.prototype || !array && prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} custom prototypes are unsupported.`);
    }
    if (array && entry.length > MAX_INGEST_BATCH_ITEMS) {
      throw new Error(`${label} array exceeds the ${MAX_INGEST_BATCH_ITEMS} item hard limit.`);
    }
    let keys;
    try {
      keys = Reflect.ownKeys(entry);
    } catch {
      throw new Error(`${label} properties could not be enumerated safely.`);
    }
    let dataKeys;
    if (array) {
      const expectedKeys = new Set(["length"]);
      for (let index = 0;index < entry.length; index += 1) {
        expectedKeys.add(String(index));
      }
      for (let index = 0;index < entry.length; index += 1) {
        if (!keys.includes(String(index))) {
          throw new Error(`${label} sparse arrays are unsupported.`);
        }
      }
      if (keys.length !== expectedKeys.size || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
        throw new Error(`${label} array own keys must be exactly canonical dense indexes and length.`);
      }
      let lengthDescriptor;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(entry, "length");
      } catch {
        throw new Error(`${label} property descriptors could not be inspected safely.`);
      }
      if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== entry.length || lengthDescriptor.writable !== true || lengthDescriptor.enumerable !== false || lengthDescriptor.configurable !== false) {
        throw new Error(`${label} array length descriptor is noncanonical.`);
      }
      for (let index = 0;index < entry.length; index += 1) {
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        } catch {
          throw new Error(`${label} property descriptors could not be inspected safely.`);
        }
        if (!descriptor)
          throw new Error(`${label} sparse arrays are unsupported.`);
        if (!("value" in descriptor))
          throw new Error(`${label} accessor properties are unsupported.`);
        if (descriptor.enumerable !== true || descriptor.writable !== true || descriptor.configurable !== true) {
          throw new Error(`${label} array index descriptor is noncanonical.`);
        }
      }
      dataKeys = Array.from({ length: entry.length }, (_, index) => String(index));
    } else {
      dataKeys = keys;
    }
    if (!array && dataKeys.length > MAX_JSON_OBJECT_PROPERTIES) {
      throw new Error(`${label} object exceeds the ${MAX_JSON_OBJECT_PROPERTIES} property hard limit.`);
    }
    properties += dataKeys.length;
    if (properties > MAX_JSON_PROPERTIES) {
      throw new Error(`${label} exceeds the ${MAX_JSON_PROPERTIES} property hard limit.`);
    }
    const target = array ? new Array(entry.length) : Object.create(null);
    clones.set(entry, target);
    active.add(entry);
    let expansionBytes = 2;
    for (const key of dataKeys) {
      if (typeof key !== "string")
        throw new Error(`${label} symbol properties are unsupported.`);
      if (DANGEROUS_DATA_KEYS.has(key)) {
        throw new Error(`${label} contains a dangerous key.`);
      }
      if (Buffer.byteLength(key) > MAX_JSON_KEY_BYTES) {
        throw new Error(`${label} exceeds the ${MAX_JSON_KEY_BYTES} key byte hard limit.`);
      }
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(entry, key);
      } catch {
        throw new Error(`${label} property descriptors could not be inspected safely.`);
      }
      if (!descriptor || !("value" in descriptor)) {
        throw new Error(`${label} accessor properties are unsupported.`);
      }
      if (!array && descriptor.enumerable !== true) {
        throw new Error(`${label} non-enumerable object properties are unsupported.`);
      }
      const cloned = clone(descriptor.value, depth + 1);
      const separatorBytes = expansionBytes === 2 ? 0 : 1;
      expansionBytes = boundedAdd(expansionBytes, separatorBytes);
      if (!array) {
        expansionBytes = boundedAdd(expansionBytes, Buffer.byteLength(JSON.stringify(key)) + 1);
      }
      expansionBytes = boundedAdd(expansionBytes, cloned.expansionBytes);
      Object.defineProperty(target, array ? Number(key) : key, {
        value: cloned.value,
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    active.delete(entry);
    completedExpansionBytes.set(entry, expansionBytes);
    return { value: target, expansionBytes };
  };
  return clone(value, 0).value;
}
var MAX_INGEST_BODY_BYTES = 8388608, MAX_INGEST_BATCH_ITEMS = 4096, MAX_JSON_PROPERTIES = 32768, MAX_JSON_DEPTH = 64, MAX_JSON_OBJECT_PROPERTIES = 256, MAX_JSON_NODES = 4096, MAX_JSON_KEY_BYTES = 16384, DANGEROUS_DATA_KEYS;
var init_input_limits = __esm(() => {
  DANGEROUS_DATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);
});

// src/runtime-role.ts
import { existsSync as existsSync2, readFileSync } from "fs";
import { isProxy as isProxy2 } from "util/types";
function configGraphIssue(root) {
  const seen = new WeakSet;
  const pending = [root];
  let nodes = 0;
  let properties = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value);
      if (bytes > MAX_CONFIG_BYTES)
        return "config exceeds the aggregate byte limit";
      continue;
    }
    if (!value || typeof value !== "object")
      continue;
    if (isProxy2(value))
      return "config proxy inputs are unsupported";
    if (seen.has(value))
      continue;
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return "config prototype could not be inspected safely";
    }
    if (Array.isArray(value) && prototype !== Array.prototype || !Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return "config custom prototypes are unsupported";
    }
    if (++nodes > MAX_CONFIG_NODES)
      return "config exceeds the aggregate node limit";
    seen.add(value);
    if (Array.isArray(value) && value.length > MAX_CONFIG_ARRAY_ITEMS) {
      return "config array exceeds the aggregate item limit";
    }
    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return "config properties could not be enumerated safely";
    }
    properties += keys.length;
    if (properties > MAX_CONFIG_PROPERTIES)
      return "config exceeds the aggregate property limit";
    for (const key of keys) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        return "config property descriptors could not be inspected safely";
      }
      if (!descriptor || !("value" in descriptor))
        return "config accessor properties are unsupported";
      pending.push(descriptor.value);
    }
  }
  return null;
}
function configRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function safeRelativePath(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\x00") || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  const segments = value.replace(/\\/g, "/").split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
function optionalStringIssue(record, key, label, allowEmpty = false) {
  const value = record[key];
  if (value === undefined)
    return null;
  if (typeof value !== "string" || !allowEmpty && !value.trim()) {
    return `${label} must be ${allowEmpty ? "a string" : "a non-empty string"} when present`;
  }
  return null;
}
function optionalBooleanIssue(record, key, label) {
  const value = record[key];
  return value === undefined || typeof value === "boolean" ? null : `${label} must be a boolean when present`;
}
function optionalPositiveIntegerIssue(record, key, label) {
  const value = record[key];
  return value === undefined || typeof value === "number" && Number.isInteger(value) && value > 0 ? null : `${label} must be a positive integer when present`;
}
function knowledgeConfigValidationIssue(value) {
  let cloned;
  try {
    cloned = cloneBoundedDataGraph(value, {
      label: "config",
      maxBytes: MAX_CONFIG_BYTES
    });
  } catch (error) {
    return error instanceof Error ? error.message : "config could not be cloned safely";
  }
  const graphIssue = configGraphIssue(cloned);
  if (graphIssue)
    return graphIssue;
  const config = configRecord(cloned);
  if (!config)
    return "config root must be an object";
  if (config.version !== 1)
    return "config version must be 1";
  if (config.mode !== "local" && config.mode !== "hosted") {
    return "config mode must be exactly local or hosted";
  }
  const storage = configRecord(config.storage);
  if (!storage)
    return "config storage must be an object";
  if (storage.type !== "local" && storage.type !== "s3") {
    return "config storage.type must be local or s3";
  }
  if (config.mode === "local" && storage.type === "s3") {
    return "config mode local must not select S3 storage";
  }
  if (!safeRelativePath(storage.artifacts_root)) {
    return "config storage.artifacts_root must be a safe relative path";
  }
  if (storage.type === "s3") {
    const s3 = configRecord(storage.s3);
    if (!s3 || typeof s3.bucket !== "string" || !s3.bucket.trim()) {
      return "config S3 storage requires a non-empty bucket";
    }
  }
  if (storage.type === "local" && storage.s3 !== undefined) {
    return "config local storage must not include storage.s3";
  }
  if (storage.s3 !== undefined) {
    const s3 = configRecord(storage.s3);
    if (!s3)
      return "config storage.s3 must be an object when present";
    for (const [key, label, allowEmpty] of [
      ["bucket", "config storage.s3.bucket", false],
      ["prefix", "config storage.s3.prefix", true],
      ["region", "config storage.s3.region", false],
      ["profile", "config storage.s3.profile", false],
      ["kms_key_id", "config storage.s3.kms_key_id", false]
    ]) {
      const issue = optionalStringIssue(s3, key, label, allowEmpty);
      if (issue)
        return issue;
    }
    const attemptsIssue = optionalPositiveIntegerIssue(s3, "max_attempts", "config storage.s3.max_attempts");
    if (attemptsIssue)
      return attemptsIssue;
    if (s3.server_side_encryption !== undefined && s3.server_side_encryption !== "AES256" && s3.server_side_encryption !== "aws:kms") {
      return "config storage.s3.server_side_encryption must be AES256 or aws:kms when present";
    }
  }
  const sources = configRecord(config.sources);
  if (!sources || sources.preferred_ref !== "open-files") {
    return "config sources.preferred_ref must be open-files";
  }
  if (!Array.isArray(sources.allowed_schemes) || sources.allowed_schemes.some((entry) => typeof entry !== "string" || !entry.trim())) {
    return "config sources.allowed_schemes must be an array of non-empty strings";
  }
  for (const key of ["hosted", "embeddings", "providers", "safety"]) {
    if (config[key] !== undefined && !configRecord(config[key])) {
      return `config ${key} must be an object when present`;
    }
  }
  const hosted = configRecord(config.hosted);
  if (hosted?.api_url !== undefined && (typeof hosted.api_url !== "string" || !hosted.api_url.trim())) {
    return "config hosted.api_url must be a non-empty string when present";
  }
  const embeddings = configRecord(config.embeddings);
  if (embeddings) {
    const modelIssue = optionalStringIssue(embeddings, "default_model", "config embeddings.default_model");
    if (modelIssue)
      return modelIssue;
    for (const key of ["dimensions", "batch_size", "max_parallel_calls"]) {
      const issue = optionalPositiveIntegerIssue(embeddings, key, `config embeddings.${key}`);
      if (issue)
        return issue;
    }
  }
  const providers = configRecord(config.providers);
  if (providers) {
    const modelIssue = optionalStringIssue(providers, "default_model", "config providers.default_model");
    if (modelIssue)
      return modelIssue;
    if (providers.aliases !== undefined) {
      const aliases = configRecord(providers.aliases);
      if (!aliases || Object.entries(aliases).some(([key, value2]) => !key.trim() || typeof value2 !== "string" || !value2.trim())) {
        return "config providers.aliases must map non-empty names to non-empty strings";
      }
    }
    for (const providerName of ["openai", "anthropic", "deepseek"]) {
      if (providers[providerName] === undefined)
        continue;
      const provider = configRecord(providers[providerName]);
      if (!provider)
        return `config providers.${providerName} must be an object when present`;
      for (const key of ["api_key_env", "base_url", "default_model"]) {
        const issue = optionalStringIssue(provider, key, `config providers.${providerName}.${key}`);
        if (issue)
          return issue;
      }
    }
  }
  const safety = configRecord(config.safety);
  if (safety) {
    if (safety.network !== undefined) {
      const network = configRecord(safety.network);
      if (!network)
        return "config safety.network must be an object when present";
      for (const key of ["web_search_enabled", "s3_reads_enabled"]) {
        const issue = optionalBooleanIssue(network, key, `config safety.network.${key}`);
        if (issue)
          return issue;
      }
      if (network.allowed_s3_buckets !== undefined && (!Array.isArray(network.allowed_s3_buckets) || network.allowed_s3_buckets.some((entry) => typeof entry !== "string" || !entry.trim()))) {
        return "config safety.network.allowed_s3_buckets must be an array of non-empty strings";
      }
    }
    if (safety.redaction !== undefined) {
      const redaction = configRecord(safety.redaction);
      if (!redaction)
        return "config safety.redaction must be an object when present";
      const issue = optionalBooleanIssue(redaction, "enabled", "config safety.redaction.enabled");
      if (issue)
        return issue;
    }
    if (safety.approvals !== undefined) {
      const approvals = configRecord(safety.approvals);
      if (!approvals)
        return "config safety.approvals must be an object when present";
      const issue = optionalBooleanIssue(approvals, "generated_writes_require_approval", "config safety.approvals.generated_writes_require_approval");
      if (issue)
        return issue;
    }
  }
  return null;
}
function configContainmentError(detail, surface = "public-api") {
  return new KnowledgeContainmentError("KNOWLEDGE_CONFIG_INVALID", 503, "invalid", surface, `${detail}; no Knowledge write or data-plane I/O was attempted`);
}
function assertValidKnowledgeConfig(value, surface = "public-api") {
  const issue = knowledgeConfigValidationIssue(value);
  if (issue)
    throw configContainmentError(issue, surface);
}
function readRegularConfigTextNoFollow(path) {
  try {
    return readAnchoredRegularFileSnapshot(path, MAX_CONFIG_BYTES)?.content;
  } catch (error) {
    if (error instanceof AnchoredFilesystemError) {
      throw configContainmentError(error.message);
    }
    throw configContainmentError("config could not be opened through its anchored directory");
  }
}
function readValidatedKnowledgeConfig(configPath, fs = roleFs) {
  let raw;
  if (fs === roleFs) {
    raw = readRegularConfigTextNoFollow(configPath);
  } else {
    if (!fs.existsSync(configPath))
      return;
    raw = fs.readFileSync(configPath, "utf8");
  }
  if (raw === undefined)
    return;
  if (Buffer.byteLength(raw) > MAX_CONFIG_BYTES) {
    throw configContainmentError(`config exceeds the ${MAX_CONFIG_BYTES} byte hard limit`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configContainmentError("config JSON is malformed");
  }
  assertValidKnowledgeConfig(parsed);
  return parsed;
}
function normalizeMode(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local" || normalized === "offline" || normalized === "standalone" || normalized === "desktop")
    return "local";
  if (normalized === "cloud" || normalized === "hosted" || normalized === "hosted_client" || normalized === "hosted_server" || normalized === "self_hosted" || normalized === "remote" || normalized === "hybrid")
    return "hosted";
  return null;
}
function normalizeBooleanMode(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on")
    return "hosted";
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off")
    return "local";
  return null;
}
function environmentLayers(supplied) {
  const ambient = process.env;
  if (!supplied || supplied === ambient)
    return [{ name: "ambient", env: ambient }];
  return [
    { name: "ambient", env: ambient },
    { name: "supplied", env: supplied }
  ];
}
function safeEnvironmentValue(layer, key, addIssue) {
  try {
    let owner = layer.env;
    let raw;
    while (owner) {
      if (isProxy2(owner)) {
        addIssue(`unreadable-env:${layer.name}:${key}`);
        return;
      }
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor) {
        if (!("value" in descriptor)) {
          addIssue(`unreadable-env:${layer.name}:${key}`);
          return;
        }
        raw = descriptor.value;
        break;
      }
      owner = Object.getPrototypeOf(owner);
    }
    if (raw === undefined || raw === null || raw === "")
      return;
    if (typeof raw !== "string") {
      addIssue(`non-string-env:${layer.name}:${key}`);
      return;
    }
    return raw.trim() || undefined;
  } catch {
    addIssue(`unreadable-env:${layer.name}:${key}`);
    return;
  }
}
function environmentSignals(layers, keys, addIssue) {
  const entries = [];
  for (const layer of layers) {
    for (const key of keys) {
      const value = safeEnvironmentValue(layer, key, addIssue);
      if (value)
        entries.push({ source: `${layer.name}:${key}`, value });
    }
  }
  return entries;
}
function distinctSignalValues(entries) {
  return new Set(entries.map(({ value }) => value)).size;
}
function resolveKnowledgeRuntimeRole(intent = {}) {
  const layers = environmentLayers(intent.env);
  const surface = intent.surface ?? "public-api";
  const signals = [];
  const issues = [];
  const modeSignals = [];
  const addIssue = (issue) => {
    if (!issues.includes(issue))
      issues.push(issue);
  };
  const collectMode = (source, value, normalize2 = normalizeMode) => {
    const trimmed = value?.trim();
    if (!trimmed)
      return;
    signals.push(source);
    const mode = normalize2(trimmed);
    if (!mode)
      addIssue(`unknown-mode:${source}`);
    else
      modeSignals.push({ source, mode });
  };
  collectMode("explicit-mode", intent.explicitMode);
  collectMode("config-mode", intent.configMode);
  for (const layer of layers) {
    for (const key of MODE_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue));
    }
    for (const key of ROLE_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue));
    }
    for (const key of HOSTED_BOOLEAN_KEYS) {
      collectMode(`${layer.name}:${key}`, safeEnvironmentValue(layer, key, addIssue), normalizeBooleanMode);
    }
  }
  const apiUrls = environmentSignals(layers, API_URL_KEYS, addIssue);
  const apiKeys = environmentSignals(layers, API_KEY_KEYS, addIssue);
  const databaseUrls = environmentSignals(layers, DATABASE_URL_KEYS, addIssue);
  signals.push(...apiUrls.map(({ source }) => source), ...apiKeys.map(({ source }) => source), ...databaseUrls.map(({ source }) => source));
  if (distinctSignalValues(apiUrls) > 1)
    addIssue("conflicting-api-url-aliases");
  if (distinctSignalValues(apiKeys) > 1)
    addIssue("conflicting-api-key-aliases");
  if (distinctSignalValues(databaseUrls) > 1)
    addIssue("conflicting-database-url-aliases");
  for (const layer of layers) {
    const layerUrls = environmentSignals([layer], API_URL_KEYS, addIssue);
    const layerKeys = environmentSignals([layer], API_KEY_KEYS, addIssue);
    if (layerUrls.length > 0 !== layerKeys.length > 0)
      addIssue(`partial-http-intent:${layer.name}`);
  }
  const distinctModes = new Set(modeSignals.map(({ mode }) => mode));
  if (distinctModes.size > 1)
    addIssue("conflicting-modes");
  const explicitLocal = modeSignals.some(({ mode }) => mode === "local");
  const explicitHosted = modeSignals.some(({ mode }) => mode === "hosted");
  const activeHostedSignal = apiUrls.length > 0 || apiKeys.length > 0 || databaseUrls.length > 0 || Boolean(intent.hostedRequested);
  const hasApiUrl = apiUrls.length > 0;
  const hasApiKey = apiKeys.length > 0;
  if (hasApiUrl !== hasApiKey)
    addIssue("partial-http-intent");
  if (!explicitHosted && databaseUrls.length > 0)
    addIssue("database-url-without-hosted-mode");
  if (explicitLocal && activeHostedSignal)
    addIssue("local-hosted-conflict");
  const surfaceIsServer = surface === "server";
  const surfaceIsOperator = surface === "operator-migration";
  if (surfaceIsServer && explicitLocal)
    addIssue("server-local-conflict");
  if (surfaceIsOperator)
    addIssue("operator-capability-required");
  const hosted = explicitHosted || Boolean(intent.hostedRequested) || hasApiUrl && hasApiKey || surfaceIsServer;
  if (hosted && intent.localStoreOverride)
    addIssue("hosted-local-store-conflict");
  if (issues.length > 0) {
    return { role: "invalid", surface, source: "invalid", signals, issues };
  }
  if (hosted) {
    return {
      role: surfaceIsServer ? "hosted-server" : "hosted-client",
      surface,
      source: explicitHosted ? "mode" : intent.hostedRequested ? "operation" : surfaceIsServer ? "surface" : "http-config",
      signals,
      issues
    };
  }
  return {
    role: "local",
    surface,
    source: explicitLocal ? "mode" : "legacy-default",
    signals,
    issues
  };
}
function resolveKnowledgeRuntimeRoleWithConfig(intent, readConfigMode) {
  const preliminary = resolveKnowledgeRuntimeRole(intent);
  if (preliminary.role !== "local")
    return preliminary;
  return resolveKnowledgeRuntimeRole({ ...intent, configMode: readConfigMode() });
}
function containmentErrorFor(resolution) {
  if (resolution.role === "invalid") {
    if (resolution.issues.includes("unknown-mode:config-mode")) {
      return configContainmentError("persisted or supplied config is structurally invalid", resolution.surface);
    }
    return new KnowledgeContainmentError("KNOWLEDGE_RUNTIME_INTENT_INVALID", 503, resolution.role, resolution.surface, "runtime intent is incomplete, unknown, or conflicting; no Knowledge I/O was attempted");
  }
  if (resolution.role === "operator-migration") {
    return new KnowledgeContainmentError("KNOWLEDGE_OPERATOR_REQUIRED", 503, resolution.role, resolution.surface, "operator-only operation is unavailable through this public boundary");
  }
  return new KnowledgeContainmentError("KNOWLEDGE_HOSTED_CONTAINED", 503, resolution.role, resolution.surface, "hosted Knowledge access is disabled until trusted project authority is available");
}
function readKnowledgeConfiguredMode(configPath, fs = roleFs, required = false) {
  try {
    const parsed = readValidatedKnowledgeConfig(configPath, fs);
    if (!parsed)
      return required ? INVALID_CONFIG_MODE : undefined;
    return configuredModeFromValidatedConfig(parsed);
  } catch {
    return INVALID_CONFIG_MODE;
  }
}
function configuredModeFromValidatedConfig(parsed) {
  const storage = parsed.storage;
  return parsed.mode === "hosted" || storage.type === "s3" ? "hosted" : "local";
}
var roleFs, INVALID_CONFIG_MODE = "__invalid_config__", MAX_CONFIG_ARRAY_ITEMS = 4096, MAX_CONFIG_PROPERTIES = 4096, MAX_CONFIG_NODES = 2048, MAX_CONFIG_BYTES = 1048576, MODE_KEYS, ROLE_KEYS, HOSTED_BOOLEAN_KEYS, API_URL_KEYS, API_KEY_KEYS, DATABASE_URL_KEYS, MAX_KNOWLEDGE_DIAGNOSTIC_BYTES = 384, CONTAINMENT_MESSAGES, KnowledgeContainmentError;
var init_runtime_role = __esm(() => {
  init_anchored_fs();
  init_input_limits();
  roleFs = {
    existsSync: existsSync2,
    readFileSync
  };
  MODE_KEYS = [
    "HASNA_KNOWLEDGE_STORAGE_MODE",
    "KNOWLEDGE_STORAGE_MODE",
    "HASNA_KNOWLEDGE_MODE",
    "KNOWLEDGE_MODE"
  ];
  ROLE_KEYS = [
    "CODEWITH_RUNTIME_ROLE",
    "CODEWITH_EXECUTION_ROLE",
    "CODEWITH_AGENT_ROLE",
    "CODEWITH_ROLE",
    "KNOWLEDGE_RUNTIME_ROLE",
    "KNOWLEDGE_EXECUTION_ROLE",
    "KNOWLEDGE_AGENT_ROLE",
    "KNOWLEDGE_ROLE"
  ];
  HOSTED_BOOLEAN_KEYS = [
    "CODEWITH_HOSTED",
    "KNOWLEDGE_HOSTED"
  ];
  API_URL_KEYS = [
    "HASNA_KNOWLEDGE_API_URL",
    "HASNA_KNOWLEDGE_API_BASE_URL",
    "KNOWLEDGE_API_URL",
    "KNOWLEDGE_API_BASE_URL",
    "OPEN_KNOWLEDGE_API_URL"
  ];
  API_KEY_KEYS = [
    "HASNA_KNOWLEDGE_API_KEY",
    "KNOWLEDGE_API_KEY",
    "OPEN_KNOWLEDGE_API_KEY"
  ];
  DATABASE_URL_KEYS = [
    "HASNA_KNOWLEDGE_DATABASE_URL",
    "KNOWLEDGE_DATABASE_URL",
    "HASNA_KNOWLEDGE_DATABASE_URL_OWNER"
  ];
  CONTAINMENT_MESSAGES = {
    KNOWLEDGE_RUNTIME_INTENT_INVALID: "runtime intent was rejected before Knowledge I/O",
    KNOWLEDGE_CONFIG_INVALID: "configuration was rejected before Knowledge I/O",
    KNOWLEDGE_HOSTED_CONTAINED: "hosted capability is unavailable during Stage A",
    KNOWLEDGE_AUTHORITY_UNAVAILABLE: "trusted authority is unavailable during Stage A",
    KNOWLEDGE_PROJECT_FORBIDDEN: "project authority denied Knowledge access",
    KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED: "positive hosted authority is disabled during Stage A",
    KNOWLEDGE_OPERATOR_REQUIRED: "operator capability is required for this operation"
  };
  KnowledgeContainmentError = class KnowledgeContainmentError extends Error {
    code;
    status;
    role;
    surface;
    name = "KnowledgeContainmentError";
    constructor(code, status, role, surface, _detail) {
      const message = `${code}: ${CONTAINMENT_MESSAGES[code]}`;
      super(Buffer.byteLength(message) <= MAX_KNOWLEDGE_DIAGNOSTIC_BYTES ? message : `${code}: contained`);
      this.code = code;
      this.status = status;
      this.role = role;
      this.surface = surface;
    }
    toJSON() {
      const payload = {
        ok: false,
        code: this.code,
        status: this.status,
        role: this.role,
        surface: this.surface,
        message: this.message
      };
      if (Buffer.byteLength(JSON.stringify(payload)) > MAX_KNOWLEDGE_DIAGNOSTIC_BYTES) {
        return { ...payload, message: `${this.code}: contained` };
      }
      return payload;
    }
  };
});

// src/workspace.ts
import { homedir } from "os";
import { lstatSync as lstatSync2, realpathSync } from "fs";
import { basename as basename2, dirname as dirname2, isAbsolute as isAbsolute2, join, normalize as normalize2, resolve as resolve2 } from "path";
function canonicalKnowledgeScope(scope, defaultScope = "global") {
  const candidate = scope === undefined ? defaultScope : scope;
  if (typeof candidate !== "string" || !CANONICAL_KNOWLEDGE_SCOPES.has(candidate)) {
    throw new Error("Invalid knowledge scope. Use exactly global, local, or project.");
  }
  return candidate;
}
function errno2(error) {
  return error?.code;
}
function assertCanonicalAuthorityPath(path, label) {
  if (typeof path !== "string" || path.includes("\x00") || !isAbsolute2(path) || normalize2(path) !== path || resolve2(path) !== path) {
    throw new Error(`${label} must be an absolute normalized canonical path.`);
  }
  if (path.normalize("NFC") !== path || path.normalize("NFKC") !== path) {
    throw new Error(`${label} must use an exact canonical Unicode path.`);
  }
  let existing = path;
  let stat;
  for (;; ) {
    try {
      stat = lstatSync2(existing);
      break;
    } catch (error) {
      if (errno2(error) !== "ENOENT")
        throw error;
      const parent = dirname2(existing);
      if (parent === existing)
        throw new Error(`${label} has no canonical filesystem ancestor.`);
      existing = parent;
    }
  }
  if (stat.isSymbolicLink() || realpathSync.native(existing) !== existing) {
    throw new Error(`${label} must not use a symlink, case, or path alias.`);
  }
  return path;
}
function nearestCanonicalDirectoryIdentity(path, label) {
  assertCanonicalAuthorityPath(path, label);
  let existing = path;
  for (;; ) {
    try {
      const stat = lstatSync2(existing);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(existing) !== existing) {
        throw new Error(`${label} must have one exact canonical directory authority parent.`);
      }
      return {
        path: existing,
        identity: Object.freeze({ dev: stat.dev, ino: stat.ino })
      };
    } catch (error) {
      if (errno2(error) !== "ENOENT")
        throw error;
      const parent = dirname2(existing);
      if (parent === existing)
        throw new Error(`${label} has no canonical directory authority parent.`);
      existing = parent;
    }
  }
}
function canonicalExistingDirectory(path, label) {
  const canonical = assertCanonicalAuthorityPath(path, label);
  const stat = lstatSync2(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(canonical) !== canonical) {
    throw new Error(`${label} must identify one exact canonical directory.`);
  }
  return canonical;
}
function existingDirectoryIdentity(path, label) {
  assertCanonicalAuthorityPath(path, label);
  let stat;
  try {
    stat = lstatSync2(path);
  } catch (error) {
    if (errno2(error) === "ENOENT")
      return;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync.native(path) !== path) {
    throw new Error(`${label} must identify one exact canonical directory.`);
  }
  return Object.freeze({ dev: stat.dev, ino: stat.ino });
}
function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function workspaceShape(canonicalHome) {
  return {
    home: canonicalHome,
    configPath: join(canonicalHome, "config.json"),
    jsonStorePath: join(canonicalHome, "db.json"),
    knowledgeDbPath: join(canonicalHome, "knowledge.db"),
    artifactsDir: join(canonicalHome, "artifacts"),
    cacheDir: join(canonicalHome, "cache"),
    exportsDir: join(canonicalHome, "exports"),
    indexesDir: join(canonicalHome, "indexes"),
    logsDir: join(canonicalHome, "logs"),
    runsDir: join(canonicalHome, "runs"),
    schemasDir: join(canonicalHome, "schemas"),
    wikiDir: join(canonicalHome, "wiki")
  };
}
function trustedWorkspace(home, scope, projectRoot) {
  const canonicalHome = assertCanonicalAuthorityPath(home, "Knowledge workspace home");
  const workspace = Object.freeze(workspaceShape(canonicalHome));
  const identity2 = Object.freeze({
    scope,
    projectRoot,
    home: canonicalHome,
    key: `${scope ?? "custom"}\x00${projectRoot ?? ""}\x00${canonicalHome}`
  });
  const projectRootIdentity = projectRoot ? existingDirectoryIdentity(projectRoot, "Knowledge project root") : undefined;
  if (projectRoot && !projectRootIdentity) {
    throw new Error("Knowledge project root must remain an existing canonical directory.");
  }
  const authorityParent = nearestCanonicalDirectoryIdentity(canonicalHome, "Knowledge workspace home");
  trustedWorkspaceIdentities.set(workspace, {
    identity: identity2,
    projectRootIdentity,
    authorityParentPath: authorityParent.path,
    authorityParentIdentity: authorityParent.identity,
    homeIdentity: existingDirectoryIdentity(canonicalHome, "Knowledge workspace home"),
    revoked: false
  });
  return workspace;
}
function trustedKnowledgeWorkspaceIdentity(workspace) {
  if (!workspace || typeof workspace !== "object") {
    throw new Error("A trusted workspace identity is required.");
  }
  const state = trustedWorkspaceIdentities.get(workspace);
  if (!state || !Object.isFrozen(workspace)) {
    throw new Error("A trusted workspace identity from the canonical constructor is required.");
  }
  if (state.revoked) {
    throw new Error("Knowledge workspace identity was permanently invalidated.");
  }
  const { identity: identity2 } = state;
  try {
    const expected = workspaceShape(identity2.home);
    for (const field of WORKSPACE_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(workspace, field);
      if (!descriptor || !("value" in descriptor) || descriptor.value !== expected[field] || descriptor.writable !== false || descriptor.configurable !== false) {
        throw new Error("Trusted workspace identity fields changed after construction.");
      }
    }
    const currentAuthorityParent = existingDirectoryIdentity(state.authorityParentPath, "Knowledge workspace authority parent");
    if (!currentAuthorityParent || !sameDirectoryIdentity(state.authorityParentIdentity, currentAuthorityParent)) {
      throw new Error("Knowledge workspace canonical parent identity changed after construction.");
    }
    const currentHomeIdentity = existingDirectoryIdentity(identity2.home, "Knowledge workspace home");
    if (state.homeIdentity) {
      if (!currentHomeIdentity || !sameDirectoryIdentity(state.homeIdentity, currentHomeIdentity)) {
        throw new Error("Knowledge workspace directory identity changed after construction.");
      }
    } else if (currentHomeIdentity) {
      state.homeIdentity = currentHomeIdentity;
    }
    if (identity2.projectRoot) {
      const currentProjectRootIdentity = existingDirectoryIdentity(identity2.projectRoot, "Knowledge project root");
      if (!state.projectRootIdentity || !currentProjectRootIdentity || !sameDirectoryIdentity(state.projectRootIdentity, currentProjectRootIdentity)) {
        throw new Error("Knowledge project root identity changed after construction.");
      }
    }
    return identity2;
  } catch (error) {
    state.revoked = true;
    throw error;
  }
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve2(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function resolveScopedWorkspace(scope, cwd = process.cwd()) {
  const canonicalScope = canonicalKnowledgeScope(scope);
  if (canonicalScope === "project" || canonicalScope === "local") {
    const projectRoot = canonicalExistingDirectory(cwd, "Knowledge project root");
    return trustedWorkspace(projectKnowledgeHome(projectRoot), canonicalScope, projectRoot);
  }
  const globalRoot = canonicalExistingDirectory(homedir(), "Knowledge global root");
  return trustedWorkspace(join(globalRoot, ".hasna", "knowledge"), canonicalScope, null);
}
var HASNA_KNOWLEDGE_APP_PATH, LEGACY_HASNA_KNOWLEDGE_APP_PATH, CANONICAL_KNOWLEDGE_SCOPES, WORKSPACE_FIELDS, trustedWorkspaceIdentities;
var init_workspace = __esm(() => {
  init_anchored_fs();
  init_runtime_role();
  HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
  LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");
  CANONICAL_KNOWLEDGE_SCOPES = new Set(["global", "local", "project"]);
  WORKSPACE_FIELDS = [
    "home",
    "configPath",
    "jsonStorePath",
    "knowledgeDbPath",
    "artifactsDir",
    "cacheDir",
    "exportsDir",
    "indexesDir",
    "logsDir",
    "runsDir",
    "schemasDir",
    "wikiDir"
  ];
  trustedWorkspaceIdentities = new WeakMap;
});

// src/mcp-http.js
var exports_mcp_http = {};
__export(exports_mcp_http, {
  startMcpHttpServer: () => startMcpHttpServer,
  resolveMcpHttpPort: () => resolveMcpHttpPort,
  readBoundedMcpJsonBody: () => readBoundedMcpJsonBody,
  isHttpMode: () => isHttpMode,
  assertLoopbackHost: () => assertLoopbackHost,
  MCP_HTTP_SERVICE_NAME: () => MCP_HTTP_SERVICE_NAME,
  MCP_HTTP_BODY_TIMEOUT_MS: () => MCP_HTTP_BODY_TIMEOUT_MS,
  MAX_MCP_HTTP_BODY_CHUNKS: () => MAX_MCP_HTTP_BODY_CHUNKS,
  MAX_MCP_HTTP_BODY_BYTES: () => MAX_MCP_HTTP_BODY_BYTES,
  DEFAULT_MCP_HTTP_PORT: () => DEFAULT_MCP_HTTP_PORT
});
import { createServer } from "http";
function assertLoopbackHost(host) {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Knowledge MCP HTTP is loopback-only; use 127.0.0.1 or ::1");
  }
  return host;
}
function isHttpMode(argv = process.argv, env = process.env) {
  return argv.includes("--http") || env.MCP_HTTP === "1";
}
function resolveMcpHttpPort(argv = process.argv, env = process.env) {
  const portIdx = argv.indexOf("--port");
  if (portIdx !== -1 && argv[portIdx + 1]) {
    return parsePort(argv[portIdx + 1], "--port");
  }
  if (env.MCP_HTTP_PORT) {
    return parsePort(env.MCP_HTTP_PORT, "MCP_HTTP_PORT");
  }
  return DEFAULT_MCP_HTTP_PORT;
}
function parsePort(raw, source) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid ${source} value "${raw}". Expected 0-65535.`);
  }
  return parsed;
}
function requestError(status, code, message) {
  return new McpHttpRequestError(status, code, message);
}
function rawHeaderValues(req, name) {
  const values = [];
  for (let index = 0;index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === name)
      values.push(req.rawHeaders[index + 1]);
  }
  return values;
}
function expectedBodyBytes(req, maxBytes) {
  if (rawHeaderValues(req, "transfer-encoding").length > 0) {
    throw requestError(400, "MCP_HTTP_TRANSFER_ENCODING_REJECTED", "Transfer-Encoding is not accepted.");
  }
  const values = rawHeaderValues(req, "content-length");
  if (values.length === 0) {
    throw requestError(411, "MCP_HTTP_LENGTH_REQUIRED", "A single Content-Length header is required.");
  }
  if (values.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(values[0] ?? "")) {
    throw requestError(400, "MCP_HTTP_LENGTH_INVALID", "Content-Length must be one canonical decimal value.");
  }
  const expected = Number(values[0]);
  if (!Number.isSafeInteger(expected)) {
    throw requestError(413, "MCP_HTTP_BODY_TOO_LARGE", "MCP HTTP body length is not safely bounded.");
  }
  if (expected > maxBytes) {
    throw requestError(413, "MCP_HTTP_BODY_TOO_LARGE", `MCP HTTP body exceeds the ${maxBytes} byte hard limit.`);
  }
  if (expected === 0) {
    throw requestError(400, "MCP_HTTP_BODY_REQUIRED", "MCP HTTP requires a JSON request body.");
  }
  return expected;
}
function strictBound(value, hardLimit, label) {
  if (value === undefined)
    return hardLimit;
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardLimit) {
    throw new RangeError(`${label} must be a positive safe integer no greater than ${hardLimit}.`);
  }
  return value;
}
function readBoundedMcpJsonBody(req, options = {}) {
  const maxBytes = strictBound(options.maxBytes, MAX_MCP_HTTP_BODY_BYTES, "MCP HTTP maxBytes");
  const maxChunks = strictBound(options.maxChunks, MAX_MCP_HTTP_BODY_CHUNKS, "MCP HTTP maxChunks");
  const timeoutMs = strictBound(options.timeoutMs, MCP_HTTP_BODY_TIMEOUT_MS, "MCP HTTP timeoutMs");
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  const mediaType = contentType.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    throw requestError(415, "MCP_HTTP_CONTENT_TYPE_REQUIRED", "Content-Type must be application/json.");
  }
  const expected = expectedBodyBytes(req, maxBytes);
  return new Promise((resolve3, reject) => {
    const chunks = [];
    let bytes = 0;
    let chunkCount = 0;
    let settled = false;
    const timer = setTimeout(() => {
      fail2(requestError(408, "MCP_HTTP_BODY_TIMEOUT", "MCP HTTP body streaming timed out."));
    }, timeoutMs);
    timer.unref?.();
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAborted);
      req.off("error", onError);
    };
    const fail2 = (error) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      req.pause();
      reject(error);
    };
    const onData = (value) => {
      const chunk = typeof value === "string" ? Buffer.from(value) : value;
      chunkCount += 1;
      bytes += chunk.byteLength;
      if (chunkCount > maxChunks) {
        fail2(requestError(413, "MCP_HTTP_TOO_MANY_CHUNKS", `MCP HTTP body exceeds the ${maxChunks} chunk hard limit.`));
        return;
      }
      if (bytes > maxBytes || bytes > expected) {
        fail2(requestError(413, "MCP_HTTP_BODY_TOO_LARGE", `MCP HTTP body exceeds its declared or ${maxBytes} byte hard limit.`));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled)
        return;
      if (bytes !== expected || !req.complete) {
        fail2(requestError(400, "MCP_HTTP_LENGTH_MISMATCH", "MCP HTTP body length does not match Content-Length."));
        return;
      }
      settled = true;
      cleanup();
      try {
        const text = Buffer.concat(chunks, bytes).toString("utf8");
        resolve3(JSON.parse(text));
      } catch {
        reject(requestError(400, "MCP_HTTP_JSON_INVALID", "MCP HTTP body must be valid JSON."));
      }
    };
    const onAborted = () => fail2(requestError(400, "MCP_HTTP_BODY_ABORTED", "MCP HTTP body was aborted."));
    const onError = () => fail2(requestError(400, "MCP_HTTP_BODY_STREAM_ERROR", "MCP HTTP body stream failed."));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("aborted", onAborted);
    req.on("error", onError);
  });
}
function createHttpRuntimeBoundary(options) {
  const cwd = options.cwd ?? process.cwd();
  const scope = options.scope ?? "project";
  const workspace = resolveScopedWorkspace(scope, cwd);
  const identity2 = trustedKnowledgeWorkspaceIdentity(workspace);
  return Object.freeze({ cwd, scope, workspace, identity: identity2, env: options.env });
}
function invalidWorkspaceRuntime(detail) {
  return {
    role: "invalid",
    surface: "mcp-http",
    source: "startup-workspace-identity",
    signals: [],
    issues: ["startup-workspace-identity-invalid"],
    detail
  };
}
function runtimeFor(boundary) {
  try {
    const current = trustedKnowledgeWorkspaceIdentity(boundary.workspace);
    if (current.key !== boundary.identity.key || current.home !== boundary.identity.home || current.projectRoot !== boundary.identity.projectRoot)
      return invalidWorkspaceRuntime("MCP HTTP startup workspace identity changed after validation.");
  } catch (error) {
    return invalidWorkspaceRuntime(error instanceof Error ? error.message : "MCP HTTP startup workspace identity is unavailable.");
  }
  return resolveKnowledgeRuntimeRoleWithConfig({
    surface: "mcp-http",
    env: boundary.env ?? process.env
  }, () => readKnowledgeConfiguredMode(boundary.workspace.configPath));
}
function sendJson(res, status, payload, closeConnection = false) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...closeConnection ? { Connection: "close" } : {}
  });
  res.end(JSON.stringify(payload));
}
function sendRequestError(req, res, error) {
  res.writeHead(error.status, { "Content-Type": "application/json", Connection: "close" });
  res.once("finish", () => req.destroy());
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32600, message: error.message, data: { code: error.code } },
    id: null
  }));
}
async function startMcpHttpServer(buildServer, options = {}) {
  const host = assertLoopbackHost(options.host ?? "127.0.0.1");
  const requestedPort = options.port ?? resolveMcpHttpPort();
  const serviceName = options.serviceName ?? MCP_HTTP_SERVICE_NAME;
  const runtimeBoundary = createHttpRuntimeBoundary(options);
  const initialRuntime = runtimeFor(runtimeBoundary);
  if (initialRuntime.role !== "local")
    throw containmentErrorFor(initialRuntime);
  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", name: serviceName }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/ready") {
        const current2 = runtimeFor(runtimeBoundary);
        if (current2.role !== "local") {
          const error = containmentErrorFor(current2);
          const { status: httpStatus, ...containmentPayload } = error.toJSON();
          sendJson(res, error.status, { status: "unavailable", http_status: httpStatus, ...containmentPayload });
          return;
        }
        sendJson(res, 200, { status: "ready", name: serviceName });
        return;
      }
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      const current = runtimeFor(runtimeBoundary);
      if (current.role !== "local") {
        const containment = containmentErrorFor(current);
        sendJson(res, containment.status, containment.toJSON());
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, {
          "Content-Type": "application/json",
          Allow: "POST",
          Connection: "close"
        });
        res.once("finish", () => req.destroy());
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }
      let parsedBody;
      try {
        parsedBody = await readBoundedMcpJsonBody(req, {
          maxBytes: options.maxBodyBytes,
          maxChunks: options.maxBodyChunks,
          timeoutMs: options.bodyTimeoutMs
        });
      } catch (error) {
        if (error instanceof McpHttpRequestError) {
          sendRequestError(req, res, error);
          return;
        }
        throw error;
      }
      const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error(`[${serviceName}-mcp] HTTP error: ${error instanceof Error ? error.message : "unknown failure"}`);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });
  await new Promise((resolve3, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(requestedPort, host, () => resolve3());
  });
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : requestedPort;
  console.error(`[${serviceName}-mcp] Streamable HTTP listening on http://${host}:${port}/mcp`);
  return {
    port,
    host,
    close: () => new Promise((resolve3, reject) => {
      httpServer.close((err) => err ? reject(err) : resolve3());
    })
  };
}
var MCP_HTTP_SERVICE_NAME = "knowledge", DEFAULT_MCP_HTTP_PORT = 8819, MAX_MCP_HTTP_BODY_BYTES = 1048576, MAX_MCP_HTTP_BODY_CHUNKS = 256, MCP_HTTP_BODY_TIMEOUT_MS = 5000, McpHttpRequestError;
var init_mcp_http = __esm(() => {
  init_workspace();
  init_runtime_role();
  McpHttpRequestError = class McpHttpRequestError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  };
});

// src/mcp-entry.js
init_workspace();
init_runtime_role();
import { once } from "events";
function wantsHttp(argv, env) {
  if (argv.includes("--http"))
    return true;
  const transport = (env.KNOWLEDGE_MCP_TRANSPORT ?? env.HASNA_MCP_TRANSPORT ?? "").trim().toLowerCase();
  return transport === "http" || transport === "streamable-http" || env.KNOWLEDGE_MCP_HTTP === "1" || env.MCP_HTTP === "1";
}
async function mainKnowledgeMcpEntry(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.error(`Usage: knowledge-mcp [options]

Options:
  --http
  --port <number>
  -h, --help`);
    return;
  }
  if (wantsHttp(argv, env)) {
    const startupCwd = process.cwd();
    const runtime2 = resolveKnowledgeRuntimeRoleWithConfig({
      surface: "mcp-http",
      env
    }, () => readKnowledgeConfiguredMode(resolveScopedWorkspace("project", startupCwd).configPath));
    if (runtime2.role !== "local") {
      const error = containmentErrorFor(runtime2);
      console.error(JSON.stringify(error.toJSON()));
      process.exitCode = 1;
      return;
    }
    const { resolveMcpHttpPort: resolveMcpHttpPort2, startMcpHttpServer: startMcpHttpServer2 } = await Promise.resolve().then(() => (init_mcp_http(), exports_mcp_http));
    const payloadPath2 = "../dist/mcp-payload.js";
    const { createMcpHttpServerFactory } = await import(payloadPath2);
    const factory = createMcpHttpServerFactory({
      surface: "mcp-http",
      env,
      scope: "project",
      cwd: startupCwd
    });
    const handle = await startMcpHttpServer2(factory, {
      host: "127.0.0.1",
      port: resolveMcpHttpPort2(argv, env),
      env,
      scope: "project",
      cwd: startupCwd
    });
    console.error(`knowledge MCP HTTP listening on http://${handle.host}:${handle.port}/mcp`);
    await Promise.race([once(process, "SIGINT"), once(process, "SIGTERM")]);
    await handle.close();
    return;
  }
  const runtime = resolveKnowledgeRuntimeRoleWithConfig({
    surface: "mcp-stdio",
    env
  }, () => readKnowledgeConfiguredMode(resolveScopedWorkspace("project").configPath));
  if (runtime.role !== "local") {
    const error = containmentErrorFor(runtime);
    console.error(JSON.stringify(error.toJSON()));
    process.exitCode = 1;
    return;
  }
  const payloadPath = "../dist/mcp-payload.js";
  const { main } = await import(payloadPath);
  await main();
}
if (import.meta.main) {
  mainKnowledgeMcpEntry().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
export {
  wantsHttp,
  mainKnowledgeMcpEntry
};
