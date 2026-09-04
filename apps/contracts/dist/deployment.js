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

// src/todos/common.ts
import { createHash } from "crypto";

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/core.js
var NEVER = Object.freeze({
  status: "aborted"
});
function $constructor(name, initializer, params) {
  function init(inst, def) {
    var _a;
    Object.defineProperty(inst, "_zod", {
      value: inst._zod ?? {},
      enumerable: false
    });
    (_a = inst._zod).traits ?? (_a.traits = new Set);
    inst._zod.traits.add(name);
    initializer(inst, def);
    for (const k in _.prototype) {
      if (!(k in inst))
        Object.defineProperty(inst, k, { value: _.prototype[k].bind(inst) });
    }
    inst._zod.constr = _;
    inst._zod.def = def;
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}
var globalConfig = {};
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/util.js
var exports_util = {};
__export(exports_util, {
  unwrapMessage: () => unwrapMessage,
  stringifyPrimitive: () => stringifyPrimitive,
  required: () => required,
  randomString: () => randomString,
  propertyKeyTypes: () => propertyKeyTypes,
  promiseAllObject: () => promiseAllObject,
  primitiveTypes: () => primitiveTypes,
  prefixIssues: () => prefixIssues,
  pick: () => pick,
  partial: () => partial,
  optionalKeys: () => optionalKeys,
  omit: () => omit,
  numKeys: () => numKeys,
  nullish: () => nullish,
  normalizeParams: () => normalizeParams,
  merge: () => merge,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  joinValues: () => joinValues,
  issue: () => issue,
  isPlainObject: () => isPlainObject,
  isObject: () => isObject,
  getSizableOrigin: () => getSizableOrigin,
  getParsedType: () => getParsedType,
  getLengthableOrigin: () => getLengthableOrigin,
  getEnumValues: () => getEnumValues,
  getElementAtPath: () => getElementAtPath,
  floatSafeRemainder: () => floatSafeRemainder,
  finalizeIssue: () => finalizeIssue,
  extend: () => extend,
  escapeRegex: () => escapeRegex,
  esc: () => esc,
  defineLazy: () => defineLazy,
  createTransparentProxy: () => createTransparentProxy,
  clone: () => clone,
  cleanRegex: () => cleanRegex,
  cleanEnum: () => cleanEnum,
  captureStackTrace: () => captureStackTrace,
  cached: () => cached,
  assignProp: () => assignProp,
  assertNotEqual: () => assertNotEqual,
  assertNever: () => assertNever,
  assertIs: () => assertIs,
  assertEqual: () => assertEqual,
  assert: () => assert,
  allowsEval: () => allowsEval,
  aborted: () => aborted,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  Class: () => Class,
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {}
function assertNever(_x) {
  throw new Error;
}
function assert(_) {}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function defineLazy(object, key, getter) {
  const set = false;
  Object.defineProperty(object, key, {
    get() {
      if (!set) {
        const value = getter();
        object[key] = value;
        return value;
      }
      throw new Error("cached value already set");
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0;i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0;i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
var captureStackTrace = Error.captureStackTrace ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = cached(() => {
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = new Set(["string", "number", "symbol"]);
var primitiveTypes = new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const newShape = {};
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    newShape[key] = currDef.shape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function omit(schema, mask) {
  const newShape = { ...schema._zod.def.shape };
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    delete newShape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const def = {
    ...schema._zod.def,
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    checks: []
  };
  return clone(schema, def);
}
function merge(a, b) {
  return clone(a, {
    ...a._zod.def,
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    catchall: b._zod.def.catchall,
    checks: []
  });
}
function partial(Class, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in oldShape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = Class ? new Class({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  } else {
    for (const key in oldShape) {
      shape[key] = Class ? new Class({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    checks: []
  });
}
function required(Class, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in shape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = new Class({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  } else {
    for (const key in oldShape) {
      shape[key] = new Class({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    checks: []
  });
}
function aborted(x, startIndex = 0) {
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true)
      return true;
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!ctx?.reportInput) {
    delete full.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}

class Class {
  constructor(..._args) {}
}

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  Object.defineProperty(inst, "message", {
    get() {
      return JSON.stringify(def, jsonStringifyReplacer, 2);
    },
    enumerable: true
  });
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, _mapper) {
  const mapper = _mapper || function(issue2) {
    return issue2.message;
  };
  const fieldErrors = { _errors: [] };
  const processError = (error2) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues });
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues });
      } else if (issue2.path.length === 0) {
        fieldErrors._errors.push(mapper(issue2));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue2.path.length) {
          const el = issue2.path[i];
          const terminal = i === issue2.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue2));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][^\s-]{8,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
var e164 = /^\+(?:[0-9]){6,14}[0-9]$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time2 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-]\\d{2}:\\d{2})`);
  const timeRegex = `${time2}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^\d+$/;
var number = /^-?\d+(?:\.\d+)?/i;
var boolean = /true|false/i;
var _null = /null/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a;
    (_a = inst2._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inst
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 0,
  patch: 0
};

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    inst._zod.run = (payload, ctx) => {
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  inst["~standard"] = {
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  };
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const orig = payload.value;
      const url = new URL(orig);
      const href = url.href;
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (!orig.endsWith("/") && href.endsWith("/")) {
        payload.value = href.slice(0, -1);
      } else {
        payload.value = href;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv4`;
  });
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv6`;
  });
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const [address, prefix] = payload.value.split("/");
    try {
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64url";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handleObjectResult(result, final, key) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(key, result.issues));
  }
  final.value[key] = result.value;
}
function handleOptionalObjectResult(result, final, key, input) {
  if (result.issues.length) {
    if (input[key] === undefined) {
      if (key in input) {
        final.value[key] = undefined;
      } else {
        final.value[key] = result.value;
      }
    } else {
      final.issues.push(...prefixIssues(key, result.issues));
    }
  } else if (result.value === undefined) {
    if (key in input)
      final.value[key] = undefined;
  } else {
    final.value[key] = result.value;
  }
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const _normalized = cached(() => {
    const keys = Object.keys(def.shape);
    for (const k of keys) {
      if (!(def.shape[k] instanceof $ZodType)) {
        throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
      }
    }
    const okeys = optionalKeys(def.shape);
    return {
      shape: def.shape,
      keys,
      keySet: new Set(keys),
      numKeys: keys.length,
      optionalKeys: new Set(okeys)
    };
  });
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {}`);
    for (const key of normalized.keys) {
      if (normalized.optionalKeys.has(key)) {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        const k = esc(key);
        doc.write(`
        if (${id}.issues.length) {
          if (input[${k}] === undefined) {
            if (${k} in input) {
              newResult[${k}] = undefined;
            }
          } else {
            payload.issues = payload.issues.concat(
              ${id}.issues.map((iss) => ({
                ...iss,
                path: iss.path ? [${k}, ...iss.path] : [${k}],
              }))
            );
          }
        } else if (${id}.value === undefined) {
          if (${k} in input) newResult[${k}] = undefined;
        } else {
          newResult[${k}] = ${id}.value;
        }
        `);
      } else {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        doc.write(`
          if (${id}.issues.length) payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${esc(key)}, ...iss.path] : [${esc(key)}]
          })));`);
        doc.write(`newResult[${esc(key)}] = ${id}.value`);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
    } else {
      payload.value = {};
      const shape = value.shape;
      for (const key of value.keys) {
        const el = shape[key];
        const r = el._zod.run({ value: input[key], issues: [] }, ctx);
        const isOptional = el._zod.optin === "optional" && el._zod.optout === "optional";
        if (r instanceof Promise) {
          proms.push(r.then((r2) => isOptional ? handleOptionalObjectResult(r2, payload, key, input) : handleObjectResult(r2, payload, key)));
        } else if (isOptional) {
          handleOptionalObjectResult(r, payload, key, input);
        } else {
          handleObjectResult(r, payload, key);
        }
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    const unrecognized = [];
    const keySet = value.keySet;
    const _catchall = catchall._zod;
    const t = _catchall.def.type;
    for (const key of Object.keys(input)) {
      if (keySet.has(key))
        continue;
      if (t === "never") {
        unrecognized.push(key);
        continue;
      }
      const r = _catchall.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handleObjectResult(r2, payload, key)));
      } else {
        handleObjectResult(r, payload, key);
      }
    }
    if (unrecognized.length) {
      payload.issues.push({
        code: "unrecognized_keys",
        keys: unrecognized,
        input,
        inst
      });
    }
    if (!proms.length)
      return payload;
    return Promise.all(proms).then(() => {
      return payload;
    });
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  inst._zod.parse = (payload, ctx) => {
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  if (left.issues.length) {
    result.issues.push(...left.issues);
  }
  if (right.issues.length) {
    result.issues.push(...right.issues);
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  inst._zod.values = new Set(values);
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.values = new Set(def.values);
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? o.toString() : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const _out = def.transform(payload.value, payload);
    if (_ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    return payload;
  };
});
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def, ctx));
    }
    return handlePipeResult(left, def, ctx);
  };
});
function handlePipeResult(left, def, ctx) {
  if (aborted(left)) {
    return left;
  }
  return def.out._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/locales/en.js
var parsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "number";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Invalid input: expected ${issue2.expected}, received ${parsedType(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/registries.js
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new Map;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      if (this._idmap.has(meta.id)) {
        throw new Error(`ID ${meta.id} already exists in the registry`);
      }
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new Map;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      return { ...pm, ...this._map.get(schema) };
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
var globalRegistry = /* @__PURE__ */ registry();
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/api.js
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/iso.js
var exports_iso = {};
__export(exports_iso, {
  time: () => time2,
  duration: () => duration2,
  datetime: () => datetime2,
  date: () => date2,
  ZodISOTime: () => ZodISOTime,
  ZodISODuration: () => ZodISODuration,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODate: () => ZodISODate
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue2) => inst.issues.push(issue2)
    },
    addIssues: {
      value: (issues2) => inst.issues.push(...issues2)
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodError = $constructor("ZodError", initializer2);
var ZodRealError = $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/schemas.js
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  inst.def = def;
  Object.defineProperty(inst, "_def", { value: def });
  inst.check = (...checks2) => {
    return inst.clone({
      ...def,
      checks: [
        ...def.checks ?? [],
        ...checks2.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    });
  };
  inst.clone = (def2, params) => clone(inst, def2, params);
  inst.brand = () => inst;
  inst.register = (reg, meta) => {
    reg.add(inst, meta);
    return inst;
  };
  inst.parse = (data, params) => parse2(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.refine = (check, params) => inst.check(refine(check, params));
  inst.superRefine = (refinement) => inst.check(superRefine(refinement));
  inst.overwrite = (fn) => inst.check(_overwrite(fn));
  inst.optional = () => optional(inst);
  inst.nullable = () => nullable(inst);
  inst.nullish = () => optional(nullable(inst));
  inst.nonoptional = (params) => nonoptional(inst, params);
  inst.array = () => array(inst);
  inst.or = (arg) => union([inst, arg]);
  inst.and = (arg) => intersection(inst, arg);
  inst.transform = (tx) => pipe(inst, transform(tx));
  inst.default = (def2) => _default(inst, def2);
  inst.prefault = (def2) => prefault(inst, def2);
  inst.catch = (params) => _catch(inst, params);
  inst.pipe = (target) => pipe(inst, target);
  inst.readonly = () => readonly(inst);
  inst.describe = (description) => {
    const cl = inst.clone();
    globalRegistry.add(cl, { description });
    return cl;
  };
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  inst.meta = (...args) => {
    if (args.length === 0) {
      return globalRegistry.get(inst);
    }
    const cl = inst.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  };
  inst.isOptional = () => inst.safeParse(undefined).success;
  inst.isNullable = () => inst.safeParse(null).success;
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  inst.regex = (...args) => inst.check(_regex(...args));
  inst.includes = (...args) => inst.check(_includes(...args));
  inst.startsWith = (...args) => inst.check(_startsWith(...args));
  inst.endsWith = (...args) => inst.check(_endsWith(...args));
  inst.min = (...args) => inst.check(_minLength(...args));
  inst.max = (...args) => inst.check(_maxLength(...args));
  inst.length = (...args) => inst.check(_length(...args));
  inst.nonempty = (...args) => inst.check(_minLength(1, ...args));
  inst.lowercase = (params) => inst.check(_lowercase(params));
  inst.uppercase = (params) => inst.check(_uppercase(params));
  inst.trim = () => inst.check(_trim());
  inst.normalize = (...args) => inst.check(_normalize(...args));
  inst.toLowerCase = () => inst.check(_toLowerCase());
  inst.toUpperCase = () => inst.check(_toUpperCase());
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.int = (params) => inst.check(int(params));
  inst.safe = (params) => inst.check(int(params));
  inst.positive = (params) => inst.check(_gt(0, params));
  inst.nonnegative = (params) => inst.check(_gte(0, params));
  inst.negative = (params) => inst.check(_lt(0, params));
  inst.nonpositive = (params) => inst.check(_lte(0, params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  inst.step = (value, params) => inst.check(_multipleOf(value, params));
  inst.finite = () => inst;
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType.init(inst, def);
});
function _null3(params) {
  return _null2(ZodNull, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst.element = def.element;
  inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
  inst.nonempty = (params) => inst.check(_minLength(1, params));
  inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
  inst.length = (len, params) => inst.check(_length(len, params));
  inst.unwrap = () => inst.element;
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObject.init(inst, def);
  ZodType.init(inst, def);
  exports_util.defineLazy(inst, "shape", () => def.shape);
  inst.keyof = () => _enum(Object.keys(inst._zod.def.shape));
  inst.catchall = (catchall) => inst.clone({ ...inst._zod.def, catchall });
  inst.passthrough = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
  inst.strip = () => inst.clone({ ...inst._zod.def, catchall: undefined });
  inst.extend = (incoming) => {
    return exports_util.extend(inst, incoming);
  };
  inst.merge = (other) => exports_util.merge(inst, other);
  inst.pick = (mask) => exports_util.pick(inst, mask);
  inst.omit = (mask) => exports_util.omit(inst, mask);
  inst.partial = (...args) => exports_util.partial(ZodOptional, inst, args[0]);
  inst.required = (...args) => exports_util.required(ZodNonOptional, inst, args[0]);
});
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    get shape() {
      exports_util.assignProp(this, "shape", { ...shape });
      return this.shape;
    },
    catchall: never(),
    ...exports_util.normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...exports_util.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...exports_util.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...exports_util.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(exports_util.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        _issue.continue ?? (_issue.continue = true);
        payload.issues.push(exports_util.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
  });
  ch._zod.check = fn;
  return ch;
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn) {
  const ch = check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(exports_util.issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(exports_util.issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/external.js
config(en_default());

// src/todos/common.ts
var TODOS_CONTRACT_VERSION = "1.0.0";
var TODOS_MANIFEST_VERSION = "1";
var TodosAudienceSchema = _enum(["customer", "tenant_admin"]);
var TodosTimestampSchema = exports_iso.datetime({ offset: true });
var TodosDateSchema = exports_iso.date();
var TodosEntityIdSchema = string2().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosOwnerIdSchema = string2().min(2).max(128).regex(/^[a-z][a-z0-9.-]*$/);
var TodosSlugSchema = string2().min(1).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var TodosRequestIdSchema = string2().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosIdempotencyKeySchema = string2().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosSha256DigestSchema = string2().regex(/^[a-f0-9]{64}$/);
var TodosCursorSchema = string2().min(1).max(512);
var TodosRelativePathSchema = string2().min(1).max(1024).superRefine((value, ctx) => {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.split("/").some((segment) => segment === "..")) {
    ctx.addIssue({
      code: "custom",
      message: "Paths must be relative and must not traverse parent directories"
    });
  }
});
var TodosPortableScalarSchema = union([
  string2().max(4096),
  number2().finite(),
  boolean2(),
  _null3()
]);
var TodosOwnerQualifiedRefSchema = strictObject({
  owner: TodosOwnerIdSchema,
  kind: string2().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  id: TodosEntityIdSchema,
  digest: TodosSha256DigestSchema
});
var TodosContentRefSchema = strictObject({
  algorithm: literal("sha256"),
  digest: TodosSha256DigestSchema,
  mediaType: string2().min(1).max(160),
  byteLength: number2().int().nonnegative()
});
var TodosPageRequestSchema = strictObject({
  cursor: TodosCursorSchema.nullable(),
  limit: number2().int().positive().max(500)
});
var TodosResponseMetaSchema = strictObject({
  requestId: TodosRequestIdSchema,
  authorityId: TodosOwnerIdSchema,
  contractVersion: literal(TODOS_CONTRACT_VERSION),
  manifestVersion: literal(TODOS_MANIFEST_VERSION)
});
function canonicalizeTodosValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeTodosValue);
  }
  if (value && typeof value === "object") {
    const record = value;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalizeTodosValue(record[key])]));
  }
  return value;
}
function stableTodosJson(value) {
  return JSON.stringify(canonicalizeTodosValue(value));
}
function sha256TodosValue(value) {
  return createHash("sha256").update(stableTodosJson(value), "utf8").digest("hex");
}
function sha256TodosText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType2,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default2,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown2,
  ZodUnion: () => ZodUnion2,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType2,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString2,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType2,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly2,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional2,
  ZodObject: () => ZodObject2,
  ZodNumber: () => ZodNumber2,
  ZodNullable: () => ZodNullable2,
  ZodNull: () => ZodNull2,
  ZodNever: () => ZodNever2,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral2,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection2,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError2,
  ZodEnum: () => ZodEnum2,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault2,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch2,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean2,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray2,
  ZodAny: () => ZodAny,
  Schema: () => ZodType2,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER2,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs2(_arg) {}
  util2.assertIs = assertIs2;
  function assertNever2(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever2;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues2(array2, separator = " | ") {
    return array2.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues2;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType2 = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError2 extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue2) {
      return issue2.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error2) => {
      for (const issue2 of error2.issues) {
        if (issue2.code === "invalid_union") {
          issue2.unionErrors.map(processError);
        } else if (issue2.code === "invalid_return_type") {
          processError(issue2.returnTypeError);
        } else if (issue2.code === "invalid_arguments") {
          processError(issue2.argumentsError);
        } else if (issue2.path.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue2.path.length) {
            const el = issue2.path[i];
            const terminal = i === issue2.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError2)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue2) => issue2.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError2.create = (issues) => {
  const error2 = new ZodError2(issues);
  return error2;
};

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue2, _ctx) => {
  let message;
  switch (issue2.code) {
    case ZodIssueCode.invalid_type:
      if (issue2.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue2.expected}, received ${issue2.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue2.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue2.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue2.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue2.options)}, received '${issue2.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue2.validation === "object") {
        if ("includes" in issue2.validation) {
          message = `Invalid input: must include "${issue2.validation.includes}"`;
          if (typeof issue2.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue2.validation.position}`;
          }
        } else if ("startsWith" in issue2.validation) {
          message = `Invalid input: must start with "${issue2.validation.startsWith}"`;
        } else if ("endsWith" in issue2.validation) {
          message = `Invalid input: must end with "${issue2.validation.endsWith}"`;
        } else {
          util.assertNever(issue2.validation);
        }
      } else if (issue2.validation !== "regex") {
        message = `Invalid ${issue2.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `more than`} ${issue2.minimum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `over`} ${issue2.minimum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "bigint")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue2.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `less than`} ${issue2.maximum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `under`} ${issue2.maximum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "bigint")
        message = `BigInt must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly` : issue2.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue2.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue2.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue2);
  }
  return { message };
};
var en_default2 = errorMap;

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default2;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue2 = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default2 ? undefined : en_default2
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue2);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../../../../../../Workspace/50-repositories/hasna/apps/node_modules/.bun/zod@3.25.76/node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error2 = new ZodError2(ctx.common.issues);
        this._error = error2;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType2 {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType2(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType2(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType2(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType2(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType2(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType2(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check2, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check2(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check2, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check2(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional2.create(this, this._def);
  }
  nullable() {
    return ZodNullable2.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray2.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion2.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection2.create(this, incoming, this._def);
  }
  transform(transform2) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform: transform2 }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault2({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch2({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly2.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT2(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base642 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base642));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString2 extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        if (input.data.length < check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check2.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        if (input.data.length > check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check2.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "length") {
        const tooBig = input.data.length > check2.value;
        const tooSmall = input.data.length < check2.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check2.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check2.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check2.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check2.message
            });
          }
          status.dirty();
        }
      } else if (check2.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "regex") {
        check2.regex.lastIndex = 0;
        const testResult = check2.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "trim") {
        input.data = input.data.trim();
      } else if (check2.kind === "includes") {
        if (!input.data.includes(check2.value, check2.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check2.value, position: check2.position },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check2.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check2.kind === "startsWith") {
        if (!input.data.startsWith(check2.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check2.value },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "endsWith") {
        if (!input.data.endsWith(check2.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check2.value },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "datetime") {
        const regex = datetimeRegex(check2);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "time") {
        const regex = timeRegex(check2);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "ip") {
        if (!isValidIP(input.data, check2.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "jwt") {
        if (!isValidJWT2(input.data, check2.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cidr") {
        if (!isValidCidr(input.data, check2.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check2) {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString2.create = (params) => {
  return new ZodString2({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder2(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check2 of this._def.checks) {
      if (check2.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "min") {
        const tooSmall = check2.inclusive ? input.data < check2.value : input.data <= check2.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check2.value,
            type: "number",
            inclusive: check2.inclusive,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        const tooBig = check2.inclusive ? input.data > check2.value : input.data >= check2.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check2.value,
            type: "number",
            inclusive: check2.inclusive,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "multipleOf") {
        if (floatSafeRemainder2(input.data, check2.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check2.value,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber2({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check2) {
    return new ZodNumber2({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber2.create = (params) => {
  return new ZodNumber2({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType2 {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        const tooSmall = check2.inclusive ? input.data < check2.value : input.data <= check2.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check2.value,
            inclusive: check2.inclusive,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        const tooBig = check2.inclusive ? input.data > check2.value : input.data >= check2.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check2.value,
            inclusive: check2.inclusive,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "multipleOf") {
        if (input.data % check2.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check2.value,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check2) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};

class ZodBoolean2 extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean2.create = (params) => {
  return new ZodBoolean2({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        if (input.data.getTime() < check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check2.message,
            inclusive: true,
            exact: false,
            minimum: check2.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        if (input.data.getTime() > check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check2.message,
            inclusive: true,
            exact: false,
            maximum: check2.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check2) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};

class ZodSymbol extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};

class ZodUndefined extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};

class ZodNull2 extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull2.create = (params) => {
  return new ZodNull2({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType2 {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};

class ZodUnknown2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown2.create = (params) => {
  return new ZodUnknown2({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever2 extends ZodType2 {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever2.create = (params) => {
  return new ZodNever2({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};

class ZodArray2 extends ZodType2 {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : undefined,
          maximum: tooBig ? def.exactLength.value : undefined,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray2({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray2({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray2({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray2.create = (schema, params) => {
  return new ZodArray2({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject2) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional2.create(deepPartialify(fieldSchema));
    }
    return new ZodObject2({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray2) {
    return new ZodArray2({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional2) {
    return ZodOptional2.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable2) {
    return ZodNullable2.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever2 && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever2) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {} else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject2({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue2, ctx) => {
          const defaultError = this._def.errorMap?.(issue2, ctx).message ?? ctx.defaultError;
          if (issue2.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject2({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject2({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject2({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject2({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject2({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional2) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject2.create = (shape, params) => {
  return new ZodObject2({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject2.strictCreate = (shape, params) => {
  return new ZodObject2({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject2.lazycreate = (shape, params) => {
  return new ZodObject2({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError2(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = undefined;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError2(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion2.create = (types, params) => {
  return new ZodUnion2({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral2) {
    return [type.value];
  } else if (type instanceof ZodEnum2) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault2) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull2) {
    return [null];
  } else if (type instanceof ZodOptional2) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable2) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly2) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch2) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  static create(discriminator, options, params) {
    const optionsMap = new Map;
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
}
function mergeValues2(a, b) {
  const aType = getParsedType2(a);
  const bType = getParsedType2(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues2(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues2(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection2 extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues2(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection2.create = (left, right, params) => {
  return new ZodIntersection2({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas3, params) => {
  if (!Array.isArray(schemas3)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas3,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType2 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType2) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString2.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType2 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = new Map;
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};

class ZodSet extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = new Set;
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};

class ZodFunction extends ZodType2 {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error2) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default2].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error2
        }
      });
    }
    function makeReturnsIssue(returns, error2) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default2].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error2
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error2 = new ZodError2([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error2.addIssue(makeArgsIssue(args, e));
          throw error2;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error2.addIssue(makeReturnsIssue(result, e));
          throw error2;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError2([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError2([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown2.create())
    });
  }
  returns(returnType) {
    return new ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown2.create()),
      returns: returns || ZodUnknown2.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType2 {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};

class ZodLiteral2 extends ZodType2 {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral2.create = (value, params) => {
  return new ZodLiteral2({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum2({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum2 extends ZodType2 {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum2.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum2.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum2.create = createZodEnum;

class ZodNativeEnum extends ZodType2 {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};

class ZodPromise extends ZodType2 {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};

class ZodEffects extends ZodType2 {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional2 extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional2.create = (type, params) => {
  return new ZodOptional2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable2 extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable2.create = (type, params) => {
  return new ZodNullable2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault2.create = (type, params) => {
  return new ZodDefault2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError2(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError2(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch2.create = (type, params) => {
  return new ZodCatch2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");

class ZodBranded extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}

class ZodPipeline extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}

class ZodReadonly2 extends ZodType2 {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly2.create = (type, params) => {
  return new ZodReadonly2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check2, _params = {}, fatal) {
  if (check2)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check2(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject2.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString2.create;
var numberType = ZodNumber2.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean2.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull2.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown2.create;
var neverType = ZodNever2.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray2.create;
var objectType = ZodObject2.create;
var strictObjectType = ZodObject2.strictCreate;
var unionType = ZodUnion2.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection2.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral2.create;
var enumType = ZodEnum2.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional2.create;
var nullableType = ZodNullable2.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString2.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber2.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean2.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER2 = INVALID;
// src/deployment.ts
var DEPLOYMENT_CONTRACT_VERSION = "1.0.0";
var DEPLOYMENT_SCHEMA_IDS = {
  productProjection: "hasna.product_projection.v1",
  intentSnapshot: "hasna.intent_snapshot.v1",
  verifiedSourceCandidate: "hasna.verified_source_candidate.v1",
  buildArtifact: "hasna.build_artifact.v1",
  artifactAttestation: "hasna.artifact_attestation.v1",
  environmentBinding: "hasna.environment_binding.v1",
  deploymentRequest: "hasna.deployment_request.v1",
  deploymentPlan: "hasna.deployment_plan.v1",
  deploymentApprovalDecision: "hasna.deployment_approval_decision.v1",
  deploymentAttempt: "hasna.deployment_attempt.v1",
  providerReceipt: "hasna.provider_receipt.v1",
  deploymentReceipt: "hasna.deployment_receipt.v1",
  launchEvidence: "hasna.launch_evidence.v1"
};
var DEPLOYMENT_GENERATED_ARTIFACT_ROOT = "generated/deployment/v1";
var DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
var DEPLOYMENT_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
var OPERATION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
var ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]*$/;
var GIT_SHA = /^[a-f0-9]{40}$/;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var FORBIDDEN_FIELD = /(?:^|_)(?:command|commands|script|scripts|shell|argv|environment_map|env_map|provider_request_body|raw_provider_state|terraform_state|callback_body|hook|hooks|secret_value|token_value|password|passphrase|private_key|database_url|credential_value)(?:$|_)/i;
var SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bhasna_[a-z0-9_]+\.[A-Za-z0-9._-]{12,}\b/,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i,
  /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//i,
  /\b(?:password|passphrase|api[_-]?key|access[_-]?key|token|secret)\s*[:=]\s*\S{8,}/i,
  /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:$|[^A-Za-z0-9_-])/
];
var EXECUTABLE_VALUE_PATTERNS = [
  /^#!\//,
  /^(?:ba|z|k|c|fi)?sh\s+-c\b/i,
  /^(?:sudo|curl|wget|terraform|tofu|kubectl|helm|docker|podman|aws|gcloud|az|npm|bun|node|python|ruby|perl|make)\s+/i,
  /(?:&&|\|\||\$\(|`[^`]+`|\$\{[^}]+\})/
];
function addDeploymentSafetyIssues(value, ctx, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => addDeploymentSafetyIssues(item, ctx, [...path, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
      if (FORBIDDEN_FIELD.test(normalized)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Deployment contracts cannot contain executable, raw provider, state, or secret-bearing fields",
          path: [...path, key]
        });
      }
      addDeploymentSafetyIssues(child, ctx, [...path, key]);
    }
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment contract numbers must be finite",
      path
    });
    return;
  }
  if (typeof value !== "string")
    return;
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment contracts cannot contain secret or credential values",
      path
    });
  }
  if (EXECUTABLE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment contracts cannot contain commands, scripts, or templated executable strings",
      path
    });
  }
}
function assertCanonicalDeploymentValue(value, path = "<root>") {
  if (value === undefined) {
    throw new TypeError(`Deployment canonical JSON rejects undefined at ${path}`);
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Deployment canonical JSON rejects ${typeof value} at ${path}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Deployment canonical JSON rejects non-finite numbers at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonicalDeploymentValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertCanonicalDeploymentValue(child, `${path}.${key}`);
    }
  }
}
function canonicalizeDeploymentValue(value) {
  assertCanonicalDeploymentValue(value);
  return canonicalizeTodosValue(value);
}
function stableDeploymentJson(value) {
  assertCanonicalDeploymentValue(value);
  return stableTodosJson(value);
}
function sha256DeploymentValue(value) {
  assertCanonicalDeploymentValue(value);
  return sha256TodosValue(value);
}
function sha256DeploymentText(value) {
  return sha256TodosText(value);
}
function computeDeploymentRecordDigest(value) {
  const { digest: _digest, ...unsigned } = value;
  return sha256DeploymentValue(unsigned);
}
function withDeploymentRecordDigest(value) {
  const { digest: _digest, ...unsigned } = value;
  return {
    ...unsigned,
    digest: sha256DeploymentValue(unsigned)
  };
}
function computeEnvironmentBindingEtag(id, revision) {
  return sha256DeploymentText(`${id}\x00${revision}`);
}
function uniqueBy(values, key, ctx, path, label) {
  const seen = new Set;
  values.forEach((value, index) => {
    const semanticId = key(value);
    if (seen.has(semanticId)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${label} must be unique`,
        path: [...path, index]
      });
    }
    seen.add(semanticId);
  });
}
function validateDeploymentRecord(value, ctx) {
  addDeploymentSafetyIssues(value, ctx);
  let computedDigest;
  try {
    computedDigest = computeDeploymentRecordDigest(value);
  } catch (error2) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: error2 instanceof Error ? error2.message : "Deployment record cannot be canonicalized",
      path: []
    });
    return;
  }
  if (value.digest !== computedDigest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment record digest does not match canonical content",
      path: ["digest"]
    });
  }
}
function validateChronology(first, second, ctx, path) {
  if (second && Date.parse(second) < Date.parse(first)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Timestamp must not precede the record start",
      path
    });
  }
}
function isSorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) <= 0);
}
function createDeploymentSchemas(primitives) {
  const DeploymentIdSchema = exports_external.string().regex(DEPLOYMENT_ID);
  const DeploymentNameSchema = exports_external.string().regex(DEPLOYMENT_NAME);
  const DeploymentOperationIdSchema = exports_external.string().regex(OPERATION_ID);
  const DeploymentTimestampSchema = primitives.timestamp;
  const DeploymentDigestSchema = primitives.sha256Digest;
  const DeploymentEvidenceArraySchema = exports_external.array(primitives.evidencePointer).default([]);
  const DeploymentActorArraySchema = exports_external.array(primitives.actorPointer).min(1);
  const recordBase = (schema) => ({
    schema: exports_external.literal(schema),
    id: DeploymentIdSchema,
    createdAt: DeploymentTimestampSchema,
    producer: primitives.actorPointer,
    digest: DeploymentDigestSchema
  });
  const refSchema = (schema) => exports_external.object({
    schema: exports_external.literal(schema),
    id: DeploymentIdSchema,
    digest: DeploymentDigestSchema
  }).strict();
  const revisionedRefSchema = (schema) => exports_external.object({
    schema: exports_external.literal(schema),
    id: DeploymentIdSchema,
    revision: exports_external.number().int().positive(),
    digest: DeploymentDigestSchema
  }).strict();
  const ProductProjectionRefSchema = revisionedRefSchema(DEPLOYMENT_SCHEMA_IDS.productProjection);
  const IntentSnapshotRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.intentSnapshot);
  const VerifiedSourceCandidateRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate);
  const BuildArtifactRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.buildArtifact);
  const ArtifactAttestationRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.artifactAttestation);
  const EnvironmentBindingRefSchema = revisionedRefSchema(DEPLOYMENT_SCHEMA_IDS.environmentBinding);
  const DeploymentRequestRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentRequest);
  const DeploymentPlanRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentPlan);
  const DeploymentApprovalDecisionRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision);
  const DeploymentAttemptRefSchema = revisionedRefSchema(DEPLOYMENT_SCHEMA_IDS.deploymentAttempt);
  const ProviderReceiptRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.providerReceipt);
  const DeploymentReceiptRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentReceipt);
  const ProductProjectionSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.productProjection),
    revision: exports_external.number().int().positive(),
    sourceProjectRef: primitives.resourcePointer,
    sourceRevision: exports_external.number().int().positive(),
    slug: exports_external.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: exports_external.string().trim().min(1).max(200),
    repositoryRef: primitives.resourcePointer,
    workspaceRef: primitives.resourcePointer,
    lifecycle: exports_external.enum(["draft", "active", "paused", "archived"]),
    ownerRefs: exports_external.array(primitives.actorPointer).min(1),
    projectedAt: DeploymentTimestampSchema,
    sourceEvidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.ownerRefs, (actor) => `${actor.kind}:${actor.id}`, ctx, ["ownerRefs"], "Product owner identities");
  });
  const EndpointRequirementSchema = exports_external.object({
    path: exports_external.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/),
    protocol: exports_external.enum(["http", "https"]),
    expectedStatuses: exports_external.array(exports_external.number().int().min(100).max(599)).min(1)
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.expectedStatuses, String, ctx, ["expectedStatuses"], "Endpoint statuses");
  });
  const RuntimeProcessSchema = exports_external.object({
    id: DeploymentNameSchema,
    role: exports_external.enum(["web", "worker", "cron", "migration", "scheduler"]),
    ports: exports_external.array(exports_external.number().int().min(1).max(65535)).default([]),
    liveness: EndpointRequirementSchema.optional(),
    readiness: EndpointRequirementSchema.optional(),
    version: EndpointRequirementSchema.optional(),
    resources: exports_external.object({
      cpuMillicores: exports_external.number().int().positive(),
      memoryMiB: exports_external.number().int().positive(),
      minReplicas: exports_external.number().int().nonnegative(),
      maxReplicas: exports_external.number().int().positive()
    }).strict()
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.ports, String, ctx, ["ports"], "Process ports");
    if (value.resources.maxReplicas < value.resources.minReplicas) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "maxReplicas must be greater than or equal to minReplicas",
        path: ["resources", "maxReplicas"]
      });
    }
  });
  const ServiceRequirementSchema = exports_external.object({
    id: DeploymentNameSchema,
    kind: exports_external.enum(["database", "object_storage", "queue", "cron", "worker"]),
    required: exports_external.boolean(),
    class: DeploymentNameSchema
  }).strict();
  const ConfigurationRequirementSchema = exports_external.object({
    name: exports_external.string().regex(ENVIRONMENT_KEY),
    kind: exports_external.enum(["configuration", "secret_reference"]),
    required: exports_external.boolean(),
    referenceClass: DeploymentNameSchema.optional()
  }).strict().superRefine((value, ctx) => {
    if (value.kind === "secret_reference" && !value.referenceClass) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Secret-reference requirements require an opaque reference class",
        path: ["referenceClass"]
      });
    }
  });
  const IntentSnapshotSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.intentSnapshot),
    product: ProductProjectionRefSchema,
    repositoryRef: primitives.resourcePointer,
    commitSha: exports_external.string().regex(GIT_SHA),
    treeSha: exports_external.string().regex(GIT_SHA),
    intentDocument: exports_external.object({
      path: primitives.relativeProjectPath,
      digest: DeploymentDigestSchema
    }).strict(),
    processes: exports_external.array(RuntimeProcessSchema).min(1),
    serviceRequirements: exports_external.array(ServiceRequirementSchema).default([]),
    migration: exports_external.object({
      compatibility: exports_external.enum(["none", "backward_compatible", "forward_compatible", "breaking"]),
      order: exports_external.enum(["before_workload", "after_workload", "independent"]),
      rollbackClass: DeploymentNameSchema
    }).strict(),
    accessClass: DeploymentNameSchema,
    networkClass: DeploymentNameSchema,
    backupClass: DeploymentNameSchema,
    restoreClass: DeploymentNameSchema,
    alarmClass: DeploymentNameSchema,
    rollbackClass: DeploymentNameSchema,
    configurationRequirements: exports_external.array(ConfigurationRequirementSchema).default([]),
    validationPlan: primitives.validationPlan,
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.processes, (process) => process.id, ctx, ["processes"], "Process ids");
    uniqueBy(value.serviceRequirements, (requirement) => requirement.id, ctx, ["serviceRequirements"], "Service requirement ids");
    uniqueBy(value.configurationRequirements, (requirement) => requirement.name, ctx, ["configurationRequirements"], "Configuration requirement names");
  });
  const VerificationResultSchema = exports_external.object({
    id: DeploymentNameSchema,
    kind: exports_external.enum(["review", "test", "policy", "source_integrity"]),
    status: exports_external.enum(["passed", "failed", "not_run"]),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict();
  const VerifiedSourceCandidateSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate),
    status: exports_external.enum(["candidate", "verified", "rejected", "superseded"]),
    repositoryRef: primitives.resourcePointer,
    commitSha: exports_external.string().regex(GIT_SHA),
    treeSha: exports_external.string().regex(GIT_SHA),
    branchRef: primitives.resourcePointer.optional(),
    pullRequestRef: primitives.resourcePointer.optional(),
    intent: IntentSnapshotRefSchema,
    validationPlan: primitives.validationPlan,
    verificationRun: primitives.workRun,
    results: exports_external.array(VerificationResultSchema).min(1),
    verifiers: DeploymentActorArraySchema,
    verifiedAt: DeploymentTimestampSchema,
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.results, (result) => result.id, ctx, ["results"], "Verification result ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Verifier identities");
    if (value.status === "verified" && value.results.some((result) => result.status !== "passed")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Verified source candidates require every declared result to pass",
        path: ["results"]
      });
    }
  });
  const BuildArtifactSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.buildArtifact),
    kind: exports_external.enum(["oci_image", "archive", "binary"]),
    mediaType: exports_external.string().trim().min(1).max(160),
    uri: primitives.uri,
    artifactDigest: DeploymentDigestSchema,
    sourceCandidate: VerifiedSourceCandidateRefSchema,
    repositoryCommitSha: exports_external.string().regex(GIT_SHA),
    repositoryTreeSha: exports_external.string().regex(GIT_SHA),
    buildWorkflowRef: primitives.resourcePointer,
    buildRun: primitives.workRun,
    builder: primitives.actorPointer,
    sbomRefs: DeploymentEvidenceArraySchema,
    provenanceRefs: DeploymentEvidenceArraySchema,
    scanRefs: DeploymentEvidenceArraySchema,
    signatureRefs: DeploymentEvidenceArraySchema,
    status: exports_external.enum(["active", "superseded", "revoked"])
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    if (value.buildRun.status !== "succeeded") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Build artifacts require a succeeded build run",
        path: ["buildRun", "status"]
      });
    }
  });
  const ArtifactAttestationSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.artifactAttestation),
    artifact: BuildArtifactRefSchema,
    artifactDigest: DeploymentDigestSchema,
    predicateKind: DeploymentNameSchema,
    predicateSchemaVersion: exports_external.string().regex(/^v?[0-9]+(?:\.[0-9]+){0,2}$/),
    issuer: primitives.actorPointer,
    keyRef: primitives.resourcePointer,
    signatureRef: primitives.evidencePointer,
    policyResult: exports_external.enum(["passed", "failed"]),
    policyRevision: exports_external.number().int().positive(),
    expiresAt: DeploymentTimestampSchema.nullable().optional(),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.createdAt, value.expiresAt, ctx, ["expiresAt"]);
  });
  const ProviderIdentitySchema = exports_external.object({
    accountId: DeploymentIdSchema,
    region: DeploymentNameSchema,
    projectId: DeploymentIdSchema.optional(),
    clusterId: DeploymentIdSchema.optional(),
    networkId: DeploymentIdSchema.optional(),
    storageId: DeploymentIdSchema.optional(),
    routingId: DeploymentIdSchema.optional()
  }).strict().superRefine((value, ctx) => {
    for (const [key, identity] of Object.entries(value)) {
      if (identity && UUID.test(identity)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provider identity must use provider-issued stable identifiers, not mutable local UUIDs",
          path: [key]
        });
      }
    }
  });
  const EnvironmentBindingSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.environmentBinding),
    updatedAt: DeploymentTimestampSchema,
    revision: exports_external.number().int().positive(),
    etag: DeploymentDigestSchema,
    product: ProductProjectionRefSchema,
    intent: IntentSnapshotRefSchema,
    environment: exports_external.object({
      id: DeploymentNameSchema,
      classification: exports_external.enum(["development", "staging", "production", "disaster_recovery"])
    }).strict(),
    dataBackend: exports_external.enum(["sqlite", "postgresql"]),
    providerConnectionRef: primitives.resourcePointer,
    providerCapabilityCard: primitives.providerCapabilityCard,
    providerCapabilityDigest: DeploymentDigestSchema,
    providerIdentity: ProviderIdentitySchema,
    policyProfile: DeploymentNameSchema,
    authorizationProfile: DeploymentNameSchema,
    dataClassification: exports_external.enum(["public", "internal", "private", "sensitive"]),
    backupProfile: DeploymentNameSchema,
    rollbackProfile: DeploymentNameSchema,
    commercialBindingRef: primitives.resourcePointer.optional(),
    writer: primitives.actorPointer,
    changeEvidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    if (value.providerCapabilityDigest !== sha256DeploymentValue(value.providerCapabilityCard)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Provider capability digest does not match the pinned capability card",
        path: ["providerCapabilityDigest"]
      });
    }
    if (value.etag !== computeEnvironmentBindingEtag(value.id, value.revision)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Environment ETag does not match id and revision",
        path: ["etag"]
      });
    }
    validateChronology(value.createdAt, value.updatedAt, ctx, ["updatedAt"]);
  });
  const DeploymentRequestKindSchema = exports_external.enum([
    "deployment",
    "promotion",
    "rollback",
    "reconciliation"
  ]);
  const DeploymentRequestSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentRequest),
    kind: DeploymentRequestKindSchema,
    requester: primitives.actorPointer,
    product: ProductProjectionRefSchema,
    environment: EnvironmentBindingRefSchema,
    intent: IntentSnapshotRefSchema,
    artifact: BuildArtifactRefSchema.optional(),
    attestations: exports_external.array(ArtifactAttestationRefSchema).default([]),
    priorReceipt: DeploymentReceiptRefSchema.optional(),
    policyProfile: DeploymentNameSchema,
    idempotencyKeyFingerprint: DeploymentDigestSchema,
    requestAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema.nullable().optional(),
    sourceRequestId: DeploymentIdSchema,
    auditCorrelationId: DeploymentIdSchema,
    costEstimate: primitives.costEstimate.optional(),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.attestations, (ref) => `${ref.id}:${ref.digest}`, ctx, ["attestations"], "Attestation references");
    validateChronology(value.requestAt, value.expiresAt, ctx, ["expiresAt"]);
    if (value.kind === "deployment" && !value.artifact) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Deployment requests require an immutable build artifact",
        path: ["artifact"]
      });
    }
    if ((value.kind === "promotion" || value.kind === "rollback") && !value.priorReceipt) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Promotion and rollback requests require an immutable prior receipt",
        path: ["priorReceipt"]
      });
    }
  });
  const DeploymentInputRefSchema = exports_external.object({
    schema: primitives.schemaId,
    id: DeploymentIdSchema,
    revision: exports_external.number().int().positive().optional(),
    digest: DeploymentDigestSchema
  }).strict();
  const DeploymentActionSchema = exports_external.object({
    id: DeploymentNameSchema,
    operationId: DeploymentOperationIdSchema,
    operationVersion: exports_external.number().int().positive(),
    dependsOn: exports_external.array(DeploymentNameSchema).default([]),
    inputs: exports_external.array(DeploymentInputRefSchema).default([]),
    outputSchema: primitives.schemaId,
    preconditions: exports_external.array(DeploymentNameSchema).default([]),
    postconditions: exports_external.array(DeploymentNameSchema).default([]),
    lockClass: DeploymentNameSchema,
    fencingRequired: exports_external.boolean(),
    sideEffectClass: primitives.providerSideEffectClass,
    riskClass: exports_external.enum(["low", "medium", "high", "critical"]),
    approvalScope: exports_external.enum(["none", "plan", "action", "phase"]),
    runtimeMaterialKind: DeploymentNameSchema.nullable(),
    providerOperation: DeploymentOperationIdSchema.nullable(),
    providerCapabilityDigest: DeploymentDigestSchema.nullable(),
    retryClass: exports_external.enum(["none", "safe", "reconcile_first"]),
    maxAttempts: exports_external.number().int().positive().max(20),
    timeoutClass: DeploymentNameSchema,
    compensationOperationId: DeploymentOperationIdSchema.nullable(),
    idempotencyRequired: exports_external.boolean(),
    reconciliationRequired: exports_external.boolean(),
    evidenceRequirements: exports_external.array(DeploymentNameSchema).min(1)
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.dependsOn, String, ctx, ["dependsOn"], "Action dependency ids");
    uniqueBy(value.inputs, (input) => `${input.schema}:${input.id}`, ctx, ["inputs"], "Action input identities");
    if (Boolean(value.providerOperation) !== Boolean(value.providerCapabilityDigest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Provider actions require both operation and capability digest",
        path: value.providerOperation ? ["providerCapabilityDigest"] : ["providerOperation"]
      });
    }
    if (value.sideEffectClass !== "none" && value.sideEffectClass !== "read_only") {
      if (!value.idempotencyRequired) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Side-effecting actions require idempotency",
          path: ["idempotencyRequired"]
        });
      }
      if (!value.reconciliationRequired) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Side-effecting actions require reconciliation",
          path: ["reconciliationRequired"]
        });
      }
      if (!value.compensationOperationId) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Side-effecting actions require compensation or rollback",
          path: ["compensationOperationId"]
        });
      }
    }
    if (value.runtimeMaterialKind && value.approvalScope !== "phase") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Runtime execution material requires phase-scoped approval",
        path: ["approvalScope"]
      });
    }
  });
  const DeploymentPlanSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentPlan),
    kind: DeploymentRequestKindSchema,
    request: DeploymentRequestRefSchema,
    compiler: exports_external.object({
      actor: primitives.actorPointer,
      version: exports_external.string().trim().min(1),
      contractKitVersion: exports_external.literal(DEPLOYMENT_CONTRACT_VERSION)
    }).strict(),
    inputs: exports_external.array(DeploymentInputRefSchema).min(1),
    providerCapabilityDigests: exports_external.array(DeploymentDigestSchema).default([]),
    actions: exports_external.array(DeploymentActionSchema).min(1),
    authorizationRequirements: exports_external.array(DeploymentNameSchema).default([]),
    policyRequirements: exports_external.array(DeploymentNameSchema).default([]),
    riskClass: exports_external.enum(["low", "medium", "high", "critical"]),
    evidenceRequirements: exports_external.array(DeploymentNameSchema).min(1),
    expectedStateDigest: DeploymentDigestSchema,
    verificationCriteria: exports_external.array(DeploymentNameSchema).min(1),
    rollbackTarget: DeploymentReceiptRefSchema.optional(),
    rollbackInputs: exports_external.array(DeploymentInputRefSchema).default([]),
    estimatedCost: primitives.costEstimate.optional(),
    issuedAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.issuedAt, value.expiresAt, ctx, ["expiresAt"]);
    uniqueBy(value.inputs, (input) => `${input.schema}:${input.id}`, ctx, ["inputs"], "Plan input identities");
    uniqueBy(value.actions, (action) => action.id, ctx, ["actions"], "Action ids");
    uniqueBy(value.providerCapabilityDigests, String, ctx, ["providerCapabilityDigests"], "Provider capability digests");
    if (!isSorted(value.actions.map((action) => action.id))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Plan actions must use deterministic lexicographic order",
        path: ["actions"]
      });
    }
    const actionIds = new Set(value.actions.map((action) => action.id));
    const visited = new Set;
    value.actions.forEach((action, index) => {
      for (const dependency of action.dependsOn) {
        if (!actionIds.has(dependency)) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Action dependency must resolve inside the same plan",
            path: ["actions", index, "dependsOn"]
          });
        } else if (!visited.has(dependency)) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Action dependencies must precede dependants in deterministic order",
            path: ["actions", index, "dependsOn"]
          });
        }
      }
      visited.add(action.id);
    });
  });
  const RuntimeMaterialBindingSchema = exports_external.object({
    kind: DeploymentNameSchema,
    digest: DeploymentDigestSchema,
    stateLineage: DeploymentIdSchema,
    preActionStateSerial: exports_external.number().int().nonnegative()
  }).strict();
  const DeploymentApprovalDecisionSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision),
    decision: primitives.decisionEnvelope,
    plan: DeploymentPlanRefSchema,
    scope: exports_external.enum(["plan", "action", "phase"]),
    actionId: DeploymentNameSchema.nullable(),
    phaseId: DeploymentNameSchema.nullable(),
    runtimeMaterial: RuntimeMaterialBindingSchema.nullable(),
    boundInputDigests: exports_external.array(exports_external.object({
      kind: DeploymentNameSchema,
      digest: DeploymentDigestSchema
    }).strict()).min(1),
    environment: EnvironmentBindingRefSchema,
    actorRole: exports_external.enum(["requester", "planner", "approver", "executor", "auditor", "administrator"]),
    attemptScope: exports_external.object({
      minimum: exports_external.number().int().positive(),
      maximum: exports_external.number().int().positive()
    }).strict(),
    unchangedRetryPolicy: exports_external.enum(["allowed", "denied"]),
    issuedAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema,
    separationOfDutiesPassed: exports_external.boolean(),
    authorizationPolicyRevision: exports_external.number().int().positive(),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.issuedAt, value.expiresAt, ctx, ["expiresAt"]);
    uniqueBy(value.boundInputDigests, (binding) => binding.kind, ctx, ["boundInputDigests"], "Bound input kinds");
    if (value.decision.decisionType !== "approval") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Deployment approval decisions must compose an approval DecisionEnvelope",
        path: ["decision", "decisionType"]
      });
    }
    if (value.attemptScope.maximum < value.attemptScope.minimum) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Attempt scope maximum must be greater than or equal to minimum",
        path: ["attemptScope", "maximum"]
      });
    }
    if (value.scope === "plan" && (value.actionId || value.phaseId || value.runtimeMaterial)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Plan-scoped decisions cannot bind action, phase, or runtime material",
        path: ["scope"]
      });
    }
    if (value.scope === "action" && (!value.actionId || value.phaseId || value.runtimeMaterial)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Action-scoped decisions require only an action id",
        path: ["actionId"]
      });
    }
    if (value.scope === "phase" && (!value.actionId || !value.phaseId || !value.runtimeMaterial)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Phase-scoped decisions require action, phase, and runtime material bindings",
        path: ["runtimeMaterial"]
      });
    }
    if (value.decision.status === "allowed" && !value.separationOfDutiesPassed) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Allowed deployment decisions require separation-of-duties evaluation to pass",
        path: ["separationOfDutiesPassed"]
      });
    }
  });
  const AttemptApprovalRefSchema = exports_external.object({
    decision: DeploymentApprovalDecisionRefSchema,
    scope: exports_external.enum(["plan", "action", "phase"]),
    actionId: DeploymentNameSchema.nullable(),
    phaseId: DeploymentNameSchema.nullable(),
    runtimeMaterialDigest: DeploymentDigestSchema.nullable()
  }).strict();
  const AttemptActionStepSchema = exports_external.object({
    sequence: exports_external.number().int().positive(),
    actionId: DeploymentNameSchema,
    state: exports_external.enum(["pending", "running", "succeeded", "failed", "cancelled", "unknown_outcome"]),
    providerCorrelationId: DeploymentIdSchema.nullable(),
    startedAt: DeploymentTimestampSchema.nullable(),
    finishedAt: DeploymentTimestampSchema.nullable(),
    evidenceRefs: DeploymentEvidenceArraySchema
  }).strict().superRefine((value, ctx) => {
    if (value.finishedAt && !value.startedAt) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Finished action steps require a start timestamp",
        path: ["startedAt"]
      });
    }
    if (value.startedAt) {
      validateChronology(value.startedAt, value.finishedAt, ctx, ["finishedAt"]);
    }
  });
  const DeploymentAttemptSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentAttempt),
    updatedAt: DeploymentTimestampSchema,
    revision: exports_external.number().int().positive(),
    plan: DeploymentPlanRefSchema,
    approvals: exports_external.array(AttemptApprovalRefSchema).min(1),
    requester: primitives.actorPointer,
    decisionActors: DeploymentActorArraySchema,
    executorActors: DeploymentActorArraySchema,
    environmentLock: exports_external.object({
      id: DeploymentIdSchema,
      fencingToken: exports_external.number().int().positive()
    }).strict(),
    attemptNumber: exports_external.number().int().positive(),
    retryOf: DeploymentAttemptRefSchema.nullable(),
    state: exports_external.enum(["queued", "running", "reconciling", "unknown_outcome", "succeeded", "failed", "cancelled"]),
    actionSteps: exports_external.array(AttemptActionStepSchema).min(1),
    outboxCorrelationRef: primitives.resourcePointer,
    inboxCorrelationRef: primitives.resourcePointer,
    failureReason: exports_external.string().trim().min(1).nullable(),
    evidenceRefs: DeploymentEvidenceArraySchema,
    providerReceipts: exports_external.array(ProviderReceiptRefSchema).default([]),
    finalReceipt: DeploymentReceiptRefSchema.nullable()
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.createdAt, value.updatedAt, ctx, ["updatedAt"]);
    uniqueBy(value.approvals, (approval) => approval.decision.id, ctx, ["approvals"], "Approval decision ids");
    uniqueBy(value.decisionActors, (actor) => `${actor.kind}:${actor.id}`, ctx, ["decisionActors"], "Decision actor identities");
    uniqueBy(value.executorActors, (actor) => `${actor.kind}:${actor.id}`, ctx, ["executorActors"], "Executor actor identities");
    uniqueBy(value.actionSteps, (step) => step.actionId, ctx, ["actionSteps"], "Attempt action ids");
    uniqueBy(value.actionSteps, (step) => String(step.sequence), ctx, ["actionSteps"], "Attempt action sequences");
    if (!isSorted(value.actionSteps.map((step) => String(step.sequence).padStart(10, "0")))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Attempt action steps must be in ascending sequence order",
        path: ["actionSteps"]
      });
    }
    if ((value.state === "failed" || value.state === "cancelled" || value.state === "unknown_outcome") && !value.failureReason) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Failed, cancelled, and unknown-outcome attempts require a reason",
        path: ["failureReason"]
      });
    }
    if (value.state !== "succeeded" && value.finalReceipt) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Only succeeded attempts may bind a final deployment receipt",
        path: ["finalReceipt"]
      });
    }
  });
  const ProviderReceiptSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.providerReceipt),
    attempt: DeploymentAttemptRefSchema,
    provider: DeploymentNameSchema,
    adapter: DeploymentNameSchema,
    connectionRef: primitives.resourcePointer,
    capabilityDigest: DeploymentDigestSchema,
    operationId: DeploymentOperationIdSchema,
    operationVersion: exports_external.number().int().positive(),
    providerIdentity: exports_external.object({
      projectId: DeploymentIdSchema.nullable(),
      operationId: DeploymentIdSchema,
      deploymentId: DeploymentIdSchema.nullable(),
      resourceIds: exports_external.array(DeploymentIdSchema).default([]),
      eventId: DeploymentIdSchema.nullable()
    }).strict(),
    requestFingerprint: DeploymentDigestSchema,
    providerStatus: DeploymentNameSchema,
    normalizedResult: exports_external.enum(["accepted", "succeeded", "failed", "cancelled", "unknown"]),
    observedProviderRevision: DeploymentIdSchema.nullable(),
    observedAt: DeploymentTimestampSchema,
    retryClass: exports_external.enum(["none", "safe", "reconcile_first"]),
    reconciliationState: exports_external.enum(["not_required", "pending", "confirmed", "diverged"]),
    unknownOutcome: exports_external.boolean(),
    redaction: exports_external.enum(["none", "partial", "full"]),
    responseEvidenceRefs: exports_external.array(primitives.evidencePointer).min(1),
    observationEvidenceRefs: DeploymentEvidenceArraySchema
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    const providerIds = [
      value.providerIdentity.projectId,
      value.providerIdentity.operationId,
      value.providerIdentity.deploymentId,
      value.providerIdentity.eventId,
      ...value.providerIdentity.resourceIds
    ].filter((identity) => Boolean(identity));
    providerIds.forEach((identity, index) => {
      if (UUID.test(identity)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provider receipts require provider-issued identities, not mutable local UUIDs",
          path: ["providerIdentity", index]
        });
      }
    });
    uniqueBy(value.providerIdentity.resourceIds, String, ctx, ["providerIdentity", "resourceIds"], "Provider resource ids");
    if (value.normalizedResult === "succeeded" && value.observationEvidenceRefs.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Provider success requires later observation evidence",
        path: ["observationEvidenceRefs"]
      });
    }
    if (value.unknownOutcome !== (value.normalizedResult === "unknown")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "unknownOutcome must agree with normalizedResult",
        path: ["unknownOutcome"]
      });
    }
  });
  const VerificationCheckSchema = exports_external.object({
    id: DeploymentNameSchema,
    kind: exports_external.enum(["health", "readiness", "version", "migration", "alarm", "access", "restore", "rollback", "security", "contract"]),
    status: exports_external.enum(["passed", "failed", "missing", "expired", "blocked"]),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict();
  const DeploymentReceiptSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentReceipt),
    request: DeploymentRequestRefSchema,
    plan: DeploymentPlanRefSchema,
    approvals: exports_external.array(DeploymentApprovalDecisionRefSchema).min(1),
    attempt: DeploymentAttemptRefSchema,
    product: ProductProjectionRefSchema,
    intent: IntentSnapshotRefSchema,
    artifact: BuildArtifactRefSchema,
    attestations: exports_external.array(ArtifactAttestationRefSchema).min(1),
    environment: EnvironmentBindingRefSchema,
    providerReceipts: exports_external.array(ProviderReceiptRefSchema).min(1),
    desiredStateDigest: DeploymentDigestSchema,
    observedStateDigest: DeploymentDigestSchema,
    verification: exports_external.array(VerificationCheckSchema).min(1),
    infrastructurePlanRef: primitives.evidencePointer.optional(),
    infrastructureStateLineageRef: primitives.resourcePointer.optional(),
    rollbackTarget: DeploymentReceiptRefSchema.optional(),
    verifiers: DeploymentActorArraySchema,
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1),
    outcome: exports_external.enum(["succeeded", "failed", "cancelled", "unknown_outcome"])
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.approvals, (approval) => approval.id, ctx, ["approvals"], "Receipt approval ids");
    uniqueBy(value.attestations, (attestation) => attestation.id, ctx, ["attestations"], "Receipt attestation ids");
    uniqueBy(value.providerReceipts, (receipt) => receipt.id, ctx, ["providerReceipts"], "Provider receipt ids");
    uniqueBy(value.verification, (check2) => check2.id, ctx, ["verification"], "Verification check ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Receipt verifier identities");
    if (value.outcome === "succeeded" && value.verification.some((check2) => check2.status !== "passed")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Succeeded deployment receipts require every verification check to pass",
        path: ["verification"]
      });
    }
  });
  const LaunchFindingSchema = exports_external.object({
    id: DeploymentNameSchema,
    severity: exports_external.enum(["p0", "p1", "p2", "p3"]),
    status: exports_external.enum(["open", "resolved", "accepted"]),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict();
  const LaunchEvidenceSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.launchEvidence),
    product: ProductProjectionRefSchema,
    environment: EnvironmentBindingRefSchema,
    deploymentReceipt: DeploymentReceiptRefSchema,
    requiredChecks: exports_external.array(VerificationCheckSchema).min(1),
    proofBundleRefs: exports_external.array(primitives.resourcePointer).min(1),
    findings: exports_external.array(LaunchFindingSchema).default([]),
    verifiers: DeploymentActorArraySchema,
    independentReview: exports_external.boolean(),
    status: exports_external.enum(["candidate", "blocked", "ready", "launched", "rolled_back"]),
    compiledAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.requiredChecks, (check2) => check2.id, ctx, ["requiredChecks"], "Launch check ids");
    uniqueBy(value.findings, (finding) => finding.id, ctx, ["findings"], "Launch finding ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Launch verifier identities");
    validateChronology(value.compiledAt, value.expiresAt, ctx, ["expiresAt"]);
    if ((value.status === "ready" || value.status === "launched") && (value.requiredChecks.some((check2) => check2.status !== "passed") || value.findings.some((finding) => (finding.severity === "p0" || finding.severity === "p1") && finding.status === "open") || !value.independentReview)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Ready and launched evidence requires passing checks, no open P0/P1 findings, and independent review",
        path: ["status"]
      });
    }
  });
  const DeploymentSchemaRegistry = Object.freeze({
    [DEPLOYMENT_SCHEMA_IDS.productProjection]: ProductProjectionSchema,
    [DEPLOYMENT_SCHEMA_IDS.intentSnapshot]: IntentSnapshotSchema,
    [DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate]: VerifiedSourceCandidateSchema,
    [DEPLOYMENT_SCHEMA_IDS.buildArtifact]: BuildArtifactSchema,
    [DEPLOYMENT_SCHEMA_IDS.artifactAttestation]: ArtifactAttestationSchema,
    [DEPLOYMENT_SCHEMA_IDS.environmentBinding]: EnvironmentBindingSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentRequest]: DeploymentRequestSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentPlan]: DeploymentPlanSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision]: DeploymentApprovalDecisionSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentAttempt]: DeploymentAttemptSchema,
    [DEPLOYMENT_SCHEMA_IDS.providerReceipt]: ProviderReceiptSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentReceipt]: DeploymentReceiptSchema,
    [DEPLOYMENT_SCHEMA_IDS.launchEvidence]: LaunchEvidenceSchema
  });
  return {
    ProductProjectionRefSchema,
    IntentSnapshotRefSchema,
    VerifiedSourceCandidateRefSchema,
    BuildArtifactRefSchema,
    ArtifactAttestationRefSchema,
    EnvironmentBindingRefSchema,
    DeploymentRequestRefSchema,
    DeploymentPlanRefSchema,
    DeploymentApprovalDecisionRefSchema,
    DeploymentAttemptRefSchema,
    ProviderReceiptRefSchema,
    DeploymentReceiptRefSchema,
    ProductProjectionSchema,
    IntentSnapshotSchema,
    VerifiedSourceCandidateSchema,
    BuildArtifactSchema,
    ArtifactAttestationSchema,
    EnvironmentBindingSchema,
    DeploymentRequestSchema,
    DeploymentActionSchema,
    DeploymentPlanSchema,
    DeploymentApprovalDecisionSchema,
    DeploymentAttemptSchema,
    ProviderReceiptSchema,
    DeploymentReceiptSchema,
    LaunchEvidenceSchema,
    DeploymentSchemaRegistry
  };
}
function sameDeploymentReference(left, right) {
  return left.schema === right.schema && left.id === right.id && left.digest === right.digest && left.revision === right.revision;
}
function sameDeploymentReferenceSet(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const referenceKey = (reference) => [
    reference.schema,
    reference.id,
    reference.revision ?? "",
    reference.digest
  ].join("\x00");
  const leftKeys = left.map(referenceKey).sort();
  const rightKeys = right.map(referenceKey).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
}
function linkedRecordMap(records, label, issues) {
  const result = new Map;
  for (const record of records) {
    if (result.has(record.id)) {
      issues.push(`${label}: duplicate semantic id ${record.id}`);
      continue;
    }
    result.set(record.id, record);
  }
  return result;
}
function requireLinkedRecord(reference, records, path, issues) {
  const target = records.get(reference.id);
  if (!target) {
    issues.push(`${path}: missing linked record ${reference.id}`);
    return;
  }
  if (target.digest !== reference.digest) {
    issues.push(`${path}: digest mismatch`);
  }
  if (reference.revision !== undefined && target.revision !== reference.revision) {
    issues.push(`${path}: revision mismatch`);
  }
}
function deploymentRecordKey(reference) {
  return `${reference.schema}\x00${reference.id}`;
}
function requireLinkedDeploymentRecord(reference, records, path, issues) {
  const target = records.get(deploymentRecordKey(reference));
  if (!target) {
    issues.push(`${path}: missing linked record ${reference.id}`);
    return;
  }
  if (target.digest !== reference.digest) {
    issues.push(`${path}: digest mismatch`);
  }
  if (reference.revision !== undefined && target.revision !== reference.revision) {
    issues.push(`${path}: revision mismatch`);
  }
}
function validateDeploymentContractSet(schemas3, input) {
  const issues = [];
  const parseMany = (name, schema) => input[name].flatMap((value, index) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      for (const issue2 of parsed.error.issues) {
        issues.push(`${String(name)}.${index}.${issue2.path.join(".")}: ${issue2.message}`);
      }
      return [];
    }
    return [parsed.data];
  });
  const products = parseMany("productProjections", schemas3.ProductProjectionSchema);
  const intents = parseMany("intentSnapshots", schemas3.IntentSnapshotSchema);
  const candidates = parseMany("verifiedSourceCandidates", schemas3.VerifiedSourceCandidateSchema);
  const artifacts = parseMany("buildArtifacts", schemas3.BuildArtifactSchema);
  const attestations = parseMany("artifactAttestations", schemas3.ArtifactAttestationSchema);
  const environments = parseMany("environmentBindings", schemas3.EnvironmentBindingSchema);
  const requests = parseMany("deploymentRequests", schemas3.DeploymentRequestSchema);
  const plans = parseMany("deploymentPlans", schemas3.DeploymentPlanSchema);
  const approvals = parseMany("deploymentApprovalDecisions", schemas3.DeploymentApprovalDecisionSchema);
  const attempts = parseMany("deploymentAttempts", schemas3.DeploymentAttemptSchema);
  const providerReceipts = parseMany("providerReceipts", schemas3.ProviderReceiptSchema);
  const receipts = parseMany("deploymentReceipts", schemas3.DeploymentReceiptSchema);
  const launches = parseMany("launchEvidence", schemas3.LaunchEvidenceSchema);
  const productMap = linkedRecordMap(products, "productProjections", issues);
  const intentMap = linkedRecordMap(intents, "intentSnapshots", issues);
  const candidateMap = linkedRecordMap(candidates, "verifiedSourceCandidates", issues);
  const artifactMap = linkedRecordMap(artifacts, "buildArtifacts", issues);
  const attestationMap = linkedRecordMap(attestations, "artifactAttestations", issues);
  const environmentMap = linkedRecordMap(environments, "environmentBindings", issues);
  const requestMap = linkedRecordMap(requests, "deploymentRequests", issues);
  const planMap = linkedRecordMap(plans, "deploymentPlans", issues);
  const approvalMap = linkedRecordMap(approvals, "deploymentApprovalDecisions", issues);
  const attemptMap = linkedRecordMap(attempts, "deploymentAttempts", issues);
  const providerReceiptMap = linkedRecordMap(providerReceipts, "providerReceipts", issues);
  const receiptMap = linkedRecordMap(receipts, "deploymentReceipts", issues);
  linkedRecordMap(launches, "launchEvidence", issues);
  const deploymentRecordMap = new Map;
  for (const record of [
    ...products,
    ...intents,
    ...candidates,
    ...artifacts,
    ...attestations,
    ...environments,
    ...requests,
    ...plans,
    ...approvals,
    ...attempts,
    ...providerReceipts,
    ...receipts,
    ...launches
  ]) {
    deploymentRecordMap.set(deploymentRecordKey(record), record);
  }
  intents.forEach((intent) => requireLinkedRecord(intent.product, productMap, `intentSnapshots.${intent.id}.product`, issues));
  candidates.forEach((candidate) => requireLinkedRecord(candidate.intent, intentMap, `verifiedSourceCandidates.${candidate.id}.intent`, issues));
  artifacts.forEach((artifact) => {
    requireLinkedRecord(artifact.sourceCandidate, candidateMap, `buildArtifacts.${artifact.id}.sourceCandidate`, issues);
    const candidate = candidateMap.get(artifact.sourceCandidate.id);
    if (artifact.status === "active" && candidate && candidate.status !== "verified") {
      issues.push(`buildArtifacts.${artifact.id}.sourceCandidate: active artifacts require a verified source candidate`);
    }
  });
  attestations.forEach((attestation) => {
    requireLinkedRecord(attestation.artifact, artifactMap, `artifactAttestations.${attestation.id}.artifact`, issues);
    const artifact = artifactMap.get(attestation.artifact.id);
    if (artifact && "artifactDigest" in artifact && artifact.artifactDigest !== attestation.artifactDigest) {
      issues.push(`artifactAttestations.${attestation.id}.artifactDigest: digest mismatch`);
    }
  });
  environments.forEach((environment) => {
    requireLinkedRecord(environment.product, productMap, `environmentBindings.${environment.id}.product`, issues);
    requireLinkedRecord(environment.intent, intentMap, `environmentBindings.${environment.id}.intent`, issues);
  });
  requests.forEach((request) => {
    requireLinkedRecord(request.product, productMap, `deploymentRequests.${request.id}.product`, issues);
    requireLinkedRecord(request.environment, environmentMap, `deploymentRequests.${request.id}.environment`, issues);
    requireLinkedRecord(request.intent, intentMap, `deploymentRequests.${request.id}.intent`, issues);
    if (request.artifact) {
      requireLinkedRecord(request.artifact, artifactMap, `deploymentRequests.${request.id}.artifact`, issues);
    }
    request.attestations.forEach((attestation, index) => requireLinkedRecord(attestation, attestationMap, `deploymentRequests.${request.id}.attestations.${index}`, issues));
    if (request.priorReceipt) {
      requireLinkedRecord(request.priorReceipt, receiptMap, `deploymentRequests.${request.id}.priorReceipt`, issues);
    }
  });
  plans.forEach((plan) => {
    requireLinkedRecord(plan.request, requestMap, `deploymentPlans.${plan.id}.request`, issues);
    plan.actions.forEach((action, actionIndex) => action.inputs.forEach((input2, inputIndex) => requireLinkedDeploymentRecord(input2, deploymentRecordMap, `deploymentPlans.${plan.id}.actions.${actionIndex}.inputs.${inputIndex}`, issues)));
    const request = requestMap.get(plan.request.id);
    if (!request) {
      return;
    }
    const pinnedRequestInputs = [
      request.product,
      request.environment,
      request.intent,
      ...request.artifact ? [request.artifact] : [],
      ...request.priorReceipt ? [request.priorReceipt] : []
    ];
    if (!sameDeploymentReferenceSet(plan.inputs, pinnedRequestInputs)) {
      issues.push(`deploymentPlans.${plan.id}.inputs: input set does not exactly match linked request ${request.id}`);
    }
  });
  approvals.forEach((approval) => {
    requireLinkedRecord(approval.plan, planMap, `deploymentApprovalDecisions.${approval.id}.plan`, issues);
    const plan = planMap.get(approval.plan.id);
    if (!plan) {
      return;
    }
    const request = requestMap.get(plan.request.id);
    const planBoundDigests = new Set([
      plan.digest,
      plan.request.digest,
      ...plan.inputs.map((input2) => input2.digest),
      ...plan.rollbackInputs.map((input2) => input2.digest),
      ...plan.providerCapabilityDigests,
      ...request?.attestations.map((attestation) => attestation.digest) ?? []
    ]);
    const expectedDigestByKind = new Map([
      ["plan", plan.digest],
      ["request", plan.request.digest],
      ...request ? [
        ["product", request.product.digest],
        ["environment", request.environment.digest],
        ["intent", request.intent.digest],
        ...request.artifact ? [["artifact", request.artifact.digest]] : [],
        ...request.priorReceipt ? [["prior-receipt", request.priorReceipt.digest]] : []
      ] : []
    ]);
    approval.boundInputDigests.forEach((binding, index) => {
      const expectedDigest = expectedDigestByKind.get(binding.kind);
      if (expectedDigest && binding.digest !== expectedDigest) {
        issues.push(`deploymentApprovalDecisions.${approval.id}.boundInputDigests.${index}: ${binding.kind} digest does not match linked plan lineage`);
      } else if (!expectedDigest && !planBoundDigests.has(binding.digest)) {
        issues.push(`deploymentApprovalDecisions.${approval.id}.boundInputDigests.${index}: digest is not bound by linked plan ${plan.id}`);
      }
    });
    const boundKinds = new Set(approval.boundInputDigests.map((binding) => binding.kind));
    for (const requiredKind of ["plan", "request", "intent"]) {
      if (!boundKinds.has(requiredKind)) {
        issues.push(`deploymentApprovalDecisions.${approval.id}.boundInputDigests: missing required ${requiredKind} binding`);
      }
    }
  });
  attempts.forEach((attempt) => {
    requireLinkedRecord(attempt.plan, planMap, `deploymentAttempts.${attempt.id}.plan`, issues);
    const plan = planMap.get(attempt.plan.id);
    const request = plan ? requestMap.get(plan.request.id) : undefined;
    const linkedApprovalActorKeys = new Set;
    let linkedApprovalCount = 0;
    let linkedApprovalActorCount = 0;
    attempt.approvals.forEach((approval, index) => {
      const approvalPath = `deploymentAttempts.${attempt.id}.approvals.${index}`;
      requireLinkedRecord(approval.decision, approvalMap, approvalPath, issues);
      const linkedApproval = approvalMap.get(approval.decision.id);
      if (!linkedApproval) {
        return;
      }
      linkedApprovalCount += 1;
      if (linkedApproval.decision.actor) {
        linkedApprovalActorCount += 1;
        linkedApprovalActorKeys.add(`${linkedApproval.decision.actor.kind}:${linkedApproval.decision.actor.id}`);
      } else {
        issues.push(`${approvalPath}.decision: linked approval decision is missing an actor`);
      }
      if (linkedApproval.decision.status !== "allowed") {
        issues.push(`${approvalPath}.decision: linked approval decision is not allowed`);
      }
      if (Date.parse(linkedApproval.expiresAt) <= Date.parse(attempt.createdAt)) {
        issues.push(`${approvalPath}.decision: linked approval expired before the attempt`);
      }
      if (request && !sameDeploymentReference(linkedApproval.environment, request.environment)) {
        issues.push(`${approvalPath}.decision: linked approval environment does not match plan request environment`);
      }
      if (attempt.attemptNumber < linkedApproval.attemptScope.minimum || attempt.attemptNumber > linkedApproval.attemptScope.maximum) {
        issues.push(`${approvalPath}.decision: attempt number is outside linked approval scope`);
      }
      if (approval.scope !== linkedApproval.scope || approval.actionId !== linkedApproval.actionId || approval.phaseId !== linkedApproval.phaseId || approval.runtimeMaterialDigest !== (linkedApproval.runtimeMaterial?.digest ?? null)) {
        issues.push(`${approvalPath}: approval scope does not match linked decision`);
      }
    });
    if (linkedApprovalCount === attempt.approvals.length && linkedApprovalActorCount === attempt.approvals.length) {
      const attemptDecisionActorKeys = new Set(attempt.decisionActors.map((actor) => `${actor.kind}:${actor.id}`));
      if (attemptDecisionActorKeys.size !== linkedApprovalActorKeys.size || [...attemptDecisionActorKeys].some((actorKey) => !linkedApprovalActorKeys.has(actorKey))) {
        issues.push(`deploymentAttempts.${attempt.id}.decisionActors: decision actors do not match linked approval actors`);
      }
    }
    if (plan) {
      const planActionIds = new Set(plan.actions.map((action) => action.id));
      attempt.actionSteps.forEach((step, index) => {
        if (!planActionIds.has(step.actionId)) {
          issues.push(`deploymentAttempts.${attempt.id}.actionSteps.${index}.actionId: action is not present in linked deployment plan ${plan.id}`);
        }
      });
      if (attempt.state === "succeeded" && attempt.actionSteps.length < planActionIds.size) {
        issues.push(`deploymentAttempts.${attempt.id}.actionSteps: succeeded attempt is missing linked deployment plan actions`);
      }
    }
    if (attempt.state === "succeeded" && attempt.actionSteps.some((step) => step.state !== "succeeded")) {
      issues.push(`deploymentAttempts.${attempt.id}.state: succeeded attempt requires every action step to succeed`);
    }
  });
  providerReceipts.forEach((receipt) => requireLinkedRecord(receipt.attempt, attemptMap, `providerReceipts.${receipt.id}.attempt`, issues));
  receipts.forEach((receipt) => {
    requireLinkedRecord(receipt.request, requestMap, `deploymentReceipts.${receipt.id}.request`, issues);
    requireLinkedRecord(receipt.plan, planMap, `deploymentReceipts.${receipt.id}.plan`, issues);
    requireLinkedRecord(receipt.attempt, attemptMap, `deploymentReceipts.${receipt.id}.attempt`, issues);
    requireLinkedRecord(receipt.intent, intentMap, `deploymentReceipts.${receipt.id}.intent`, issues);
    const request = requestMap.get(receipt.request.id);
    if (request && !sameDeploymentReference(receipt.intent, request.intent)) {
      issues.push(`deploymentReceipts.${receipt.id}.intent: reference does not match linked request intent`);
    }
    receipt.approvals.forEach((approval, index) => requireLinkedRecord(approval, approvalMap, `deploymentReceipts.${receipt.id}.approvals.${index}`, issues));
    receipt.providerReceipts.forEach((providerReceipt, index) => requireLinkedRecord(providerReceipt, providerReceiptMap, `deploymentReceipts.${receipt.id}.providerReceipts.${index}`, issues));
  });
  launches.forEach((launch) => {
    requireLinkedRecord(launch.product, productMap, `launchEvidence.${launch.id}.product`, issues);
    requireLinkedRecord(launch.environment, environmentMap, `launchEvidence.${launch.id}.environment`, issues);
    requireLinkedRecord(launch.deploymentReceipt, receiptMap, `launchEvidence.${launch.id}.deploymentReceipt`, issues);
    const receipt = receiptMap.get(launch.deploymentReceipt.id);
    if (launch.status === "launched" && receipt && receipt.outcome !== "succeeded") {
      issues.push(`launchEvidence.${launch.id}.deploymentReceipt: launched evidence requires a succeeded deployment receipt`);
    }
  });
  return {
    success: issues.length === 0,
    issues
  };
}
export {
  withDeploymentRecordDigest,
  validateDeploymentContractSet,
  stableDeploymentJson,
  sha256DeploymentValue,
  sha256DeploymentText,
  createDeploymentSchemas,
  computeEnvironmentBindingEtag,
  computeDeploymentRecordDigest,
  canonicalizeDeploymentValue,
  addDeploymentSafetyIssues,
  DEPLOYMENT_SCHEMA_IDS,
  DEPLOYMENT_GENERATED_ARTIFACT_ROOT,
  DEPLOYMENT_CONTRACT_VERSION
};
