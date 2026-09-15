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
import { hostname as osHostname } from "os";
import { isAbsolute, join } from "path";

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/resolve.js
import assert2 from "assert";
import { statSync, realpathSync } from "fs";
import process2 from "process";
import { fileURLToPath as fileURLToPath3, pathToFileURL } from "url";
import path2 from "path";
import { builtinModules } from "module";

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/get-format.js
import { fileURLToPath as fileURLToPath2 } from "url";

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/package-json-reader.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/errors.js
import v8 from "v8";
import assert from "assert";
import { format, inspect } from "util";
var own = {}.hasOwnProperty;
var classRegExp = /^([A-Z][a-z\d]*)+$/;
var kTypes = new Set([
  "string",
  "function",
  "number",
  "object",
  "Function",
  "Object",
  "boolean",
  "bigint",
  "symbol"
]);
var codes = {};
function formatList(array, type = "and") {
  return array.length < 3 ? array.join(` ${type} `) : `${array.slice(0, -1).join(", ")}, ${type} ${array[array.length - 1]}`;
}
var messages = new Map;
var nodeInternalPrefix = "__node_internal_";
var userStackTraceLimit;
codes.ERR_INVALID_ARG_TYPE = createError("ERR_INVALID_ARG_TYPE", (name, expected, actual) => {
  assert.ok(typeof name === "string", "'name' must be a string");
  if (!Array.isArray(expected)) {
    expected = [expected];
  }
  let message = "The ";
  if (name.endsWith(" argument")) {
    message += `${name} `;
  } else {
    const type = name.includes(".") ? "property" : "argument";
    message += `"${name}" ${type} `;
  }
  message += "must be ";
  const types = [];
  const instances = [];
  const other = [];
  for (const value of expected) {
    assert.ok(typeof value === "string", "All expected entries have to be of type string");
    if (kTypes.has(value)) {
      types.push(value.toLowerCase());
    } else if (classRegExp.exec(value) === null) {
      assert.ok(value !== "object", 'The value "object" should be written as "Object"');
      other.push(value);
    } else {
      instances.push(value);
    }
  }
  if (instances.length > 0) {
    const pos = types.indexOf("object");
    if (pos !== -1) {
      types.slice(pos, 1);
      instances.push("Object");
    }
  }
  if (types.length > 0) {
    message += `${types.length > 1 ? "one of type" : "of type"} ${formatList(types, "or")}`;
    if (instances.length > 0 || other.length > 0)
      message += " or ";
  }
  if (instances.length > 0) {
    message += `an instance of ${formatList(instances, "or")}`;
    if (other.length > 0)
      message += " or ";
  }
  if (other.length > 0) {
    if (other.length > 1) {
      message += `one of ${formatList(other, "or")}`;
    } else {
      if (other[0].toLowerCase() !== other[0])
        message += "an ";
      message += `${other[0]}`;
    }
  }
  message += `. Received ${determineSpecificType(actual)}`;
  return message;
}, TypeError);
codes.ERR_INVALID_MODULE_SPECIFIER = createError("ERR_INVALID_MODULE_SPECIFIER", (request, reason, base = undefined) => {
  return `Invalid module "${request}" ${reason}${base ? ` imported from ${base}` : ""}`;
}, TypeError);
codes.ERR_INVALID_PACKAGE_CONFIG = createError("ERR_INVALID_PACKAGE_CONFIG", (path, base, message) => {
  return `Invalid package config ${path}${base ? ` while importing ${base}` : ""}${message ? `. ${message}` : ""}`;
}, Error);
codes.ERR_INVALID_PACKAGE_TARGET = createError("ERR_INVALID_PACKAGE_TARGET", (packagePath, key, target, isImport = false, base = undefined) => {
  const relatedError = typeof target === "string" && !isImport && target.length > 0 && !target.startsWith("./");
  if (key === ".") {
    assert.ok(isImport === false);
    return `Invalid "exports" main target ${JSON.stringify(target)} defined ` + `in the package config ${packagePath}package.json${base ? ` imported from ${base}` : ""}${relatedError ? '; targets must start with "./"' : ""}`;
  }
  return `Invalid "${isImport ? "imports" : "exports"}" target ${JSON.stringify(target)} defined for '${key}' in the package config ${packagePath}package.json${base ? ` imported from ${base}` : ""}${relatedError ? '; targets must start with "./"' : ""}`;
}, Error);
codes.ERR_MODULE_NOT_FOUND = createError("ERR_MODULE_NOT_FOUND", (path, base, exactUrl = false) => {
  return `Cannot find ${exactUrl ? "module" : "package"} '${path}' imported from ${base}`;
}, Error);
codes.ERR_NETWORK_IMPORT_DISALLOWED = createError("ERR_NETWORK_IMPORT_DISALLOWED", "import of '%s' by %s is not supported: %s", Error);
codes.ERR_PACKAGE_IMPORT_NOT_DEFINED = createError("ERR_PACKAGE_IMPORT_NOT_DEFINED", (specifier, packagePath, base) => {
  return `Package import specifier "${specifier}" is not defined${packagePath ? ` in package ${packagePath}package.json` : ""} imported from ${base}`;
}, TypeError);
codes.ERR_PACKAGE_PATH_NOT_EXPORTED = createError("ERR_PACKAGE_PATH_NOT_EXPORTED", (packagePath, subpath, base = undefined) => {
  if (subpath === ".")
    return `No "exports" main defined in ${packagePath}package.json${base ? ` imported from ${base}` : ""}`;
  return `Package subpath '${subpath}' is not defined by "exports" in ${packagePath}package.json${base ? ` imported from ${base}` : ""}`;
}, Error);
codes.ERR_UNSUPPORTED_DIR_IMPORT = createError("ERR_UNSUPPORTED_DIR_IMPORT", "Directory import '%s' is not supported " + "resolving ES modules imported from %s", Error);
codes.ERR_UNSUPPORTED_RESOLVE_REQUEST = createError("ERR_UNSUPPORTED_RESOLVE_REQUEST", 'Failed to resolve module specifier "%s" from "%s": Invalid relative URL or base scheme is not hierarchical.', TypeError);
codes.ERR_UNKNOWN_FILE_EXTENSION = createError("ERR_UNKNOWN_FILE_EXTENSION", (extension, path) => {
  return `Unknown file extension "${extension}" for ${path}`;
}, TypeError);
codes.ERR_INVALID_ARG_VALUE = createError("ERR_INVALID_ARG_VALUE", (name, value, reason = "is invalid") => {
  let inspected = inspect(value);
  if (inspected.length > 128) {
    inspected = `${inspected.slice(0, 128)}...`;
  }
  const type = name.includes(".") ? "property" : "argument";
  return `The ${type} '${name}' ${reason}. Received ${inspected}`;
}, TypeError);
function createError(sym, value, constructor) {
  messages.set(sym, value);
  return makeNodeErrorWithCode(constructor, sym);
}
function makeNodeErrorWithCode(Base, key) {
  return NodeError;
  function NodeError(...parameters) {
    const limit = Error.stackTraceLimit;
    if (isErrorStackTraceLimitWritable())
      Error.stackTraceLimit = 0;
    const error = new Base;
    if (isErrorStackTraceLimitWritable())
      Error.stackTraceLimit = limit;
    const message = getMessage(key, parameters, error);
    Object.defineProperties(error, {
      message: {
        value: message,
        enumerable: false,
        writable: true,
        configurable: true
      },
      toString: {
        value() {
          return `${this.name} [${key}]: ${this.message}`;
        },
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
    captureLargerStackTrace(error);
    error.code = key;
    return error;
  }
}
function isErrorStackTraceLimitWritable() {
  try {
    if (v8.startupSnapshot.isBuildingSnapshot()) {
      return false;
    }
  } catch {}
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) {
    return Object.isExtensible(Error);
  }
  return own.call(desc, "writable") && desc.writable !== undefined ? desc.writable : desc.set !== undefined;
}
function hideStackFrames(wrappedFunction) {
  const hidden = nodeInternalPrefix + wrappedFunction.name;
  Object.defineProperty(wrappedFunction, "name", { value: hidden });
  return wrappedFunction;
}
var captureLargerStackTrace = hideStackFrames(function(error) {
  const stackTraceLimitIsWritable = isErrorStackTraceLimitWritable();
  if (stackTraceLimitIsWritable) {
    userStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = Number.POSITIVE_INFINITY;
  }
  Error.captureStackTrace(error);
  if (stackTraceLimitIsWritable)
    Error.stackTraceLimit = userStackTraceLimit;
  return error;
});
function getMessage(key, parameters, self) {
  const message = messages.get(key);
  assert.ok(message !== undefined, "expected `message` to be found");
  if (typeof message === "function") {
    assert.ok(message.length <= parameters.length, `Code: ${key}; The provided arguments length (${parameters.length}) does not ` + `match the required ones (${message.length}).`);
    return Reflect.apply(message, self, parameters);
  }
  const regex = /%[dfijoOs]/g;
  let expectedLength = 0;
  while (regex.exec(message) !== null)
    expectedLength++;
  assert.ok(expectedLength === parameters.length, `Code: ${key}; The provided arguments length (${parameters.length}) does not ` + `match the required ones (${expectedLength}).`);
  if (parameters.length === 0)
    return message;
  parameters.unshift(message);
  return Reflect.apply(format, null, parameters);
}
function determineSpecificType(value) {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "function" && value.name) {
    return `function ${value.name}`;
  }
  if (typeof value === "object") {
    if (value.constructor && value.constructor.name) {
      return `an instance of ${value.constructor.name}`;
    }
    return `${inspect(value, { depth: -1 })}`;
  }
  let inspected = inspect(value, { colors: false });
  if (inspected.length > 28) {
    inspected = `${inspected.slice(0, 25)}...`;
  }
  return `type ${typeof value} (${inspected})`;
}

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/package-json-reader.js
var hasOwnProperty = {}.hasOwnProperty;
var { ERR_INVALID_PACKAGE_CONFIG } = codes;
var cache = new Map;
function read(jsonPath, { base, specifier }) {
  const existing = cache.get(jsonPath);
  if (existing) {
    return existing;
  }
  let string;
  try {
    string = fs.readFileSync(path.toNamespacedPath(jsonPath), "utf8");
  } catch (error) {
    const exception = error;
    if (exception.code !== "ENOENT") {
      throw exception;
    }
  }
  const result = {
    exists: false,
    pjsonPath: jsonPath,
    main: undefined,
    name: undefined,
    type: "none",
    exports: undefined,
    imports: undefined
  };
  if (string !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(string);
    } catch (error_) {
      const cause = error_;
      const error = new ERR_INVALID_PACKAGE_CONFIG(jsonPath, (base ? `"${specifier}" from ` : "") + fileURLToPath(base || specifier), cause.message);
      error.cause = cause;
      throw error;
    }
    result.exists = true;
    if (hasOwnProperty.call(parsed, "name") && typeof parsed.name === "string") {
      result.name = parsed.name;
    }
    if (hasOwnProperty.call(parsed, "main") && typeof parsed.main === "string") {
      result.main = parsed.main;
    }
    if (hasOwnProperty.call(parsed, "exports")) {
      result.exports = parsed.exports;
    }
    if (hasOwnProperty.call(parsed, "imports")) {
      result.imports = parsed.imports;
    }
    if (hasOwnProperty.call(parsed, "type") && (parsed.type === "commonjs" || parsed.type === "module")) {
      result.type = parsed.type;
    }
  }
  cache.set(jsonPath, result);
  return result;
}
function getPackageScopeConfig(resolved) {
  let packageJSONUrl = new URL("package.json", resolved);
  while (true) {
    const packageJSONPath2 = packageJSONUrl.pathname;
    if (packageJSONPath2.endsWith("node_modules/package.json")) {
      break;
    }
    const packageConfig = read(fileURLToPath(packageJSONUrl), {
      specifier: resolved
    });
    if (packageConfig.exists) {
      return packageConfig;
    }
    const lastPackageJSONUrl = packageJSONUrl;
    packageJSONUrl = new URL("../package.json", packageJSONUrl);
    if (packageJSONUrl.pathname === lastPackageJSONUrl.pathname) {
      break;
    }
  }
  const packageJSONPath = fileURLToPath(packageJSONUrl);
  return {
    pjsonPath: packageJSONPath,
    exists: false,
    type: "none"
  };
}
function getPackageType(url) {
  return getPackageScopeConfig(url).type;
}

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/get-format.js
var { ERR_UNKNOWN_FILE_EXTENSION } = codes;
var hasOwnProperty2 = {}.hasOwnProperty;
var extensionFormatMap = {
  __proto__: null,
  ".cjs": "commonjs",
  ".js": "module",
  ".json": "json",
  ".mjs": "module"
};
function mimeToFormat(mime) {
  if (mime && /\s*(text|application)\/javascript\s*(;\s*charset=utf-?8\s*)?/i.test(mime))
    return "module";
  if (mime === "application/json")
    return "json";
  return null;
}
var protocolHandlers = {
  __proto__: null,
  "data:": getDataProtocolModuleFormat,
  "file:": getFileProtocolModuleFormat,
  "http:": getHttpProtocolModuleFormat,
  "https:": getHttpProtocolModuleFormat,
  "node:"() {
    return "builtin";
  }
};
function getDataProtocolModuleFormat(parsed) {
  const { 1: mime } = /^([^/]+\/[^;,]+)[^,]*?(;base64)?,/.exec(parsed.pathname) || [null, null, null];
  return mimeToFormat(mime);
}
function extname(url) {
  const pathname = url.pathname;
  let index = pathname.length;
  while (index--) {
    const code = pathname.codePointAt(index);
    if (code === 47) {
      return "";
    }
    if (code === 46) {
      return pathname.codePointAt(index - 1) === 47 ? "" : pathname.slice(index);
    }
  }
  return "";
}
function getFileProtocolModuleFormat(url, _context, ignoreErrors) {
  const value = extname(url);
  if (value === ".js") {
    const packageType = getPackageType(url);
    if (packageType !== "none") {
      return packageType;
    }
    return "commonjs";
  }
  if (value === "") {
    const packageType = getPackageType(url);
    if (packageType === "none" || packageType === "commonjs") {
      return "commonjs";
    }
    return "module";
  }
  const format2 = extensionFormatMap[value];
  if (format2)
    return format2;
  if (ignoreErrors) {
    return;
  }
  const filepath = fileURLToPath2(url);
  throw new ERR_UNKNOWN_FILE_EXTENSION(value, filepath);
}
function getHttpProtocolModuleFormat() {}
function defaultGetFormatWithoutErrors(url, context) {
  const protocol = url.protocol;
  if (!hasOwnProperty2.call(protocolHandlers, protocol)) {
    return null;
  }
  return protocolHandlers[protocol](url, context, true) || null;
}

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/utils.js
var { ERR_INVALID_ARG_VALUE } = codes;
var DEFAULT_CONDITIONS = Object.freeze(["node", "import"]);
var DEFAULT_CONDITIONS_SET = new Set(DEFAULT_CONDITIONS);
function getDefaultConditions() {
  return DEFAULT_CONDITIONS;
}
function getDefaultConditionsSet() {
  return DEFAULT_CONDITIONS_SET;
}
function getConditionsSet(conditions) {
  if (conditions !== undefined && conditions !== getDefaultConditions()) {
    if (!Array.isArray(conditions)) {
      throw new ERR_INVALID_ARG_VALUE("conditions", conditions, "expected an array");
    }
    return new Set(conditions);
  }
  return getDefaultConditionsSet();
}

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/lib/resolve.js
var RegExpPrototypeSymbolReplace = RegExp.prototype[Symbol.replace];
var {
  ERR_NETWORK_IMPORT_DISALLOWED,
  ERR_INVALID_MODULE_SPECIFIER,
  ERR_INVALID_PACKAGE_CONFIG: ERR_INVALID_PACKAGE_CONFIG2,
  ERR_INVALID_PACKAGE_TARGET,
  ERR_MODULE_NOT_FOUND,
  ERR_PACKAGE_IMPORT_NOT_DEFINED,
  ERR_PACKAGE_PATH_NOT_EXPORTED,
  ERR_UNSUPPORTED_DIR_IMPORT,
  ERR_UNSUPPORTED_RESOLVE_REQUEST
} = codes;
var own2 = {}.hasOwnProperty;
var invalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))?(\\|\/|$)/i;
var deprecatedInvalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i;
var invalidPackageNameRegEx = /^\.|%|\\/;
var patternRegEx = /\*/g;
var encodedSeparatorRegEx = /%2f|%5c/i;
var emittedPackageWarnings = new Set;
var doubleSlashRegEx = /[/\\]{2}/;
function emitInvalidSegmentDeprecation(target, request, match, packageJsonUrl, internal, base, isTarget) {
  if (process2.noDeprecation) {
    return;
  }
  const pjsonPath = fileURLToPath3(packageJsonUrl);
  const double = doubleSlashRegEx.exec(isTarget ? target : request) !== null;
  process2.emitWarning(`Use of deprecated ${double ? "double slash" : "leading or trailing slash matching"} resolving "${target}" for module ` + `request "${request}" ${request === match ? "" : `matched to "${match}" `}in the "${internal ? "imports" : "exports"}" field module resolution of the package at ${pjsonPath}${base ? ` imported from ${fileURLToPath3(base)}` : ""}.`, "DeprecationWarning", "DEP0166");
}
function emitLegacyIndexDeprecation(url, packageJsonUrl, base, main) {
  if (process2.noDeprecation) {
    return;
  }
  const format2 = defaultGetFormatWithoutErrors(url, { parentURL: base.href });
  if (format2 !== "module")
    return;
  const urlPath = fileURLToPath3(url.href);
  const packagePath = fileURLToPath3(new URL(".", packageJsonUrl));
  const basePath = fileURLToPath3(base);
  if (!main) {
    process2.emitWarning(`No "main" or "exports" field defined in the package.json for ${packagePath} resolving the main entry point "${urlPath.slice(packagePath.length)}", imported from ${basePath}.
Default "index" lookups for the main are deprecated for ES modules.`, "DeprecationWarning", "DEP0151");
  } else if (path2.resolve(packagePath, main) !== urlPath) {
    process2.emitWarning(`Package ${packagePath} has a "main" field set to "${main}", ` + `excluding the full filename and extension to the resolved file at "${urlPath.slice(packagePath.length)}", imported from ${basePath}.
 Automatic extension resolution of the "main" field is ` + "deprecated for ES modules.", "DeprecationWarning", "DEP0151");
  }
}
function tryStatSync(path3) {
  try {
    return statSync(path3);
  } catch {}
}
function fileExists(url) {
  const stats = statSync(url, { throwIfNoEntry: false });
  const isFile = stats ? stats.isFile() : undefined;
  return isFile === null || isFile === undefined ? false : isFile;
}
function legacyMainResolve(packageJsonUrl, packageConfig, base) {
  let guess;
  if (packageConfig.main !== undefined) {
    guess = new URL(packageConfig.main, packageJsonUrl);
    if (fileExists(guess))
      return guess;
    const tries2 = [
      `./${packageConfig.main}.js`,
      `./${packageConfig.main}.json`,
      `./${packageConfig.main}.node`,
      `./${packageConfig.main}/index.js`,
      `./${packageConfig.main}/index.json`,
      `./${packageConfig.main}/index.node`
    ];
    let i2 = -1;
    while (++i2 < tries2.length) {
      guess = new URL(tries2[i2], packageJsonUrl);
      if (fileExists(guess))
        break;
      guess = undefined;
    }
    if (guess) {
      emitLegacyIndexDeprecation(guess, packageJsonUrl, base, packageConfig.main);
      return guess;
    }
  }
  const tries = ["./index.js", "./index.json", "./index.node"];
  let i = -1;
  while (++i < tries.length) {
    guess = new URL(tries[i], packageJsonUrl);
    if (fileExists(guess))
      break;
    guess = undefined;
  }
  if (guess) {
    emitLegacyIndexDeprecation(guess, packageJsonUrl, base, packageConfig.main);
    return guess;
  }
  throw new ERR_MODULE_NOT_FOUND(fileURLToPath3(new URL(".", packageJsonUrl)), fileURLToPath3(base));
}
function finalizeResolution(resolved, base, preserveSymlinks) {
  if (encodedSeparatorRegEx.exec(resolved.pathname) !== null) {
    throw new ERR_INVALID_MODULE_SPECIFIER(resolved.pathname, 'must not include encoded "/" or "\\" characters', fileURLToPath3(base));
  }
  let filePath;
  try {
    filePath = fileURLToPath3(resolved);
  } catch (error) {
    const cause = error;
    Object.defineProperty(cause, "input", { value: String(resolved) });
    Object.defineProperty(cause, "module", { value: String(base) });
    throw cause;
  }
  const stats = tryStatSync(filePath.endsWith("/") ? filePath.slice(-1) : filePath);
  if (stats && stats.isDirectory()) {
    const error = new ERR_UNSUPPORTED_DIR_IMPORT(filePath, fileURLToPath3(base));
    error.url = String(resolved);
    throw error;
  }
  if (!stats || !stats.isFile()) {
    const error = new ERR_MODULE_NOT_FOUND(filePath || resolved.pathname, base && fileURLToPath3(base), true);
    error.url = String(resolved);
    throw error;
  }
  if (!preserveSymlinks) {
    const real = realpathSync(filePath);
    const { search, hash } = resolved;
    resolved = pathToFileURL(real + (filePath.endsWith(path2.sep) ? "/" : ""));
    resolved.search = search;
    resolved.hash = hash;
  }
  return resolved;
}
function importNotDefined(specifier, packageJsonUrl, base) {
  return new ERR_PACKAGE_IMPORT_NOT_DEFINED(specifier, packageJsonUrl && fileURLToPath3(new URL(".", packageJsonUrl)), fileURLToPath3(base));
}
function exportsNotFound(subpath, packageJsonUrl, base) {
  return new ERR_PACKAGE_PATH_NOT_EXPORTED(fileURLToPath3(new URL(".", packageJsonUrl)), subpath, base && fileURLToPath3(base));
}
function throwInvalidSubpath(request, match, packageJsonUrl, internal, base) {
  const reason = `request is not a valid match in pattern "${match}" for the "${internal ? "imports" : "exports"}" resolution of ${fileURLToPath3(packageJsonUrl)}`;
  throw new ERR_INVALID_MODULE_SPECIFIER(request, reason, base && fileURLToPath3(base));
}
function invalidPackageTarget(subpath, target, packageJsonUrl, internal, base) {
  target = typeof target === "object" && target !== null ? JSON.stringify(target, null, "") : `${target}`;
  return new ERR_INVALID_PACKAGE_TARGET(fileURLToPath3(new URL(".", packageJsonUrl)), subpath, target, internal, base && fileURLToPath3(base));
}
function resolvePackageTargetString(target, subpath, match, packageJsonUrl, base, pattern, internal, isPathMap, conditions) {
  if (subpath !== "" && !pattern && target[target.length - 1] !== "/")
    throw invalidPackageTarget(match, target, packageJsonUrl, internal, base);
  if (!target.startsWith("./")) {
    if (internal && !target.startsWith("../") && !target.startsWith("/")) {
      let isURL = false;
      try {
        new URL(target);
        isURL = true;
      } catch {}
      if (!isURL) {
        const exportTarget = pattern ? RegExpPrototypeSymbolReplace.call(patternRegEx, target, () => subpath) : target + subpath;
        return packageResolve(exportTarget, packageJsonUrl, conditions);
      }
    }
    throw invalidPackageTarget(match, target, packageJsonUrl, internal, base);
  }
  if (invalidSegmentRegEx.exec(target.slice(2)) !== null) {
    if (deprecatedInvalidSegmentRegEx.exec(target.slice(2)) === null) {
      if (!isPathMap) {
        const request = pattern ? match.replace("*", () => subpath) : match + subpath;
        const resolvedTarget = pattern ? RegExpPrototypeSymbolReplace.call(patternRegEx, target, () => subpath) : target;
        emitInvalidSegmentDeprecation(resolvedTarget, request, match, packageJsonUrl, internal, base, true);
      }
    } else {
      throw invalidPackageTarget(match, target, packageJsonUrl, internal, base);
    }
  }
  const resolved = new URL(target, packageJsonUrl);
  const resolvedPath = resolved.pathname;
  const packagePath = new URL(".", packageJsonUrl).pathname;
  if (!resolvedPath.startsWith(packagePath))
    throw invalidPackageTarget(match, target, packageJsonUrl, internal, base);
  if (subpath === "")
    return resolved;
  if (invalidSegmentRegEx.exec(subpath) !== null) {
    const request = pattern ? match.replace("*", () => subpath) : match + subpath;
    if (deprecatedInvalidSegmentRegEx.exec(subpath) === null) {
      if (!isPathMap) {
        const resolvedTarget = pattern ? RegExpPrototypeSymbolReplace.call(patternRegEx, target, () => subpath) : target;
        emitInvalidSegmentDeprecation(resolvedTarget, request, match, packageJsonUrl, internal, base, false);
      }
    } else {
      throwInvalidSubpath(request, match, packageJsonUrl, internal, base);
    }
  }
  if (pattern) {
    return new URL(RegExpPrototypeSymbolReplace.call(patternRegEx, resolved.href, () => subpath));
  }
  return new URL(subpath, resolved);
}
function isArrayIndex(key) {
  const keyNumber = Number(key);
  if (`${keyNumber}` !== key)
    return false;
  return keyNumber >= 0 && keyNumber < 4294967295;
}
function resolvePackageTarget(packageJsonUrl, target, subpath, packageSubpath, base, pattern, internal, isPathMap, conditions) {
  if (typeof target === "string") {
    return resolvePackageTargetString(target, subpath, packageSubpath, packageJsonUrl, base, pattern, internal, isPathMap, conditions);
  }
  if (Array.isArray(target)) {
    const targetList = target;
    if (targetList.length === 0)
      return null;
    let lastException;
    let i = -1;
    while (++i < targetList.length) {
      const targetItem = targetList[i];
      let resolveResult;
      try {
        resolveResult = resolvePackageTarget(packageJsonUrl, targetItem, subpath, packageSubpath, base, pattern, internal, isPathMap, conditions);
      } catch (error) {
        const exception = error;
        lastException = exception;
        if (exception.code === "ERR_INVALID_PACKAGE_TARGET")
          continue;
        throw error;
      }
      if (resolveResult === undefined)
        continue;
      if (resolveResult === null) {
        lastException = null;
        continue;
      }
      return resolveResult;
    }
    if (lastException === undefined || lastException === null) {
      return null;
    }
    throw lastException;
  }
  if (typeof target === "object" && target !== null) {
    const keys = Object.getOwnPropertyNames(target);
    let i = -1;
    while (++i < keys.length) {
      const key = keys[i];
      if (isArrayIndex(key)) {
        throw new ERR_INVALID_PACKAGE_CONFIG2(fileURLToPath3(packageJsonUrl), base, '"exports" cannot contain numeric property keys.');
      }
    }
    i = -1;
    while (++i < keys.length) {
      const key = keys[i];
      if (key === "default" || conditions && conditions.has(key)) {
        const conditionalTarget = target[key];
        const resolveResult = resolvePackageTarget(packageJsonUrl, conditionalTarget, subpath, packageSubpath, base, pattern, internal, isPathMap, conditions);
        if (resolveResult === undefined)
          continue;
        return resolveResult;
      }
    }
    return null;
  }
  if (target === null) {
    return null;
  }
  throw invalidPackageTarget(packageSubpath, target, packageJsonUrl, internal, base);
}
function isConditionalExportsMainSugar(exports, packageJsonUrl, base) {
  if (typeof exports === "string" || Array.isArray(exports))
    return true;
  if (typeof exports !== "object" || exports === null)
    return false;
  const keys = Object.getOwnPropertyNames(exports);
  let isConditionalSugar = false;
  let i = 0;
  let keyIndex = -1;
  while (++keyIndex < keys.length) {
    const key = keys[keyIndex];
    const currentIsConditionalSugar = key === "" || key[0] !== ".";
    if (i++ === 0) {
      isConditionalSugar = currentIsConditionalSugar;
    } else if (isConditionalSugar !== currentIsConditionalSugar) {
      throw new ERR_INVALID_PACKAGE_CONFIG2(fileURLToPath3(packageJsonUrl), base, `"exports" cannot contain some keys starting with '.' and some not.` + " The exports object must either be an object of package subpath keys" + " or an object of main entry condition name keys only.");
    }
  }
  return isConditionalSugar;
}
function emitTrailingSlashPatternDeprecation(match, pjsonUrl, base) {
  if (process2.noDeprecation) {
    return;
  }
  const pjsonPath = fileURLToPath3(pjsonUrl);
  if (emittedPackageWarnings.has(pjsonPath + "|" + match))
    return;
  emittedPackageWarnings.add(pjsonPath + "|" + match);
  process2.emitWarning(`Use of deprecated trailing slash pattern mapping "${match}" in the ` + `"exports" field module resolution of the package at ${pjsonPath}${base ? ` imported from ${fileURLToPath3(base)}` : ""}. Mapping specifiers ending in "/" is no longer supported.`, "DeprecationWarning", "DEP0155");
}
function packageExportsResolve(packageJsonUrl, packageSubpath, packageConfig, base, conditions) {
  let exports = packageConfig.exports;
  if (isConditionalExportsMainSugar(exports, packageJsonUrl, base)) {
    exports = { ".": exports };
  }
  if (own2.call(exports, packageSubpath) && !packageSubpath.includes("*") && !packageSubpath.endsWith("/")) {
    const target = exports[packageSubpath];
    const resolveResult = resolvePackageTarget(packageJsonUrl, target, "", packageSubpath, base, false, false, false, conditions);
    if (resolveResult === null || resolveResult === undefined) {
      throw exportsNotFound(packageSubpath, packageJsonUrl, base);
    }
    return resolveResult;
  }
  let bestMatch = "";
  let bestMatchSubpath = "";
  const keys = Object.getOwnPropertyNames(exports);
  let i = -1;
  while (++i < keys.length) {
    const key = keys[i];
    const patternIndex = key.indexOf("*");
    if (patternIndex !== -1 && packageSubpath.startsWith(key.slice(0, patternIndex))) {
      if (packageSubpath.endsWith("/")) {
        emitTrailingSlashPatternDeprecation(packageSubpath, packageJsonUrl, base);
      }
      const patternTrailer = key.slice(patternIndex + 1);
      if (packageSubpath.length >= key.length && packageSubpath.endsWith(patternTrailer) && patternKeyCompare(bestMatch, key) === 1 && key.lastIndexOf("*") === patternIndex) {
        bestMatch = key;
        bestMatchSubpath = packageSubpath.slice(patternIndex, packageSubpath.length - patternTrailer.length);
      }
    }
  }
  if (bestMatch) {
    const target = exports[bestMatch];
    const resolveResult = resolvePackageTarget(packageJsonUrl, target, bestMatchSubpath, bestMatch, base, true, false, packageSubpath.endsWith("/"), conditions);
    if (resolveResult === null || resolveResult === undefined) {
      throw exportsNotFound(packageSubpath, packageJsonUrl, base);
    }
    return resolveResult;
  }
  throw exportsNotFound(packageSubpath, packageJsonUrl, base);
}
function patternKeyCompare(a, b) {
  const aPatternIndex = a.indexOf("*");
  const bPatternIndex = b.indexOf("*");
  const baseLengthA = aPatternIndex === -1 ? a.length : aPatternIndex + 1;
  const baseLengthB = bPatternIndex === -1 ? b.length : bPatternIndex + 1;
  if (baseLengthA > baseLengthB)
    return -1;
  if (baseLengthB > baseLengthA)
    return 1;
  if (aPatternIndex === -1)
    return 1;
  if (bPatternIndex === -1)
    return -1;
  if (a.length > b.length)
    return -1;
  if (b.length > a.length)
    return 1;
  return 0;
}
function packageImportsResolve(name, base, conditions) {
  if (name === "#" || name.startsWith("#/") || name.endsWith("/")) {
    const reason = "is not a valid internal imports specifier name";
    throw new ERR_INVALID_MODULE_SPECIFIER(name, reason, fileURLToPath3(base));
  }
  let packageJsonUrl;
  const packageConfig = getPackageScopeConfig(base);
  if (packageConfig.exists) {
    packageJsonUrl = pathToFileURL(packageConfig.pjsonPath);
    const imports = packageConfig.imports;
    if (imports) {
      if (own2.call(imports, name) && !name.includes("*")) {
        const resolveResult = resolvePackageTarget(packageJsonUrl, imports[name], "", name, base, false, true, false, conditions);
        if (resolveResult !== null && resolveResult !== undefined) {
          return resolveResult;
        }
      } else {
        let bestMatch = "";
        let bestMatchSubpath = "";
        const keys = Object.getOwnPropertyNames(imports);
        let i = -1;
        while (++i < keys.length) {
          const key = keys[i];
          const patternIndex = key.indexOf("*");
          if (patternIndex !== -1 && name.startsWith(key.slice(0, -1))) {
            const patternTrailer = key.slice(patternIndex + 1);
            if (name.length >= key.length && name.endsWith(patternTrailer) && patternKeyCompare(bestMatch, key) === 1 && key.lastIndexOf("*") === patternIndex) {
              bestMatch = key;
              bestMatchSubpath = name.slice(patternIndex, name.length - patternTrailer.length);
            }
          }
        }
        if (bestMatch) {
          const target = imports[bestMatch];
          const resolveResult = resolvePackageTarget(packageJsonUrl, target, bestMatchSubpath, bestMatch, base, true, true, false, conditions);
          if (resolveResult !== null && resolveResult !== undefined) {
            return resolveResult;
          }
        }
      }
    }
  }
  throw importNotDefined(name, packageJsonUrl, base);
}
function parsePackageName(specifier, base) {
  let separatorIndex = specifier.indexOf("/");
  let validPackageName = true;
  let isScoped = false;
  if (specifier[0] === "@") {
    isScoped = true;
    if (separatorIndex === -1 || specifier.length === 0) {
      validPackageName = false;
    } else {
      separatorIndex = specifier.indexOf("/", separatorIndex + 1);
    }
  }
  const packageName = separatorIndex === -1 ? specifier : specifier.slice(0, separatorIndex);
  if (invalidPackageNameRegEx.exec(packageName) !== null) {
    validPackageName = false;
  }
  if (!validPackageName) {
    throw new ERR_INVALID_MODULE_SPECIFIER(specifier, "is not a valid package name", fileURLToPath3(base));
  }
  const packageSubpath = "." + (separatorIndex === -1 ? "" : specifier.slice(separatorIndex));
  return { packageName, packageSubpath, isScoped };
}
function packageResolve(specifier, base, conditions) {
  if (builtinModules.includes(specifier)) {
    return new URL("node:" + specifier);
  }
  const { packageName, packageSubpath, isScoped } = parsePackageName(specifier, base);
  const packageConfig = getPackageScopeConfig(base);
  if (packageConfig.exists) {
    const packageJsonUrl2 = pathToFileURL(packageConfig.pjsonPath);
    if (packageConfig.name === packageName && packageConfig.exports !== undefined && packageConfig.exports !== null) {
      return packageExportsResolve(packageJsonUrl2, packageSubpath, packageConfig, base, conditions);
    }
  }
  let packageJsonUrl = new URL("./node_modules/" + packageName + "/package.json", base);
  let packageJsonPath = fileURLToPath3(packageJsonUrl);
  let lastPath;
  do {
    const stat = tryStatSync(packageJsonPath.slice(0, -13));
    if (!stat || !stat.isDirectory()) {
      lastPath = packageJsonPath;
      packageJsonUrl = new URL((isScoped ? "../../../../node_modules/" : "../../../node_modules/") + packageName + "/package.json", packageJsonUrl);
      packageJsonPath = fileURLToPath3(packageJsonUrl);
      continue;
    }
    const packageConfig2 = read(packageJsonPath, { base, specifier });
    if (packageConfig2.exports !== undefined && packageConfig2.exports !== null) {
      return packageExportsResolve(packageJsonUrl, packageSubpath, packageConfig2, base, conditions);
    }
    if (packageSubpath === ".") {
      return legacyMainResolve(packageJsonUrl, packageConfig2, base);
    }
    return new URL(packageSubpath, packageJsonUrl);
  } while (packageJsonPath.length !== lastPath.length);
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath3(base), false);
}
function isRelativeSpecifier(specifier) {
  if (specifier[0] === ".") {
    if (specifier.length === 1 || specifier[1] === "/")
      return true;
    if (specifier[1] === "." && (specifier.length === 2 || specifier[2] === "/")) {
      return true;
    }
  }
  return false;
}
function shouldBeTreatedAsRelativeOrAbsolutePath(specifier) {
  if (specifier === "")
    return false;
  if (specifier[0] === "/")
    return true;
  return isRelativeSpecifier(specifier);
}
function moduleResolve(specifier, base, conditions, preserveSymlinks) {
  if (conditions === undefined) {
    conditions = getConditionsSet();
  }
  const protocol = base.protocol;
  const isData = protocol === "data:";
  const isRemote = isData || protocol === "http:" || protocol === "https:";
  let resolved;
  if (shouldBeTreatedAsRelativeOrAbsolutePath(specifier)) {
    try {
      resolved = new URL(specifier, base);
    } catch (error_) {
      const error = new ERR_UNSUPPORTED_RESOLVE_REQUEST(specifier, base);
      error.cause = error_;
      throw error;
    }
  } else if (protocol === "file:" && specifier[0] === "#") {
    resolved = packageImportsResolve(specifier, base, conditions);
  } else {
    try {
      resolved = new URL(specifier);
    } catch (error_) {
      if (isRemote && !builtinModules.includes(specifier)) {
        const error = new ERR_UNSUPPORTED_RESOLVE_REQUEST(specifier, base);
        error.cause = error_;
        throw error;
      }
      resolved = packageResolve(specifier, base, conditions);
    }
  }
  assert2.ok(resolved !== undefined, "expected to be defined");
  if (resolved.protocol !== "file:") {
    return resolved;
  }
  return finalizeResolution(resolved, base, preserveSymlinks);
}
function checkIfDisallowedImport(specifier, parsed, parsedParentURL) {
  if (parsedParentURL) {
    const parentProtocol = parsedParentURL.protocol;
    if (parentProtocol === "http:" || parentProtocol === "https:") {
      if (shouldBeTreatedAsRelativeOrAbsolutePath(specifier)) {
        const parsedProtocol = parsed?.protocol;
        if (parsedProtocol && parsedProtocol !== "https:" && parsedProtocol !== "http:") {
          throw new ERR_NETWORK_IMPORT_DISALLOWED(specifier, parsedParentURL, "remote imports cannot import from a local location.");
        }
        return { url: parsed?.href || "" };
      }
      if (builtinModules.includes(specifier)) {
        throw new ERR_NETWORK_IMPORT_DISALLOWED(specifier, parsedParentURL, "remote imports cannot import from a local location.");
      }
      throw new ERR_NETWORK_IMPORT_DISALLOWED(specifier, parsedParentURL, "only relative and absolute specifiers are supported.");
    }
  }
}
function isURL(self) {
  return Boolean(self && typeof self === "object" && "href" in self && typeof self.href === "string" && "protocol" in self && typeof self.protocol === "string" && self.href && self.protocol);
}
function throwIfInvalidParentURL(parentURL) {
  if (parentURL === undefined) {
    return;
  }
  if (typeof parentURL !== "string" && !isURL(parentURL)) {
    throw new codes.ERR_INVALID_ARG_TYPE("parentURL", ["string", "URL"], parentURL);
  }
}
function defaultResolve(specifier, context = {}) {
  const { parentURL } = context;
  assert2.ok(parentURL !== undefined, "expected `parentURL` to be defined");
  throwIfInvalidParentURL(parentURL);
  let parsedParentURL;
  if (parentURL) {
    try {
      parsedParentURL = new URL(parentURL);
    } catch {}
  }
  let parsed;
  let protocol;
  try {
    parsed = shouldBeTreatedAsRelativeOrAbsolutePath(specifier) ? new URL(specifier, parsedParentURL) : new URL(specifier);
    protocol = parsed.protocol;
    if (protocol === "data:") {
      return { url: parsed.href, format: null };
    }
  } catch {}
  const maybeReturn = checkIfDisallowedImport(specifier, parsed, parsedParentURL);
  if (maybeReturn)
    return maybeReturn;
  if (protocol === undefined && parsed) {
    protocol = parsed.protocol;
  }
  if (protocol === "node:") {
    return { url: specifier };
  }
  if (parsed && parsed.protocol === "node:")
    return { url: specifier };
  const conditions = getConditionsSet(context.conditions);
  const url = moduleResolve(specifier, new URL(parentURL), conditions, false);
  return {
    url: url.href,
    format: defaultGetFormatWithoutErrors(url, { parentURL })
  };
}

// ../../node_modules/.bun/import-meta-resolve@4.2.0/node_modules/import-meta-resolve/index.js
function resolve(specifier, parent) {
  if (!parent) {
    throw new Error("Please pass `parent`: `import-meta-resolve` cannot ponyfill that");
  }
  try {
    return defaultResolve(specifier, { parentURL: parent }).url;
  } catch (error) {
    const exception = error;
    if ((exception.code === "ERR_UNSUPPORTED_DIR_IMPORT" || exception.code === "ERR_MODULE_NOT_FOUND") && typeof exception.url === "string") {
      return exception.url;
    }
    throw error;
  }
}

// src/client/credentials.ts
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
  constructor(path3, reason) {
    super(`Refusing unsafe credential/config file ${path3}: ${reason}.`);
    this.name = "CredentialFileUnsafeError";
    this.path = path3;
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
function readAppConfigFile(path3) {
  const unsafe = (reason) => {
    throw new CredentialFileUnsafeError(path3, reason);
  };
  let fd = -1;
  try {
    fd = openSync(path3, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
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
function readCredentialFile(path3, apiKeyKeys, pointerKey) {
  const parsed = readAppConfigFile(path3);
  if (!parsed)
    return null;
  for (const key of [...apiKeyKeys, pointerKey]) {
    if (parsed.unusable.has(key)) {
      throw new CredentialFileUnsafeError(path3, `${key} is declared but blank or malformed`);
    }
  }
  const values = apiKeyKeys.map((key) => parsed.values.get(key)?.trim()).filter((value) => Boolean(value));
  const pointer = parsed.values.get(pointerKey)?.trim();
  if (pointer !== undefined) {
    if (!VAULT_POINTER_SHAPE.test(pointer))
      throw new CredentialFileUnsafeError(path3, `${pointerKey} must name a vault item`);
    if (values.length)
      throw new CredentialFileUnsafeError(path3, "a credential file cannot select both a literal key and a vault reference");
    return { apiKey: "", pointerVaultKey: pointer };
  }
  if (new Set(values).size > 1) {
    throw new CredentialFileUnsafeError(path3, "credential aliases disagree");
  }
  return values[0] === undefined ? null : { apiKey: values[0] };
}
var CREDENTIAL_SHAPED_KEY = /(?:^|_)(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)(?:_|$)/;
function appConfigDiskValue(name, env, keys) {
  const wanted = keys.filter((key) => !CREDENTIAL_SHAPED_KEY.test(key));
  if (wanted.length === 0)
    return null;
  for (const path3 of credentialDiskSources(name, env)) {
    const parsed = readAppConfigFile(path3);
    if (!parsed)
      continue;
    if (wanted.some((key) => parsed.unusable.has(key))) {
      return { key: wanted.find((key) => parsed.unusable.has(key)), value: "", path: path3, unusable: true };
    }
    const values = wanted.map((key) => parsed.values.get(key)?.trim()).filter((value) => Boolean(value));
    if (new Set(values).size > 1)
      throw new CredentialFileUnsafeError(path3, "configuration aliases disagree");
    for (const key of wanted) {
      if (parsed.unusable.has(key))
        return { key, value: "", path: path3, unusable: true };
      const value = parsed.values.get(key)?.trim();
      if (value)
        return { key, value, path: path3 };
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
    for (const path3 of paths) {
      const value = readCredentialFile(path3, apiKeyKeys, pointerKeyName);
      if (value) {
        if (!value.pointerVaultKey)
          assertUsableCredential(name, path3, value.apiKey);
        return sealCredential({
          ...value,
          tier: value.pointerVaultKey ? "pointer" : "profile",
          source: path3,
          deliberate: true,
          diskCandidates: paths,
          warning: null
        });
      }
    }
    throw new CredentialResolutionError(name, `Profile '${profile}' (from ${profileSource}) has no ${apiKeyKeys[0]} or ${pointerKeyName} for '${name}'. ` + `Looked in: ${paths.join(", ") || "<no HOME in this environment>"}. ` + `A profile names WHICH identity to use, so it is never resolved around \u2014 ` + `create the profile's credential file or unset ${CREDENTIAL_PROFILE_ENV_KEY}.`, paths);
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
  const diskHits = diskSourceList.map((src) => ({ src, value: readCredentialFile(src.path, apiKeyKeys, pointerKeyName) })).filter((hit) => hit.value !== null);
  if (diskHits.length > 0) {
    const winner = diskHits[0];
    if (winner.value.pointerVaultKey) {
      return sealCredential({
        ...winner.value,
        tier: "pointer",
        source: winner.src.path,
        deliberate: false,
        diskCandidates: diskPaths,
        warning: null
      });
    }
    assertUsableCredential(name, winner.src.path, winner.value.apiKey);
    const divergentSources = [
      ...diskHits.slice(1).filter((hit) => hit.value.apiKey !== winner.value.apiKey || hit.value.pointerVaultKey !== winner.value.pointerVaultKey).map((hit) => hit.src.path),
      ...envHit && envHit.value !== winner.value.apiKey ? [envHit.key] : []
    ];
    const warning = divergentSources.length > 0 ? `Credential sources disagree for '${name}': ${winner.src.path} and ` + `${divergentSources.join(", ")} hold different keys. ${winner.src.path} wins, because a file on ` + `disk is re-read on every call while an environment variable is a snapshot. Reconcile them \u2014 ` + `a rotation that updated only one leaves the other to fail 401 wherever it is loaded first.` : null;
    return sealCredential({
      apiKey: winner.value.apiKey,
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
async function completePointerCredential(name, pointerResolution, env = process.env) {
  const secretsEnv = snapshotClientEnvironment("secrets", env);
  const vaultKey = pointerResolution.pointerVaultKey;
  const pointerEnvKey = pointerResolution.source;
  if (!vaultKey) {
    throw new CredentialResolutionError(name, `Pointer resolution from ${pointerEnvKey} carries no vault item key; this is a defect in the resolver.`, [pointerEnvKey]);
  }
  if (name === "secrets") {
    throw new CredentialResolutionError(name, "The Secrets bootstrap credential cannot reference the same hosted vault; configure an independent bootstrap provider.", [pointerEnvKey]);
  }
  let secretsSdk;
  try {
    const sdkUrl = resolve(SECRETS_PACKAGE_SPECIFIER, import.meta.url);
    secretsSdk = await import(sdkUrl);
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the secrets SDK (@hasna/secrets) is not installed in this process. A vault pointer is TERMINAL: install @hasna/secrets to resolve it, or unset ${pointerEnvKey}.`, [pointerEnvKey]);
  }
  let client;
  try {
    const bootstrap = resolveCredential("secrets", secretsEnv);
    if (!bootstrap || bootstrap.tier === "pointer") {
      throw new CredentialResolutionError("secrets", "The Secrets vault requires an independent, non-reference bootstrap credential.", bootstrap ? [bootstrap.source] : []);
    }
    client = secretsSdk.createSecretsClientFromEnv(secretsEnv);
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the secrets client could not be configured from this environment (the secrets service URL and key env are missing or invalid). A vault pointer is TERMINAL and never falls through to a literal or disk credential.`, [pointerEnvKey]);
  }
  let secret;
  try {
    secret = await client.getSecret({ key: vaultKey });
  } catch {
    throw new CredentialResolutionError(name, `${pointerEnvKey} names vault item '${vaultKey}', but the vault could not be reached or the item is unavailable. A vault pointer is TERMINAL and never falls through to a literal or disk credential.`, [pointerEnvKey]);
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
    deliberate: pointerResolution.deliberate,
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
  let path3 = url.pathname.replace(/\/+$/, "");
  if (path3.endsWith("/v1"))
    path3 = path3.slice(0, -"/v1".length);
  url.pathname = `${path3}/v1`;
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
  constructor(method, path3, status, body, credential) {
    const guidance = credential ? `. ${credential.guidance}` : "";
    super(`Hasna cloud request failed: ${method} ${path3} -> ${status}${guidance}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path3;
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
function appendQuery(path3, query) {
  if (!query)
    return path3;
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
    return path3;
  return `${path3}${path3.includes("?") ? "&" : "?"}${qs}`;
}
var defaultSleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
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
  async function request(method, path3, body, opts = {}) {
    const upper = method.toUpperCase();
    const rel = appendQuery(path3.startsWith("/") ? path3 : `/${path3}`, opts.query);
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
    get: (path3, opts) => request("GET", path3, undefined, opts),
    post: (path3, body, opts) => request("POST", path3, body, opts),
    put: (path3, body, opts) => request("PUT", path3, body, opts),
    patch: (path3, body, opts) => request("PATCH", path3, body, opts),
    del: (path3, body, opts) => request("DELETE", path3, body, opts)
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

// src/client/storage.ts
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
function isNotFoundHttpError(error) {
  return typeof error === "object" && error !== null && error.name === "HasnaHttpError" && error.status === 404;
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
        if (isNotFoundHttpError(error))
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
        if (isNotFoundHttpError(error))
          return;
        throw error;
      }
    }
  };
}
function resolveStorageClient(name, env = process.env, overrides) {
  const wired = createClientTransport(name, env, overrides);
  return { transport: "http", client: createHasnaStorageClient(name, wired.client) };
}
export {
  resolveStorageClient,
  createHasnaStorageClient
};
