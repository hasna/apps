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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/core.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/util.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/errors.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/parse.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/regexes.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/checks.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/doc.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 0,
  patch: 0
};

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/schemas.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/locales/en.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/registries.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/api.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/iso.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/errors.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/schemas.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/external.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/external.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/util.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/ZodError.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/locales/en.js
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

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default2;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
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
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/types.js
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

// src/schemas.ts
import { createHash as createHash2 } from "crypto";

// src/deployment-envelope.ts
var DEPLOYMENT_ENVELOPE_SCHEMA_ID = "hasna.deployment_envelope.v1";
var DEPLOYMENT_ENVELOPE_RATIFICATION_GATE = "one production deployment executed through this envelope with receipts and a passed live test";
var CANONICAL_RESOURCE_KINDS = [
  "compute",
  "database",
  "object_storage",
  "cache",
  "queue",
  "topic",
  "worker",
  "cron",
  "function",
  "secret",
  "domain",
  "dns",
  "cdn",
  "network",
  "identity",
  "observability",
  "other"
];
var RESOURCE_KIND_SOURCE_VOCABULARIES = [
  "deployment_db",
  "app_cloud",
  "intent",
  "aws_plan"
];
var RESOURCE_KIND_MAPPINGS = {
  deployment_db: {
    database: "database",
    cache: "cache",
    storage: "object_storage",
    domain: "domain",
    compute: "compute",
    queue: "queue",
    cdn: "cdn",
    dns: "dns"
  },
  app_cloud: {
    database: "database",
    bucket: "object_storage",
    object_store: "object_storage",
    queue: "queue",
    secret: "secret",
    function: "function",
    worker: "worker",
    cache: "cache",
    topic: "topic",
    scheduler: "cron",
    other: "other"
  },
  intent: {
    database: "database",
    object_storage: "object_storage",
    queue: "queue",
    cron: "cron",
    worker: "worker"
  },
  aws_plan: {
    "ecs-cluster": "compute",
    "ecs-task-definition": "compute",
    "ecs-service": "compute",
    "rds-postgres": "database",
    "s3-bucket": "object_storage",
    "iam-task-role": "identity",
    "iam-execution-role": "identity",
    "cloudwatch-log-group": "observability",
    "vpc-networking": "network",
    "security-group": "network"
  }
};
var ENVIRONMENT_ALIAS_MAP = {
  dev: "development",
  staging: "staging",
  prod: "production"
};
var ENVELOPE_PROVIDERS = [
  "aws",
  "gcp",
  "azure",
  "cloudflare",
  "vercel",
  "railway",
  "flyio",
  "digitalocean",
  "other"
];
var ACCOUNT_BOUND_PROVIDERS = new Set([
  "aws",
  "gcp",
  "azure"
]);
var ENVELOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
var ENVELOPE_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
var ENVELOPE_OPERATION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
function uniqueEnvelopeBy(values, key, ctx, path, label) {
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
function createDeploymentEnvelopeSchema(primitives) {
  const EnvelopeIdSchema = exports_external.string().regex(ENVELOPE_ID);
  const EnvelopeNameSchema = exports_external.string().regex(ENVELOPE_NAME);
  const EnvelopeOperationIdSchema = exports_external.string().regex(ENVELOPE_OPERATION_ID);
  const EnvelopeTimestampSchema = primitives.timestamp;
  const EnvelopeMetadataSchema = primitives.metadata;
  const EnvelopeUriSchema = primitives.uri;
  const EnvelopeResourcePointerSchema = primitives.resourcePointer;
  const EnvelopeEvidencePointerSchema = primitives.evidencePointer;
  const envelopeBase = (schema) => ({
    schema: exports_external.literal(schema),
    id: EnvelopeIdSchema,
    createdAt: EnvelopeTimestampSchema,
    updatedAt: EnvelopeTimestampSchema.nullable().optional(),
    metadata: EnvelopeMetadataSchema.optional()
  });
  const EnvelopeResourceSchema = exports_external.object({
    id: EnvelopeNameSchema,
    provider: exports_external.enum(ENVELOPE_PROVIDERS),
    kind: exports_external.enum(CANONICAL_RESOURCE_KINDS),
    sourceVocabulary: exports_external.enum(RESOURCE_KIND_SOURCE_VOCABULARIES).optional(),
    sourceKind: exports_external.string().trim().min(1).optional(),
    ownerPackage: primitives.npmPackageName,
    region: exports_external.string().trim().min(1).optional(),
    accountId: exports_external.string().trim().min(1).optional(),
    uri: EnvelopeUriSchema.optional(),
    dependsOn: exports_external.array(EnvelopeNameSchema).default([]),
    desiredConfig: exports_external.record(exports_external.unknown()).default({})
  }).strict().superRefine((value, ctx) => {
    if (Boolean(value.sourceVocabulary) !== Boolean(value.sourceKind)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "sourceVocabulary and sourceKind must be declared together",
        path: ["sourceKind"]
      });
    }
    if (value.sourceVocabulary && value.sourceKind) {
      const mapping = RESOURCE_KIND_MAPPINGS[value.sourceVocabulary];
      if (!mapping) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Unknown resource-kind source vocabulary",
          path: ["sourceVocabulary"]
        });
      } else if (!(value.sourceKind in mapping)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `Unmapped resource kind ${value.sourceKind} in vocabulary ${value.sourceVocabulary}; unmapped kinds are rejected, never guessed`,
          path: ["sourceKind"]
        });
      } else {
        const mapped = mapping[value.sourceKind];
        if (mapped !== value.kind) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: `Resource kind ${value.sourceKind} in vocabulary ${value.sourceVocabulary} maps to canonical kind ${mapped}, not ${value.kind}`,
            path: ["kind"]
          });
        }
      }
    }
    if (ACCOUNT_BOUND_PROVIDERS.has(value.provider) && !value.accountId) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Provider ${value.provider} is account-bound and requires an accountId`,
        path: ["accountId"]
      });
    }
    if (!ACCOUNT_BOUND_PROVIDERS.has(value.provider)) {
      if (!value.accountId && !value.uri && !value.region) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `Provider ${value.provider} requires at least one of accountId, uri, or region`,
          path: ["provider"]
        });
      }
    }
  });
  const EnvelopeEnvironmentSchema = exports_external.object({
    id: EnvelopeNameSchema,
    classification: exports_external.enum([
      "development",
      "staging",
      "production",
      "disaster_recovery"
    ]),
    legacyAlias: exports_external.enum(["dev", "staging", "prod"]).optional(),
    binding: primitives.environmentBindingRef,
    desiredConfig: exports_external.record(exports_external.unknown()).default({})
  }).strict().superRefine((value, ctx) => {
    if (value.legacyAlias) {
      const mapped = ENVIRONMENT_ALIAS_MAP[value.legacyAlias];
      if (mapped !== value.classification) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `Legacy alias ${value.legacyAlias} maps to canonical classification ${mapped}, not ${value.classification}`,
          path: ["legacyAlias"]
        });
      }
    }
  });
  const EnvelopeActionSchema = exports_external.object({
    id: EnvelopeNameSchema,
    operationId: EnvelopeOperationIdSchema,
    sideEffectClass: primitives.providerSideEffectClass,
    compensationOperationId: EnvelopeOperationIdSchema.nullable().optional(),
    nonReversible: exports_external.boolean().default(false),
    approvalScope: exports_external.enum(["none", "action", "phase"]).default("action"),
    evidenceRequirement: exports_external.string().trim().min(1).optional()
  }).strict();
  const EnvelopePhaseSchema = exports_external.object({
    id: EnvelopeNameSchema,
    approvalScope: exports_external.enum(["none", "plan", "action", "phase"]),
    actions: exports_external.array(EnvelopeActionSchema).min(1)
  }).strict();
  const EnvelopeMonitorCheckSchema = exports_external.object({
    id: EnvelopeNameSchema,
    kind: exports_external.enum([
      "availability",
      "deployment",
      "host",
      "process",
      "tls",
      "domain_expiry",
      "health",
      "readiness"
    ]),
    endpoint: EnvelopeUriSchema.optional(),
    expectedStatuses: exports_external.array(exports_external.number().int().min(100).max(599)).default([]),
    alarmClass: EnvelopeNameSchema.optional()
  }).strict();
  const DeploymentEnvelopeSchema = exports_external.object({
    ...envelopeBase(DEPLOYMENT_ENVELOPE_SCHEMA_ID),
    status: exports_external.enum(["draft", "active"]).default("draft"),
    ratification: exports_external.object({
      gate: exports_external.literal(DEPLOYMENT_ENVELOPE_RATIFICATION_GATE),
      satisfied: exports_external.boolean().default(false),
      evidenceRefs: exports_external.array(EnvelopeEvidencePointerSchema).default([])
    }).strict(),
    contractKitVersion: exports_external.literal(DEPLOYMENT_CONTRACT_VERSION),
    identity: exports_external.object({
      appId: primitives.appId,
      packageName: primitives.npmPackageName,
      projectsRef: EnvelopeResourcePointerSchema,
      repositoryRef: EnvelopeResourcePointerSchema
    }).strict(),
    audience: exports_external.enum(["internal", "products"]),
    accountMapping: exports_external.array(exports_external.object({
      audience: exports_external.enum(["internal", "products"]),
      accountId: exports_external.string().trim().min(1),
      region: exports_external.string().trim().min(1).optional(),
      purpose: exports_external.string().trim().min(1).optional()
    }).strict()).min(1),
    environments: exports_external.array(EnvelopeEnvironmentSchema).min(1),
    resourceGraph: exports_external.object({
      resources: exports_external.array(EnvelopeResourceSchema).min(1)
    }).strict(),
    artifacts: exports_external.array(primitives.buildArtifactRef).default([]),
    deployProcedure: exports_external.object({
      requestKind: exports_external.enum([
        "deployment",
        "promotion",
        "rollback",
        "reconciliation"
      ]),
      plan: primitives.deploymentPlanRef,
      phases: exports_external.array(EnvelopePhaseSchema).min(1)
    }).strict(),
    monitorWiring: exports_external.object({
      source: exports_external.enum(["uptime", "monitor", "fleet", "none"]),
      importMode: exports_external.enum(["link_only", "active"]).default("link_only"),
      checks: exports_external.array(EnvelopeMonitorCheckSchema).default([])
    }).strict(),
    rollback: exports_external.object({
      profile: EnvelopeNameSchema,
      targetReceipt: primitives.deploymentReceiptRef.optional()
    }).strict()
  }).strict().superRefine((value, ctx) => {
    addDeploymentSafetyIssues(value, ctx);
    if (value.status === "active") {
      if (!value.ratification.satisfied) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Active envelopes require the ratification gate to be satisfied",
          path: ["ratification", "satisfied"]
        });
      }
      if (value.ratification.evidenceRefs.length === 0) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Active envelopes require ratification evidence refs",
          path: ["ratification", "evidenceRefs"]
        });
      }
    }
    if (value.identity.projectsRef.kind !== "project") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "The envelope requires a resolved Hasna Projects identity (projectsRef.kind must be project)",
        path: ["identity", "projectsRef", "kind"]
      });
    }
    uniqueEnvelopeBy(value.environments, (environment) => environment.id, ctx, ["environments"], "Environment ids");
    uniqueEnvelopeBy(value.accountMapping, (mapping) => mapping.audience, ctx, ["accountMapping"], "Account mapping audiences");
    uniqueEnvelopeBy(value.resourceGraph.resources, (resource) => resource.id, ctx, ["resourceGraph", "resources"], "Resource ids");
    const resourceIds = new Set(value.resourceGraph.resources.map((resource) => resource.id));
    value.resourceGraph.resources.forEach((resource, index) => {
      for (const dependency of resource.dependsOn) {
        if (!resourceIds.has(dependency)) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Resource dependency must resolve inside the graph",
            path: ["resourceGraph", "resources", index, "dependsOn"]
          });
        }
      }
    });
    uniqueEnvelopeBy(value.deployProcedure.phases, (phase) => phase.id, ctx, ["deployProcedure", "phases"], "Procedure phase ids");
    value.deployProcedure.phases.forEach((phase, phaseIndex) => {
      uniqueEnvelopeBy(phase.actions, (action) => action.id, ctx, ["deployProcedure", "phases", phaseIndex, "actions"], "Procedure action ids");
      phase.actions.forEach((action, actionIndex) => {
        const actionPath = [
          "deployProcedure",
          "phases",
          phaseIndex,
          "actions",
          actionIndex
        ];
        const sideEffectClass = String(action.sideEffectClass);
        if (sideEffectClass !== "none" && sideEffectClass !== "read_only" && !action.compensationOperationId && action.nonReversible !== true) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Side-effecting procedure actions require a compensation operation or an explicit non-reversible classification",
            path: [...actionPath, "compensationOperationId"]
          });
        }
      });
    });
  });
  return {
    DeploymentEnvelopeSchema,
    EnvelopeResourceSchema,
    EnvelopeEnvironmentSchema,
    EnvelopePhaseSchema,
    EnvelopeActionSchema
  };
}

// src/schemas.ts
var CONTRACTS_PACKAGE_NAME = "@hasna/contracts";
var CONTRACTS_PACKAGE_VERSION = "1.0.0";
var SCHEMA_IDS = {
  actorRef: "hasna.actor_ref.v1",
  resourceRef: "hasna.resource_ref.v1",
  evidenceRef: "hasna.evidence_ref.v1",
  workRun: "hasna.work_run.v1",
  taskToPrProjection: "hasna.task_to_pr_projection.v1",
  decisionEnvelope: "hasna.decision_envelope.v1",
  costEstimate: "hasna.cost_estimate.v1",
  capabilityCard: "hasna.capability_card.v1",
  providerLiveModeStandard: "hasna.provider_live_mode_standard.v1",
  contextPack: "hasna.context_pack.v1",
  integrationRef: "hasna.integration_ref.v1",
  projectManifest: "hasna.project_manifest.v1",
  projectPanel: "hasna.project_panel.v1",
  projectSnapshot: "hasna.project_snapshot.v1",
  renderManifest: "hasna.render_manifest.v1",
  agentTrajectory: "hasna.agent_trajectory.v1",
  validationPlan: "hasna.validation_plan.v1",
  proofBundle: "hasna.proof_bundle.v1",
  scaffoldManifest: "hasna.scaffold_manifest.v1",
  scaffoldInstallRecord: "hasna.scaffold_install_record.v1",
  appCloudManifest: "hasna.app_cloud_manifest.v1",
  deploymentEnvelope: "hasna.deployment_envelope.v1",
  noCloudEvidencePack: "hasna.no_cloud_evidence_pack.v1",
  secureLocalStorePolicy: "hasna.secure_local_store_policy.v1",
  serviceContract: "hasna.service_contract.v1",
  commsEventEnvelope: "hasna.comms_event_envelope.v1",
  commsChannelMetadata: "hasna.comms_channel_metadata.v1",
  commsMessageMetadata: "hasna.comms_message_metadata.v1",
  projectResourceLinkCollectionV1: "hasna.project_resource_link_collection.v1",
  app: "hasna.app.v1",
  release: "hasna.release.v1",
  rolloutRecord: "hasna.rollout_record.v1",
  announcement: "hasna.announcement.v1",
  audience: "hasna.audience.v1"
};
var SchemaIdSchema = exports_external.string().regex(/^hasna\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.v[0-9]+$/);
var TimestampSchema = exports_external.string().datetime();
var NonEmptyStringSchema = exports_external.string().trim().min(1);
var UriSchema = NonEmptyStringSchema.refine((value) => value.startsWith("artifact://") || value.startsWith("repo://") || value.startsWith("project://") || value.startsWith("dashboard://") || value.startsWith("render://") || value.startsWith("integration://") || value.startsWith("task://") || value.startsWith("todo://") || value.startsWith("file://") || value.startsWith("files://") || value.startsWith("mailery://") || value.startsWith("conversation://") || value.startsWith("knowledge://") || value.startsWith("memento://") || value.startsWith("https://") || value.startsWith("http://") || value.startsWith("git+https://"), "URI must use artifact://, repo://, project://, dashboard://, render://, integration://, task://, todo://, file://, files://, mailery://, conversation://, knowledge://, memento://, http(s)://, or git+https://");
var Sha256DigestSchema = exports_external.string().regex(/^[a-fA-F0-9]{64}$/);
var HashStringSchema = exports_external.string().regex(/^(sha256:)?[a-fA-F0-9]{64}$/);
var MetadataSchema = exports_external.record(exports_external.unknown());
var TagsSchema = exports_external.array(exports_external.string().min(1)).default([]);
var OptionalTimestampSchema = TimestampSchema.nullable().optional();
var TerminalStatuses = new Set(["succeeded", "failed", "cancelled", "blocked", "skipped"]);
var ContractStatusSchema = exports_external.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
  "unknown"
]);
function contractBaseSchema(schema) {
  return exports_external.object({
    schema: exports_external.literal(schema),
    id: exports_external.string().min(1),
    createdAt: TimestampSchema,
    updatedAt: OptionalTimestampSchema,
    metadata: MetadataSchema.optional()
  }).strict();
}
var ContractEnvelopeSchema = exports_external.object({
  schema: SchemaIdSchema,
  id: exports_external.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: OptionalTimestampSchema,
  metadata: MetadataSchema.optional()
}).strict();
var ActorKindSchema = exports_external.enum([
  "agent",
  "human",
  "service",
  "model",
  "workflow",
  "system"
]);
var ActorRefSchema = contractBaseSchema(SCHEMA_IDS.actorRef).extend({
  kind: ActorKindSchema,
  name: exports_external.string().min(1).optional(),
  provider: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  machineId: exports_external.string().min(1).optional(),
  capabilities: exports_external.array(exports_external.string().min(1)).default([])
}).strict();
var ActorPointerSchema = exports_external.object({
  kind: ActorKindSchema,
  id: exports_external.string().min(1),
  name: exports_external.string().min(1).optional(),
  provider: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  machineId: exports_external.string().min(1).optional()
}).strict();
var ResourceKindSchema = exports_external.enum([
  "task",
  "project",
  "repo",
  "run",
  "loop",
  "workflow",
  "action",
  "event",
  "integration",
  "session",
  "machine",
  "model",
  "tool",
  "file",
  "document",
  "url",
  "artifact",
  "knowledge",
  "email",
  "conversation",
  "dashboard",
  "render",
  "panel",
  "report",
  "commit",
  "branch",
  "pull_request",
  "issue",
  "comment",
  "verification",
  "finding",
  "context_pack",
  "proof_bundle",
  "memento",
  "eval",
  "budget",
  "cost",
  "alert",
  "incident",
  "app",
  "release",
  "rollout",
  "announcement",
  "audience",
  "feedback",
  "unknown"
]);
var ResourceRefSchema = contractBaseSchema(SCHEMA_IDS.resourceRef).extend({
  kind: ResourceKindSchema,
  name: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  externalId: NonEmptyStringSchema.optional(),
  sourcePackage: NonEmptyStringSchema.optional(),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.externalId && value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Resource refs require uri or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ResourcePointerSchema = exports_external.object({
  kind: ResourceKindSchema,
  id: exports_external.string().min(1),
  name: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  externalId: NonEmptyStringSchema.optional(),
  sourcePackage: NonEmptyStringSchema.optional(),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  if (!value.uri && Boolean(value.externalId) !== Boolean(value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Resource pointers with external package locators require both sourcePackage and externalId",
      path: value.externalId ? ["sourcePackage"] : ["externalId"]
    });
  }
});
var EvidenceKindSchema = exports_external.enum([
  "file",
  "command_output",
  "screenshot",
  "log",
  "diff",
  "report",
  "artifact",
  "url",
  "video",
  "har",
  "test_result",
  "metric",
  "trace",
  "other"
]);
var RedactionStateSchema = exports_external.enum(["none", "partial", "full", "unknown"]);
var EvidenceRefSchema = contractBaseSchema(SCHEMA_IDS.evidenceRef).extend({
  kind: EvidenceKindSchema,
  uri: UriSchema,
  sha256: Sha256DigestSchema.optional(),
  summary: exports_external.string().min(1).optional(),
  contentType: exports_external.string().min(1).optional(),
  sizeBytes: exports_external.number().int().nonnegative().optional(),
  redaction: RedactionStateSchema.default("unknown"),
  producer: ActorPointerSchema.optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  tags: TagsSchema
}).strict();
var EvidencePointerSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: EvidenceKindSchema.optional(),
  uri: UriSchema.optional(),
  sha256: Sha256DigestSchema.optional(),
  summary: exports_external.string().min(1).optional()
}).strict();
var CostEstimateSchema = contractBaseSchema(SCHEMA_IDS.costEstimate).extend({
  currency: exports_external.string().regex(/^[A-Z]{3}$/).default("USD"),
  amountMicros: exports_external.number().int().nonnegative(),
  provider: exports_external.string().min(1).optional(),
  model: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  promptTokens: exports_external.number().int().nonnegative().optional(),
  completionTokens: exports_external.number().int().nonnegative().optional(),
  totalTokens: exports_external.number().int().nonnegative().optional(),
  basis: exports_external.enum(["actual", "estimated", "budget", "limit"]).default("estimated"),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.promptTokens !== undefined && value.completionTokens !== undefined && value.totalTokens !== undefined && value.totalTokens !== value.promptTokens + value.completionTokens) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "totalTokens must equal promptTokens plus completionTokens when all are present",
      path: ["totalTokens"]
    });
  }
});
var DecisionStatusSchema = exports_external.enum([
  "allowed",
  "denied",
  "warned",
  "approval_required",
  "selected",
  "skipped",
  "unknown"
]);
var DecisionEnvelopeSchema = contractBaseSchema(SCHEMA_IDS.decisionEnvelope).extend({
  decisionType: exports_external.enum([
    "guardrail",
    "model_route",
    "tool_select",
    "budget",
    "secret_access",
    "approval",
    "policy",
    "other"
  ]),
  status: DecisionStatusSchema,
  actor: ActorPointerSchema.optional(),
  traceId: exports_external.string().min(1).optional(),
  inputHash: HashStringSchema.optional(),
  policyBundleId: exports_external.string().min(1).optional(),
  selected: exports_external.array(ResourcePointerSchema).default([]),
  skipped: exports_external.array(ResourcePointerSchema).default([]),
  reason: exports_external.string().min(1),
  obligations: exports_external.array(exports_external.string().min(1)).default([]),
  redactions: exports_external.array(exports_external.string().min(1)).default([]),
  costEstimate: CostEstimateSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "selected" && value.selected.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Selected decisions require at least one selected resource", path: ["selected"] });
  }
  if (value.status === "skipped" && value.skipped.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Skipped decisions require at least one skipped resource", path: ["skipped"] });
  }
  if (value.status === "denied") {
    if (value.selected.length > 0) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Denied decisions cannot include selected resources", path: ["selected"] });
    }
    if (!value.policyBundleId && value.evidenceRefs.length === 0 && value.obligations.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Denied decisions require policy, evidence, or obligations",
        path: ["policyBundleId"]
      });
    }
  }
  if (value.status === "approval_required" && value.obligations.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Approval-required decisions require actionable obligations",
      path: ["obligations"]
    });
  }
});
var CapabilityCardSchema = contractBaseSchema(SCHEMA_IDS.capabilityCard).extend({
  kind: exports_external.enum(["model", "tool", "machine", "agent", "lane", "connector", "service"]),
  name: exports_external.string().min(1),
  version: exports_external.string().min(1).optional(),
  status: exports_external.enum(["available", "unavailable", "degraded", "unknown"]).default("unknown"),
  capabilities: exports_external.array(exports_external.string().min(1)).default([]),
  limitations: exports_external.array(exports_external.string().min(1)).default([]),
  riskLevel: exports_external.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  costEstimate: CostEstimateSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict();
var ProviderModeSchema = exports_external.enum(["mock", "fixture", "sandbox", "read_only_live", "live_mutating"]);
var ProviderSideEffectClassSchema = exports_external.enum([
  "none",
  "read_only",
  "external_notification",
  "external_mutation",
  "money_movement",
  "dns_or_domain_change",
  "bulk_message_or_call",
  "legal_or_filing",
  "compute_or_infra_mutation",
  "irreversible"
]);
var CredentialRequirementSchema = exports_external.object({
  refName: NonEmptyStringSchema,
  requiredForModes: exports_external.array(ProviderModeSchema).min(1),
  allowedSecretInputs: exports_external.array(exports_external.enum(["credential_ref", "lease_ref"])).min(1).default(["credential_ref"]),
  failClosedDiagnostic: NonEmptyStringSchema,
  revocationCheck: exports_external.boolean().default(true)
}).strict();
var ProviderOperationCardSchema = exports_external.object({
  operation: NonEmptyStringSchema,
  supportedModes: exports_external.array(ProviderModeSchema).min(1),
  sideEffectClass: ProviderSideEffectClassSchema,
  requiresApproval: exports_external.boolean().default(false),
  requiresIdempotencyKey: exports_external.boolean().default(false),
  requiresSandboxEvidence: exports_external.boolean().default(false),
  requiresRollbackOrRevocation: exports_external.boolean().default(false),
  rollbackOrRevocation: NonEmptyStringSchema.optional(),
  noSideEffectSmoke: NonEmptyStringSchema.optional(),
  reconciliation: NonEmptyStringSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.supportedModes.includes("live_mutating")) {
    if (value.sideEffectClass === "none" || value.sideEffectClass === "read_only") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations must declare a side-effecting class",
        path: ["sideEffectClass"]
      });
    }
    if (!value.requiresApproval) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require approval",
        path: ["requiresApproval"]
      });
    }
    if (!value.requiresIdempotencyKey) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require idempotency keys",
        path: ["requiresIdempotencyKey"]
      });
    }
    if (!value.requiresSandboxEvidence) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require sandbox evidence before live proof",
        path: ["requiresSandboxEvidence"]
      });
    }
    if (!value.requiresRollbackOrRevocation || !value.rollbackOrRevocation) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require rollback or revocation instructions",
        path: ["rollbackOrRevocation"]
      });
    }
    if (!value.reconciliation) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require reconciliation behavior",
        path: ["reconciliation"]
      });
    }
  }
});
var ProviderCapabilityCardSchema = exports_external.object({
  providerId: NonEmptyStringSchema,
  appId: NonEmptyStringSchema,
  adapterId: NonEmptyStringSchema,
  ownerPackage: NonEmptyStringSchema,
  modes: exports_external.array(ProviderModeSchema).min(1),
  defaultMode: ProviderModeSchema,
  credentialRequirements: exports_external.array(CredentialRequirementSchema).default([]),
  operations: exports_external.array(ProviderOperationCardSchema).min(1),
  rateLimitPosture: NonEmptyStringSchema,
  costPosture: NonEmptyStringSchema.optional(),
  auditEvents: exports_external.array(NonEmptyStringSchema).default([]),
  redactionRules: exports_external.array(NonEmptyStringSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (!value.modes.includes(value.defaultMode)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "defaultMode must be one of modes",
      path: ["defaultMode"]
    });
  }
  const operationModes = new Set(value.operations.flatMap((operation) => operation.supportedModes));
  for (const mode of operationModes) {
    if (!value.modes.includes(mode)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `operation mode ${mode} is not declared in provider modes`,
        path: ["operations"]
      });
    }
  }
  if (operationModes.has("live_mutating")) {
    const liveCredential = value.credentialRequirements.some((credential) => credential.requiredForModes.includes("live_mutating"));
    if (!liveCredential) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating providers require at least one live credential reference requirement",
        path: ["credentialRequirements"]
      });
    }
    if (value.auditEvents.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating providers require audit events",
        path: ["auditEvents"]
      });
    }
  }
});
var ProviderLiveModeTargetSchema = exports_external.object({
  appId: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  priority: exports_external.enum(["p0", "p1", "p2"]).default("p1"),
  requiredEvidence: exports_external.array(NonEmptyStringSchema).min(1),
  firstOperations: exports_external.array(NonEmptyStringSchema).min(1),
  blockedUntil: exports_external.array(NonEmptyStringSchema).default([])
}).strict();
var ProviderLiveModeStandardSchema = contractBaseSchema(SCHEMA_IDS.providerLiveModeStandard).extend({
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  modes: exports_external.array(ProviderModeSchema).refine((modes) => ["mock", "fixture", "sandbox", "read_only_live", "live_mutating"].every((mode) => modes.includes(mode)), "provider live-mode standard must include every canonical provider mode"),
  requiredCapabilityFields: exports_external.array(NonEmptyStringSchema).min(1),
  liveMutationGate: exports_external.object({
    requiredMode: exports_external.literal("live_mutating"),
    requiredChecks: exports_external.array(NonEmptyStringSchema).min(1),
    forbiddenBypassSignals: exports_external.array(NonEmptyStringSchema).min(1),
    disabledLiveSmoke: NonEmptyStringSchema
  }).strict(),
  noSideEffectSmoke: exports_external.object({
    requiredForModes: exports_external.array(ProviderModeSchema).min(1),
    commandEvidence: exports_external.array(NonEmptyStringSchema).min(1),
    secretOutputScan: exports_external.boolean().default(true)
  }).strict(),
  credentialPolicy: exports_external.object({
    acceptedInputs: exports_external.array(exports_external.enum(["credential_ref", "lease_ref"])).min(1),
    rawSecretInputsAllowed: exports_external.literal(false),
    missingCredentialBehavior: exports_external.literal("fail_closed"),
    revocationCheckRequired: exports_external.boolean().default(true)
  }).strict(),
  operationCards: exports_external.array(ProviderCapabilityCardSchema).min(1),
  firstAdoptionTargets: exports_external.array(ProviderLiveModeTargetSchema).min(1),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const firstTargetApps = new Set(value.firstAdoptionTargets.map((target) => target.appId));
  const operationApps = new Set(value.operationCards.map((card) => card.appId));
  for (const appId of firstTargetApps) {
    if (!operationApps.has(appId)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `first adoption target ${appId} requires a provider capability card`,
        path: ["firstAdoptionTargets"]
      });
    }
  }
});
var ContextPackItemSchema = exports_external.object({
  id: exports_external.string().min(1),
  title: exports_external.string().min(1).optional(),
  summary: exports_external.string().min(1),
  text: exports_external.string().optional(),
  tokens: exports_external.number().int().nonnegative().optional(),
  source: EvidencePointerSchema,
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict();
var ContextPackSchema = contractBaseSchema(SCHEMA_IDS.contextPack).extend({
  objective: exports_external.string().min(1),
  budget: exports_external.object({
    maxTokens: exports_external.number().int().positive().optional(),
    maxBytes: exports_external.number().int().positive().optional()
  }).strict().optional(),
  items: exports_external.array(ContextPackItemSchema).default([]),
  citations: exports_external.array(EvidencePointerSchema).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown"),
  permissions: exports_external.array(exports_external.string().min(1)).default([]),
  redactions: exports_external.array(exports_external.string().min(1)).default([]),
  conflicts: exports_external.array(exports_external.string().min(1)).default([]),
  uncertainty: exports_external.string().min(1).optional()
}).strict();
var RelativeProjectPathSchema = NonEmptyStringSchema.refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "Project paths must be relative and cannot contain parent-directory segments");
var ProjectSlugSchema = exports_external.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Project slugs must be lowercase dashed identifiers");
var ProjectClassificationSchema = exports_external.enum(["public", "internal", "private", "sensitive"]);
var ProjectStatusSchema = exports_external.enum(["draft", "active", "paused", "archived"]);
var ProjectIntegrationKindSchema = exports_external.enum([
  "todos",
  "files",
  "mailery",
  "conversations",
  "knowledge",
  "mementos",
  "reports",
  "actions",
  "render",
  "contracts",
  "custom"
]);
var IntegrationRefSchema = contractBaseSchema(SCHEMA_IDS.integrationRef).extend({
  kind: ProjectIntegrationKindSchema,
  name: exports_external.string().min(1),
  projectId: ProjectSlugSchema.optional(),
  sourcePackage: NonEmptyStringSchema.optional(),
  externalId: NonEmptyStringSchema.optional(),
  uri: UriSchema.optional(),
  enabled: exports_external.boolean().default(true),
  readOnly: exports_external.boolean().default(true),
  capabilities: exports_external.array(exports_external.string().min(1)).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown"),
  resourceRef: ResourcePointerSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  config: MetadataSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.sourcePackage && value.externalId) && !value.resourceRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Integration refs require uri, resourceRef, or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ProjectResourceAuthoritySchema = exports_external.enum([
  "todos",
  "conversations",
  "knowledge",
  "mementos",
  "orgs",
  "contacts"
]);
var ProjectResourceTargetKindSchema = exports_external.enum([
  "contact",
  "org",
  "project",
  "task",
  "task_list",
  "plan",
  "channel",
  "collection",
  "item"
]);
var ProjectResourceLinkScopeSchema = exports_external.enum(["resource", "collection"]);
var ProjectResourceExternalUuidValueSchema = exports_external.string().trim().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/, "Project resource external UUIDs must be complete RFC 4122 UUIDs").transform((value) => value.toLowerCase());
var ProjectResourceCanonicalUriValueSchema = exports_external.string().trim().min(1).transform((value, ctx) => {
  if (/^urn:[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(value)) {
    return value;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource canonical URIs must use canonical HTTPS or URN syntax"
    });
    return exports_external.NEVER;
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource canonical HTTPS URIs must not contain credentials"
    });
    return exports_external.NEVER;
  }
  if (url.search || url.hash) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource canonical HTTPS URIs must not contain query or fragment components"
    });
    return exports_external.NEVER;
  }
  return url.toString();
});
var ProjectResourceLinkLabelsSchema = exports_external.object({
  name: NonEmptyStringSchema.optional(),
  channel_name: NonEmptyStringSchema.optional(),
  path: NonEmptyStringSchema.optional(),
  tags: exports_external.array(exports_external.string()).transform((tags) => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort()).optional()
}).strict();
var ProjectResourceExternalUuidLocatorSchema = exports_external.object({
  kind: exports_external.literal("external_uuid"),
  value: ProjectResourceExternalUuidValueSchema
}).strict();
var ProjectResourceCanonicalUriLocatorSchema = exports_external.object({
  kind: exports_external.literal("canonical_uri"),
  value: ProjectResourceCanonicalUriValueSchema
}).strict();
var ProjectResourceConversationsChannelLocatorSchema = exports_external.object({
  kind: exports_external.literal("conversations_channel_id"),
  value: exports_external.string().regex(/^chn_[0-9a-f]{32}$/, "Conversations channel locators must match chn_<32 lowercase hex>")
}).strict();
var ProjectResourcePortableLocatorSchema = exports_external.discriminatedUnion("kind", [
  ProjectResourceExternalUuidLocatorSchema,
  ProjectResourceCanonicalUriLocatorSchema
]);
var ProjectResourceLinkLocatorSchema = exports_external.discriminatedUnion("kind", [
  ProjectResourceExternalUuidLocatorSchema,
  ProjectResourceCanonicalUriLocatorSchema,
  ProjectResourceConversationsChannelLocatorSchema
]);
var ProjectResourceLinkCommonShape = {
  service_instance: ProjectResourceCanonicalUriValueSchema,
  scope: ProjectResourceLinkScopeSchema,
  labels: ProjectResourceLinkLabelsSchema.optional()
};
var ProjectResourceTodosContainerLinkInputSchema = exports_external.object({
  authority: exports_external.literal("todos"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/todos"),
  target_kind: exports_external.enum(["project", "task_list", "plan"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceTodosTaskLinkInputSchema = exports_external.object({
  authority: exports_external.literal("todos"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/todos"),
  target_kind: exports_external.literal("task"),
  locator: ProjectResourceExternalUuidLocatorSchema
}).strict();
var ProjectResourceConversationsProjectLinkInputSchema = exports_external.object({
  authority: exports_external.literal("conversations"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/conversations"),
  target_kind: exports_external.literal("project"),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceConversationsChannelLinkInputSchema = exports_external.object({
  authority: exports_external.literal("conversations"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/conversations"),
  target_kind: exports_external.literal("channel"),
  locator: exports_external.discriminatedUnion("kind", [
    ProjectResourceExternalUuidLocatorSchema,
    ProjectResourceConversationsChannelLocatorSchema
  ])
}).strict();
var ProjectResourceKnowledgeLinkInputSchema = exports_external.object({
  authority: exports_external.literal("knowledge"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/knowledge"),
  target_kind: exports_external.enum(["collection", "item"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceMementosLinkInputSchema = exports_external.object({
  authority: exports_external.literal("mementos"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/mementos"),
  target_kind: exports_external.enum(["project", "item"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceOrgsLinkInputSchema = exports_external.object({
  authority: exports_external.literal("orgs"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/orgs"),
  target_kind: exports_external.enum(["org", "project"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceContactsLinkInputSchema = exports_external.object({
  authority: exports_external.literal("contacts"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/contacts"),
  target_kind: exports_external.literal("contact"),
  locator: ProjectResourceExternalUuidLocatorSchema
}).strict();
var ProjectResourceLinkInputBranches = [
  ProjectResourceTodosContainerLinkInputSchema,
  ProjectResourceTodosTaskLinkInputSchema,
  ProjectResourceConversationsProjectLinkInputSchema,
  ProjectResourceConversationsChannelLinkInputSchema,
  ProjectResourceKnowledgeLinkInputSchema,
  ProjectResourceMementosLinkInputSchema,
  ProjectResourceOrgsLinkInputSchema,
  ProjectResourceContactsLinkInputSchema
];
function validateProjectResourceLinkSemantics(value, ctx) {
  const expectedUrnPrefix = `urn:hasna:${value.authority}:`;
  if (typeof value.service_instance === "string" && value.service_instance.startsWith("urn:") && !value.service_instance.startsWith(expectedUrnPrefix)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `Project resource service_instance URNs for ${value.authority} must start with ${expectedUrnPrefix}`,
      path: ["service_instance"]
    });
  }
  if (value.locator.kind === "canonical_uri" && typeof value.locator.value === "string" && value.locator.value.startsWith("urn:") && !value.locator.value.startsWith(expectedUrnPrefix)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `Project resource locator URNs for ${value.authority} must start with ${expectedUrnPrefix}`,
      path: ["locator", "value"]
    });
  }
  if (value.authority === "conversations" && value.target_kind === "channel" && !value.labels?.channel_name) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Conversations channel links require labels.channel_name",
      path: ["labels", "channel_name"]
    });
  }
}
var ProjectResourceLinkInputSchema = exports_external.union(ProjectResourceLinkInputBranches).superRefine(validateProjectResourceLinkSemantics);
var ProjectResourceLinkPersistedShape = {
  id: NonEmptyStringSchema,
  project_id: NonEmptyStringSchema,
  labels: ProjectResourceLinkLabelsSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema
};
var ProjectResourceLinkSchema = exports_external.union([
  ProjectResourceTodosContainerLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceTodosTaskLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceConversationsProjectLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceConversationsChannelLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceKnowledgeLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceMementosLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceOrgsLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceContactsLinkInputSchema.extend(ProjectResourceLinkPersistedShape)
]).superRefine(validateProjectResourceLinkSemantics);
var ProjectResourceLinkCollectionV1Schema = exports_external.object({
  schema: exports_external.literal(SCHEMA_IDS.projectResourceLinkCollectionV1),
  project_id: NonEmptyStringSchema,
  current_revision: NonEmptyStringSchema,
  links: exports_external.array(ProjectResourceLinkSchema),
  link_count: exports_external.number().int().nonnegative(),
  max_items: exports_external.number().int().positive(),
  collection_digest: Sha256DigestSchema,
  complete: exports_external.boolean(),
  truncated: exports_external.boolean()
}).strict().superRefine((value, ctx) => {
  if (value.link_count !== value.links.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource link_count must equal links.length",
      path: ["link_count"]
    });
  }
  if (value.link_count > value.max_items) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource link_count must not exceed max_items",
      path: ["link_count"]
    });
  }
  if (value.complete && value.truncated) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "A complete project resource link collection cannot be truncated",
      path: ["truncated"]
    });
  }
  const linkIds = new Set;
  const identities = new Set;
  for (const [index, link] of value.links.entries()) {
    if (link.project_id !== value.project_id) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Every project resource link must belong to the collection project_id",
        path: ["links", index, "project_id"]
      });
    }
    if (linkIds.has(link.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project resource link IDs must be unique within a collection",
        path: ["links", index, "id"]
      });
    }
    linkIds.add(link.id);
    const identity = JSON.stringify([
      link.authority,
      link.service_instance,
      link.source_package,
      link.target_kind,
      link.locator.kind,
      link.locator.value
    ]);
    if (identities.has(identity)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project resource link identities must be unique within a collection",
        path: ["links", index]
      });
    }
    identities.add(identity);
  }
});
var ProjectLayoutSchema = exports_external.object({
  schemaRoot: RelativeProjectPathSchema.default(".hasna/project"),
  dashboardManifest: RelativeProjectPathSchema.default(".hasna/project/dashboard.render.json"),
  snapshotsDir: RelativeProjectPathSchema.default(".hasna/project/snapshots"),
  documentsDir: RelativeProjectPathSchema.default("documents"),
  reportsDir: RelativeProjectPathSchema.default("reports"),
  evidenceDir: RelativeProjectPathSchema.default(".hasna/project/evidence"),
  privateDir: RelativeProjectPathSchema.default(".hasna/project/private")
}).strict();
var ProjectManifestSchema = contractBaseSchema(SCHEMA_IDS.projectManifest).extend({
  projectId: ProjectSlugSchema,
  slug: ProjectSlugSchema,
  name: exports_external.string().min(1),
  summary: exports_external.string().min(1).optional(),
  status: ProjectStatusSchema.default("active"),
  classification: ProjectClassificationSchema.default("private"),
  owner: ActorPointerSchema.optional(),
  layout: ProjectLayoutSchema.default({}),
  integrations: exports_external.array(IntegrationRefSchema).default([]),
  renderManifests: exports_external.array(ResourcePointerSchema).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  const integrationIds = new Set;
  const renderManifestIds = new Set;
  if (value.projectId !== value.slug) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "projectId and slug must match for canonical project manifests",
      path: ["slug"]
    });
  }
  for (const [index, integration] of value.integrations.entries()) {
    if (integrationIds.has(integration.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project manifest integration ids must be unique",
        path: ["integrations", index, "id"]
      });
    }
    integrationIds.add(integration.id);
    if (integration.projectId && integration.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Integration projectId must match the manifest projectId",
        path: ["integrations", index, "projectId"]
      });
    }
  }
  for (const [index, renderManifest] of value.renderManifests.entries()) {
    if (renderManifest.kind !== "render") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project renderManifests must use resource kind render",
        path: ["renderManifests", index, "kind"]
      });
    }
    if (renderManifestIds.has(renderManifest.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project renderManifest refs must be unique",
        path: ["renderManifests", index, "id"]
      });
    }
    renderManifestIds.add(renderManifest.id);
  }
});
var RenderImportKindSchema = exports_external.enum(["local", "package", "provider", "url"]);
var RenderImportSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: RenderImportKindSchema,
  specifier: exports_external.string().min(1),
  path: RelativeProjectPathSchema.optional(),
  packageName: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  provider: ProjectIntegrationKindSchema.optional(),
  schemaId: SchemaIdSchema.optional(),
  integrity: HashStringSchema.optional(),
  resourceRef: ResourcePointerSchema.optional(),
  optional: exports_external.boolean().default(false)
}).strict().superRefine((value, ctx) => {
  if (value.kind === "local" && !value.path) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Local render imports require path", path: ["path"] });
  }
  if (value.kind === "package" && !value.packageName) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Package render imports require packageName", path: ["packageName"] });
  }
  if (value.kind === "provider" && !value.provider) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Provider render imports require provider", path: ["provider"] });
  }
  if (value.kind === "url" && !value.uri) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "URL render imports require uri", path: ["uri"] });
  }
});
var RenderViewKindSchema = exports_external.enum(["dashboard", "canvas", "panel", "report", "document", "custom"]);
var RenderViewSchema = exports_external.object({
  id: exports_external.string().min(1),
  title: exports_external.string().min(1),
  kind: RenderViewKindSchema,
  default: exports_external.boolean().default(false),
  entry: RelativeProjectPathSchema.optional(),
  imports: exports_external.array(RenderImportSchema).default([]),
  panelRefs: exports_external.array(ResourcePointerSchema).default([]),
  dataRefs: exports_external.array(ResourcePointerSchema).default([]),
  layout: MetadataSchema.optional()
}).strict();
var RenderManifestSchema = contractBaseSchema(SCHEMA_IDS.renderManifest).extend({
  projectId: ProjectSlugSchema,
  name: exports_external.string().min(1),
  version: exports_external.string().min(1),
  manifestPath: RelativeProjectPathSchema.default(".hasna/project/dashboard.render.json"),
  renderer: exports_external.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  views: exports_external.array(RenderViewSchema).min(1),
  imports: exports_external.array(RenderImportSchema).default([]),
  theme: MetadataSchema.optional(),
  compatibility: exports_external.object({
    minProjectsVersion: exports_external.string().min(1).optional(),
    minContractsVersion: exports_external.string().min(1).optional()
  }).strict().optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const defaults = value.views.filter((view) => view.default);
  const viewIds = new Set;
  const importIds = new Set;
  if (defaults.length > 1) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Render manifests can have at most one default view", path: ["views"] });
  }
  for (const [index, importRef] of value.imports.entries()) {
    if (importIds.has(importRef.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Render manifest import ids must be unique",
        path: ["imports", index, "id"]
      });
    }
    importIds.add(importRef.id);
  }
  for (const [viewIndex, view] of value.views.entries()) {
    if (viewIds.has(view.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Render manifest view ids must be unique",
        path: ["views", viewIndex, "id"]
      });
    }
    viewIds.add(view.id);
    const viewImportIds = new Set;
    for (const [importIndex, importRef] of view.imports.entries()) {
      if (viewImportIds.has(importRef.id)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Render view import ids must be unique",
          path: ["views", viewIndex, "imports", importIndex, "id"]
        });
      }
      viewImportIds.add(importRef.id);
    }
    for (const [panelIndex, panelRef] of view.panelRefs.entries()) {
      if (panelRef.kind !== "panel") {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Render view panelRefs must use resource kind panel",
          path: ["views", viewIndex, "panelRefs", panelIndex, "kind"]
        });
      }
    }
  }
});
var ProjectPanelStateSchema = exports_external.enum(["ready", "empty", "loading", "error", "auth_required", "unavailable", "stale"]);
var ProjectPanelKindSchema = exports_external.enum([
  "overview",
  "tasks",
  "files",
  "mailery",
  "conversations",
  "knowledge",
  "mementos",
  "reports",
  "actions",
  "timeline",
  "risks",
  "documents",
  "custom"
]);
var ProjectPanelMetricSchema = exports_external.object({
  id: exports_external.string().min(1),
  label: exports_external.string().min(1),
  value: exports_external.union([exports_external.string(), exports_external.number(), exports_external.boolean()]),
  unit: exports_external.string().min(1).optional(),
  status: exports_external.enum(["good", "warning", "critical", "unknown"]).default("unknown"),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict();
var ProjectPanelItemSchema = exports_external.object({
  id: exports_external.string().min(1),
  title: exports_external.string().min(1),
  summary: exports_external.string().min(1).optional(),
  status: exports_external.string().min(1).optional(),
  priority: exports_external.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  timestamp: TimestampSchema.optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  metadata: MetadataSchema.optional()
}).strict();
var ProjectRenderFragmentSchema = exports_external.object({
  renderer: exports_external.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  title: exports_external.string().min(1).optional(),
  entry: RelativeProjectPathSchema.optional(),
  imports: exports_external.array(RenderImportSchema).default([]),
  spec: MetadataSchema.default({})
}).strict();
var ProjectPanelSchema = contractBaseSchema(SCHEMA_IDS.projectPanel).extend({
  projectId: ProjectSlugSchema,
  provider: exports_external.object({
    kind: ProjectIntegrationKindSchema,
    id: exports_external.string().min(1),
    name: exports_external.string().min(1).optional(),
    sourcePackage: NonEmptyStringSchema.optional(),
    externalId: NonEmptyStringSchema.optional()
  }).strict(),
  kind: ProjectPanelKindSchema,
  title: exports_external.string().min(1),
  summary: exports_external.string().min(1).optional(),
  state: ProjectPanelStateSchema.default("ready"),
  stateReason: exports_external.string().min(1).optional(),
  generatedAt: TimestampSchema,
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown"),
  metrics: exports_external.array(ProjectPanelMetricSchema).default([]),
  items: exports_external.array(ProjectPanelItemSchema).default([]),
  actions: exports_external.array(ResourcePointerSchema).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  renderFragment: ProjectRenderFragmentSchema.optional(),
  warnings: exports_external.array(exports_external.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  const reasonStates = new Set(["error", "auth_required", "unavailable", "stale"]);
  const metricIds = new Set;
  const itemIds = new Set;
  if (reasonStates.has(value.state) && !value.stateReason) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Non-ready provider states require stateReason",
      path: ["stateReason"]
    });
  }
  if (value.state === "ready" && value.metrics.length === 0 && value.items.length === 0 && !value.renderFragment) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Ready panels require metrics, items, or a renderFragment; use state=empty for empty panels",
      path: ["state"]
    });
  }
  for (const [index, metric] of value.metrics.entries()) {
    if (metricIds.has(metric.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project panel metric ids must be unique",
        path: ["metrics", index, "id"]
      });
    }
    metricIds.add(metric.id);
  }
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project panel item ids must be unique",
        path: ["items", index, "id"]
      });
    }
    itemIds.add(item.id);
  }
  for (const [index, action] of value.actions.entries()) {
    if (action.kind !== "action") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project panel actions must use resource kind action",
        path: ["actions", index, "kind"]
      });
    }
  }
});
var ProjectSnapshotSchema = contractBaseSchema(SCHEMA_IDS.projectSnapshot).extend({
  projectId: ProjectSlugSchema,
  generatedAt: TimestampSchema,
  status: ContractStatusSchema.default("unknown"),
  manifestRef: ResourcePointerSchema,
  renderManifestRef: ResourcePointerSchema.optional(),
  panels: exports_external.array(ProjectPanelSchema).default([]),
  contextPacks: exports_external.array(ContextPackSchema).default([]),
  proofBundleRefs: exports_external.array(ResourcePointerSchema).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  warnings: exports_external.array(exports_external.string().min(1)).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  const panelIds = new Set;
  const contextPackIds = new Set;
  if (value.manifestRef.kind !== "project") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project snapshot manifestRef must use resource kind project",
      path: ["manifestRef", "kind"]
    });
  }
  if (value.renderManifestRef && value.renderManifestRef.kind !== "render") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project snapshot renderManifestRef must use resource kind render",
      path: ["renderManifestRef", "kind"]
    });
  }
  for (const [index, proofBundleRef] of value.proofBundleRefs.entries()) {
    if (proofBundleRef.kind !== "proof_bundle") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project snapshot proofBundleRefs must use resource kind proof_bundle",
        path: ["proofBundleRefs", index, "kind"]
      });
    }
  }
  for (const [index, panel] of value.panels.entries()) {
    if (panel.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Panel projectId must match snapshot projectId",
        path: ["panels", index, "projectId"]
      });
    }
    if (panelIds.has(panel.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project snapshot panel ids must be unique",
        path: ["panels", index, "id"]
      });
    }
    panelIds.add(panel.id);
  }
  for (const [index, contextPack] of value.contextPacks.entries()) {
    if (contextPackIds.has(contextPack.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project snapshot context pack ids must be unique",
        path: ["contextPacks", index, "id"]
      });
    }
    contextPackIds.add(contextPack.id);
  }
});
var ValidationCheckSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: exports_external.enum(["command", "test", "typecheck", "lint", "eval", "security", "review", "deploy", "smoke", "manual", "other"]),
  required: exports_external.boolean().default(true),
  command: exports_external.string().min(1).optional(),
  expected: exports_external.string().min(1).optional(),
  timeoutMs: exports_external.number().int().positive().optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const actionableKinds = new Set(["command", "test", "typecheck", "lint", "smoke", "eval"]);
  if (actionableKinds.has(value.kind) && !value.command && !value.expected) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Actionable validation checks require command or expected",
      path: ["command"]
    });
  }
});
var ValidationPlanSchema = contractBaseSchema(SCHEMA_IDS.validationPlan).extend({
  objective: exports_external.string().min(1),
  subject: ResourcePointerSchema.optional(),
  checks: exports_external.array(ValidationCheckSchema).min(1),
  verifier: ActorPointerSchema.optional(),
  requiredEvidenceKinds: exports_external.array(EvidenceKindSchema).default([])
}).strict();
var ScaffoldTypeSchema = exports_external.enum([
  "open_source",
  "internal_app",
  "platform",
  "app",
  "agent",
  "content",
  "overlay",
  "other"
]);
var ScaffoldStatusSchema = exports_external.enum(["draft", "active", "deprecated", "archived"]);
var ScaffoldCapabilitySchema = exports_external.enum([
  "cli",
  "mcp",
  "library",
  "sdk",
  "rest_api",
  "dashboard",
  "database",
  "auth",
  "billing",
  "worker",
  "daemon",
  "native",
  "browser_extension",
  "ai_provider",
  "media_pipeline",
  "data_pipeline",
  "tests",
  "ci",
  "deployment",
  "docs",
  "other"
]);
var ScaffoldEnvVarSchema = exports_external.object({
  key: exports_external.string().regex(/^[A-Z][A-Z0-9_]*$/),
  description: exports_external.string().min(1),
  required: exports_external.boolean().default(false),
  ["secret"]: exports_external.boolean().default(false),
  group: exports_external.string().min(1).optional(),
  default: exports_external.string().optional()
}).strict().superRefine((value, ctx) => {
  if (value.secret && value.default !== undefined) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Secret scaffold env vars cannot include defaults",
      path: ["default"]
    });
  }
});
var ScaffoldScriptSchema = exports_external.object({
  name: exports_external.string().min(1),
  command: exports_external.string().min(1),
  description: exports_external.string().min(1).optional(),
  required: exports_external.boolean().default(false)
}).strict();
var ScaffoldOutputShapeSchema = exports_external.object({
  packageManager: exports_external.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  languages: exports_external.array(exports_external.string().min(1)).default([]),
  requiredFiles: exports_external.array(exports_external.string().min(1)).default([]),
  requiredDirectories: exports_external.array(exports_external.string().min(1)).default([]),
  optionalDirectories: exports_external.array(exports_external.string().min(1)).default([])
}).strict();
var ScaffoldManifestSchema = contractBaseSchema(SCHEMA_IDS.scaffoldManifest).extend({
  name: exports_external.string().min(1),
  version: exports_external.string().min(1),
  summary: exports_external.string().min(1),
  type: ScaffoldTypeSchema,
  status: ScaffoldStatusSchema.default("draft"),
  capabilities: exports_external.array(ScaffoldCapabilitySchema).default([]),
  techStack: exports_external.array(exports_external.string().min(1)).default([]),
  tags: TagsSchema,
  source: ResourcePointerSchema.optional(),
  output: ScaffoldOutputShapeSchema,
  env: exports_external.array(ScaffoldEnvVarSchema).default([]),
  scripts: exports_external.array(ScaffoldScriptSchema).default([]),
  validationChecks: exports_external.array(ValidationCheckSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.source?.uri?.startsWith("file://")) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Public scaffold manifest source refs cannot use local file:// URIs",
      path: ["source", "uri"]
    });
  }
  if (value.status === "active" && value.validationChecks.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Active scaffold manifests require validation checks",
      path: ["validationChecks"]
    });
  }
  if (value.status === "active" && value.output.requiredFiles.length === 0 && value.output.requiredDirectories.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Active scaffold manifests require at least one required file or directory",
      path: ["output"]
    });
  }
});
var ScaffoldInstallStatusSchema = exports_external.enum(["installed", "failed", "cancelled", "partial", "unknown"]);
var ScaffoldInstallRecordSchema = contractBaseSchema(SCHEMA_IDS.scaffoldInstallRecord).extend({
  scaffoldId: exports_external.string().min(1),
  scaffoldVersion: exports_external.string().min(1).optional(),
  manifestRef: ResourcePointerSchema.optional(),
  target: ResourcePointerSchema,
  status: ScaffoldInstallStatusSchema,
  installedAt: TimestampSchema.optional(),
  installer: ActorPointerSchema.optional(),
  packageManager: exports_external.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  options: MetadataSchema.optional(),
  generatedFiles: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  proofBundleRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "installed" && !value.installedAt) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Installed scaffold records require installedAt",
      path: ["installedAt"]
    });
  }
  if (value.status === "installed" && value.generatedFiles.length === 0 && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Installed scaffold records require generated files, evidence, or proof bundle refs",
      path: ["generatedFiles"]
    });
  }
  if ((value.status === "failed" || value.status === "partial") && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed or partial scaffold records require evidence or proof bundle refs",
      path: ["evidenceRefs"]
    });
  }
});
var AppIdSchema = exports_external.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "App ids must be lowercase dashed identifiers");
var NpmPackageNameSchema = exports_external.string().regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, "Must be a valid npm package name");
var SemverSchema = exports_external.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, "Must be a semver version");
var GitShaSchema = exports_external.string().regex(/^[0-9a-f]{7,40}$/, "Must be a lowercase git sha (7-40 hex chars)");
var GithubUrlSchema = NonEmptyStringSchema.refine((value) => value.startsWith("https://github.com/") || value.startsWith("git+https://github.com/"), "GitHub URLs must start with https://github.com/ or git+https://github.com/");
var AppLifecycleSchema = exports_external.enum(["active", "stub", "deprecated", "archived"]);
var ReleaseChannelSchema = exports_external.enum(["stable", "beta", "canary", "internal"]);
var AppMcpSurfaceSchema = exports_external.object({
  transport: exports_external.enum(["http", "stdio"]).default("http"),
  bin: exports_external.string().min(1).optional(),
  url: UriSchema.optional()
}).strict();
var AppHttpSurfaceSchema = exports_external.object({
  healthPath: exports_external.string().min(1).default("/health"),
  port: exports_external.number().int().positive().optional(),
  baseUrl: UriSchema.optional()
}).strict();
var AppSurfacesSchema = exports_external.object({
  bins: exports_external.array(exports_external.string().min(1)).default([]),
  mcp: AppMcpSurfaceSchema.optional(),
  http: AppHttpSurfaceSchema.optional()
}).strict();
var AppSchema = contractBaseSchema(SCHEMA_IDS.app).extend({
  appId: AppIdSchema,
  npmName: NpmPackageNameSchema,
  repoFolder: AppIdSchema,
  githubUrl: GithubUrlSchema,
  projectSlug: ProjectSlugSchema,
  surfaces: AppSurfacesSchema.default({}),
  lifecycle: AppLifecycleSchema,
  releaseChannel: ReleaseChannelSchema.default("stable"),
  summary: exports_external.string().min(1).optional(),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  const seenBins = new Set;
  for (const [index, bin] of value.surfaces.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "App surface bins must be unique",
        path: ["surfaces", "bins", index]
      });
    }
    seenBins.add(bin);
  }
});
var PublishPathSchema = exports_external.enum(["skill", "ci", "backfilled"]);
var ReleaseSchema = contractBaseSchema(SCHEMA_IDS.release).extend({
  appId: AppIdSchema,
  package: NpmPackageNameSchema,
  version: SemverSchema,
  gitSha: GitShaSchema,
  publishedAt: TimestampSchema,
  publishPath: PublishPathSchema,
  changelogRef: ResourcePointerSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.publishPath !== "backfilled" && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "skill and ci releases require publish evidence; only backfilled releases may omit it",
      path: ["evidenceRefs"]
    });
  }
});
var RolloutActionSchema = exports_external.enum(["install", "update", "rollback", "freeze-blocked"]);
var RolloutVerificationSchema = exports_external.object({
  cliVersion: exports_external.string().min(1).optional(),
  mcpHealth: exports_external.enum(["ok", "degraded", "unavailable", "not_checked"]).optional()
}).strict().superRefine((value, ctx) => {
  if (!value.cliVersion && value.mcpHealth === undefined) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollout verification requires at least one concrete verifier field"
    });
  }
});
var RolloutRecordSchema = contractBaseSchema(SCHEMA_IDS.rolloutRecord).extend({
  appId: AppIdSchema,
  package: NpmPackageNameSchema,
  version: SemverSchema,
  machine: NonEmptyStringSchema,
  action: RolloutActionSchema,
  result: ContractStatusSchema,
  verifiedBy: RolloutVerificationSchema.optional(),
  at: TimestampSchema,
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.action === "freeze-blocked" && value.result !== "blocked" && value.result !== "skipped") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "freeze-blocked rollout records must report result blocked or skipped",
      path: ["result"]
    });
  }
  const hasConcreteVerification = Boolean(value.verifiedBy?.cliVersion) || value.verifiedBy?.mcpHealth !== undefined && value.verifiedBy.mcpHealth !== "not_checked";
  const hasVerifierFields = value.verifiedBy ? Object.keys(value.verifiedBy).length > 0 : false;
  if ((value.action === "install" || value.action === "update") && value.result === "succeeded" && (!value.verifiedBy || hasVerifierFields && !hasConcreteVerification)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Succeeded install/update rollout records require concrete verification",
      path: ["verifiedBy"]
    });
  }
});
var AnnouncementChannelKindSchema = exports_external.enum([
  "email",
  "telegram",
  "slack",
  "discord",
  "x",
  "blog",
  "rss",
  "webhook",
  "github",
  "other"
]);
var AnnouncementDeliveryStatusSchema = exports_external.enum([
  "pending",
  "queued",
  "sent",
  "failed",
  "skipped",
  "suppressed"
]);
var AnnouncementChannelSchema = exports_external.object({
  channel: AnnouncementChannelKindSchema,
  status: AnnouncementDeliveryStatusSchema,
  deliveredAt: TimestampSchema.optional(),
  detail: exports_external.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if (value.status === "sent" && !value.deliveredAt) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Sent announcement channels require deliveredAt",
      path: ["deliveredAt"]
    });
  }
  if (value.status === "failed" && !value.detail) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed announcement channels require detail",
      path: ["detail"]
    });
  }
});
var AnnouncementSchema = contractBaseSchema(SCHEMA_IDS.announcement).extend({
  campaignId: NonEmptyStringSchema,
  appId: AppIdSchema.optional(),
  releaseRef: ResourcePointerSchema.optional(),
  channels: exports_external.array(AnnouncementChannelSchema).min(1),
  audienceRef: ResourcePointerSchema,
  sentAt: TimestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.releaseRef && value.releaseRef.kind !== "release") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Announcement releaseRef must use resource kind release",
      path: ["releaseRef", "kind"]
    });
  }
  if (value.audienceRef.kind !== "audience") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Announcement audienceRef must use resource kind audience",
      path: ["audienceRef", "kind"]
    });
  }
});
var AudiencePredicateKindSchema = exports_external.enum(["tag", "attribute", "group"]);
var AudiencePredicateOpSchema = exports_external.enum(["eq", "neq", "in", "not_in", "exists", "not_exists"]);
var AudiencePredicateValueSchema = exports_external.union([exports_external.string(), exports_external.number(), exports_external.boolean()]);
var AudiencePredicateSchema = exports_external.object({
  kind: AudiencePredicateKindSchema,
  key: exports_external.string().min(1).optional(),
  op: AudiencePredicateOpSchema.default("eq"),
  value: AudiencePredicateValueSchema.optional(),
  values: exports_external.array(AudiencePredicateValueSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.kind === "attribute" && !value.key) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Attribute predicates require key",
      path: ["key"]
    });
  }
  if ((value.op === "eq" || value.op === "neq") && value.value === undefined) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "eq/neq predicates require value",
      path: ["value"]
    });
  }
  if ((value.op === "in" || value.op === "not_in") && value.values.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "in/not_in predicates require values",
      path: ["values"]
    });
  }
});
var AudienceDefinitionSchema = exports_external.object({
  match: exports_external.enum(["all", "any"]).default("all"),
  predicates: exports_external.array(AudiencePredicateSchema).min(1)
}).strict();
var ConsentPolicySchema = exports_external.enum(["opt_in", "opt_out", "transactional", "none"]);
var AudienceSchema = contractBaseSchema(SCHEMA_IDS.audience).extend({
  audienceId: AppIdSchema,
  name: NonEmptyStringSchema,
  definition: AudienceDefinitionSchema,
  consentPolicy: ConsentPolicySchema,
  suppressionSyncedAt: OptionalTimestampSchema
}).strict();
var FORBIDDEN_SHARED_CLOUD_RUNTIMES = ["@hasna/cloud", "open-cloud"];
var AppCloudProviderSchema = exports_external.enum([
  "aws",
  "gcp",
  "azure",
  "cloudflare",
  "vercel",
  "neon",
  "supabase",
  "postgres",
  "s3",
  "rds",
  "other"
]);
var AppCloudResourceSchema = exports_external.object({
  id: exports_external.string().min(1),
  provider: AppCloudProviderSchema,
  kind: exports_external.enum([
    "database",
    "bucket",
    "queue",
    "secret",
    "function",
    "worker",
    "cache",
    "topic",
    "scheduler",
    "object_store",
    "other"
  ]),
  ownerPackage: exports_external.string().min(1),
  region: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  machineScoped: exports_external.boolean().default(false)
}).strict();
var AppCloudManifestSchema = contractBaseSchema(SCHEMA_IDS.appCloudManifest).extend({
  packageName: exports_external.string().min(1),
  packageVersion: exports_external.string().min(1).optional(),
  appId: exports_external.string().min(1),
  repository: ResourcePointerSchema.optional(),
  cloudBoundary: exports_external.enum(["none", "app_owned", "external_service", "local_cache"]),
  cloudResources: exports_external.array(AppCloudResourceSchema).default([]),
  localCache: exports_external.object({
    path: exports_external.string().min(1).optional(),
    pullMode: exports_external.enum(["manual", "daemon", "ci", "none"]).default("manual"),
    conflictPolicy: exports_external.enum(["cloud_wins", "local_wins", "merge", "manual_review"]).default("manual_review")
  }).strict().optional(),
  forbiddenSharedRuntimes: exports_external.array(exports_external.string().min(1)).default([...FORBIDDEN_SHARED_CLOUD_RUNTIMES]),
  dependencies: exports_external.array(exports_external.string().min(1)).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const effectiveForbiddenRuntimes = new Set([...FORBIDDEN_SHARED_CLOUD_RUNTIMES, ...value.forbiddenSharedRuntimes]);
  if (effectiveForbiddenRuntimes.has(value.packageName)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "App-owned cloud manifests cannot be for a forbidden runtime",
      path: ["packageName"]
    });
  }
  for (const runtime of FORBIDDEN_SHARED_CLOUD_RUNTIMES) {
    if (!value.forbiddenSharedRuntimes.includes(runtime)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `forbiddenSharedRuntimes must include ${runtime}`,
        path: ["forbiddenSharedRuntimes"]
      });
    }
  }
  for (const runtime of effectiveForbiddenRuntimes) {
    if (value.dependencies.includes(runtime)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `App-owned cloud manifests cannot depend on ${runtime}`,
        path: ["dependencies"]
      });
    }
  }
  if (value.cloudBoundary === "local_cache") {
    if (!value.localCache) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "A local_cache boundary requires localCache settings",
        path: ["localCache"]
      });
    }
  }
  if (value.cloudBoundary === "external_service") {
    if (value.cloudResources.length > 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "An external_service boundary must not declare app-owned cloudResources",
        path: ["cloudResources"]
      });
    }
  }
  if ((value.cloudBoundary === "app_owned" || value.cloudBoundary === "local_cache") && value.cloudResources.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "App-owned boundaries require explicit app-owned cloudResources",
      path: ["cloudResources"]
    });
  }
  if (value.cloudBoundary === "none" && value.cloudResources.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "cloudBoundary none cannot declare cloudResources",
      path: ["cloudResources"]
    });
  }
  value.cloudResources.forEach((resource, index) => {
    if (resource.ownerPackage !== value.packageName) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Cloud resources must be owned by the app package that declares the manifest",
        path: ["cloudResources", index, "ownerPackage"]
      });
    }
  });
});
var NoCloudCheckKindSchema = exports_external.enum([
  "package_manifest",
  "lockfile",
  "source_import",
  "runtime_config",
  "packed_artifact",
  "published_metadata",
  "app_cloud_manifest",
  "remote_config",
  "boundary_doc",
  "other"
]);
var NoCloudFindingSeveritySchema = exports_external.enum(["low", "medium", "high", "critical"]);
var NoCloudFindingSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: NoCloudCheckKindSchema,
  severity: NoCloudFindingSeveritySchema,
  path: exports_external.string().min(1).optional(),
  packageName: exports_external.string().min(1).optional(),
  pattern: exports_external.string().min(1),
  message: exports_external.string().min(1),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict();
var NoCloudCheckResultSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: NoCloudCheckKindSchema,
  status: ContractStatusSchema,
  target: exports_external.string().min(1),
  command: exports_external.string().min(1).optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  findings: exports_external.array(NoCloudFindingSchema).default([])
}).strict();
var NoCloudEvidencePackSchema = contractBaseSchema(SCHEMA_IDS.noCloudEvidencePack).extend({
  subject: ResourcePointerSchema,
  packageName: exports_external.string().min(1).optional(),
  packageVersion: exports_external.string().min(1).optional(),
  generatedBy: ActorPointerSchema.optional(),
  scanMode: exports_external.enum(["source_tree", "packed_artifact", "published_metadata", "runtime_config", "workspace", "ci"]),
  status: ContractStatusSchema,
  verdict: exports_external.enum(["passed", "failed", "warning", "not_run"]),
  appCloudManifest: AppCloudManifestSchema.optional(),
  checks: exports_external.array(NoCloudCheckResultSchema).min(1),
  findings: exports_external.array(NoCloudFindingSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const allFindings = [...value.findings, ...value.checks.flatMap((check2) => check2.findings)];
  const blockingFindings = allFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence requires succeeded status", path: ["status"] });
    }
    if (blockingFindings.length > 0) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence cannot include high or critical findings", path: ["findings"] });
    }
    if (value.checks.some((check2) => check2.status !== "succeeded")) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence requires every check to be succeeded", path: ["checks"] });
    }
  }
  if (value.verdict === "failed" && allFindings.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Failed no-cloud evidence requires findings", path: ["findings"] });
  }
  if (value.status === "succeeded" && value.checks.some((check2) => check2.status === "failed")) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Succeeded no-cloud evidence cannot contain failed checks", path: ["checks"] });
  }
  value.checks.forEach((check2, index) => {
    const checkBlockingFindings = check2.findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
    if (check2.status === "succeeded" && checkBlockingFindings.length > 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Succeeded no-cloud checks cannot contain high or critical findings",
        path: ["checks", index, "findings"]
      });
    }
  });
});
var ProofCheckResultSchema = exports_external.object({
  checkId: exports_external.string().min(1),
  status: ContractStatusSchema,
  summary: exports_external.string().min(1).optional(),
  startedAt: OptionalTimestampSchema,
  finishedAt: OptionalTimestampSchema,
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict();
var ProofBundleSchema = contractBaseSchema(SCHEMA_IDS.proofBundle).extend({
  subject: ResourcePointerSchema,
  validationPlanRef: ResourcePointerSchema.optional(),
  status: ContractStatusSchema,
  verdict: exports_external.enum(["passed", "failed", "inconclusive", "not_run"]).default("inconclusive"),
  checks: exports_external.array(ProofCheckResultSchema).default([]),
  verifier: ActorPointerSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  residualRisks: exports_external.array(exports_external.string().min(1)).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles must have status succeeded",
        path: ["status"]
      });
    }
    if (value.checks.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles require at least one check result",
        path: ["checks"]
      });
    }
    value.checks.forEach((check2, index) => {
      if (check2.status !== "succeeded") {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Passed proof bundles require all checks to have status succeeded",
          path: ["checks", index, "status"]
        });
      }
    });
    const hasEvidence = value.evidenceRefs.length > 0 || value.checks.some((check2) => check2.evidenceRefs.length > 0);
    if (!hasEvidence) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles require evidence",
        path: ["evidenceRefs"]
      });
    }
    if (!value.verifier) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles require a verifier",
        path: ["verifier"]
      });
    }
  }
  if (value.verdict === "not_run" && value.checks.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Not-run proof bundles cannot include check results",
      path: ["checks"]
    });
  }
  if (value.verdict === "failed" && !value.checks.some((check2) => check2.status === "failed") && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed proof bundles require a failed check or evidence",
      path: ["checks"]
    });
  }
});
var WorkRunSchema = contractBaseSchema(SCHEMA_IDS.workRun).extend({
  objective: exports_external.string().min(1),
  status: ContractStatusSchema,
  actor: ActorPointerSchema,
  traceId: exports_external.string().min(1).optional(),
  startedAt: OptionalTimestampSchema,
  finishedAt: OptionalTimestampSchema,
  constraints: exports_external.array(exports_external.string().min(1)).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  decisions: exports_external.array(DecisionEnvelopeSchema).default([]),
  costEstimates: exports_external.array(CostEstimateSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  validationPlanRefs: exports_external.array(ResourcePointerSchema).default([]),
  proofBundleRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.startedAt && value.finishedAt && Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "finishedAt must be after or equal to startedAt",
      path: ["finishedAt"]
    });
  }
  if (TerminalStatuses.has(value.status) && !value.finishedAt) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Terminal work runs require finishedAt",
      path: ["finishedAt"]
    });
  }
  const hasEvidence = value.evidenceRefs.length > 0 || value.proofBundleRefs.length > 0;
  if (value.status === "succeeded" && !hasEvidence) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Succeeded work runs require evidence or a proof bundle",
      path: ["evidenceRefs"]
    });
  }
  if ((value.status === "failed" || value.status === "blocked") && !hasEvidence && value.decisions.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed or blocked work runs require evidence, a proof bundle, or a decision record",
      path: ["evidenceRefs"]
    });
  }
});
var TASK_TO_PR_ROLE_AUTHORITIES = Object.freeze({
  work_run: Object.freeze(["codewith"]),
  root_request: Object.freeze(["todos"]),
  pr_group: Object.freeze(["todos"]),
  leaf_task: Object.freeze(["todos"]),
  attempt: Object.freeze(["todos"]),
  writer_generation: Object.freeze(["todos"]),
  writer_lease: Object.freeze(["repos"]),
  writer_fence: Object.freeze(["repos"]),
  provider_profile: Object.freeze(["codewith"]),
  provider_route: Object.freeze(["codewith"]),
  admission: Object.freeze(["codewith"]),
  worker_actor: Object.freeze(["codewith"]),
  worker: Object.freeze(["codewith"]),
  runtime: Object.freeze(["codewith"]),
  repo: Object.freeze(["repos"]),
  worktree: Object.freeze(["repos"]),
  branch: Object.freeze(["repos"]),
  event_stream: Object.freeze(["todos"]),
  replay_cursor: Object.freeze(["todos"]),
  handoff: Object.freeze(["todos"]),
  pull_request: Object.freeze(["todos"]),
  commit: Object.freeze(["repos"]),
  review: Object.freeze(["review"]),
  reviewer: Object.freeze(["review"]),
  review_run: Object.freeze(["review"]),
  proof_bundle: Object.freeze(["review"]),
  repair_cycle: Object.freeze(["todos"]),
  merge_guard: Object.freeze(["todos"]),
  merge_operator: Object.freeze(["merge_provider"]),
  merge_operator_run: Object.freeze(["merge_provider"]),
  merge_guard_receipt: Object.freeze(["merge_provider"]),
  merge_outcome: Object.freeze(["merge_provider"]),
  recovery: Object.freeze(["todos"]),
  cancellation: Object.freeze(["todos"]),
  cleanup_eligibility: Object.freeze(["repos"]),
  cleanup_outcome: Object.freeze(["repos"]),
  rollback_plan: Object.freeze(["todos"]),
  rollback_outcome: Object.freeze(["repos"]),
  terminal_disposition: Object.freeze(["todos"]),
  openloops_invocation: Object.freeze(["openloops"]),
  adapter_extension: Object.freeze(["adapter"])
});
var TaskToPrRefRoleSchema = exports_external.enum([
  "work_run",
  "root_request",
  "pr_group",
  "leaf_task",
  "attempt",
  "writer_generation",
  "writer_lease",
  "writer_fence",
  "provider_profile",
  "provider_route",
  "admission",
  "worker_actor",
  "worker",
  "runtime",
  "repo",
  "worktree",
  "branch",
  "event_stream",
  "replay_cursor",
  "handoff",
  "pull_request",
  "commit",
  "review",
  "reviewer",
  "review_run",
  "proof_bundle",
  "repair_cycle",
  "merge_guard",
  "merge_operator",
  "merge_operator_run",
  "merge_guard_receipt",
  "merge_outcome",
  "recovery",
  "cancellation",
  "cleanup_eligibility",
  "cleanup_outcome",
  "rollback_plan",
  "rollback_outcome",
  "terminal_disposition",
  "openloops_invocation",
  "adapter_extension"
]);
var TaskToPrAuthoritySchema = exports_external.enum([
  "todos",
  "codewith",
  "repos",
  "review",
  "merge_provider",
  "openloops",
  "adapter"
]);
var LowerSha256DigestSchema = exports_external.string().regex(/^[a-f0-9]{64}$/);
var OpaqueTaskToPrIdSchema = exports_external.string().trim().min(3).max(256);
var NonsemanticOpaqueSuffixPattern = /^[a-f0-9]{32}$/;
function deriveTaskToPrRefId(role, authority, digest) {
  return `${role}:${authority}:opaque-${digest.slice(0, 32)}`;
}
function deriveTaskToPrEvidenceId(digest) {
  return `evidence:opaque-${digest.slice(0, 32)}`;
}
var TaskToPrProjectionIdSchema = OpaqueTaskToPrIdSchema.refine((value) => {
  const prefix = "task_to_pr_projection:opaque-";
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  return NonsemanticOpaqueSuffixPattern.test(suffix);
}, "Projection ids must use a nonsemantic 128-bit lowercase hexadecimal surrogate");
var TaskToPrAttemptNonceSchema = OpaqueTaskToPrIdSchema.refine((value) => {
  const prefix = "attempt_nonce:opaque-";
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  return NonsemanticOpaqueSuffixPattern.test(suffix);
}, "Attempt nonces must use a nonsemantic 128-bit lowercase hexadecimal surrogate");
var SensitiveTaskToPrRoles = new Set([
  "writer_lease",
  "writer_fence",
  "provider_profile",
  "provider_route",
  "admission",
  "worker_actor",
  "worker",
  "runtime",
  "worktree",
  "merge_operator",
  "merge_operator_run",
  "merge_guard_receipt",
  "merge_outcome",
  "openloops_invocation",
  "adapter_extension"
]);
var TaskToPrRefSchema = exports_external.object({
  role: TaskToPrRefRoleSchema,
  authority: TaskToPrAuthoritySchema,
  id: OpaqueTaskToPrIdSchema,
  digest: LowerSha256DigestSchema,
  redaction: exports_external.enum(["none", "partial", "full"])
}).strict().superRefine((value, ctx) => {
  const allowedAuthorities = TASK_TO_PR_ROLE_AUTHORITIES[value.role];
  if (!allowedAuthorities.includes(value.authority)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.role} refs must be owned by ${allowedAuthorities.join(" or ")}`,
      path: ["authority"]
    });
  }
  if (SensitiveTaskToPrRoles.has(value.role) && value.redaction === "none") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.role} refs must be redacted and cannot carry a raw locator or credential`,
      path: ["redaction"]
    });
  }
  const expectedId = deriveTaskToPrRefId(value.role, value.authority, value.digest);
  if (value.id !== expectedId) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Reference ids must be nonsemantic authority-bound surrogates derived from the canonical role, authority, and owner-record digest",
      path: ["id"]
    });
  }
});
var TaskToPrEvidenceRefSchema = exports_external.object({
  id: OpaqueTaskToPrIdSchema,
  digest: LowerSha256DigestSchema,
  redaction: exports_external.enum(["partial", "full"])
}).strict().superRefine((value, ctx) => {
  if (value.id !== deriveTaskToPrEvidenceId(value.digest)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Evidence ids must be nonsemantic owner-resolvable surrogates derived from their canonical digest",
      path: ["id"]
    });
  }
});
function requireDistinctTaskToPrEvidenceRefs(stopEvidenceRef, leaseRevocationEvidenceRef, ctx, path) {
  if (stopEvidenceRef.id === leaseRevocationEvidenceRef.id || stopEvidenceRef.digest === leaseRevocationEvidenceRef.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Stop and lease-revocation facts require distinct evidence identities and digests",
      path
    });
  }
}
function taskToPrRefFor(role) {
  return TaskToPrRefSchema.refine((value) => value.role === role, {
    message: `Reference must use role ${role}`,
    path: ["role"]
  });
}
function sameTaskToPrRef(left, right) {
  return left.role === right.role && left.authority === right.authority && left.id === right.id && left.digest === right.digest && left.redaction === right.redaction;
}
function sameTaskToPrCanonicalRefId(left, right) {
  return left.role === right.role && left.authority === right.authority && left.id === right.id;
}
function requireFreshTaskToPrRef(prior, successor, ctx, path, label) {
  if (sameTaskToPrCanonicalRefId(prior, successor)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${label} requires a fresh canonical role/authority/id`,
      path
    });
  }
  if (prior.digest === successor.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${label} requires a fresh canonical digest`,
      path
    });
  }
}
function taskToPrCanonicalRefKey(ref) {
  return `${ref.role}\x00${ref.authority}\x00${ref.id}`;
}
function sameGitObjectId(left, right) {
  return left.algorithm === right.algorithm && left.value === right.value;
}
function sameTaskToPrMergeGuardLineageFacts(left, right) {
  return sameTaskToPrRef(left.pullRequestRef, right.pullRequestRef) && sameGitObjectId(left.expectedBase, right.expectedBase) && sameGitObjectId(left.expectedHead, right.expectedHead) && JSON.stringify(left.reviewRefs) === JSON.stringify(right.reviewRefs) && JSON.stringify(left.proofBundleRefs) === JSON.stringify(right.proofBundleRefs) && sameTaskToPrRef(left.operatorRef, right.operatorRef) && sameTaskToPrRef(left.operatorRunRef, right.operatorRunRef) && sameTaskToPrRef(left.providerGuardReceiptRef, right.providerGuardReceiptRef) && left.mechanism === right.mechanism;
}
var TaskToPrGitObjectIdSchema = exports_external.object({
  algorithm: exports_external.enum(["sha1", "sha256"]),
  value: exports_external.string().regex(/^[a-f0-9]+$/)
}).strict().superRefine((value, ctx) => {
  const requiredLength = value.algorithm === "sha1" ? 40 : 64;
  if (value.value.length !== requiredLength) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.algorithm} object ids must contain exactly ${requiredLength} lowercase hex characters`,
      path: ["value"]
    });
  }
});
function deriveTaskToPrIdentityDigest(input) {
  if (input.canonicalizationVersion === 1) {
    const legacyCanonicalBinding = JSON.stringify([
      "hasna.task_to_pr_projection.binding.v1",
      input.canonicalizationVersion,
      input.rootRequestRef.id,
      input.rootRequestRef.digest,
      input.prGroupRef.id,
      input.prGroupRef.digest,
      input.leafTaskRef.id,
      input.leafTaskRef.digest,
      input.repoRef.id,
      input.repoRef.digest,
      input.baseHead.algorithm,
      input.baseHead.value,
      input.frozenScopeDigest
    ]);
    return createHash2("sha256").update(legacyCanonicalBinding, "utf8").digest("hex");
  }
  const canonicalBinding = JSON.stringify([
    "hasna.task_to_pr_projection.binding.v2",
    input.canonicalizationVersion,
    ...[input.rootRequestRef, input.prGroupRef, input.leafTaskRef, input.repoRef, input.worktreeRef, input.branchRef].flatMap((ref) => [ref.role, ref.authority, ref.id, ref.digest]),
    input.baseHead.algorithm,
    input.baseHead.value,
    input.frozenScopeDigest
  ]);
  return createHash2("sha256").update(canonicalBinding, "utf8").digest("hex");
}
var TaskToPrAttemptSchema = exports_external.object({
  ref: taskToPrRefFor("attempt"),
  nonce: TaskToPrAttemptNonceSchema,
  admissionRef: taskToPrRefFor("admission"),
  admissionWriterGenerationRef: taskToPrRefFor("writer_generation"),
  workerActorRef: taskToPrRefFor("worker_actor"),
  workerRef: taskToPrRefFor("worker"),
  runtimeRef: taskToPrRefFor("runtime"),
  writerGenerationRef: taskToPrRefFor("writer_generation"),
  writerLeaseRef: taskToPrRefFor("writer_lease"),
  writerFenceRef: taskToPrRefFor("writer_fence"),
  providerProfileRef: taskToPrRefFor("provider_profile"),
  providerRouteRef: taskToPrRefFor("provider_route")
}).strict();
var TaskToPrRepositoryBindingSchema = exports_external.object({
  repoRef: taskToPrRefFor("repo"),
  worktreeRef: taskToPrRefFor("worktree"),
  branchRef: taskToPrRefFor("branch"),
  baseHead: TaskToPrGitObjectIdSchema,
  branchHead: TaskToPrGitObjectIdSchema
}).strict();
var TaskToPrEventCursorSchema = exports_external.object({
  streamRef: taskToPrRefFor("event_stream"),
  replayCursorRef: taskToPrRefFor("replay_cursor"),
  sequence: exports_external.number().int().safe().nonnegative(),
  prefixDigest: LowerSha256DigestSchema
}).strict();
var TaskToPrHandoffSchema = exports_external.object({
  ref: taskToPrRefFor("handoff"),
  previousAttemptRef: taskToPrRefFor("attempt"),
  nextAttemptRef: taskToPrRefFor("attempt"),
  previousWriterGenerationRef: taskToPrRefFor("writer_generation"),
  nextWriterGenerationRef: taskToPrRefFor("writer_generation"),
  stoppedWorkRunRef: taskToPrRefFor("work_run"),
  stopEvidenceRef: TaskToPrEvidenceRefSchema,
  leaseRevocationEvidenceRef: TaskToPrEvidenceRefSchema
}).strict().superRefine((value, ctx) => {
  requireFreshTaskToPrRef(value.previousAttemptRef, value.nextAttemptRef, ctx, ["nextAttemptRef"], "Handoff attempt rotation");
  requireFreshTaskToPrRef(value.previousWriterGenerationRef, value.nextWriterGenerationRef, ctx, ["nextWriterGenerationRef"], "Handoff writer-generation rotation");
  requireDistinctTaskToPrEvidenceRefs(value.stopEvidenceRef, value.leaseRevocationEvidenceRef, ctx, ["leaseRevocationEvidenceRef"]);
});
var TaskToPrReviewBindingSchema = exports_external.object({
  ref: taskToPrRefFor("review"),
  pullRequestRef: taskToPrRefFor("pull_request"),
  base: TaskToPrGitObjectIdSchema,
  head: TaskToPrGitObjectIdSchema,
  reviewerRef: taskToPrRefFor("reviewer"),
  reviewRunRef: taskToPrRefFor("review_run"),
  proofBundleRef: taskToPrRefFor("proof_bundle"),
  verdict: exports_external.enum(["approved", "changes_requested", "blocked"]),
  reviewedAt: TimestampSchema
}).strict();
var TaskToPrExactHeadBindingSchema = exports_external.object({
  pullRequestRef: taskToPrRefFor("pull_request"),
  remoteBranchRef: taskToPrRefFor("branch"),
  expectedBase: TaskToPrGitObjectIdSchema,
  providerPullRequestBase: TaskToPrGitObjectIdSchema,
  localHead: TaskToPrGitObjectIdSchema,
  remoteHead: TaskToPrGitObjectIdSchema,
  providerPullRequestHead: TaskToPrGitObjectIdSchema,
  equalityProofRef: taskToPrRefFor("proof_bundle"),
  ciProofBundleRefs: exports_external.array(taskToPrRefFor("proof_bundle")).min(1),
  verifiedAt: TimestampSchema
}).strict().superRefine((value, ctx) => {
  if (!sameGitObjectId(value.expectedBase, value.providerPullRequestBase)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Expected and provider-observed pull-request bases must be exactly equal",
      path: ["providerPullRequestBase"]
    });
  }
  if (!sameGitObjectId(value.localHead, value.remoteHead) || !sameGitObjectId(value.localHead, value.providerPullRequestHead)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Local, remote, and provider pull-request heads must be exactly equal",
      path: ["providerPullRequestHead"]
    });
  }
  const proofKeys = value.ciProofBundleRefs.map(taskToPrCanonicalRefKey);
  if (new Set(proofKeys).size !== proofKeys.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "CI proof bundle refs must have unique canonical identities",
      path: ["ciProofBundleRefs"]
    });
  }
  const proofDigests = value.ciProofBundleRefs.map((ref) => ref.digest);
  if (new Set(proofDigests).size !== proofDigests.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "CI proof bundle refs must have unique canonical digests",
      path: ["ciProofBundleRefs"]
    });
  }
  if (value.ciProofBundleRefs.some((ref) => sameTaskToPrCanonicalRefId(ref, value.equalityProofRef))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-equality and CI proof refs must have distinct canonical identities",
      path: ["ciProofBundleRefs"]
    });
  }
  if (value.ciProofBundleRefs.some((ref) => ref.digest === value.equalityProofRef.digest)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-equality and CI proof refs must have distinct canonical digests",
      path: ["ciProofBundleRefs"]
    });
  }
});
var TaskToPrRepairStateSchema = exports_external.object({
  ref: taskToPrRefFor("repair_cycle"),
  cycle: exports_external.number().int().min(0).max(2),
  cap: exports_external.literal(2),
  exhausted: exports_external.boolean(),
  latestRepairRef: taskToPrRefFor("repair_cycle").optional()
}).strict().superRefine((value, ctx) => {
  if (value.exhausted !== (value.cycle === value.cap)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Repair exhaustion must equal the cumulative cycle cap",
      path: ["exhausted"]
    });
  }
  if (value.cycle === 0 && value.latestRepairRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cycle zero cannot reference a repair",
      path: ["latestRepairRef"]
    });
  }
  if (value.cycle > 0 && !value.latestRepairRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Non-zero repair state requires the latest immutable repair ref",
      path: ["latestRepairRef"]
    });
  }
  if (value.latestRepairRef && sameTaskToPrCanonicalRefId(value.ref, value.latestRepairRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Repair-state and latest-repair refs must be distinct canonical records",
      path: ["latestRepairRef"]
    });
  }
  if (value.latestRepairRef && value.ref.digest === value.latestRepairRef.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Repair-state and latest-repair refs must have distinct canonical digests",
      path: ["latestRepairRef"]
    });
  }
});
var TaskToPrMergeGuardSchema = exports_external.object({
  ref: taskToPrRefFor("merge_guard"),
  pullRequestRef: taskToPrRefFor("pull_request"),
  expectedBase: TaskToPrGitObjectIdSchema,
  expectedHead: TaskToPrGitObjectIdSchema,
  reviewRefs: exports_external.array(taskToPrRefFor("review")).min(1),
  proofBundleRefs: exports_external.array(taskToPrRefFor("proof_bundle")).min(1),
  operatorRef: taskToPrRefFor("merge_operator"),
  operatorRunRef: taskToPrRefFor("merge_operator_run"),
  providerGuardReceiptRef: taskToPrRefFor("merge_guard_receipt"),
  mechanism: exports_external.enum(["compare_and_swap", "queue_expected_head"]),
  decision: exports_external.enum(["eligible", "denied", "consumed", "revoked"]),
  evaluatedAt: TimestampSchema
}).strict().superRefine((value, ctx) => {
  const uniqueReviews = new Set(value.reviewRefs.map((ref) => ref.id));
  if (uniqueReviews.size !== value.reviewRefs.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge guard review refs must be unique",
      path: ["reviewRefs"]
    });
  }
  const uniqueProofs = new Set(value.proofBundleRefs.map(taskToPrCanonicalRefKey));
  if (uniqueProofs.size !== value.proofBundleRefs.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge guard proof refs must have unique canonical identities",
      path: ["proofBundleRefs"]
    });
  }
  const uniqueProofDigests = new Set(value.proofBundleRefs.map((ref) => ref.digest));
  if (uniqueProofDigests.size !== value.proofBundleRefs.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge guard proof refs must have unique canonical digests",
      path: ["proofBundleRefs"]
    });
  }
});
var TaskToPrMergeOutcomeSchema = exports_external.object({
  ref: taskToPrRefFor("merge_outcome"),
  guardRef: taskToPrRefFor("merge_guard"),
  pullRequestRef: taskToPrRefFor("pull_request"),
  expectedBase: TaskToPrGitObjectIdSchema,
  observedBase: TaskToPrGitObjectIdSchema,
  expectedHead: TaskToPrGitObjectIdSchema,
  observedHead: TaskToPrGitObjectIdSchema,
  status: exports_external.enum(["merged", "closed_unmerged", "refused", "head_drift", "base_drift"]),
  mergeCommitRef: taskToPrRefFor("commit").optional(),
  finishedAt: TimestampSchema,
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict().superRefine((value, ctx) => {
  const baseMatches = sameGitObjectId(value.expectedBase, value.observedBase);
  const headMatches = sameGitObjectId(value.expectedHead, value.observedHead);
  if (value.status === "merged") {
    if (!baseMatches || !headMatches) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merged outcomes require observed base and head to equal the guarded values",
        path: [!baseMatches ? "observedBase" : "observedHead"]
      });
    }
    if (!value.mergeCommitRef) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merged outcomes require an immutable merge commit ref",
        path: ["mergeCommitRef"]
      });
    }
  } else if (value.mergeCommitRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Unmerged outcomes cannot claim a merge commit",
      path: ["mergeCommitRef"]
    });
  }
  if (value.status === "head_drift" && headMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-drift outcomes require distinct expected and observed heads",
      path: ["observedHead"]
    });
  }
  if (value.status === "head_drift" && !baseMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-drift outcomes cannot also carry an unclassified base drift",
      path: ["observedBase"]
    });
  }
  if (value.status === "base_drift" && baseMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Base-drift outcomes require distinct expected and observed bases",
      path: ["observedBase"]
    });
  }
  if (value.status === "base_drift" && !headMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Base-drift outcomes cannot also carry an unclassified head drift",
      path: ["observedHead"]
    });
  }
  if (!headMatches && value.status !== "head_drift") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Only a head_drift outcome may record an observed head that differs from the expected head",
      path: ["observedHead"]
    });
  }
  if (!baseMatches && value.status !== "base_drift") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Only a base_drift outcome may record an observed base that differs from the expected base",
      path: ["observedBase"]
    });
  }
});
var TaskToPrMergeStateSchema = exports_external.object({
  guard: TaskToPrMergeGuardSchema,
  outcome: TaskToPrMergeOutcomeSchema.optional()
}).strict();
var TaskToPrRecoverySchema = exports_external.object({
  ref: taskToPrRefFor("recovery"),
  priorAttemptRef: taskToPrRefFor("attempt"),
  priorWriterGenerationRef: taskToPrRefFor("writer_generation"),
  priorWorkRunRef: taskToPrRefFor("work_run"),
  successorAttemptNonce: TaskToPrAttemptNonceSchema,
  successorWriterGenerationRef: taskToPrRefFor("writer_generation"),
  preservedStateRefs: exports_external.array(TaskToPrRefSchema).min(1),
  stopEvidenceRef: TaskToPrEvidenceRefSchema,
  leaseRevocationEvidenceRef: TaskToPrEvidenceRefSchema
}).strict().superRefine((value, ctx) => {
  requireFreshTaskToPrRef(value.priorWriterGenerationRef, value.successorWriterGenerationRef, ctx, ["successorWriterGenerationRef"], "Recovery writer-generation rotation");
  requireDistinctTaskToPrEvidenceRefs(value.stopEvidenceRef, value.leaseRevocationEvidenceRef, ctx, ["leaseRevocationEvidenceRef"]);
});
var TaskToPrCancellationSchema = exports_external.object({
  ref: taskToPrRefFor("cancellation"),
  cancelledAttemptRef: taskToPrRefFor("attempt"),
  preservedStateRefs: exports_external.array(TaskToPrRefSchema).min(1),
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict();
var TaskToPrCleanupEligibilitySchema = exports_external.object({
  ref: taskToPrRefFor("cleanup_eligibility"),
  status: exports_external.enum(["not_ready", "preserved", "blocked", "eligible"]),
  targetWorktreeRef: taskToPrRefFor("worktree"),
  eventCursorRef: taskToPrRefFor("replay_cursor"),
  terminalDispositionRef: taskToPrRefFor("terminal_disposition"),
  writerLeaseRef: taskToPrRefFor("writer_lease"),
  leaseRevocationEvidenceRef: TaskToPrEvidenceRefSchema,
  consumedEventEvidenceRef: TaskToPrEvidenceRefSchema,
  evaluatedAt: TimestampSchema,
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict().superRefine((value, ctx) => {
  if (value.leaseRevocationEvidenceRef.id === value.consumedEventEvidenceRef.id || value.leaseRevocationEvidenceRef.digest === value.consumedEventEvidenceRef.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup lease-revocation and consumed-event facts require distinct evidence identities and digests",
      path: ["consumedEventEvidenceRef"]
    });
  }
});
var TaskToPrCleanupOutcomeSchema = exports_external.object({
  ref: taskToPrRefFor("cleanup_outcome"),
  eligibilityRef: taskToPrRefFor("cleanup_eligibility"),
  targetWorktreeRef: taskToPrRefFor("worktree"),
  status: exports_external.enum(["preserved", "deleted", "failed", "skipped"]),
  finishedAt: TimestampSchema,
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict();
var TaskToPrCleanupStateSchema = exports_external.object({
  eligibility: TaskToPrCleanupEligibilitySchema,
  outcome: TaskToPrCleanupOutcomeSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.outcome && !sameTaskToPrRef(value.outcome.eligibilityRef, value.eligibility.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup outcomes must bind the exact eligibility decision",
      path: ["outcome", "eligibilityRef"]
    });
  }
  if (value.outcome && !sameTaskToPrRef(value.outcome.targetWorktreeRef, value.eligibility.targetWorktreeRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility and outcome must bind the same target worktree",
      path: ["outcome", "targetWorktreeRef"]
    });
  }
  if (value.outcome?.status === "deleted" && value.eligibility.status !== "eligible") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deletion requires an eligible cleanup decision",
      path: ["outcome", "status"]
    });
  }
});
var TaskToPrRollbackSchema = exports_external.object({
  plan: exports_external.object({
    ref: taskToPrRefFor("rollback_plan"),
    targetRef: exports_external.union([taskToPrRefFor("commit"), taskToPrRefFor("branch")]),
    createdAt: TimestampSchema
  }).strict(),
  outcome: exports_external.object({
    ref: taskToPrRefFor("rollback_outcome"),
    planRef: taskToPrRefFor("rollback_plan"),
    targetRef: exports_external.union([taskToPrRefFor("commit"), taskToPrRefFor("branch")]),
    status: exports_external.enum(["not_run", "succeeded", "failed", "cancelled"]),
    finishedAt: TimestampSchema,
    evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  if (value.outcome && !sameTaskToPrRef(value.outcome.planRef, value.plan.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes must bind the exact rollback plan",
      path: ["outcome", "planRef"]
    });
  }
  if (value.outcome && !sameTaskToPrRef(value.outcome.targetRef, value.plan.targetRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes must bind the exact rollback target",
      path: ["outcome", "targetRef"]
    });
  }
  if (value.outcome && Date.parse(value.outcome.finishedAt) < Date.parse(value.plan.createdAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes cannot finish before their plan was created",
      path: ["outcome", "finishedAt"]
    });
  }
});
var TaskToPrProvenanceEntrySchema = exports_external.discriminatedUnion("category", [
  exports_external.object({
    category: exports_external.literal("projection_id"),
    projectionId: TaskToPrProjectionIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("work_run"),
    ref: taskToPrRefFor("work_run")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("attempt"),
    ref: taskToPrRefFor("attempt")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("admission"),
    ref: taskToPrRefFor("admission")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("worker_actor"),
    ref: taskToPrRefFor("worker_actor")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("worker_assignment"),
    ref: taskToPrRefFor("worker")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("attempt_nonce"),
    nonce: TaskToPrAttemptNonceSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("runtime"),
    ref: taskToPrRefFor("runtime")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("writer_generation"),
    ref: taskToPrRefFor("writer_generation")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("writer_lease"),
    ref: taskToPrRefFor("writer_lease")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("writer_fence"),
    ref: taskToPrRefFor("writer_fence")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("provider_profile"),
    ref: taskToPrRefFor("provider_profile")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("provider_route"),
    ref: taskToPrRefFor("provider_route")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("replay_cursor"),
    ref: taskToPrRefFor("replay_cursor")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("replay_prefix"),
    sequence: exports_external.number().int().safe().nonnegative(),
    prefixDigest: LowerSha256DigestSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("repair_state"),
    ref: taskToPrRefFor("repair_cycle")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("latest_repair"),
    ref: taskToPrRefFor("repair_cycle")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("handoff"),
    ref: taskToPrRefFor("handoff")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("recovery"),
    ref: taskToPrRefFor("recovery")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("merge_guard"),
    ref: taskToPrRefFor("merge_guard")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("cleanup_eligibility"),
    ref: taskToPrRefFor("cleanup_eligibility")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("rollback_plan"),
    ref: taskToPrRefFor("rollback_plan")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("terminal_disposition"),
    ref: taskToPrRefFor("terminal_disposition")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("equality_proof"),
    ref: taskToPrRefFor("proof_bundle"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("ci_proof"),
    ref: taskToPrRefFor("proof_bundle"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("review_proof"),
    ref: taskToPrRefFor("proof_bundle"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("review_record"),
    ref: taskToPrRefFor("review"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("review_run"),
    ref: taskToPrRefFor("review_run"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("provider_guard_receipt"),
    ref: taskToPrRefFor("merge_guard_receipt"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict()
]);
function taskToPrActiveProvenanceEntries(projection) {
  return [
    {
      category: "projection_id",
      projectionId: projection.id
    },
    {
      category: "work_run",
      ref: projection.workRunRef
    },
    {
      category: "attempt",
      ref: projection.attempt.ref
    },
    {
      category: "admission",
      ref: projection.attempt.admissionRef
    },
    {
      category: "worker_actor",
      ref: projection.attempt.workerActorRef
    },
    {
      category: "worker_assignment",
      ref: projection.attempt.workerRef
    },
    {
      category: "attempt_nonce",
      nonce: projection.attempt.nonce
    },
    {
      category: "runtime",
      ref: projection.attempt.runtimeRef
    },
    {
      category: "writer_generation",
      ref: projection.attempt.writerGenerationRef
    },
    {
      category: "writer_lease",
      ref: projection.attempt.writerLeaseRef
    },
    {
      category: "writer_fence",
      ref: projection.attempt.writerFenceRef
    },
    {
      category: "provider_profile",
      ref: projection.attempt.providerProfileRef
    },
    {
      category: "provider_route",
      ref: projection.attempt.providerRouteRef
    },
    {
      category: "replay_cursor",
      ref: projection.events.replayCursorRef
    },
    {
      category: "replay_prefix",
      sequence: projection.events.sequence,
      prefixDigest: projection.events.prefixDigest
    },
    {
      category: "repair_state",
      ref: projection.repair.ref
    },
    ...projection.repair.latestRepairRef ? [
      {
        category: "latest_repair",
        ref: projection.repair.latestRepairRef
      }
    ] : [],
    ...projection.handoff ? [{ category: "handoff", ref: projection.handoff.ref }] : [],
    ...projection.recovery ? [{ category: "recovery", ref: projection.recovery.ref }] : [],
    ...projection.exactHead ? [
      {
        category: "equality_proof",
        ref: projection.exactHead.equalityProofRef,
        base: projection.exactHead.expectedBase,
        head: projection.exactHead.localHead
      },
      ...projection.exactHead.ciProofBundleRefs.map((ref) => ({
        category: "ci_proof",
        ref,
        base: projection.exactHead.expectedBase,
        head: projection.exactHead.localHead
      }))
    ] : [],
    ...projection.reviews.flatMap((review) => [
      {
        category: "review_proof",
        ref: review.proofBundleRef,
        base: review.base,
        head: review.head
      },
      {
        category: "review_record",
        ref: review.ref,
        base: review.base,
        head: review.head
      },
      {
        category: "review_run",
        ref: review.reviewRunRef,
        base: review.base,
        head: review.head
      }
    ]),
    ...projection.merge ? [
      {
        category: "merge_guard",
        ref: projection.merge.guard.ref
      },
      {
        category: "provider_guard_receipt",
        ref: projection.merge.guard.providerGuardReceiptRef,
        base: projection.merge.guard.expectedBase,
        head: projection.merge.guard.expectedHead
      }
    ] : [],
    ...projection.cleanup ? [
      {
        category: "cleanup_eligibility",
        ref: projection.cleanup.eligibility.ref
      }
    ] : [],
    ...projection.rollback ? [
      {
        category: "rollback_plan",
        ref: projection.rollback.plan.ref
      }
    ] : [],
    ...projection.terminalDispositionRef ? [
      {
        category: "terminal_disposition",
        ref: projection.terminalDispositionRef
      }
    ] : []
  ];
}
function sameTaskToPrProvenanceEntry(left, right) {
  if (left.category !== right.category) {
    return false;
  }
  if (left.category === "projection_id" && right.category === "projection_id") {
    return left.projectionId === right.projectionId;
  }
  if (left.category === "attempt_nonce" && right.category === "attempt_nonce") {
    return left.nonce === right.nonce;
  }
  if (left.category === "replay_prefix" && right.category === "replay_prefix") {
    return left.sequence === right.sequence && left.prefixDigest === right.prefixDigest;
  }
  if (!("ref" in left) || !("ref" in right)) {
    return false;
  }
  return sameTaskToPrRef(left.ref, right.ref) && (("head" in left) && ("head" in right) && ("base" in left) && ("base" in right) && sameGitObjectId(left.base, right.base) && sameGitObjectId(left.head, right.head) || !("head" in left) && !("head" in right) && !("base" in left) && !("base" in right));
}
var TASK_TO_PR_V1_ADAPTER_EXTENSION_SCHEMA_PREFIX = "hasna.task_to_pr_adapter_extension.";
var TaskToPrAdapterExtensionSchema = exports_external.object({
  schema: SchemaIdSchema,
  ref: taskToPrRefFor("adapter_extension"),
  digest: LowerSha256DigestSchema
}).strict().superRefine((value, ctx) => {
  if (!value.schema.startsWith(TASK_TO_PR_V1_ADAPTER_EXTENSION_SCHEMA_PREFIX)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Adapter extension schema ids must use the permanently reserved task-to-PR adapter-extension namespace",
      path: ["schema"]
    });
  }
});
var TaskToPrProjectionStateSchema = exports_external.enum([
  "admitted",
  "running",
  "handed_off",
  "reviewing",
  "repairing",
  "merge_ready",
  "merged",
  "closed_unmerged",
  "failed",
  "blocked",
  "cancelled",
  "recovering",
  "cleanup_complete",
  "rolled_back"
]);
var TaskToPrStatesWithoutReviewAuthority = new Set([
  "admitted",
  "running",
  "handed_off"
]);
var TaskToPrTerminalStates = new Set([
  "merged",
  "closed_unmerged",
  "failed",
  "blocked",
  "cancelled",
  "cleanup_complete",
  "rolled_back"
]);
var TASK_TO_PR_STATE_MERGE_MATRIX = {
  admitted: new Set(["absent", "denied:none", "revoked:none"]),
  running: new Set(["absent", "denied:none", "revoked:none"]),
  handed_off: new Set(["absent", "denied:none", "revoked:none"]),
  reviewing: new Set(["absent", "denied:none", "revoked:none"]),
  repairing: new Set(["absent", "denied:none", "revoked:none"]),
  merge_ready: new Set(["eligible:none"]),
  merged: new Set(["consumed:merged"]),
  closed_unmerged: new Set([
    "consumed:closed_unmerged",
    "consumed:refused",
    "consumed:head_drift",
    "consumed:base_drift"
  ]),
  failed: new Set(["absent", "revoked:none"]),
  blocked: new Set(["absent", "revoked:none"]),
  cancelled: new Set(["absent", "revoked:none"]),
  recovering: new Set(["absent", "denied:none", "revoked:none"]),
  cleanup_complete: new Set([
    "absent",
    "revoked:none",
    "consumed:merged",
    "consumed:closed_unmerged",
    "consumed:refused",
    "consumed:head_drift",
    "consumed:base_drift"
  ]),
  rolled_back: new Set(["consumed:merged"])
};
var TaskToPrProjectionSchema = exports_external.object({
  schema: exports_external.literal(SCHEMA_IDS.taskToPrProjection),
  id: TaskToPrProjectionIdSchema,
  createdAt: TimestampSchema,
  canonicalizationVersion: exports_external.union([exports_external.literal(1), exports_external.literal(2)]),
  identityDigest: LowerSha256DigestSchema,
  frozenScopeDigest: LowerSha256DigestSchema,
  state: TaskToPrProjectionStateSchema,
  workRunRef: taskToPrRefFor("work_run"),
  rootRequestRef: taskToPrRefFor("root_request"),
  prGroupRef: taskToPrRefFor("pr_group"),
  leafTaskRef: taskToPrRefFor("leaf_task"),
  attempt: TaskToPrAttemptSchema,
  repository: TaskToPrRepositoryBindingSchema,
  events: TaskToPrEventCursorSchema,
  openLoopsInvocationRef: taskToPrRefFor("openloops_invocation").optional(),
  pullRequestRef: taskToPrRefFor("pull_request").optional(),
  exactHead: TaskToPrExactHeadBindingSchema.optional(),
  handoff: TaskToPrHandoffSchema.optional(),
  reviews: exports_external.array(TaskToPrReviewBindingSchema).default([]),
  repair: TaskToPrRepairStateSchema,
  merge: TaskToPrMergeStateSchema.optional(),
  recovery: TaskToPrRecoverySchema.optional(),
  cancellation: TaskToPrCancellationSchema.optional(),
  cleanup: TaskToPrCleanupStateSchema.optional(),
  rollback: TaskToPrRollbackSchema.optional(),
  terminalDispositionRef: taskToPrRefFor("terminal_disposition").optional(),
  provenanceLedger: exports_external.array(TaskToPrProvenanceEntrySchema),
  adapterExtensions: exports_external.array(TaskToPrAdapterExtensionSchema).default([]),
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).default([])
}).strict().superRefine((value, ctx) => {
  const derivedIdentityDigest = value.canonicalizationVersion === 1 ? deriveTaskToPrIdentityDigest({
    canonicalizationVersion: 1,
    rootRequestRef: value.rootRequestRef,
    prGroupRef: value.prGroupRef,
    leafTaskRef: value.leafTaskRef,
    repoRef: value.repository.repoRef,
    baseHead: value.repository.baseHead,
    frozenScopeDigest: value.frozenScopeDigest
  }) : deriveTaskToPrIdentityDigest({
    canonicalizationVersion: 2,
    rootRequestRef: value.rootRequestRef,
    prGroupRef: value.prGroupRef,
    leafTaskRef: value.leafTaskRef,
    repoRef: value.repository.repoRef,
    worktreeRef: value.repository.worktreeRef,
    branchRef: value.repository.branchRef,
    baseHead: value.repository.baseHead,
    frozenScopeDigest: value.frozenScopeDigest
  });
  if (value.identityDigest !== derivedIdentityDigest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "identityDigest must equal the selected v1 compatibility or v2 branch/worktree-bound canonical identity digest",
      path: ["identityDigest"]
    });
  }
  const provenanceIds = new Set;
  const provenanceDigests = new Set;
  const provenanceProjectionIds = new Set;
  const provenanceAttemptNonces = new Set;
  const provenanceReplayPrefixes = new Set;
  const provenanceReplaySequences = new Set;
  for (const [index, entry] of value.provenanceLedger.entries()) {
    if ("ref" in entry) {
      if (provenanceIds.has(entry.ref.id)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provenance entries cannot reuse a canonical owner id across categories or generations",
          path: ["provenanceLedger", index, "ref", "id"]
        });
      }
      provenanceIds.add(entry.ref.id);
      if (provenanceDigests.has(entry.ref.digest)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provenance entries cannot reuse a canonical digest across categories or generations",
          path: ["provenanceLedger", index, "ref", "digest"]
        });
      }
      provenanceDigests.add(entry.ref.digest);
      continue;
    }
    if (entry.category === "projection_id") {
      if (provenanceProjectionIds.has(entry.projectionId)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Projection identity provenance tombstones must be globally unique",
          path: ["provenanceLedger", index, "projectionId"]
        });
      }
      provenanceProjectionIds.add(entry.projectionId);
      continue;
    }
    if (entry.category === "attempt_nonce") {
      if (provenanceAttemptNonces.has(entry.nonce)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Attempt nonce provenance tombstones must be globally unique",
          path: ["provenanceLedger", index, "nonce"]
        });
      }
      provenanceAttemptNonces.add(entry.nonce);
      continue;
    }
    if (provenanceReplayPrefixes.has(entry.prefixDigest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Replay prefix provenance tombstones must be globally unique",
        path: ["provenanceLedger", index, "prefixDigest"]
      });
    }
    provenanceReplayPrefixes.add(entry.prefixDigest);
    if (provenanceReplaySequences.has(entry.sequence)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Replay prefix provenance entries must bind globally unique replay sequences",
        path: ["provenanceLedger", index, "sequence"]
      });
    }
    provenanceReplaySequences.add(entry.sequence);
  }
  for (const activeEntry of taskToPrActiveProvenanceEntries(value)) {
    if (!value.provenanceLedger.some((entry) => sameTaskToPrProvenanceEntry(entry, activeEntry))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `The active ${activeEntry.category} identity must be represented exactly in the monotonic provenance ledger`,
        path: ["provenanceLedger"]
      });
    }
  }
  const requiredCanonicalPreservationRefs = [
    value.rootRequestRef,
    value.prGroupRef,
    value.leafTaskRef,
    value.repository.repoRef,
    value.repository.worktreeRef,
    value.repository.branchRef,
    value.events.streamRef,
    ...value.pullRequestRef ? [value.pullRequestRef] : []
  ];
  const requirePreservedRefs = (preservedStateRefs, requiredRefs, path, label) => {
    const requiredRoles = new Set(requiredRefs.map((requiredRef) => requiredRef.role));
    const seenRoles = new Set;
    for (const [index, preservedRef] of preservedStateRefs.entries()) {
      if (!requiredRoles.has(preservedRef.role)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `${label} cannot preserve an unrecognized ${preservedRef.role} role`,
          path: [...path, index]
        });
      }
      if (seenRoles.has(preservedRef.role)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `${label} must preserve exactly one canonical ref per role`,
          path: [...path, index]
        });
      }
      seenRoles.add(preservedRef.role);
    }
    if (preservedStateRefs.length !== requiredRefs.length) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${label} preservation refs must exactly equal the required canonical role set`,
        path
      });
    }
    for (const requiredRef of requiredRefs) {
      if (!preservedStateRefs.some((preservedRef) => sameTaskToPrRef(preservedRef, requiredRef))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `${label} must preserve ${requiredRef.role}`,
          path
        });
      }
    }
  };
  if (value.handoff && !sameTaskToPrRef(value.handoff.nextWriterGenerationRef, value.attempt.writerGenerationRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Handoff next generation must be the current attempt writer generation",
      path: ["handoff", "nextWriterGenerationRef"]
    });
  }
  if (value.handoff && !sameTaskToPrRef(value.handoff.nextAttemptRef, value.attempt.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Handoff next attempt must be the current attempt",
      path: ["handoff", "nextAttemptRef"]
    });
  }
  if (value.handoff) {
    requireFreshTaskToPrRef(value.handoff.stoppedWorkRunRef, value.workRunRef, ctx, ["handoff", "stoppedWorkRunRef"], "Handoff WorkRun rotation");
  }
  if (value.recovery) {
    if (value.recovery.successorAttemptNonce !== value.attempt.nonce) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Recovery successor nonce must equal the current attempt nonce",
        path: ["recovery", "successorAttemptNonce"]
      });
    }
    if (!sameTaskToPrRef(value.recovery.successorWriterGenerationRef, value.attempt.writerGenerationRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Recovery successor generation must equal the current writer generation",
        path: ["recovery", "successorWriterGenerationRef"]
      });
    }
    requireFreshTaskToPrRef(value.recovery.priorAttemptRef, value.attempt.ref, ctx, ["recovery", "priorAttemptRef"], "Recovery attempt rotation");
    requireFreshTaskToPrRef(value.recovery.priorWorkRunRef, value.workRunRef, ctx, ["recovery", "priorWorkRunRef"], "Recovery WorkRun rotation");
    requirePreservedRefs(value.recovery.preservedStateRefs, [value.recovery.priorWorkRunRef, ...requiredCanonicalPreservationRefs], ["recovery", "preservedStateRefs"], "Recovery");
  }
  if (value.cancellation && !sameTaskToPrRef(value.cancellation.cancelledAttemptRef, value.attempt.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cancellation must bind the current attempt",
      path: ["cancellation", "cancelledAttemptRef"]
    });
  }
  if (value.cancellation) {
    requirePreservedRefs(value.cancellation.preservedStateRefs, [value.workRunRef, value.attempt.ref, ...requiredCanonicalPreservationRefs], ["cancellation", "preservedStateRefs"], "Cancellation");
  }
  if (value.cancellation && value.recovery) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "A projection cannot be both the cancellation and recovery snapshot",
      path: ["recovery"]
    });
  }
  if (value.handoff && value.recovery) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "A projection cannot be both the handoff and recovery snapshot",
      path: ["recovery"]
    });
  }
  if (value.cleanup && !sameTaskToPrRef(value.cleanup.eligibility.eventCursorRef, value.events.replayCursorRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the current canonical replay cursor",
      path: ["cleanup", "eligibility", "eventCursorRef"]
    });
  }
  if (value.cleanup && (!value.terminalDispositionRef || !sameTaskToPrRef(value.cleanup.eligibility.terminalDispositionRef, value.terminalDispositionRef))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the exact durable terminal owner fact",
      path: ["cleanup", "eligibility", "terminalDispositionRef"]
    });
  }
  if (value.cleanup && !sameTaskToPrRef(value.cleanup.eligibility.writerLeaseRef, value.attempt.writerLeaseRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the exact writer lease being revoked",
      path: ["cleanup", "eligibility", "writerLeaseRef"]
    });
  }
  if (value.cleanup && !sameTaskToPrRef(value.cleanup.eligibility.targetWorktreeRef, value.repository.worktreeRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the canonical worktree",
      path: ["cleanup", "eligibility", "targetWorktreeRef"]
    });
  }
  if (value.pullRequestRef) {
    if (value.exactHead && !sameTaskToPrRef(value.exactHead.pullRequestRef, value.pullRequestRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Exact-head proof must bind the canonical pull request ref",
        path: ["exactHead", "pullRequestRef"]
      });
    }
    for (const [reviewIndex, review] of value.reviews.entries()) {
      if (!sameTaskToPrRef(review.pullRequestRef, value.pullRequestRef)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Every review must bind the canonical pull request ref",
          path: ["reviews", reviewIndex, "pullRequestRef"]
        });
      }
    }
    if (value.merge && !sameTaskToPrRef(value.merge.guard.pullRequestRef, value.pullRequestRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guard must bind the canonical pull request ref",
        path: ["merge", "guard", "pullRequestRef"]
      });
    }
    if (value.merge?.outcome && !sameTaskToPrRef(value.merge.outcome.pullRequestRef, value.pullRequestRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome must bind the canonical pull request ref",
        path: ["merge", "outcome", "pullRequestRef"]
      });
    }
  } else if (value.exactHead || value.reviews.length > 0 || value.merge) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Review and merge state require a canonical pull request ref",
      path: ["pullRequestRef"]
    });
  }
  if (value.exactHead && !sameGitObjectId(value.exactHead.localHead, value.repository.branchHead)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact local head must equal the canonical branch head",
      path: ["exactHead", "localHead"]
    });
  }
  if (value.exactHead && !sameGitObjectId(value.exactHead.expectedBase, value.repository.baseHead)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact-head expected base must equal the canonical repository base",
      path: ["exactHead", "expectedBase"]
    });
  }
  if (value.exactHead && !sameTaskToPrRef(value.exactHead.remoteBranchRef, value.repository.branchRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact-head remote branch ref must equal the canonical repository branch ref",
      path: ["exactHead", "remoteBranchRef"]
    });
  }
  if (value.exactHead && Date.parse(value.exactHead.verifiedAt) < Date.parse(value.createdAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact-head verification cannot precede the projection timestamp",
      path: ["exactHead", "verifiedAt"]
    });
  }
  if (value.reviews.length > 0 && !value.exactHead) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Reviews require local/remote/provider exact-head proof",
      path: ["exactHead"]
    });
  }
  if (value.exactHead) {
    const proofObligations = [
      { ref: value.exactHead.equalityProofRef, path: ["exactHead", "equalityProofRef"] },
      ...value.exactHead.ciProofBundleRefs.map((ref, index) => ({
        ref,
        path: ["exactHead", "ciProofBundleRefs", index]
      })),
      ...value.reviews.map((review, index) => ({
        ref: review.proofBundleRef,
        path: ["reviews", index, "proofBundleRef"]
      }))
    ];
    const proofObligationKeys = new Set;
    const proofObligationDigests = new Set;
    for (const obligation of proofObligations) {
      const key = taskToPrCanonicalRefKey(obligation.ref);
      if (proofObligationKeys.has(key)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Exact-head equality, CI, and review proof obligations require globally unique canonical identities",
          path: obligation.path
        });
      }
      proofObligationKeys.add(key);
      if (proofObligationDigests.has(obligation.ref.digest)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Exact-head equality, CI, and review proof obligations require globally unique canonical digests",
          path: obligation.path
        });
      }
      proofObligationDigests.add(obligation.ref.digest);
    }
  }
  const reviewKeys = new Set;
  const reviewDigests = new Set;
  const reviewerKeys = new Set;
  const reviewerDigests = new Set;
  const reviewRunKeys = new Set;
  const reviewRunDigests = new Set;
  const reviewProofKeys = new Set;
  const reviewProofDigests = new Set;
  for (const [reviewIndex, review] of value.reviews.entries()) {
    if (!sameGitObjectId(review.base, value.repository.baseHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review base must equal the exact canonical pull-request base",
        path: ["reviews", reviewIndex, "base"]
      });
    }
    if (!sameGitObjectId(review.head, value.repository.branchHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review head must equal the exact canonical branch head",
        path: ["reviews", reviewIndex, "head"]
      });
    }
    for (const [key, seen, path] of [
      [review.ref.id, reviewKeys, "ref"],
      [review.reviewerRef.id, reviewerKeys, "reviewerRef"],
      [review.reviewRunRef.id, reviewRunKeys, "reviewRunRef"]
    ]) {
      if (seen.has(key)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Review, reviewer, and review-run refs must each be unique",
          path: ["reviews", reviewIndex, path]
        });
      }
      seen.add(key);
    }
    if (reviewDigests.has(review.ref.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review refs must resolve to distinct canonical record digests",
        path: ["reviews", reviewIndex, "ref"]
      });
    }
    reviewDigests.add(review.ref.digest);
    if (reviewerDigests.has(review.reviewerRef.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Reviewer refs must resolve to distinct canonical actor digests",
        path: ["reviews", reviewIndex, "reviewerRef"]
      });
    }
    reviewerDigests.add(review.reviewerRef.digest);
    if (reviewRunDigests.has(review.reviewRunRef.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review-run refs must resolve to distinct canonical run digests",
        path: ["reviews", reviewIndex, "reviewRunRef"]
      });
    }
    reviewRunDigests.add(review.reviewRunRef.digest);
    const reviewProofKey = taskToPrCanonicalRefKey(review.proofBundleRef);
    if (reviewProofKeys.has(reviewProofKey)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review proof bundles must have unique canonical identities",
        path: ["reviews", reviewIndex, "proofBundleRef"]
      });
    }
    reviewProofKeys.add(reviewProofKey);
    if (reviewProofDigests.has(review.proofBundleRef.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review proof bundles must have unique canonical digests",
        path: ["reviews", reviewIndex, "proofBundleRef"]
      });
    }
    reviewProofDigests.add(review.proofBundleRef.digest);
    if (review.reviewerRef.digest === value.attempt.workerRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker and reviewer identities must resolve to distinct canonical digests",
        path: ["reviews", reviewIndex, "reviewerRef"]
      });
    }
    if (review.reviewRunRef.digest === value.attempt.runtimeRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker runtime and review run must resolve to distinct canonical digests",
        path: ["reviews", reviewIndex, "reviewRunRef"]
      });
    }
    if (value.exactHead && Date.parse(review.reviewedAt) < Date.parse(value.exactHead.verifiedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Reviews cannot precede exact-head verification",
        path: ["reviews", reviewIndex, "reviewedAt"]
      });
    }
  }
  if (value.merge) {
    if (!value.exactHead) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge state requires local/remote/provider exact-head proof",
        path: ["exactHead"]
      });
    }
    if (!sameGitObjectId(value.merge.guard.expectedBase, value.repository.baseHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guard expected base must equal the exact canonical pull-request base",
        path: ["merge", "guard", "expectedBase"]
      });
    }
    if (!sameGitObjectId(value.merge.guard.expectedHead, value.repository.branchHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guard expected head must equal the exact canonical branch head",
        path: ["merge", "guard", "expectedHead"]
      });
    }
    if (value.exactHead && Date.parse(value.merge.guard.evaluatedAt) < Date.parse(value.exactHead.verifiedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guards cannot precede exact-head verification",
        path: ["merge", "guard", "evaluatedAt"]
      });
    }
    if (value.reviews.some((review) => Date.parse(value.merge.guard.evaluatedAt) < Date.parse(review.reviewedAt))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guards cannot precede their bound reviews",
        path: ["merge", "guard", "evaluatedAt"]
      });
    }
    if (value.merge.guard.operatorRef.digest === value.attempt.workerRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker and merge operator identities must resolve to distinct canonical digests",
        path: ["merge", "guard", "operatorRef"]
      });
    }
    if (value.merge.guard.operatorRunRef.digest === value.attempt.runtimeRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker runtime and merge-operator run must resolve to distinct canonical digests",
        path: ["merge", "guard", "operatorRunRef"]
      });
    }
    for (const [reviewIndex, review] of value.reviews.entries()) {
      if (value.merge.guard.operatorRef.digest === review.reviewerRef.digest) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Reviewer and merge operator identities must resolve to distinct canonical digests",
          path: ["reviews", reviewIndex, "reviewerRef"]
        });
      }
      if (value.merge.guard.operatorRunRef.digest === review.reviewRunRef.digest) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Review and merge-operator runs must resolve to distinct canonical digests",
          path: ["reviews", reviewIndex, "reviewRunRef"]
        });
      }
    }
    if (value.merge.guard.decision === "eligible" || value.merge.guard.decision === "consumed") {
      if (value.reviews.length === 0 || value.reviews.some((review) => review.verdict !== "approved")) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guards require at least one review and all reviews approved",
          path: ["merge", "guard", "decision"]
        });
      }
      if (value.merge.guard.reviewRefs.length !== value.reviews.length || value.merge.guard.reviewRefs.some((reviewRef) => !value.reviews.some((review) => sameTaskToPrRef(reviewRef, review.ref)))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guard review refs must exactly equal the projected approved review refs as a canonical set",
          path: ["merge", "guard", "reviewRefs"]
        });
      }
      for (const review of value.reviews) {
        if (!value.merge.guard.proofBundleRefs.some((proofRef) => sameTaskToPrRef(proofRef, review.proofBundleRef))) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Eligible merge guards must bind every exact review proof bundle",
            path: ["merge", "guard", "proofBundleRefs"]
          });
        }
      }
      if (value.exactHead && !value.merge.guard.proofBundleRefs.some((proofRef) => sameTaskToPrRef(proofRef, value.exactHead.equalityProofRef))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guards must bind the exact-head equality proof",
          path: ["merge", "guard", "proofBundleRefs"]
        });
      }
      if (value.exactHead && value.exactHead.ciProofBundleRefs.some((ciProofRef) => !value.merge.guard.proofBundleRefs.some((proofRef) => sameTaskToPrRef(proofRef, ciProofRef)))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guards must bind every exact-head CI proof",
          path: ["merge", "guard", "proofBundleRefs"]
        });
      }
    }
  }
  if (value.merge?.outcome) {
    if (!sameTaskToPrRef(value.merge.outcome.guardRef, value.merge.guard.ref)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome must bind the exact immutable merge guard",
        path: ["merge", "outcome", "guardRef"]
      });
    }
    if (!sameGitObjectId(value.merge.outcome.expectedHead, value.merge.guard.expectedHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome expected head must equal the guarded expected head",
        path: ["merge", "outcome", "expectedHead"]
      });
    }
    if (!sameGitObjectId(value.merge.outcome.expectedBase, value.merge.guard.expectedBase)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome expected base must equal the guarded expected base",
        path: ["merge", "outcome", "expectedBase"]
      });
    }
    if (value.merge.guard.decision !== "consumed") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Every merge outcome requires an explicitly consumed merge guard",
        path: ["merge", "guard", "decision"]
      });
    }
    if (Date.parse(value.merge.outcome.finishedAt) < Date.parse(value.merge.guard.evaluatedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcomes cannot precede guard evaluation",
        path: ["merge", "outcome", "finishedAt"]
      });
    }
  }
  if (value.cleanup) {
    const cleanupFloor = value.merge?.outcome?.finishedAt ?? value.createdAt;
    if (Date.parse(value.cleanup.eligibility.evaluatedAt) < Date.parse(cleanupFloor)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Cleanup eligibility cannot precede the terminal merge outcome or projection",
        path: ["cleanup", "eligibility", "evaluatedAt"]
      });
    }
    if (value.cleanup.outcome && Date.parse(value.cleanup.outcome.finishedAt) < Date.parse(value.cleanup.eligibility.evaluatedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Cleanup outcomes cannot precede cleanup eligibility",
        path: ["cleanup", "outcome", "finishedAt"]
      });
    }
  }
  if (value.rollback?.outcome && value.merge?.outcome && Date.parse(value.rollback.outcome.finishedAt) < Date.parse(value.merge.outcome.finishedAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes cannot precede the merge outcome they remediate",
      path: ["rollback", "outcome", "finishedAt"]
    });
  }
  if (value.rollback) {
    const rollbackFloor = value.merge?.outcome?.finishedAt ?? value.createdAt;
    if (Date.parse(value.rollback.plan.createdAt) < Date.parse(rollbackFloor)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Rollback plans cannot precede the terminal merge outcome or projection",
        path: ["rollback", "plan", "createdAt"]
      });
    }
  }
  if (value.state === "handed_off" && !value.handoff) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Handed-off projections require a handoff ref", path: ["handoff"] });
  }
  if (TaskToPrStatesWithoutReviewAuthority.has(value.state) && value.reviews.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections cannot carry review bindings before review authority is active`,
      path: ["reviews"]
    });
  }
  if ((TaskToPrStatesWithoutReviewAuthority.has(value.state) || value.state === "recovering") && (value.merge?.guard.reviewRefs.length ?? 0) > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections cannot hide review bindings in a merge guard before review authority is active`,
      path: ["merge", "guard", "reviewRefs"]
    });
  }
  const mergeMatrixKey = value.merge ? `${value.merge.guard.decision}:${value.merge.outcome?.status ?? "none"}` : "absent";
  if (!TASK_TO_PR_STATE_MERGE_MATRIX[value.state].has(mergeMatrixKey)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `State ${value.state} is incompatible with merge authority ${mergeMatrixKey}`,
      path: ["merge"]
    });
  }
  if (TaskToPrTerminalStates.has(value.state) && !value.terminalDispositionRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections require a durable Todos terminal-disposition owner ref`,
      path: ["terminalDispositionRef"]
    });
  }
  if (!TaskToPrTerminalStates.has(value.state) && value.terminalDispositionRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections cannot carry a terminal-disposition owner ref`,
      path: ["terminalDispositionRef"]
    });
  }
  if (value.state === "reviewing" && value.reviews.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Reviewing projections require review refs", path: ["reviews"] });
  }
  if (value.state === "cancelled" && !value.cancellation) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Cancelled projections require preservation state", path: ["cancellation"] });
  }
  if (value.cancellation && value.merge?.outcome) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cancellation cannot coexist with a terminal merge outcome",
      path: ["cancellation"]
    });
  }
  if (value.state === "recovering" && !value.recovery) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Recovering projections require recovery state", path: ["recovery"] });
  }
  if (value.state === "repairing" && value.repair.cycle === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Repairing projections require a non-zero repair cycle", path: ["repair", "cycle"] });
  }
  if (value.merge && (value.merge.guard.decision === "eligible" || value.merge.guard.decision === "consumed") && !sameTaskToPrRef(value.attempt.admissionWriterGenerationRef, value.attempt.writerGenerationRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge eligibility requires admission from the current writer generation",
      path: ["attempt", "admissionWriterGenerationRef"]
    });
  }
  if (value.state === "merge_ready" && value.merge?.guard.decision !== "eligible") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Merge-ready projections require an eligible guard", path: ["merge"] });
  }
  if (value.state === "merged" && value.merge?.outcome?.status !== "merged") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Merged projections require a merged immutable outcome", path: ["merge"] });
  }
  if (value.state === "closed_unmerged" && !value.merge?.outcome?.status.match(/^(closed_unmerged|refused|head_drift|base_drift)$/)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Closed-unmerged projections require a non-merged terminal outcome",
      path: ["merge"]
    });
  }
  if (value.state === "cleanup_complete" && (!value.cleanup?.outcome || !["deleted", "preserved", "skipped"].includes(value.cleanup.outcome.status))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup-complete projections require an immutable cleanup outcome",
      path: ["cleanup"]
    });
  }
  if (value.state === "rolled_back" && value.rollback?.outcome?.status !== "succeeded") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rolled-back projections require a successful rollback outcome",
      path: ["rollback"]
    });
  }
  if ((value.state === "failed" || value.state === "blocked") && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed and blocked projections require redacted evidence refs",
      path: ["evidenceRefs"]
    });
  }
  if (["admitted", "running", "handed_off", "reviewing", "repairing", "merge_ready", "recovering"].includes(value.state) && (value.merge?.outcome || value.cancellation || value.cleanup?.outcome || value.rollback?.outcome)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Non-terminal projections cannot carry terminal owner outcomes",
      path: ["state"]
    });
  }
  const extensionKeys = new Set;
  for (const [index, extension] of value.adapterExtensions.entries()) {
    const key = `${extension.schema}:${extension.ref.id}`;
    if (extensionKeys.has(key)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Adapter extensions must be unique per schema and referenced object",
        path: ["adapterExtensions", index]
      });
    }
    extensionKeys.add(key);
  }
});
function taskToPrHeadBoundEvidenceBindings(projection) {
  return [
    ...projection.exactHead ? [
      {
        category: "equality_proof",
        ref: projection.exactHead.equalityProofRef,
        path: "exactHead.equalityProofRef"
      },
      ...projection.exactHead.ciProofBundleRefs.map((ref, index) => ({
        category: "ci_proof",
        ref,
        path: `exactHead.ciProofBundleRefs.${index}`
      }))
    ] : [],
    ...projection.reviews.flatMap((review, index) => [
      {
        category: "review_proof",
        ref: review.proofBundleRef,
        path: `reviews.${index}.proofBundleRef`
      },
      {
        category: "review_record",
        ref: review.ref,
        path: `reviews.${index}.ref`
      },
      {
        category: "review_run",
        ref: review.reviewRunRef,
        path: `reviews.${index}.reviewRunRef`
      }
    ])
  ];
}
var TASK_TO_PR_CHANGED_HEAD_EVIDENCE_IDENTITY_MESSAGE = "A changed branch head requires every head-bound evidence ref to use a fresh canonical identity";
var TASK_TO_PR_CHANGED_HEAD_EVIDENCE_DIGEST_MESSAGE = "A changed branch head requires every head-bound evidence ref to use a fresh digest";
var TASK_TO_PR_LEGAL_STATE_TRANSITIONS = {
  admitted: ["admitted", "running", "failed", "blocked", "cancelled", "recovering"],
  running: [
    "running",
    "handed_off",
    "reviewing",
    "repairing",
    "merge_ready",
    "failed",
    "blocked",
    "cancelled",
    "recovering"
  ],
  handed_off: ["handed_off", "running", "reviewing", "repairing", "failed", "blocked", "cancelled", "recovering"],
  reviewing: ["reviewing", "repairing", "merge_ready", "failed", "blocked", "cancelled", "recovering", "closed_unmerged"],
  repairing: ["repairing", "running", "reviewing", "merge_ready", "failed", "blocked", "cancelled", "recovering", "closed_unmerged"],
  merge_ready: ["merge_ready", "repairing", "merged", "closed_unmerged", "failed", "blocked", "cancelled"],
  merged: ["merged", "cleanup_complete", "rolled_back"],
  closed_unmerged: ["closed_unmerged", "cleanup_complete"],
  failed: ["failed", "cleanup_complete", "rolled_back"],
  blocked: ["blocked", "cancelled", "cleanup_complete"],
  cancelled: ["cancelled", "cleanup_complete"],
  recovering: ["recovering", "running", "handed_off", "failed", "blocked", "cancelled"],
  cleanup_complete: ["cleanup_complete"],
  rolled_back: ["rolled_back"]
};
function taskToPrParseIssues(prefix, issues) {
  return issues.map((issue2) => ({
    path: [prefix, ...issue2.path].join("."),
    message: issue2.message
  }));
}
function validateTaskToPrProjectionTransition(previousInput, currentInput) {
  const issues = [];
  const addIssue = (path, message) => issues.push({ path, message });
  const parsedPrevious = TaskToPrProjectionSchema.safeParse(previousInput);
  const parsedCurrent = TaskToPrProjectionSchema.safeParse(currentInput);
  if (!parsedPrevious.success) {
    issues.push(...taskToPrParseIssues("previous", parsedPrevious.error.issues));
  }
  if (!parsedCurrent.success) {
    issues.push(...taskToPrParseIssues("current", parsedCurrent.error.issues));
  }
  if (!parsedPrevious.success || !parsedCurrent.success) {
    return { success: false, issues };
  }
  const previous = parsedPrevious.data;
  const current = parsedCurrent.data;
  const previousActiveProvenance = taskToPrActiveProvenanceEntries(previous);
  const currentActiveProvenance = taskToPrActiveProvenanceEntries(current);
  if (current.provenanceLedger.length < previous.provenanceLedger.length || previous.provenanceLedger.some((entry, index) => !current.provenanceLedger[index] || !sameTaskToPrProvenanceEntry(entry, current.provenanceLedger[index]))) {
    addIssue("provenanceLedger", "The provenance ledger is append-only and must retain the previous ledger as an exact immutable prefix");
  }
  const appendedProvenance = current.provenanceLedger.slice(previous.provenanceLedger.length);
  for (const [index, entry] of appendedProvenance.entries()) {
    if (!currentActiveProvenance.some((activeEntry) => sameTaskToPrProvenanceEntry(activeEntry, entry))) {
      addIssue(`provenanceLedger.${previous.provenanceLedger.length + index}`, "A newly appended provenance entry must represent an active identity in the current snapshot");
    }
  }
  for (const activeEntry of currentActiveProvenance) {
    const existedBefore = previous.provenanceLedger.some((entry) => sameTaskToPrProvenanceEntry(entry, activeEntry));
    const wasActiveBefore = previousActiveProvenance.some((entry) => sameTaskToPrProvenanceEntry(entry, activeEntry));
    if (existedBefore && !wasActiveBefore) {
      addIssue("provenanceLedger", `The ${activeEntry.category} identity cannot reactivate after becoming inactive`);
    }
  }
  const validateOwnerRecordTransition = (path, previousRecord, currentRecord) => {
    if (!previousRecord || !currentRecord || JSON.stringify(previousRecord) === JSON.stringify(currentRecord)) {
      return;
    }
    if (sameTaskToPrCanonicalRefId(previousRecord.ref, currentRecord.ref)) {
      addIssue(path, "An owner record must remain exactly immutable while its canonical ref identity is unchanged");
      return;
    }
    if (previousRecord.ref.digest === currentRecord.ref.digest) {
      addIssue(path, "A rotated owner record requires both a fresh canonical ref identity and a fresh digest");
    }
  };
  if (previous.id !== current.id) {
    addIssue("id", "The canonical top-level projection id is immutable across legal transitions");
  }
  if (Date.parse(current.createdAt) < Date.parse(previous.createdAt)) {
    addIssue("createdAt", "Projection timestamps cannot move backwards");
  }
  const {
    id: _previousId,
    createdAt: _previousCreatedAt,
    events: _previousEvents,
    provenanceLedger: _previousProvenanceLedger,
    ...previousSemanticState
  } = previous;
  const {
    id: _currentId,
    createdAt: _currentCreatedAt,
    events: _currentEvents,
    provenanceLedger: _currentProvenanceLedger,
    ...currentSemanticState
  } = current;
  if (JSON.stringify(previousSemanticState) !== JSON.stringify(currentSemanticState) && current.events.sequence <= previous.events.sequence) {
    addIssue("events.sequence", "Semantic lifecycle drift requires replay sequence and cursor advancement");
  }
  for (const [path, left, right] of [
    ["identityDigest", previous.identityDigest, current.identityDigest],
    ["frozenScopeDigest", previous.frozenScopeDigest, current.frozenScopeDigest],
    ["rootRequestRef", JSON.stringify(previous.rootRequestRef), JSON.stringify(current.rootRequestRef)],
    ["prGroupRef", JSON.stringify(previous.prGroupRef), JSON.stringify(current.prGroupRef)],
    ["leafTaskRef", JSON.stringify(previous.leafTaskRef), JSON.stringify(current.leafTaskRef)],
    ["repository.repoRef", JSON.stringify(previous.repository.repoRef), JSON.stringify(current.repository.repoRef)],
    ["repository.worktreeRef", JSON.stringify(previous.repository.worktreeRef), JSON.stringify(current.repository.worktreeRef)],
    ["repository.branchRef", JSON.stringify(previous.repository.branchRef), JSON.stringify(current.repository.branchRef)],
    ["repository.baseHead", JSON.stringify(previous.repository.baseHead), JSON.stringify(current.repository.baseHead)],
    ["events.streamRef", JSON.stringify(previous.events.streamRef), JSON.stringify(current.events.streamRef)]
  ]) {
    if (left !== right) {
      addIssue(path, "Canonical task-to-PR identity cannot change between projections");
    }
  }
  if (previous.pullRequestRef && (!current.pullRequestRef || !sameTaskToPrRef(previous.pullRequestRef, current.pullRequestRef))) {
    addIssue("pullRequestRef", "An established canonical pull-request identity cannot change or disappear");
  }
  if (sameGitObjectId(previous.repository.branchHead, current.repository.branchHead)) {
    if (previous.exactHead && JSON.stringify(current.exactHead) !== JSON.stringify(previous.exactHead)) {
      addIssue("exactHead", "An established same-head exact-head fact is immutable and cannot change or disappear");
    }
    if (current.reviews.length < previous.reviews.length || previous.reviews.some((previousReview, index) => JSON.stringify(current.reviews[index]) !== JSON.stringify(previousReview))) {
      addIssue("reviews", "Same-head review history is an exact immutable prefix; existing review bindings cannot move, change, or disappear");
    }
  } else {
    const previousHeadBoundEvidence = taskToPrHeadBoundEvidenceBindings(previous);
    const currentHeadBoundEvidence = taskToPrHeadBoundEvidenceBindings(current);
    const previousHeadBoundEvidenceKeys = new Set(previousHeadBoundEvidence.map(({ ref }) => taskToPrCanonicalRefKey(ref)));
    const previousHeadBoundEvidenceDigests = new Set(previousHeadBoundEvidence.map(({ ref }) => ref.digest));
    for (const { ref, path } of currentHeadBoundEvidence) {
      if (previousHeadBoundEvidenceKeys.has(taskToPrCanonicalRefKey(ref))) {
        addIssue(path, TASK_TO_PR_CHANGED_HEAD_EVIDENCE_IDENTITY_MESSAGE);
      }
      if (previousHeadBoundEvidenceDigests.has(ref.digest)) {
        addIssue(path, TASK_TO_PR_CHANGED_HEAD_EVIDENCE_DIGEST_MESSAGE);
      }
    }
  }
  if (current.state === "recovering" && (current.exactHead || current.reviews.length > 0)) {
    if (!sameGitObjectId(previous.repository.branchHead, current.repository.branchHead) || JSON.stringify(previous.exactHead) !== JSON.stringify(current.exactHead) || JSON.stringify(previous.reviews) !== JSON.stringify(current.reviews)) {
      addIssue("recovery", "Recovery may retain exact-head and review facts only unchanged from the immediately prior same-head snapshot");
    }
  }
  if (current.events.sequence < previous.events.sequence) {
    addIssue("events.sequence", "Replay sequence cannot decrease");
  } else if (current.events.sequence === previous.events.sequence) {
    if (current.events.prefixDigest !== previous.events.prefixDigest || !sameTaskToPrRef(current.events.replayCursorRef, previous.events.replayCursorRef)) {
      addIssue("events", "An unchanged replay sequence must retain the same cursor and prefix digest");
    }
  } else {
    if (sameTaskToPrCanonicalRefId(current.events.replayCursorRef, previous.events.replayCursorRef)) {
      addIssue("events.replayCursorRef", "An advanced replay sequence requires a fresh canonical replay cursor ref");
    }
    if (current.events.replayCursorRef.digest === previous.events.replayCursorRef.digest) {
      addIssue("events.replayCursorRef", "An advanced replay sequence requires a fresh replay cursor digest");
    }
    if (current.events.prefixDigest === previous.events.prefixDigest) {
      addIssue("events.prefixDigest", "An advanced replay sequence requires a fresh prefix digest");
    }
  }
  if (current.repair.cycle < previous.repair.cycle || current.repair.cycle > previous.repair.cycle + 1) {
    addIssue("repair.cycle", "Repair cycles are cumulative, monotonic, and append at most one cycle per transition");
  }
  if (current.repair.cycle === previous.repair.cycle + 1) {
    const previousRepairRefs = [
      previous.repair.ref,
      ...previous.repair.latestRepairRef ? [previous.repair.latestRepairRef] : []
    ];
    for (const previousRepairRef of previousRepairRefs) {
      if (sameTaskToPrCanonicalRefId(current.repair.ref, previousRepairRef)) {
        addIssue("repair.ref", "An advanced repair cycle requires a repair-state ref fresh from both prior repair slots");
      }
      if (current.repair.ref.digest === previousRepairRef.digest) {
        addIssue("repair.ref", "An advanced repair cycle requires a repair-state digest fresh from both prior repair slots");
      }
    }
    if (!current.repair.latestRepairRef) {
      addIssue("repair.latestRepairRef", "An advanced repair cycle requires a fresh latest-repair ref");
    } else {
      for (const previousRepairRef of previousRepairRefs) {
        if (sameTaskToPrCanonicalRefId(current.repair.latestRepairRef, previousRepairRef)) {
          addIssue("repair.latestRepairRef", "An advanced repair cycle requires a latest-repair ref fresh from both prior repair slots");
        }
        if (current.repair.latestRepairRef.digest === previousRepairRef.digest) {
          addIssue("repair.latestRepairRef", "An advanced repair cycle requires a latest-repair digest fresh from both prior repair slots");
        }
      }
    }
  } else if (current.repair.cycle === previous.repair.cycle && JSON.stringify(current.repair) !== JSON.stringify(previous.repair)) {
    addIssue("repair", "An unchanged repair cycle must retain the same immutable repair refs");
  }
  const enteringRepair = previous.state !== "repairing" && current.state === "repairing";
  if (enteringRepair && current.repair.cycle !== previous.repair.cycle + 1) {
    addIssue("repair.cycle", "Every entry into repairing must consume exactly one repair cycle");
  }
  if (enteringRepair && previous.repair.exhausted) {
    addIssue("repair.exhausted", "An exhausted repair budget cannot enter repairing");
  }
  if (TaskToPrTerminalStates.has(previous.state) && JSON.stringify(current.repair) !== JSON.stringify(previous.repair)) {
    addIssue("repair", "Repair state is frozen after terminal disposition");
  }
  const attemptChanged = !sameTaskToPrCanonicalRefId(previous.attempt.ref, current.attempt.ref);
  const nonceChanged = previous.attempt.nonce !== current.attempt.nonce;
  const generationChanged = !sameTaskToPrCanonicalRefId(previous.attempt.writerGenerationRef, current.attempt.writerGenerationRef);
  const workRunChanged = !sameTaskToPrCanonicalRefId(previous.workRunRef, current.workRunRef);
  if (new Set([attemptChanged, nonceChanged, generationChanged, workRunChanged]).size !== 1) {
    addIssue("attempt", "Attempt ref, nonce, writer generation, and WorkRun must either all remain stable or all advance together");
  }
  if (attemptChanged && (!current.recovery && !current.handoff)) {
    addIssue("attempt", "A fresh attempt requires an explicit recovery or handoff transition ref");
  }
  if (attemptChanged && current.recovery && current.handoff) {
    addIssue("attempt", "A fresh attempt must use exactly one recovery or handoff transition");
  }
  if (!attemptChanged && (current.recovery || current.handoff) && !previous.recovery && !previous.handoff) {
    addIssue("attempt", "Recovery and handoff transitions require a fresh attempt");
  }
  if (!attemptChanged && JSON.stringify(previous.handoff) !== JSON.stringify(current.handoff)) {
    addIssue("handoff", "An unchanged attempt must retain its exact immutable handoff provenance");
  }
  if (!attemptChanged && JSON.stringify(previous.recovery) !== JSON.stringify(current.recovery)) {
    addIssue("recovery", "An unchanged attempt must retain its exact immutable recovery provenance");
  }
  if (!attemptChanged && JSON.stringify(previous.attempt) !== JSON.stringify(current.attempt)) {
    addIssue("attempt", "An unchanged attempt identity cannot mutate attempt-scoped owner refs");
  }
  if (!generationChanged && !sameTaskToPrRef(previous.attempt.writerGenerationRef, current.attempt.writerGenerationRef)) {
    addIssue("attempt.writerGenerationRef", "An unchanged writer-generation identity cannot mutate its digest");
  }
  if (!workRunChanged && !sameTaskToPrRef(previous.workRunRef, current.workRunRef)) {
    addIssue("workRunRef", "An unchanged WorkRun identity cannot mutate its digest");
  }
  if (attemptChanged) {
    if (current.attempt.ref.digest === previous.attempt.ref.digest) {
      addIssue("attempt.ref", "A fresh attempt requires a fresh attempt digest");
    }
    if (current.attempt.writerGenerationRef.digest === previous.attempt.writerGenerationRef.digest) {
      addIssue("attempt.writerGenerationRef", "A fresh attempt requires a fresh writer-generation digest");
    }
    if (current.workRunRef.digest === previous.workRunRef.digest) {
      addIssue("workRunRef", "A fresh attempt requires a fresh WorkRun digest");
    }
    for (const field of [
      "admissionRef",
      "workerRef",
      "runtimeRef",
      "writerLeaseRef",
      "writerFenceRef",
      "providerProfileRef",
      "providerRouteRef"
    ]) {
      if (sameTaskToPrCanonicalRefId(previous.attempt[field], current.attempt[field]) || previous.attempt[field].digest === current.attempt[field].digest) {
        addIssue(`attempt.${field}`, `A fresh attempt requires a fresh ${field}`);
      }
    }
    if (current.recovery) {
      if (!sameTaskToPrRef(current.recovery.priorAttemptRef, previous.attempt.ref)) {
        addIssue("recovery.priorAttemptRef", "Recovery must bind the immediately prior attempt");
      }
      if (!sameTaskToPrRef(current.recovery.priorWriterGenerationRef, previous.attempt.writerGenerationRef)) {
        addIssue("recovery.priorWriterGenerationRef", "Recovery must bind the immediately prior writer generation");
      }
      if (!sameTaskToPrRef(current.recovery.priorWorkRunRef, previous.workRunRef)) {
        addIssue("recovery.priorWorkRunRef", "Recovery must bind the immediately prior WorkRun");
      }
    }
    if (current.handoff) {
      if (!sameTaskToPrRef(current.handoff.previousAttemptRef, previous.attempt.ref)) {
        addIssue("handoff.previousAttemptRef", "Handoff must bind the immediately prior attempt");
      }
      if (!sameTaskToPrRef(current.handoff.nextAttemptRef, current.attempt.ref)) {
        addIssue("handoff.nextAttemptRef", "Handoff must bind the successor attempt");
      }
      if (!sameTaskToPrRef(current.handoff.previousWriterGenerationRef, previous.attempt.writerGenerationRef)) {
        addIssue("handoff.previousWriterGenerationRef", "Handoff must bind the immediately prior writer generation");
      }
      if (!sameTaskToPrRef(current.handoff.stoppedWorkRunRef, previous.workRunRef)) {
        addIssue("handoff.stoppedWorkRunRef", "Handoff must bind the immediately prior WorkRun");
      }
    }
  }
  if (!TASK_TO_PR_LEGAL_STATE_TRANSITIONS[previous.state].includes(current.state)) {
    addIssue("state", `Illegal task-to-PR lifecycle transition from ${previous.state} to ${current.state}`);
  }
  if (previous.merge?.guard.decision === "eligible" && current.state !== "merge_ready") {
    if (!current.merge) {
      addIssue("merge", "Leaving merge_ready requires an explicit revoked or consumed successor for the eligible guard");
    } else {
      const expectedDecision = current.merge.outcome ? "consumed" : "revoked";
      if (current.merge.guard.decision !== expectedDecision) {
        addIssue("merge.guard.decision", `Leaving merge_ready requires the eligible guard to become ${expectedDecision}`);
      }
      if (!sameTaskToPrMergeGuardLineageFacts(previous.merge.guard, current.merge.guard)) {
        addIssue("merge.guard", "A revoked or consumed successor guard must preserve the eligible guard's exact authority facts");
      }
      if (Date.parse(current.merge.guard.evaluatedAt) < Date.parse(previous.merge.guard.evaluatedAt)) {
        addIssue("merge.guard.evaluatedAt", "A revoked or consumed successor guard cannot precede the eligible guard");
      }
    }
  }
  validateOwnerRecordTransition("handoff", previous.handoff, current.handoff);
  validateOwnerRecordTransition("recovery", previous.recovery, current.recovery);
  validateOwnerRecordTransition("merge.guard", previous.merge?.guard, current.merge?.guard);
  if (previous.merge && current.merge && (!sameGitObjectId(previous.merge.guard.expectedBase, current.merge.guard.expectedBase) || !sameGitObjectId(previous.merge.guard.expectedHead, current.merge.guard.expectedHead))) {
    if (sameTaskToPrCanonicalRefId(previous.merge.guard.providerGuardReceiptRef, current.merge.guard.providerGuardReceiptRef)) {
      addIssue("merge.guard.providerGuardReceiptRef", "A changed guarded base or head requires a fresh provider guard receipt identity");
    }
    if (previous.merge.guard.providerGuardReceiptRef.digest === current.merge.guard.providerGuardReceiptRef.digest) {
      addIssue("merge.guard.providerGuardReceiptRef", "A changed guarded base or head requires a fresh provider guard receipt digest");
    }
  }
  validateOwnerRecordTransition("cleanup.eligibility", previous.cleanup?.eligibility, current.cleanup?.eligibility);
  validateOwnerRecordTransition("rollback.plan", previous.rollback?.plan, current.rollback?.plan);
  if (previous.terminalDispositionRef && (!current.terminalDispositionRef || !sameTaskToPrRef(previous.terminalDispositionRef, current.terminalDispositionRef))) {
    addIssue("terminalDispositionRef", "A durable terminal-disposition owner fact cannot change or disappear");
  }
  for (const [path, left, right] of [
    ["merge", previous.merge?.outcome ? previous.merge : undefined, current.merge],
    ["cancellation", previous.cancellation, current.cancellation],
    ["cleanup", previous.cleanup?.outcome ? previous.cleanup : undefined, current.cleanup],
    ["rollback", previous.rollback?.outcome ? previous.rollback : undefined, current.rollback]
  ]) {
    if (left && JSON.stringify(left) !== JSON.stringify(right)) {
      addIssue(path, "Complete immutable terminal owner facts cannot change or disappear");
    }
  }
  return issues.length === 0 ? { success: true, issues: [] } : { success: false, issues };
}
function validateTaskToPrAdapterCoreEquivalence(firstInput, secondInput) {
  const issues = [];
  const parsedFirst = TaskToPrProjectionSchema.safeParse(firstInput);
  const parsedSecond = TaskToPrProjectionSchema.safeParse(secondInput);
  if (!parsedFirst.success) {
    issues.push(...taskToPrParseIssues("first", parsedFirst.error.issues));
  }
  if (!parsedSecond.success) {
    issues.push(...taskToPrParseIssues("second", parsedSecond.error.issues));
  }
  if (!parsedFirst.success || !parsedSecond.success) {
    return { success: false, issues };
  }
  const { adapterExtensions: _firstExtensions, ...firstCore } = parsedFirst.data;
  const { adapterExtensions: _secondExtensions, ...secondCore } = parsedSecond.data;
  if (JSON.stringify(firstCore) !== JSON.stringify(secondCore)) {
    return {
      success: false,
      issues: [
        {
          path: "core",
          message: "Adapter projections must serialize byte-equivalent task-to-PR core projections"
        }
      ]
    };
  }
  return { success: true, issues: [] };
}
var TrajectoryEventSchema = exports_external.object({
  id: exports_external.string().min(1),
  at: TimestampSchema,
  kind: exports_external.enum(["message", "tool_call", "command", "file_change", "error", "test", "decision", "verification", "status", "other"]),
  summary: exports_external.string().min(1),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  costEstimate: CostEstimateSchema.optional()
}).strict();
var AgentTrajectorySchema = contractBaseSchema(SCHEMA_IDS.agentTrajectory).extend({
  actor: ActorPointerSchema,
  workRunRef: ResourcePointerSchema.optional(),
  events: exports_external.array(TrajectoryEventSchema).default([]),
  outcome: exports_external.enum(["succeeded", "failed", "cancelled", "blocked", "unknown"]).default("unknown"),
  proofBundleRef: ResourcePointerSchema.optional()
}).strict();
var SERVICE_CONTRACT_VERSION = "v1";
var RepoClassSchema = exports_external.enum(["library", "cli-with-store", "service", "saas"]);
var HOSTING_MODES = ["user-hosted", "hasna-saas"];
var HostingModeSchema = exports_external.enum(HOSTING_MODES);
var SERVICE_SURFACE_KINDS = ["api", "sdk", "mcp", "cli"];
var ServiceSurfaceKindSchema = exports_external.enum(SERVICE_SURFACE_KINDS);
var ServiceSurfaceStatusSchema = exports_external.enum(["supported", "deferred", "unsupported"]);
var ServiceAuthModeSchema = exports_external.enum(["none", "local-only", "api-key", "session", "service-token", "custom"]);
var ServiceEndpointSchema = exports_external.object({
  method: exports_external.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: exports_external.string().regex(/^\/[A-Za-z0-9_./:*-]*$/, "Endpoint paths must be absolute HTTP paths"),
  public: exports_external.boolean().default(false),
  description: exports_external.string().min(1).optional()
}).strict();
var DeploymentReadinessGateSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: exports_external.enum(["auth", "storage", "secret-ref", "migration", "health", "readiness", "redaction", "smoke", "operator", "other"]),
  required: exports_external.boolean().default(true),
  command: exports_external.string().min(1).optional(),
  evidenceRef: EvidencePointerSchema.optional(),
  status: exports_external.enum(["pending", "passed", "failed", "blocked", "deferred"]).default("pending"),
  summary: exports_external.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if ((value.status === "passed" || value.status === "failed" || value.status === "blocked") && !value.command && !value.evidenceRef && !value.summary) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Terminal readiness gates require command, evidenceRef, or summary",
      path: ["status"]
    });
  }
});
var ServiceSurfaceSchema = exports_external.object({
  name: exports_external.string().min(1),
  kind: ServiceSurfaceKindSchema.optional(),
  status: ServiceSurfaceStatusSchema,
  bin: exports_external.string().min(1).optional(),
  mcpBin: exports_external.string().min(1).optional(),
  authMode: ServiceAuthModeSchema,
  health: ServiceEndpointSchema.optional(),
  readiness: ServiceEndpointSchema.optional(),
  version: ServiceEndpointSchema.optional(),
  apiBasePath: exports_external.string().regex(/^\/v[0-9]+$/, "Stable API base path must be /vN").optional(),
  openApiPath: exports_external.string().regex(/^\/[A-Za-z0-9_./:-]*$/).optional(),
  exportSubpath: exports_external.string().regex(/^\.(?:\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/, "SDK export subpaths must be package export keys such as . or ./sdk").optional(),
  generatedFrom: exports_external.string().regex(/^\/[A-Za-z0-9_./:-]*$/, "SDK generatedFrom must reference an absolute OpenAPI path").optional(),
  clientClassName: exports_external.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/).optional(),
  deferReason: exports_external.string().min(1).optional(),
  readinessGates: exports_external.array(DeploymentReadinessGateSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "supported") {
    if (!value.kind || value.kind === "api") {
      if (!value.bin) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a serve bin", path: ["bin"] });
      }
      if (!value.health) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a health endpoint", path: ["health"] });
      }
      if (!value.readiness) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a readiness endpoint", path: ["readiness"] });
      }
      if (!value.version) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a version endpoint", path: ["version"] });
      }
    }
    if (value.kind === "cli" && !value.bin) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported CLI surfaces require a bin", path: ["bin"] });
    }
    if (value.kind === "mcp" && !value.mcpBin) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported MCP surfaces require an mcpBin", path: ["mcpBin"] });
    }
    if (value.kind === "sdk" && !value.exportSubpath) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported SDK surfaces require an exportSubpath", path: ["exportSubpath"] });
    }
  }
  if ((value.status === "deferred" || value.status === "unsupported") && !value.deferReason) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deferred or unsupported service surfaces require a deferReason",
      path: ["deferReason"]
    });
  }
  if (value.health && value.health.path !== "/health") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Health endpoint must be /health", path: ["health", "path"] });
  }
  if (value.health && value.health.method !== "GET") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Health endpoint must use GET", path: ["health", "method"] });
  }
  if (value.readiness && value.readiness.path !== "/ready") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Readiness endpoint must be /ready", path: ["readiness", "path"] });
  }
  if (value.readiness && value.readiness.method !== "GET") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Readiness endpoint must use GET", path: ["readiness", "method"] });
  }
  if (value.version && value.version.path !== "/version") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Version endpoint must be /version", path: ["version", "path"] });
  }
  if (value.version && value.version.method !== "GET") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Version endpoint must use GET", path: ["version", "method"] });
  }
});
var SERVER_DATA_BACKENDS = ["postgresql"];
var ServerDataBackendSchema = exports_external.literal("postgresql");
var STORAGE_ENGINES = ["sqlite", "postgresql"];
var STORAGE_ENGINE_VALUES = ["sqlite", "json", "postgresql"];
var LOCAL_STORAGE_ENGINES = ["sqlite", "json"];
var StorageEngineSchema = exports_external.enum(STORAGE_ENGINE_VALUES);
var WAIVABLE_STORAGE_ENGINES = ["postgresql"];
var SurfaceConformanceWaiverSchema = exports_external.object({
  kind: ServiceSurfaceKindSchema,
  reason: exports_external.string().trim().min(1)
}).strict();
var STORAGE_WAIVER_REASON_MAX_LENGTH = 500;
var STORAGE_WAIVER_REVIEWER_MAX_LENGTH = 200;
var WaiverTextSchema = (maxLength) => exports_external.string().trim().min(1).max(maxLength).regex(/^[^\u0000-\u001f\u007f]+$/, "Waiver text must not contain control characters");
var ASSET_INVENTORY_KINDS = ["domain", "host", "ip", "email"];
var AssetInventoryWaiverSchema = exports_external.object({
  kind: exports_external.enum(ASSET_INVENTORY_KINDS),
  reason: WaiverTextSchema(STORAGE_WAIVER_REASON_MAX_LENGTH),
  reviewedBy: WaiverTextSchema(STORAGE_WAIVER_REVIEWER_MAX_LENGTH),
  expiresAt: TimestampSchema
}).strict();
var StorageEngineWaiverSchema = exports_external.object({
  engine: exports_external.enum(WAIVABLE_STORAGE_ENGINES),
  reason: WaiverTextSchema(STORAGE_WAIVER_REASON_MAX_LENGTH),
  reviewedBy: WaiverTextSchema(STORAGE_WAIVER_REVIEWER_MAX_LENGTH).optional(),
  expiresAt: TimestampSchema.optional()
}).strict();
function declaresSupportedApiSurface(surfaces) {
  return surfaces.some((surface) => surface.status === "supported" && (surface.kind === "api" || !surface.kind && Boolean(surface.apiBasePath || surface.openApiPath || surface.health || surface.readiness || surface.version)));
}
function storageWaiverIneligibilityReason(input) {
  if (input.class !== "cli-with-store") {
    return `storage waivers are not permitted for class ${input.class}`;
  }
  if (input.bins.includes(`${input.name}-serve`)) {
    return `storage waivers are not permitted for a service-capable cli-with-store repo shipping ${input.name}-serve`;
  }
  if (declaresSupportedApiSurface(input.serviceSurfaces ?? [])) {
    return "storage waivers are not permitted for a service-capable cli-with-store repo declaring a supported api service surface";
  }
  if (input.storageBackend === "postgresql") {
    return "storage waivers are not permitted while storage.backend is postgresql, which reads and writes PostgreSQL directly";
  }
  if (input.hosting.includes("hasna-saas")) {
    return "storage waivers are not permitted for a repo declaring the hasna-saas product story";
  }
  return null;
}
var ServiceContractMetadataSchema = exports_external.object({
  conformance: exports_external.object({
    waivedSurfaces: exports_external.array(SurfaceConformanceWaiverSchema).default([]),
    waiverProfile: exports_external.literal("non-node-monorepo").optional(),
    waivedStorageEngines: exports_external.array(StorageEngineWaiverSchema).default([]),
    waivedAssetInventories: exports_external.array(AssetInventoryWaiverSchema).default([])
  }).catchall(exports_external.unknown()).optional(),
  release: exports_external.object({
    artifactScan: exports_external.object({
      script: exports_external.string().trim().min(1)
    }).strict().optional()
  }).catchall(exports_external.unknown()).optional()
}).catchall(exports_external.unknown());
var AppNameSchema = exports_external.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "App names must be lowercase dashed identifiers");
var ALLOWED_BIN_SUFFIXES = [
  "",
  "-cli",
  "-mcp",
  "-serve",
  "-worker",
  "-runner",
  "-daemon",
  "-migrate",
  "-doctor"
];
var CANONICAL_HASNA_BIN_ALIASES = Object.freeze({
  deployment: Object.freeze(["hasna-deploy"])
});
function allowedBinsForName(name) {
  return [
    ...ALLOWED_BIN_SUFFIXES.map((suffix) => `${name}${suffix}`),
    ...CANONICAL_HASNA_BIN_ALIASES[name] ?? []
  ];
}
function databaseUrlSecretRefFor(name) {
  return `hasna/oss/${name}/database-url`;
}
function defaultSqlitePathFor(name) {
  return `~/.hasna/${name}/${name}.db`;
}
var StorageContractSchema = exports_external.object({
  backend: exports_external.enum(["sqlite", "postgresql"]),
  engines: exports_external.array(StorageEngineSchema).min(1).optional(),
  envPrefix: exports_external.string().regex(/^HASNA_[A-Z][A-Z0-9]*_$/).optional(),
  aliasEnvPrefix: exports_external.string().regex(/^[A-Z][A-Z0-9]*_$/).optional(),
  databaseUrlSecretRef: exports_external.string().regex(/^hasna\/oss\/[a-z0-9-]+\/database-url$/).optional(),
  sqlitePath: exports_external.string().min(1).endsWith(".db", "storage.sqlitePath must end in .db").optional(),
  pgTestGate: exports_external.object({
    envVar: exports_external.string().regex(/^[A-Z][A-Z0-9_]*_TEST_DATABASE_URL$/),
    command: exports_external.string().trim().min(1)
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  if (value.engines && new Set(value.engines).size !== value.engines.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "storage.engines must not contain duplicates",
      path: ["engines"]
    });
  }
  if (value.engines?.includes("postgresql") && !value.envPrefix) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "storage.engines containing postgresql requires envPrefix for the HASNA_<NAME>_DATABASE_URL contract",
      path: ["envPrefix"]
    });
  }
});
var OwnerOnlyFileModeSchema = exports_external.enum(["0600"]);
var OwnerOnlyDirectoryModeSchema = exports_external.enum(["0700"]);
var LocalStoreRootSchema = exports_external.enum([".hasna", ".codewith"]);
var SecureLocalStoreArtifactClassSchema = exports_external.enum([
  "directory",
  "file",
  "sqlite_db",
  "sqlite_wal",
  "sqlite_shm",
  "backup",
  "export",
  "report",
  "tmp",
  "log",
  "session",
  "snapshot"
]);
var SecureLocalStorePathPatternSchema = RelativeProjectPathSchema.refine((value) => !value.startsWith("~"), "Local store path patterns must be relative to their declared root");
var SecureLocalStoreActiveRecordExclusionSchema = exports_external.object({
  id: exports_external.string().min(1),
  source: exports_external.enum(["sqlite", "manifest", "index", "runtime", "package_adapter"]),
  table: exports_external.string().min(1).optional(),
  column: exports_external.string().min(1).optional(),
  description: exports_external.string().min(1),
  required: exports_external.boolean().default(true)
}).strict();
var SecureLocalStoreSqliteMaintenanceSchema = exports_external.object({
  safeWhen: exports_external.enum(["exclusive_access", "offline_only", "never"]),
  operations: exports_external.array(exports_external.enum(["wal_checkpoint_truncate", "incremental_vacuum", "optimize", "vacuum"])).default([])
}).strict().superRefine((value, ctx) => {
  if (value.safeWhen === "never" && value.operations.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "sqliteMaintenance.safeWhen=never cannot declare operations",
      path: ["operations"]
    });
  }
});
var SecureLocalStoreRetentionAdapterSchema = exports_external.object({
  id: exports_external.string().min(1),
  description: exports_external.string().min(1),
  ttlDays: exports_external.number().int().nonnegative().optional(),
  artifactClasses: exports_external.array(SecureLocalStoreArtifactClassSchema).min(1),
  allowlistGlobs: exports_external.array(SecureLocalStorePathPatternSchema).min(1),
  activeRecordExclusions: exports_external.array(SecureLocalStoreActiveRecordExclusionSchema).default([]),
  sqliteMaintenance: SecureLocalStoreSqliteMaintenanceSchema.optional()
}).strict();
var SecureLocalStoreDefinitionSchema = exports_external.object({
  storeId: exports_external.string().regex(/^[a-z][a-z0-9-]*$/),
  packageName: exports_external.string().min(1),
  displayName: exports_external.string().min(1),
  root: LocalStoreRootSchema,
  relativePath: SecureLocalStorePathPatternSchema,
  directoryMode: OwnerOnlyDirectoryModeSchema.default("0700"),
  fileMode: OwnerOnlyFileModeSchema.default("0600"),
  sqliteDatabaseGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  sensitiveFileGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  backupGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  exportGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  retentionAdapters: exports_external.array(SecureLocalStoreRetentionAdapterSchema).default([]),
  notes: exports_external.array(exports_external.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  if (value.relativePath.includes("*")) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "store relativePath must be a concrete directory; use glob fields for files",
      path: ["relativePath"]
    });
  }
  const adapterIds = new Set;
  for (const [index, adapter] of value.retentionAdapters.entries()) {
    if (adapterIds.has(adapter.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "retention adapter ids must be unique within a store",
        path: ["retentionAdapters", index, "id"]
      });
    }
    adapterIds.add(adapter.id);
  }
});
var SecureLocalStorePolicySchema = contractBaseSchema(SCHEMA_IDS.secureLocalStorePolicy).extend({
  version: exports_external.string().min(1),
  scope: exports_external.array(LocalStoreRootSchema).min(1),
  defaults: exports_external.object({
    directoryMode: OwnerOnlyDirectoryModeSchema.default("0700"),
    fileMode: OwnerOnlyFileModeSchema.default("0600"),
    dryRunDefault: exports_external.literal(true),
    requireExplicitApply: exports_external.literal(true),
    includeSqliteSidecars: exports_external.literal(true),
    redactedEvidenceOnly: exports_external.literal(true)
  }).strict(),
  stores: exports_external.array(SecureLocalStoreDefinitionSchema).min(1),
  lifecycle: exports_external.object({
    retentionDryRunDefault: exports_external.literal(true),
    requireActiveRecordExclusionProof: exports_external.literal(true),
    requireArtifactAllowlist: exports_external.literal(true),
    sqliteMaintenanceRequiresExclusiveAccess: exports_external.literal(true)
  }).strict(),
  warnings: exports_external.array(exports_external.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  const stores = new Set;
  for (const [index, store] of value.stores.entries()) {
    if (stores.has(store.storeId)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "store ids must be unique",
        path: ["stores", index, "storeId"]
      });
    }
    stores.add(store.storeId);
    if (!value.scope.includes(store.root)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "store root must be listed in policy scope",
        path: ["stores", index, "root"]
      });
    }
  }
});
var PUBLISH_STATUSES = ["published", "unpublished"];
var PublishStatusSchema = exports_external.enum(PUBLISH_STATUSES);
var PUBLISH_MECHANISMS = ["ci", "manual"];
var PublishMechanismSchema = exports_external.enum(PUBLISH_MECHANISMS);
var PUBLISH_CREDENTIALS = ["trusted-publisher", "token"];
var PublishCredentialSchema = exports_external.enum(PUBLISH_CREDENTIALS);
var PUBLISH_FLOWS = ["direct", "staged"];
var PublishFlowSchema = exports_external.enum(PUBLISH_FLOWS);
var PROVENANCE_MODES = ["required", "best-effort", "none"];
var ProvenanceModeSchema = exports_external.enum(PROVENANCE_MODES);
var PUBLISH_WORKFLOW_PROVIDERS = ["github-actions", "gitlab-ci"];
var PublishWorkflowProviderSchema = exports_external.enum(PUBLISH_WORKFLOW_PROVIDERS);
var PublishWorkflowSchema = exports_external.object({
  provider: PublishWorkflowProviderSchema,
  repository: exports_external.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "Workflow repository must be owner/repo"),
  file: exports_external.string().regex(/^[A-Za-z0-9._-]+\.ya?ml$/, "Workflow file must be a bare .yml/.yaml filename, not a path"),
  environment: exports_external.string().min(1).optional()
}).strict();
var PublishTargetSchema = exports_external.object({
  package: exports_external.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, "Package must be a registry package name, optionally scoped"),
  registry: exports_external.string().regex(/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:\/[A-Za-z0-9._~-]+)*$/, "Registry must be a bare host[:port][/path] with no scheme and no credentials"),
  access: exports_external.enum(["public", "restricted"]).optional(),
  mechanism: PublishMechanismSchema,
  credential: PublishCredentialSchema,
  flow: PublishFlowSchema.default("direct"),
  provenance: ProvenanceModeSchema.default("none"),
  workflow: PublishWorkflowSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.mechanism === "ci" && !value.workflow) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "mechanism=ci requires workflow (the registry registration needs repository, file, and environment)",
      path: ["workflow"]
    });
  }
  if (value.mechanism === "manual" && value.workflow) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "mechanism=manual must not declare workflow; a workflow implies mechanism=ci",
      path: ["workflow"]
    });
  }
  if (value.credential === "trusted-publisher" && value.mechanism !== "ci") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "credential=trusted-publisher requires mechanism=ci; workload identity is not issuable to an interactive publish",
      path: ["credential"]
    });
  }
});
var PublishingContractSchema = exports_external.object({
  status: PublishStatusSchema,
  targets: exports_external.array(PublishTargetSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "published" && value.targets.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "publishing.status=published requires at least one target",
      path: ["targets"]
    });
  }
  if (value.status === "unpublished" && value.targets.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "publishing.status=unpublished must not declare targets",
      path: ["targets"]
    });
  }
  const seen = new Set;
  for (const [index, target] of value.targets.entries()) {
    const key = `${target.package}@${target.registry}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Duplicate publish target for ${target.package} at ${target.registry}`,
        path: ["targets", index, "package"]
      });
    }
    seen.add(key);
  }
});
var ServiceContractManifestSchema = exports_external.object({
  $schema: exports_external.string().min(1).optional(),
  schema: exports_external.literal(SCHEMA_IDS.serviceContract),
  name: AppNameSchema,
  class: RepoClassSchema,
  contractVersion: exports_external.literal(SERVICE_CONTRACT_VERSION),
  kitVersion: exports_external.string().min(1),
  description: exports_external.string().min(1).optional(),
  bins: exports_external.array(exports_external.string().min(1)).default([]),
  storage: StorageContractSchema.optional(),
  hosting: exports_external.array(HostingModeSchema).min(1).default(["user-hosted"]),
  serviceSurfaces: exports_external.array(ServiceSurfaceSchema).default([]),
  publishing: PublishingContractSchema.optional(),
  metadata: ServiceContractMetadataSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (new Set(value.hosting).size !== value.hosting.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "hosting must not contain duplicates",
      path: ["hosting"]
    });
  }
  const allowed = new Set(allowedBinsForName(value.name));
  const seenBins = new Set;
  for (const [index, bin] of value.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Duplicate bin declaration", path: ["bins", index] });
    }
    seenBins.add(bin);
    if (!allowed.has(bin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Bin "${bin}" is not allowlisted for app "${value.name}"; allowed: ${[...allowed].join(", ")}`,
        path: ["bins", index]
      });
    }
  }
  const hasBin = (suffix) => seenBins.has(`${value.name}${suffix}`);
  if (value.storage) {
    const upper = value.name.toUpperCase().replace(/-/g, "_");
    if (value.storage.envPrefix && value.storage.envPrefix !== `HASNA_${upper}_`) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `storage.envPrefix must be HASNA_${upper}_`,
        path: ["storage", "envPrefix"]
      });
    }
    if (value.storage.databaseUrlSecretRef && value.storage.databaseUrlSecretRef !== databaseUrlSecretRefFor(value.name)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `storage.databaseUrlSecretRef must be ${databaseUrlSecretRefFor(value.name)}`,
        path: ["storage", "databaseUrlSecretRef"]
      });
    }
  }
  if (value.class === "library") {
    if (value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "library repos must not declare storage", path: ["storage"] });
    }
    if (hasBin("-serve") || hasBin("-mcp")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "library repos must not ship a -serve or -mcp bin",
        path: ["bins"]
      });
    }
  }
  if (value.class === "cli-with-store") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "cli-with-store repos must declare storage", path: ["storage"] });
    } else {
      if (value.storage.engines) {
        const declaredEngines = new Set(value.storage.engines);
        const declaredWaivers = value.metadata?.conformance?.waivedStorageEngines ?? [];
        const ineligible = storageWaiverIneligibilityReason({
          class: value.class,
          name: value.name,
          bins: value.bins,
          hosting: value.hosting,
          storageBackend: value.storage.backend,
          serviceSurfaces: value.serviceSurfaces
        });
        const waivedEngines = new Set(ineligible ? [] : declaredWaivers.map((waiver) => waiver.engine));
        const missingEngines = STORAGE_ENGINES.filter((engine) => !declaredEngines.has(engine) && !waivedEngines.has(engine));
        if (missingEngines.length > 0) {
          const refusal = ineligible && declaredWaivers.length > 0 ? `; declared waiver ignored: ${ineligible}` : "";
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: `cli-with-store storage.engines must declare sqlite and postgresql unless bounded migration tooling carries a metadata.conformance.waivedStorageEngines waiver; missing: ${missingEngines.join(", ")}${refusal}`,
            path: ["storage", "engines"]
          });
        }
      }
    }
    if (!seenBins.has(value.name)) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: `cli-with-store repos must ship the "${value.name}" bin`, path: ["bins"] });
    }
  }
  if (value.class === "service") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "service repos must declare storage", path: ["storage"] });
    } else if (value.storage.engines) {
      if (!value.storage.engines.includes("postgresql")) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "service storage.engines must declare postgresql; local engines are optional migration/import capabilities only",
          path: ["storage", "engines"]
        });
      }
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: `service repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "service repos must declare at least one service surface",
        path: ["serviceSurfaces"]
      });
    }
  }
  if (value.class === "saas") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "saas repos must declare storage", path: ["storage"] });
    } else {
      if (value.storage.backend !== "postgresql") {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "saas repos must use the postgresql storage backend", path: ["storage", "backend"] });
      }
      if (!value.storage.envPrefix) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "saas storage requires envPrefix for the public DATABASE_URL contract",
          path: ["storage", "envPrefix"]
        });
      }
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: `saas repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "saas repos must declare at least one service surface", path: ["serviceSurfaces"] });
    }
  }
  for (const [index, surface] of value.serviceSurfaces.entries()) {
    if (surface.bin && !seenBins.has(surface.bin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Service surface bin "${surface.bin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "bin"]
      });
    }
    if (surface.mcpBin && !seenBins.has(surface.mcpBin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Service surface MCP bin "${surface.mcpBin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "mcpBin"]
      });
    }
  }
  const waivedKinds = value.metadata?.conformance?.waivedSurfaces ?? [];
  const seenWaivers = new Set;
  for (const [index, waiver] of waivedKinds.entries()) {
    if (seenWaivers.has(waiver.kind)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Duplicate conformance waiver for ${waiver.kind}`,
        path: ["metadata", "conformance", "waivedSurfaces", index, "kind"]
      });
    }
    seenWaivers.add(waiver.kind);
  }
  const waivedStorageEngines = value.metadata?.conformance?.waivedStorageEngines ?? [];
  const seenStorageWaivers = new Set;
  for (const [index, waiver] of waivedStorageEngines.entries()) {
    if (seenStorageWaivers.has(waiver.engine)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Duplicate storage-engine waiver for ${waiver.engine}`,
        path: ["metadata", "conformance", "waivedStorageEngines", index, "engine"]
      });
    }
    seenStorageWaivers.add(waiver.engine);
  }
});
var HealthResponseSchema = exports_external.object({
  status: exports_external.enum(["ok", "degraded", "unavailable"]),
  version: exports_external.string().min(1),
  backend: ServerDataBackendSchema
}).strict();
var ReadyResponseSchema = exports_external.object({
  ready: exports_external.boolean(),
  reason: exports_external.string().min(1).optional()
}).strict();
var VersionResponseSchema = exports_external.object({
  version: exports_external.string().min(1)
}).strict();
var CommsSeveritySchema = exports_external.enum(["info", "notice", "breaking", "critical"]);
var CommsEventTypeSchema = exports_external.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/, "Comms event types must be 2-4 lowercase dot-separated segments (<source>.<entity>.<action>)");
var COMMS_SEVERITY_TAGS = ["FREEZE", "UNFREEZE", "BREAKING", "CUTOVER", "POLICY", "RELEASE"];
var CommsSeverityTagSchema = exports_external.enum(COMMS_SEVERITY_TAGS);
var COMMS_EVENT_TYPES = {
  "release.published": { defaultSeverity: "info", tag: "RELEASE" },
  "release.breaking": { defaultSeverity: "breaking", tag: "BREAKING" },
  "config.changed": { defaultSeverity: "notice", tag: null },
  "comms.protocol.bumped": { defaultSeverity: "breaking", tag: "POLICY" },
  "incident.opened": { defaultSeverity: "critical", tag: null },
  "incident.resolved": { defaultSeverity: "notice", tag: null },
  "cloud.cutover.step": { defaultSeverity: "notice", tag: "CUTOVER" },
  "fleet.freeze": { defaultSeverity: "critical", tag: "FREEZE" },
  "fleet.unfreeze": { defaultSeverity: "critical", tag: "UNFREEZE" },
  "fleet.directive": { defaultSeverity: "notice", tag: null }
};
function defaultSeverityForCommsEventType(type) {
  return COMMS_EVENT_TYPES[type]?.defaultSeverity ?? null;
}
var CommsScopeSchema = exports_external.enum(["fleet", "package", "machine"]);
var CommsEventEnvelopeSchema = contractBaseSchema(SCHEMA_IDS.commsEventEnvelope).extend({
  type: CommsEventTypeSchema,
  severity: CommsSeveritySchema,
  scope: CommsScopeSchema,
  summary: exports_external.string().min(1).optional(),
  source: ActorPointerSchema.optional(),
  affected_packages: exports_external.array(NonEmptyStringSchema).default([]),
  affected_machines: exports_external.array(NonEmptyStringSchema).default([]),
  action_required: exports_external.boolean().default(false),
  ack_by: TimestampSchema.optional(),
  dedupe_key: NonEmptyStringSchema,
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.scope === "package" && value.affected_packages.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Package-scoped comms events require affected_packages",
      path: ["affected_packages"]
    });
  }
  if (value.scope === "machine" && value.affected_machines.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Machine-scoped comms events require affected_machines",
      path: ["affected_machines"]
    });
  }
  if (value.ack_by && !value.action_required) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Comms events with an ack_by deadline require action_required",
      path: ["action_required"]
    });
  }
  if (value.type === "fleet.freeze" || value.type === "fleet.unfreeze") {
    if (value.severity !== "critical") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.type} events are always critical`,
        path: ["severity"]
      });
    }
    if (value.scope !== "fleet") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.type} events are always fleet-scoped`,
        path: ["scope"]
      });
    }
    if (!value.action_required) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.type} events require action_required`,
        path: ["action_required"]
      });
    }
  }
});
var CommsChannelClassSchema = exports_external.enum(["fleet", "package", "product", "loop-lane", "initiative", "personal"]);
var CommsChannelNoiseSchema = exports_external.enum(["quiet", "work", "firehose"]);
var CommsUntilHorizonSchema = NonEmptyStringSchema.refine((value) => /^(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?|gate:[0-9a-f][0-9a-f-]{7,35})$/.test(value), "until must be an ISO date (YYYY-MM-DD), a UTC timestamp, or a gate id (gate:<todos-id>)");
var CommsChannelMetadataSchema = contractBaseSchema(SCHEMA_IDS.commsChannelMetadata).extend({
  class: CommsChannelClassSchema,
  noise: CommsChannelNoiseSchema.optional(),
  owner: NonEmptyStringSchema.optional(),
  until: CommsUntilHorizonSchema.optional(),
  successor: NonEmptyStringSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.class === "initiative") {
    if (!value.owner) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Initiative channels require an owner",
        path: ["owner"]
      });
    }
    if (!value.until) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Initiative channels require an until horizon (date or gate id)",
        path: ["until"]
      });
    }
  }
});
var COMMS_SEVERITY_TAG_INFO = {
  FREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.freeze" },
  UNFREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.unfreeze" },
  BREAKING: { defaultSeverity: "breaking", allowedSeverities: ["breaking"], requiredEventType: null },
  CUTOVER: { defaultSeverity: "notice", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  POLICY: { defaultSeverity: "breaking", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  RELEASE: { defaultSeverity: "info", allowedSeverities: ["info", "notice"], requiredEventType: null }
};
var CommsMessageMetadataSchema = contractBaseSchema(SCHEMA_IDS.commsMessageMetadata).extend({
  tag: CommsSeverityTagSchema,
  envelope: CommsEventEnvelopeSchema
}).strict().superRefine((value, ctx) => {
  const info = COMMS_SEVERITY_TAG_INFO[value.tag];
  if (!info.allowedSeverities.includes(value.envelope.severity)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `[${value.tag}] posts allow severities ${info.allowedSeverities.join(", ")}`,
      path: ["envelope", "severity"]
    });
  }
  if (info.requiredEventType && value.envelope.type !== info.requiredEventType) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `[${value.tag}] posts require event type ${info.requiredEventType}`,
      path: ["envelope", "type"]
    });
  }
  for (const [tag, tagInfo] of Object.entries(COMMS_SEVERITY_TAG_INFO)) {
    if (tagInfo.requiredEventType === value.envelope.type && value.tag !== tag) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.envelope.type} events must use the [${tag}] tag`,
        path: ["tag"]
      });
    }
  }
});
function commsSeverityTagToken(tag) {
  return `[${tag}]`;
}
function extractCommsSeverityTag(text) {
  const firstWord = text.trimStart().split(/\s+/, 1)[0] ?? "";
  for (const tag of COMMS_SEVERITY_TAGS) {
    if (firstWord === `[${tag}]`) {
      return tag;
    }
  }
  return null;
}
function validateCommsTaggedMessage(input) {
  const tag = extractCommsSeverityTag(input.text);
  if (!tag) {
    return {
      success: false,
      tag: null,
      issues: [
        {
          code: exports_external.ZodIssueCode.custom,
          message: `Severity-tagged posts must start with one of ${COMMS_SEVERITY_TAGS.map(commsSeverityTagToken).join(" ")} as the exact-case first token`,
          path: ["text"]
        }
      ]
    };
  }
  const parsed = CommsMessageMetadataSchema.safeParse(input.metadata);
  if (!parsed.success) {
    return { success: false, tag, issues: parsed.error.issues };
  }
  if (parsed.data.tag !== tag) {
    return {
      success: false,
      tag,
      issues: [
        {
          code: exports_external.ZodIssueCode.custom,
          message: `Message text is tagged [${tag}] but metadata declares [${parsed.data.tag}]`,
          path: ["tag"]
        }
      ]
    };
  }
  return { success: true, tag, metadata: parsed.data };
}
var DEPLOYMENT_SCHEMAS = createDeploymentSchemas({
  actorPointer: ActorPointerSchema,
  costEstimate: CostEstimateSchema,
  decisionEnvelope: DecisionEnvelopeSchema,
  evidencePointer: EvidencePointerSchema,
  providerCapabilityCard: ProviderCapabilityCardSchema,
  resourcePointer: ResourcePointerSchema,
  validationPlan: ValidationPlanSchema,
  workRun: WorkRunSchema,
  schemaId: SchemaIdSchema,
  timestamp: TimestampSchema,
  uri: UriSchema,
  sha256Digest: Sha256DigestSchema,
  relativeProjectPath: RelativeProjectPathSchema,
  providerSideEffectClass: ProviderSideEffectClassSchema
});
var {
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
} = DEPLOYMENT_SCHEMAS;
var DEPLOYMENT_ENVELOPE_SCHEMAS = createDeploymentEnvelopeSchema({
  timestamp: TimestampSchema,
  metadata: MetadataSchema,
  appId: AppIdSchema,
  npmPackageName: NpmPackageNameSchema,
  uri: UriSchema,
  resourcePointer: ResourcePointerSchema,
  evidencePointer: EvidencePointerSchema,
  providerSideEffectClass: ProviderSideEffectClassSchema,
  productProjectionRef: ProductProjectionRefSchema,
  environmentBindingRef: EnvironmentBindingRefSchema,
  buildArtifactRef: BuildArtifactRefSchema,
  deploymentPlanRef: DeploymentPlanRefSchema,
  deploymentReceiptRef: DeploymentReceiptRefSchema
});
var {
  DeploymentEnvelopeSchema,
  EnvelopeResourceSchema,
  EnvelopeEnvironmentSchema,
  EnvelopePhaseSchema,
  EnvelopeActionSchema
} = DEPLOYMENT_ENVELOPE_SCHEMAS;
var CoreContractSchemaRegistry = {
  [SCHEMA_IDS.actorRef]: ActorRefSchema,
  [SCHEMA_IDS.resourceRef]: ResourceRefSchema,
  [SCHEMA_IDS.evidenceRef]: EvidenceRefSchema,
  [SCHEMA_IDS.workRun]: WorkRunSchema,
  [SCHEMA_IDS.taskToPrProjection]: TaskToPrProjectionSchema,
  [SCHEMA_IDS.decisionEnvelope]: DecisionEnvelopeSchema,
  [SCHEMA_IDS.costEstimate]: CostEstimateSchema,
  [SCHEMA_IDS.capabilityCard]: CapabilityCardSchema,
  [SCHEMA_IDS.providerLiveModeStandard]: ProviderLiveModeStandardSchema,
  [SCHEMA_IDS.contextPack]: ContextPackSchema,
  [SCHEMA_IDS.integrationRef]: IntegrationRefSchema,
  [SCHEMA_IDS.projectManifest]: ProjectManifestSchema,
  [SCHEMA_IDS.projectPanel]: ProjectPanelSchema,
  [SCHEMA_IDS.projectSnapshot]: ProjectSnapshotSchema,
  [SCHEMA_IDS.renderManifest]: RenderManifestSchema,
  [SCHEMA_IDS.agentTrajectory]: AgentTrajectorySchema,
  [SCHEMA_IDS.validationPlan]: ValidationPlanSchema,
  [SCHEMA_IDS.proofBundle]: ProofBundleSchema,
  [SCHEMA_IDS.scaffoldManifest]: ScaffoldManifestSchema,
  [SCHEMA_IDS.scaffoldInstallRecord]: ScaffoldInstallRecordSchema,
  [SCHEMA_IDS.appCloudManifest]: AppCloudManifestSchema,
  [SCHEMA_IDS.noCloudEvidencePack]: NoCloudEvidencePackSchema,
  [SCHEMA_IDS.secureLocalStorePolicy]: SecureLocalStorePolicySchema,
  [SCHEMA_IDS.serviceContract]: ServiceContractManifestSchema,
  [SCHEMA_IDS.commsEventEnvelope]: CommsEventEnvelopeSchema,
  [SCHEMA_IDS.commsChannelMetadata]: CommsChannelMetadataSchema,
  [SCHEMA_IDS.commsMessageMetadata]: CommsMessageMetadataSchema,
  [SCHEMA_IDS.projectResourceLinkCollectionV1]: ProjectResourceLinkCollectionV1Schema,
  [SCHEMA_IDS.app]: AppSchema,
  [SCHEMA_IDS.release]: ReleaseSchema,
  [SCHEMA_IDS.rolloutRecord]: RolloutRecordSchema,
  [SCHEMA_IDS.announcement]: AnnouncementSchema,
  [SCHEMA_IDS.audience]: AudienceSchema,
  [SCHEMA_IDS.deploymentEnvelope]: DeploymentEnvelopeSchema
};
var ContractSchemaRegistry = {
  ...CoreContractSchemaRegistry,
  ...DeploymentSchemaRegistry
};

// src/no-cloud.ts
import { readdirSync, readFileSync, statSync } from "fs";
import { basename, join as join2, relative, resolve as resolve2 } from "path";

// src/dependency-edge.ts
var PRODUCTION_SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies"];
var DEVELOPMENT_SECTIONS = ["devDependencies"];
var PIN_SECTIONS = ["overrides", "resolutions"];
var NAME_LIST_SECTIONS = ["bundleDependencies", "bundledDependencies", "trustedDependencies"];
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const chars = [...text];
  let inString = false;
  for (let index = 0;index < chars.length; index += 1) {
    const character = chars[index];
    if (inString) {
      if (character === "\\")
        index += 1;
      else if (character === '"')
        inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== ",")
      continue;
    let ahead = index + 1;
    while (ahead < chars.length && /\s/.test(chars[ahead]))
      ahead += 1;
    if (chars[ahead] === "}" || chars[ahead] === "]")
      chars[index] = " ";
  }
  try {
    return JSON.parse(chars.join(""));
  } catch {
    return null;
  }
}
var MAX_PIN_DEPTH = 4;
function pinKeyNames(key) {
  const segments = key.split("/").filter((segment) => segment !== "" && segment !== "*" && segment !== "**");
  const names = [];
  for (let index = 0;index < segments.length; index += 1) {
    const segment = segments[index];
    const next = segments[index + 1];
    if (segment.startsWith("@") && next !== undefined) {
      names.push(`${segment}/${next}`);
      index += 1;
      continue;
    }
    names.push(segment);
  }
  return names.map((name) => nameFromResolutionId(name) ?? name);
}
function pinNames(pins, depth) {
  const names = [];
  for (const [key, value] of Object.entries(pins)) {
    names.push(...pinKeyNames(key));
    if (isRecord(value) && depth < MAX_PIN_DEPTH)
      names.push(...pinNames(value, depth + 1));
  }
  return names;
}
function namesInSection(container, section) {
  const value = container[section];
  if (Array.isArray(value))
    return value.filter((entry) => typeof entry === "string");
  if (!isRecord(value))
    return [];
  return PIN_SECTIONS.includes(section) ? pinNames(value, 0) : Object.keys(value);
}
function manifestEdges(manifest, forbidden) {
  if (!isRecord(manifest))
    return [];
  const edges = [];
  const scopes = [
    { sections: [...PRODUCTION_SECTIONS, ...PIN_SECTIONS, ...NAME_LIST_SECTIONS], scope: "production" },
    { sections: DEVELOPMENT_SECTIONS, scope: "development" }
  ];
  for (const { sections, scope } of scopes) {
    for (const section of sections) {
      for (const name of namesInSection(manifest, section)) {
        if (!forbidden.includes(name))
          continue;
        edges.push({ packageName: name, scope, path: [name], source: "package.json", section });
      }
    }
  }
  return edges;
}
function isLinkedResolution(id) {
  const name = nameFromResolutionId(id);
  if (name === null)
    return false;
  return /^(?:file|link|workspace):/.test(id.slice(name.length + 1));
}
function nameFromResolutionId(id) {
  const separator = id.indexOf("@", id.startsWith("@") ? 1 : 0);
  if (separator <= 0)
    return null;
  return id.slice(0, separator);
}
function resolutionTarget(id) {
  const name = nameFromResolutionId(id);
  if (name === null)
    return null;
  const specifier = id.slice(name.length + 1);
  const aliased = /^npm:(.+)$/.exec(specifier);
  if (aliased) {
    const target2 = nameFromResolutionId(aliased[1]) ?? aliased[1];
    return target2 === name ? null : target2;
  }
  const linked = /^(?:file|link|workspace):(.+)$/.exec(specifier);
  if (!linked)
    return null;
  const segments = linked[1].split("/").filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  const target = segments[segments.length - 1];
  return target === undefined || target === name ? null : target;
}
function aliasFromKey(key, keys) {
  let best = key;
  for (const candidate of keys) {
    if (candidate.length >= key.length)
      continue;
    if (!key.startsWith(`${candidate}/`))
      continue;
    const remainder = key.slice(candidate.length + 1);
    if (best === key || remainder.length < best.length)
      best = remainder;
  }
  return best;
}
function nodesByName(lock) {
  const byName = new Map;
  const packages = lock.packages;
  if (!isRecord(packages))
    return byName;
  const keys = new Set(Object.keys(packages));
  for (const [key, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry))
      continue;
    const id = typeof entry[0] === "string" ? entry[0] : null;
    const name = (id ? nameFromResolutionId(id) : null) ?? key.split("/").slice(-1)[0] ?? key;
    const meta = entry.find((element) => isRecord(element));
    const node = {
      name,
      alias: id === null ? null : resolutionTarget(id),
      production: meta ? [...PRODUCTION_SECTIONS, ...PIN_SECTIONS, ...NAME_LIST_SECTIONS].flatMap((section) => namesInSection(meta, section)) : [],
      development: meta ? [...DEVELOPMENT_SECTIONS].flatMap((section) => namesInSection(meta, section)) : [],
      linked: id !== null && isLinkedResolution(id)
    };
    for (const lookup of new Set([name, aliasFromKey(key, keys)])) {
      const existing = byName.get(lookup);
      if (existing)
        existing.push(node);
      else
        byName.set(lookup, [node]);
    }
  }
  return byName;
}
function installRoots(lock) {
  const workspaces = lock.workspaces;
  if (!isRecord(workspaces))
    return [];
  const roots = [];
  for (const [key, record] of Object.entries(workspaces)) {
    if (!isRecord(record))
      continue;
    roots.push({ label: key === "" ? null : typeof record.name === "string" ? record.name : key, record });
  }
  const topLevel = {};
  for (const section of [...PIN_SECTIONS, ...NAME_LIST_SECTIONS]) {
    if (lock[section] !== undefined)
      topLevel[section] = lock[section];
  }
  const patched = lock.patchedDependencies;
  if (isRecord(patched)) {
    const names = Object.keys(patched).map((key) => nameFromResolutionId(key) ?? key).filter((name) => name.length > 0);
    if (names.length > 0)
      topLevel.dependencies = names;
  }
  if (Object.keys(topLevel).length > 0)
    roots.push({ label: null, record: topLevel });
  return roots;
}
function isHoistedInstall(lock) {
  const workspaces = lock.workspaces;
  if (!isRecord(workspaces))
    return false;
  return Object.values(workspaces).filter(isRecord).length <= 1;
}
function forbiddenIdentities(name, nodes, forbidden) {
  const found = new Set;
  if (forbidden.includes(name))
    found.add(name);
  for (const node of nodes) {
    if (forbidden.includes(node.name))
      found.add(node.name);
    if (node.alias !== null && forbidden.includes(node.alias))
      found.add(node.alias);
  }
  return [...found];
}
function forbiddenIdentity(name, nodes, forbidden) {
  return forbiddenIdentities(name, nodes, forbidden)[0] ?? null;
}
function lockfileWalk(lockText, forbidden) {
  const lock = parseLooseJson(lockText);
  if (!isRecord(lock))
    return null;
  const hoisted = isHoistedInstall(lock);
  const roots = installRoots(lock);
  if (roots.length === 0)
    return null;
  const nodes = nodesByName(lock);
  const clearedByLayout = new Set;
  const seeds = [];
  for (const { label, record } of roots) {
    const head = label === null ? [] : [label];
    for (const section of [...PRODUCTION_SECTIONS, ...PIN_SECTIONS, ...NAME_LIST_SECTIONS]) {
      for (const name of namesInSection(record, section))
        seeds.push({ name, trail: [...head, name], section, scope: "production", root: true });
    }
    for (const section of DEVELOPMENT_SECTIONS) {
      for (const name of namesInSection(record, section))
        seeds.push({ name, trail: [...head, name], section, scope: "development", root: true });
    }
  }
  const queue = [...seeds].sort((left, right) => left.scope === right.scope ? 0 : left.scope === "production" ? -1 : 1);
  const seen = new Set(queue.map((visit) => `${visit.scope}:${visit.name}`));
  const best = new Map;
  while (queue.length > 0) {
    const current = queue.shift();
    const known = nodes.get(current.name) ?? [];
    const reachable = hoisted ? known.filter((node) => current.root || !node.linked) : known;
    if (known.length > 0 && reachable.length === 0) {
      for (const dropped of forbiddenIdentities(current.name, known, forbidden))
        clearedByLayout.add(dropped);
      continue;
    }
    const identity = forbiddenIdentity(current.name, reachable, forbidden);
    if (identity !== null) {
      const existing = best.get(identity);
      if (!existing || existing.scope === "development" && current.scope === "production") {
        best.set(identity, {
          packageName: identity,
          scope: current.scope,
          path: current.trail[current.trail.length - 1] === identity ? current.trail : [...current.trail, identity],
          source: "bun.lock",
          section: current.section
        });
      }
    }
    for (const node of reachable) {
      const next = node.production.map((name) => ({ name, scope: current.scope }));
      if (node.linked) {
        for (const name of node.development)
          next.push({ name, scope: "development" });
      }
      for (const candidate of next) {
        const key = `${candidate.scope}:${candidate.name}`;
        if (seen.has(key))
          continue;
        seen.add(key);
        queue.push({ name: candidate.name, trail: [...current.trail, candidate.name], section: current.section, scope: candidate.scope, root: false });
      }
    }
  }
  return { edges: [...best.values()], clearedByLayout: [...clearedByLayout] };
}

// src/packed-artifact.ts
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
var MAX_ARCHIVE_MEMBER_BYTES = 5 * 1024 * 1024;
var MAX_SCANNED_MEMBER_BYTES = 512 * 1024 * 1024;
function isPackedArtifactPath(target) {
  return /\.(tgz|tar\.gz)$/i.test(target);
}
function extractArchive(target) {
  const directory = mkdtempSync(join(tmpdir(), "hasna-artifact-scan-"));
  try {
    execFileSync("tar", ["-xzf", resolve(target), "-C", directory], { stdio: "pipe" });
  } catch (error2) {
    rmSync(directory, { recursive: true, force: true });
    throw error2;
  }
  return directory;
}
function listArchiveEntries(target) {
  return execFileSync("tar", ["-tzf", target], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).split(`
`).filter(Boolean);
}
function commonArchiveRoot(entries) {
  const firstSegments = new Set;
  for (const entry of entries) {
    const normalized = entry.replace(/^\.\/+/, "").replace(/^\/+/, "");
    if (!normalized || normalized.endsWith("/"))
      continue;
    const [first, ...rest] = normalized.split("/");
    if (!first || rest.length === 0)
      return null;
    firstSegments.add(first);
    if (firstSegments.size > 1)
      return null;
  }
  const [root] = [...firstSegments];
  return root ?? null;
}
function normalizeArchiveEntry(entry, commonRoot) {
  let normalized = entry.replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/"))
    return null;
  if (commonRoot && (normalized === commonRoot || normalized.startsWith(`${commonRoot}/`))) {
    normalized = normalized.slice(commonRoot.length).replace(/^\/+/, "");
  } else {
    normalized = normalized.replace(/^package\//, "");
  }
  return normalized || null;
}
function readArchiveMemberText(target, entry) {
  return execFileSync("tar", ["-xOzf", target, entry], {
    encoding: "utf8",
    maxBuffer: MAX_ARCHIVE_MEMBER_BYTES
  });
}

// src/source-text.ts
var C_LIKE_EXTENSIONS = /\.(?:[cm]?[jt]s)$/i;
var HASH_EXTENSIONS = /\.(?:sh|bash|ya?ml|toml)$/i;
function commentSyntaxForPath(path) {
  const name = path.replaceAll("\\", "/").split("/").pop() ?? path;
  if (name === ".env" || name.startsWith(".env."))
    return "hash";
  if (C_LIKE_EXTENSIONS.test(name))
    return "c-like";
  if (HASH_EXTENSIONS.test(name))
    return "hash";
  return "none";
}
function toUnits(text) {
  return text.split("");
}
function blank(chars, start, end) {
  for (let index = start;index < end; index += 1) {
    if (chars[index] !== `
`)
      chars[index] = " ";
  }
}
var VALUE_POSITION_KEYWORD = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
function regexCanStart(before) {
  const trimmed = before.replace(/\s+$/, "");
  if (trimmed === "")
    return true;
  const last = trimmed[trimmed.length - 1];
  if (/[\])}]/.test(last)) {
    return last === "}";
  }
  if (/[\w$]/.test(last))
    return VALUE_POSITION_KEYWORD.test(trimmed);
  if (last === "'" || last === '"' || last === "`")
    return false;
  return true;
}
var CONTROL_HEAD_KEYWORD = /(?:^|[^\w$])(?:if|for|while|switch|catch|with)\s*$/;
function ambiguityChangesTheMask(text, index) {
  const end = scanRegex(text, index);
  if (end === null)
    return false;
  const body = text.slice(index + 1, end);
  return body.includes("//") || body.includes("/*");
}
function slashOpensRegex(text, index, lastCloseParen) {
  const before = text.slice(Math.max(0, index - 64), index);
  if (!before.replace(/\s+$/, "").endsWith(")"))
    return regexCanStart(before);
  if (lastCloseParen === "control")
    return true;
  if (lastCloseParen === null || lastCloseParen === "unbalanced")
    return null;
  return ambiguityChangesTheMask(text, index) ? null : false;
}
var CALLEE_BEFORE_PAREN = /([A-Za-z_$][\w$]*)\s*$/;
var UNNAMEABLE_CALLEE = "()";
function calleeBefore(text, parenIndex) {
  const before = text.slice(Math.max(0, parenIndex - 96), parenIndex).replace(/\s+$/, "");
  if (before.endsWith(")") || before.endsWith("]"))
    return UNNAMEABLE_CALLEE;
  return CALLEE_BEFORE_PAREN.exec(before)?.[1] ?? null;
}
function lexCLike(text) {
  const tokens = [];
  let index = 0;
  const length = text.length;
  const templateDepths = [];
  let braceDepth = 0;
  const brackets = [];
  const parens = [];
  let lastCloseParen = null;
  const callArgumentOpeners = new Set;
  const enclosingCallees = () => brackets.filter((frame) => frame.paren).map((frame) => frame.callee);
  while (index < length) {
    const character = text[index];
    const next = text[index + 1];
    if (character === "/" && next === "/") {
      let end = text.indexOf(`
`, index);
      if (end === -1)
        end = length;
      tokens.push({ kind: "comment", start: index, end });
      index = end;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1)
        return null;
      tokens.push({ kind: "comment", start: index, end: end + 2 });
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = scanQuoted(text, index, character);
      if (end === null)
        return null;
      tokens.push({ kind: "literal", start: index, end, callees: enclosingCallees() });
      index = end;
      lastCloseParen = null;
      continue;
    }
    if (character === "`") {
      const chunk = scanTemplateChunk(text, index + 1);
      if (chunk === null)
        return null;
      tokens.push({ kind: "literal", start: index, end: chunk.index, callees: enclosingCallees() });
      if (!chunk.closed)
        templateDepths.push(braceDepth);
      index = chunk.index;
      lastCloseParen = null;
      continue;
    }
    if (character === "$" && next === "{" && templateDepths.length > 0) {
      braceDepth += 1;
      index += 2;
      lastCloseParen = null;
      continue;
    }
    if (character === "}" && templateDepths.length > 0 && braceDepth === templateDepths[templateDepths.length - 1] + 1) {
      braceDepth -= 1;
      const chunk = scanTemplateChunk(text, index + 1);
      if (chunk === null)
        return null;
      tokens.push({ kind: "literal", start: index, end: chunk.index, callees: enclosingCallees(), interpolated: true });
      if (chunk.closed)
        templateDepths.pop();
      index = chunk.index;
      lastCloseParen = null;
      continue;
    }
    if (character === "{")
      braceDepth += 1;
    if (character === "}" && braceDepth > 0)
      braceDepth -= 1;
    if (character === "(") {
      const control = CONTROL_HEAD_KEYWORD.test(text.slice(Math.max(0, index - 32), index));
      parens.push(control ? "control" : "value");
      brackets.push({ paren: true, callee: control ? null : calleeBefore(text, index) });
      lastCloseParen = null;
      index += 1;
      continue;
    }
    if (character === ")") {
      lastCloseParen = parens.pop() ?? "unbalanced";
      if (brackets[brackets.length - 1]?.paren)
        brackets.pop();
      index += 1;
      continue;
    }
    if (character === "[" || character === "{") {
      const enclosing = brackets[brackets.length - 1];
      if (enclosing?.paren === true && enclosing.callee !== null)
        callArgumentOpeners.add(index);
      brackets.push({ paren: false, callee: null });
      lastCloseParen = null;
      index += 1;
      continue;
    }
    if (character === "]" || character === "}") {
      if (brackets[brackets.length - 1]?.paren === false)
        brackets.pop();
      lastCloseParen = null;
      index += 1;
      continue;
    }
    if (character === "/") {
      const opensRegex = slashOpensRegex(text, index, lastCloseParen);
      if (opensRegex === null)
        return null;
      if (opensRegex) {
        const end = scanRegex(text, index);
        if (end !== null) {
          index = end;
          lastCloseParen = null;
          continue;
        }
      }
    }
    if (!/\s/.test(character))
      lastCloseParen = null;
    index += 1;
  }
  if (templateDepths.length > 0)
    return null;
  return { tokens, callArgumentOpeners };
}
function maskCLike(text) {
  const lexed = lexCLike(text);
  if (lexed === null)
    return null;
  const chars = toUnits(text);
  for (const token of lexed.tokens) {
    if (token.kind === "comment")
      blank(chars, token.start, token.end);
  }
  return chars.join("");
}
function scanQuoted(text, start, quote) {
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === quote)
      return index + 1;
    if (character === `
`)
      return null;
  }
  return null;
}
function scanTemplateChunk(text, start) {
  for (let index = start;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "`")
      return { index: index + 1, closed: true };
    if (character === "$" && text[index + 1] === "{")
      return { index, closed: false };
  }
  return null;
}
function scanRegex(text, start) {
  let inClass = false;
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === `
`)
      return null;
    if (character === "[")
      inClass = true;
    else if (character === "]")
      inClass = false;
    else if (character === "/" && !inClass) {
      let end = index + 1;
      while (end < text.length && /[a-z]/i.test(text[end]))
        end += 1;
      return end;
    }
  }
  return null;
}
function maskHash(text) {
  const chars = toUnits(text);
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf(`
`, lineStart);
    if (lineEnd === -1)
      lineEnd = text.length;
    let inSingle = false;
    let inDouble = false;
    for (let index = lineStart;index < lineEnd; index += 1) {
      const character = text[index];
      if (character === "\\" && inDouble) {
        index += 1;
        continue;
      }
      if (character === "'" && !inDouble)
        inSingle = !inSingle;
      else if (character === '"' && !inSingle)
        inDouble = !inDouble;
      else if (character === "#" && !inSingle && !inDouble) {
        const previous = index === lineStart ? "" : text[index - 1];
        if (previous === "" || /\s/.test(previous)) {
          blank(chars, index, lineEnd);
          break;
        }
      }
    }
    if (lineEnd === text.length)
      break;
    lineStart = lineEnd + 1;
  }
  return chars.join("");
}
function maskComments(text, syntax) {
  if (syntax === "hash")
    return maskHash(text);
  if (syntax === "c-like")
    return maskCLike(text) ?? text;
  return text;
}
function maskCommentsForPath(text, path) {
  return maskComments(text, commentSyntaxForPath(path));
}
var INERT_CALLEES = new Set([
  "expect",
  "not",
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toContain",
  "toContainEqual",
  "toMatch",
  "toMatchObject",
  "toHaveProperty",
  "toBeUndefined",
  "toBeDefined",
  "describe",
  "it",
  "test",
  "includes",
  "indexOf",
  "lastIndexOf",
  "startsWith",
  "endsWith",
  "has",
  "match",
  "search",
  "split",
  "concat",
  "existsSync",
  "statSync",
  "lstatSync",
  "readFileSync",
  "readdirSync",
  "join",
  "basename",
  "dirname",
  "extname",
  "relative",
  "normalize",
  "push",
  "add",
  "filter",
  "some",
  "every",
  "find",
  "map",
  "RegExp",
  "raw"
]);
function mentionsCannotLoad(text, path, moduleName) {
  if (commentSyntaxForPath(path) !== "c-like")
    return false;
  const lexed = lexCLike(text);
  if (lexed === null)
    return false;
  for (let at = text.indexOf(moduleName);at !== -1; at = text.indexOf(moduleName, at + 1)) {
    const end = at + moduleName.length;
    const token = lexed.tokens.find((candidate) => at >= candidate.start && end <= candidate.end);
    if (token?.kind === "comment")
      continue;
    if (token === undefined || token.kind !== "literal")
      return false;
    if (token.interpolated)
      return false;
    if (!(token.callees ?? []).every((callee) => callee === null || INERT_CALLEES.has(callee)))
      return false;
  }
  return true;
}
function escapeRegex2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var INLINE_DATA_WINDOW = 4096;
var IDENTIFIER_TAIL = /([A-Za-z_$][\w$]*)\s*$/;
var TYPE_POSITION_KEYWORD = /(?:^|[^\w$])readonly$/;
var RECORD_KEY_TAIL = /(?:[A-Za-z_$][\w$]*|"[^"\n]*"|'[^'\n]*')\s*$/;
function readStringLiteral(text, start) {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== "`")
    return null;
  let value = "";
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      const escaped = text[index + 1];
      if (escaped === undefined)
        return null;
      value += escaped === "\\" || escaped === '"' || escaped === "'" || escaped === "`" ? escaped : `\\${escaped}`;
      index += 1;
      continue;
    }
    if (character === quote)
      return { value, end: index + 1 };
    if (quote === "`" && character === "$" && text[index + 1] === "{")
      return null;
    if (character === `
` && quote !== "`")
      return null;
    value += character;
  }
  return null;
}
function skipSpace(text, index) {
  let at = index;
  while (at < text.length && /\s/.test(text[at]))
    at += 1;
  return at;
}
function parseInlineData(text, start) {
  const opener = text[start];
  if (opener === '"' || opener === "'" || opener === "`") {
    const literal2 = readStringLiteral(text, start);
    return literal2 === null ? null : { kind: "string", value: literal2.value, start, end: literal2.end };
  }
  if (opener === "[") {
    const items = [];
    let index = skipSpace(text, start + 1);
    while (index < text.length) {
      if (text[index] === "]")
        return { kind: "array", items, start, end: index + 1 };
      const item = parseInlineData(text, index);
      if (item === null)
        return null;
      items.push(item);
      index = skipSpace(text, item.end);
      if (text[index] === ",")
        index = skipSpace(text, index + 1);
      else if (text[index] !== "]")
        return null;
    }
    return null;
  }
  if (opener === "{") {
    const entries = new Map;
    let index = skipSpace(text, start + 1);
    while (index < text.length) {
      if (text[index] === "}")
        return { kind: "record", entries, start, end: index + 1 };
      const quoted = readStringLiteral(text, index);
      let key;
      if (quoted !== null) {
        key = quoted.value;
        index = skipSpace(text, quoted.end);
      } else {
        const identifier = /^[A-Za-z_$][\w$]*/.exec(text.slice(index, index + 128));
        if (identifier === null)
          return null;
        key = identifier[0];
        index = skipSpace(text, index + identifier[0].length);
      }
      if (text[index] !== ":")
        return null;
      index = skipSpace(text, index + 1);
      const value = parseInlineData(text, index);
      if (value === null)
        return null;
      if (entries.has(key))
        return null;
      entries.set(key, value);
      index = skipSpace(text, value.end);
      if (text[index] === ",")
        index = skipSpace(text, index + 1);
      else if (text[index] !== "}")
        return null;
    }
    return null;
  }
  return null;
}
function recordKeyPrecedes(before) {
  const key = RECORD_KEY_TAIL.exec(before);
  if (key === null)
    return false;
  const head = before.slice(0, key.index).replace(/\s+$/, "");
  return head.endsWith("{") || head.endsWith(",");
}
function isInertPosition(text, start, end, callArgumentOpeners) {
  if (callArgumentOpeners.has(start))
    return false;
  const before = text.slice(Math.max(0, start - 64), start).replace(/\s+$/, "");
  if (before !== "") {
    const last = before[before.length - 1];
    const typePosition = TYPE_POSITION_KEYWORD.test(before);
    if (!typePosition && !(last === "=" || last === "[" || last === "," || last === ":" || last === "("))
      return false;
    if (last === "=" && /[=!<>]$/.test(before.slice(0, -1)))
      return false;
    if (last === "(" && IDENTIFIER_TAIL.test(before.slice(0, -1)))
      return false;
    if (!typePosition && last === ":" && !recordKeyPrecedes(before.slice(0, -1).replace(/\s+$/, "")))
      return false;
  }
  const after = skipSpace(text, end);
  const next = text.slice(after, after + 2);
  if (next.startsWith("[") || next.startsWith("(") || next.startsWith(".") || next.startsWith("?."))
    return false;
  return true;
}
function boundNameBefore(text, start) {
  const before = text.slice(Math.max(0, start - 128), start).replace(/\s+$/, "");
  if (!before.endsWith("="))
    return null;
  return IDENTIFIER_TAIL.exec(before.slice(0, -1))?.[1] ?? null;
}
function inlineDataRegions(text, needles) {
  const regions = [];
  const seen = new Set;
  let lexed;
  for (const needle of needles) {
    for (let at = text.indexOf(needle);at !== -1; at = text.indexOf(needle, at + 1)) {
      if (lexed === undefined)
        lexed = lexCLike(text);
      if (lexed === null)
        return regions;
      const floor = Math.max(0, at - INLINE_DATA_WINDOW);
      const openers = [];
      for (let back = at;back >= floor; back -= 1) {
        const character = text[back];
        if (character === "[" || character === "{")
          openers.push(back);
      }
      for (const opener of openers.reverse()) {
        const root = parseInlineData(text, opener);
        if (root === null || root.kind === "string")
          continue;
        if (!(root.start <= at && at + needle.length <= root.end))
          continue;
        if (seen.has(opener))
          break;
        if (!isInertPosition(text, root.start, root.end, lexed.callArgumentOpeners))
          break;
        seen.add(opener);
        regions.push({ root, boundName: boundNameBefore(text, root.start), start: root.start, end: root.end });
        break;
      }
    }
  }
  return regions;
}
var LOAD_CALLEE = String.raw`(?:^|[^\w$])(?:_*(?:import|require)|createRequire|Module\s*\.\s*_load)`;
var LOAD_ARGUMENT_WINDOW = 4096;
function loadCallArguments(text, open) {
  const limit = Math.min(text.length, open + LOAD_ARGUMENT_WINDOW);
  let depth = 0;
  for (let index = open;index < limit; index += 1) {
    const character = text[index];
    if (character === '"' || character === "'" || character === "`") {
      const literalEnd = character === "`" ? scanTemplateLiteral(text, index) : scanQuoted(text, index, character);
      if (literalEnd !== null) {
        index = literalEnd - 1;
        continue;
      }
    }
    if (character === "(" || character === "[" || character === "{")
      depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0)
        return text.slice(open + 1, index);
    }
  }
  return text.slice(open + 1, limit);
}
function scanTemplateLiteral(text, start) {
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "`")
      return index + 1;
  }
  return null;
}
function loadCallMentions(text, name) {
  const calls = new RegExp(`${LOAD_CALLEE}\\s*\\(`, "g");
  const bounded = new RegExp(`[^\\w$]${escapeRegex2(name)}(?![\\w$])`);
  for (const match of text.matchAll(calls)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    if (bounded.test(` ${loadCallArguments(text, open)}`))
      return true;
  }
  return false;
}
function blankSpans(text, spans) {
  if (spans.length === 0)
    return text;
  const chars = toUnits(text);
  for (const span of spans)
    blank(chars, span.start, span.end);
  return chars.join("");
}
function quoteCharacter(character) {
  return character === '"' || character === "'" || character === "`";
}
function quotedConstantSpan(text, node, expected) {
  if (node === undefined)
    return null;
  const raw = text.slice(node.start, node.end);
  const quote = raw[0];
  if (!quoteCharacter(quote))
    return null;
  if (raw !== `${quote}${expected}${quote}`)
    return null;
  return { start: node.start, end: node.end, constant: expected };
}
function blankConstantSpans(text, spans) {
  for (const span of spans) {
    const raw = text.slice(span.start, span.end);
    const quote = raw[0];
    if (!quoteCharacter(quote) || raw !== `${quote}${span.constant}${quote}`) {
      throw new Error(`refusing to blank ${span.start}..${span.end}: its bytes are not the constant it claims`);
    }
  }
  return blankSpans(text, spans);
}
var SPECIFIER_QUOTE = "[\"'`]";
var SPECIFIER_CHAR = "[^\"'`]";
function moduleSpecifier(moduleName) {
  return `${SPECIFIER_QUOTE}(?:${SPECIFIER_CHAR}*/)?${escapeRegex2(moduleName)}(?:/${SPECIFIER_CHAR}*)?${SPECIFIER_QUOTE}`;
}
function importsModule(maskedText, moduleName) {
  const pattern = new RegExp(String.raw`(?:\bfrom\s*|${LOAD_CALLEE}\s*\(\s*|\bimport\s*)` + moduleSpecifier(moduleName));
  return pattern.test(maskedText);
}
function importedBindings(maskedText, moduleName) {
  const bindings = new Set;
  const specifier = moduleSpecifier(moduleName);
  const statement = new RegExp(String.raw`\b(?:import|export)\s+([^;]*?)\bfrom\s*${specifier}`, "g");
  const assignment = new RegExp(String.raw`(?:const|let|var)\s+([^=;]*?)=\s*(?:await\s+)?_*(?:require|import)\s*\(\s*${specifier}\s*\)`, "g");
  for (const pattern of [statement, assignment]) {
    for (const match of maskedText.matchAll(pattern)) {
      for (const name of clauseBindings(match[1] ?? ""))
        bindings.add(name);
    }
  }
  return bindings;
}
var IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
function clauseBindings(clause) {
  const names = [];
  const braced = /\{([^}]*)\}/.exec(clause);
  if (braced) {
    for (const part of braced[1].split(",")) {
      const pieces = part.split(/\s+as\s+|:/);
      const name = (pieces[pieces.length - 1] ?? "").trim();
      if (IDENTIFIER.test(name))
        names.push(name);
    }
  }
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (namespace)
    names.push(namespace[1]);
  const head = clause.replace(/\{[^}]*\}/g, "").replace(/\*\s+as\s+[A-Za-z_$][\w$]*/g, "");
  for (const part of head.split(",")) {
    const name = part.replace(/\btype\b/g, "").trim();
    if (IDENTIFIER.test(name))
      names.push(name);
  }
  return names;
}

// src/no-cloud.ts
var SKIP_DIRS = new Set([".git", "node_modules", ".cache", ".next", ".turbo", "coverage", "docs", "examples", "tests"]);
var LOCKFILES = new Set(["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
var SOURCE_DIRS = new Set(["src", "bin", "cli", "mcp", "server", "lib", "scripts", "config", "infra", "hooks", ".github", "dist"]);
var MAX_TEXT_BYTES = 5 * 1024 * 1024;
var RUNTIME_PATTERNS = [
  { pattern: "@hasna/cloud", kind: "module", message: "Shared @hasna/cloud runtime reference is forbidden" },
  { pattern: "open-cloud", kind: "module", message: "Shared open-cloud runtime reference is forbidden" },
  { pattern: "cloud-mcp", kind: "module", message: "Legacy cloud-mcp runtime surface is forbidden" },
  { pattern: "registerCloudTools", kind: "symbol", message: "Legacy registerCloudTools runtime surface is forbidden" },
  { pattern: "registerCloudCommands", kind: "symbol", message: "Legacy registerCloudCommands runtime surface is forbidden" },
  { pattern: ".hasna/cloud", kind: "config", checkKind: "runtime_config", message: "Legacy .hasna/cloud runtime config is forbidden" },
  { pattern: "HASNA_CLOUD_", kind: "config", message: "Shared HASNA_CLOUD_* runtime config is forbidden" },
  { pattern: "HASNA_RDS_PASSWORD", kind: "config", message: "Legacy shared RDS credential config is forbidden" }
];
var PATH_CONFIG_PATTERNS = RUNTIME_PATTERNS.filter((entry) => ("checkKind" in entry));
var MODULE_PATTERNS = RUNTIME_PATTERNS.filter((entry) => entry.kind === "module");
var FORBIDDEN_LOCKFILE_PACKAGES = [
  ...new Set([...FORBIDDEN_SHARED_CLOUD_RUNTIMES, ...MODULE_PATTERNS.map((entry) => entry.pattern)])
];
var LOCKFILE_TEXT_PATTERNS = RUNTIME_PATTERNS.filter((entry) => entry.kind === "config");
function lockfileNamesPackage(text, packageName) {
  return new RegExp(`(?:^|["/])${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=["@/])`).test(text);
}
var NO_CLOUD_GUARD_TEST = /^src\/no-cloud-boundary\.test\.(?:[cm]?[jt]sx?|[cm]ts)$/;
var DYNAMIC_MODULE_LOAD = /\b(?:import|require)\s*\(\s*(?!(["'])[^"'\n]*\1\s*\))/;
var MODULE_RESOLUTION_CAPABILITY = /\b(?:createRequire|resolveSync|process\.binding|dlopen|eval|Function)\s*\(|\brequire\s*\.\s*resolve\b|\bimport\s*\.\s*meta\s*\.\s*resolve\b|\bBun\s*\.\s*plugin\b|\bnew\s+(?:URL|Worker|SharedWorker|Function)\s*\(/;
function isNoCloudGuardTest(path) {
  return NO_CLOUD_GUARD_TEST.test(path.replaceAll("\\", "/"));
}
function guardTestMentionsOnly(file, masked) {
  if (!isNoCloudGuardTest(file.path))
    return false;
  if (MODULE_RESOLUTION_CAPABILITY.test(masked))
    return false;
  if (DYNAMIC_MODULE_LOAD.test(masked))
    return false;
  return MODULE_PATTERNS.every((module) => mentionsCannotLoad(file.text, file.path, module.pattern));
}
function ownPatternDeclarationSpans(text, node) {
  if (node.kind === "array") {
    if (node.items.length !== FORBIDDEN_SHARED_CLOUD_RUNTIMES.length)
      return null;
    const spans = [];
    for (const [index, item] of node.items.entries()) {
      const span = quotedConstantSpan(text, item, FORBIDDEN_SHARED_CLOUD_RUNTIMES[index]);
      if (span === null)
        return null;
      spans.push(span);
    }
    return spans;
  }
  if (node.kind !== "record")
    return null;
  for (const row of RUNTIME_PATTERNS) {
    const keys = Object.keys(row);
    if (keys.length !== node.entries.size)
      continue;
    const spans = [];
    for (const key of keys) {
      const span = quotedConstantSpan(text, node.entries.get(key), row[key]);
      if (span === null)
        break;
      spans.push(span);
    }
    if (spans.length === keys.length)
      return spans;
  }
  return null;
}
function withoutInlinedDeclarations(masked, path) {
  if (commentSyntaxForPath(path) !== "c-like")
    return masked;
  const spans = [];
  for (const region of inlineDataRegions(masked, RUNTIME_PATTERNS.map((entry) => entry.pattern))) {
    if (region.boundName !== null && loadCallMentions(masked, region.boundName))
      continue;
    for (const node of [region.root, ...region.root.kind === "array" ? region.root.items : []]) {
      const verified = ownPatternDeclarationSpans(masked, node);
      if (verified !== null)
        spans.push(...verified);
    }
  }
  return blankConstantSpans(masked, spans);
}
function stableId(input) {
  let hash = 0;
  for (let index = 0;index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}
function readJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function packageVersionFromPackageJson(text) {
  const parsed = readJson(text);
  if (!isRecord2(parsed))
    return {};
  const record = parsed;
  const packageInfo = {};
  if (typeof record.name === "string")
    packageInfo.name = record.name;
  if (typeof record.version === "string")
    packageInfo.version = record.version;
  return packageInfo;
}
function malformedPackageJsonFinding(file) {
  if (isRecord2(readJson(file.text)))
    return null;
  return {
    id: `finding_${stableId(`${file.path}:malformed`)}`,
    kind: "package_manifest",
    severity: "critical",
    path: file.path,
    pattern: "package.json",
    message: "package.json must be valid JSON object before no-cloud dependency checks can pass",
    evidenceRefs: []
  };
}
function missingPackageJsonFinding() {
  return {
    id: "finding_package_manifest_missing",
    kind: "package_manifest",
    severity: "critical",
    pattern: "package.json",
    message: "No-cloud scan target must include a package.json manifest",
    evidenceRefs: []
  };
}
function dependencyFindings(file) {
  const parsed = readJson(file.text);
  if (!isRecord2(parsed)) {
    const malformed = malformedPackageJsonFinding(file);
    return malformed ? [malformed] : [];
  }
  const pkg = parsed;
  const packageName = typeof pkg.name === "string" ? pkg.name : undefined;
  const findings = [];
  if (packageName && FORBIDDEN_SHARED_CLOUD_RUNTIMES.includes(packageName)) {
    findings.push({
      id: `finding_${stableId(`${file.path}:name:${packageName}`)}`,
      kind: "package_manifest",
      severity: "critical",
      path: file.path,
      packageName,
      pattern: packageName,
      message: "Package identity is a forbidden shared cloud runtime",
      evidenceRefs: []
    });
  }
  for (const edge of manifestEdges(pkg, FORBIDDEN_SHARED_CLOUD_RUNTIMES)) {
    findings.push({
      id: `finding_${stableId(`${file.path}:${edge.section}:${edge.packageName}`)}`,
      kind: "package_manifest",
      severity: edge.scope === "production" ? "critical" : "high",
      path: file.path,
      packageName,
      pattern: edge.packageName,
      message: `Forbidden shared cloud runtime dependency in ${edge.section}`,
      evidenceRefs: []
    });
  }
  return findings;
}
function isAppCloudManifestDocument(file) {
  if (!file.path.endsWith(".json"))
    return false;
  const parsed = readJson(file.text);
  return isRecord2(parsed) && parsed.schema === SCHEMA_IDS.appCloudManifest;
}
function pathFindings(file, severity) {
  const findings = [];
  for (const entry of RUNTIME_PATTERNS) {
    if (!file.path.includes(entry.pattern))
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:path:${entry.pattern}`)}`,
      kind: "checkKind" in entry ? entry.checkKind : file.kind,
      severity,
      path: file.path,
      pattern: entry.pattern,
      message: `${entry.message} in path`,
      evidenceRefs: []
    });
  }
  return findings;
}
function textFindings(file, severity) {
  if (isAppCloudManifestDocument(file))
    return [];
  const masked = maskCommentsForPath(file.text, file.path);
  const guardTest = guardTestMentionsOnly(file, masked);
  const codeLike = file.kind === "source_import" || file.kind === "packed_artifact";
  const bareMentionText = withoutInlinedDeclarations(masked, file.path);
  const findings = [];
  for (const { pattern, kind, message } of RUNTIME_PATTERNS) {
    let reason = null;
    if (kind === "symbol" && codeLike) {
      const bound = MODULE_PATTERNS.some((module) => importedBindings(masked, module.pattern).has(pattern));
      if (bound)
        reason = "imported binding";
    } else if (kind === "module" && importsModule(masked, pattern)) {
      reason = "module import";
    } else if (!(guardTest && kind === "module") && bareMentionText.includes(pattern)) {
      reason = "source reference";
    }
    if (!reason)
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:${pattern}`)}`,
      kind: file.kind,
      severity,
      path: file.path,
      pattern,
      message: `${message} (${reason})`,
      evidenceRefs: []
    });
  }
  return findings;
}
function edgeFinding(edge, path, kind, packageName) {
  const via = edge.path.length > 1 ? ` via ${edge.path.join(" -> ")}` : "";
  const where = edge.section ? ` (root ${edge.section})` : "";
  return {
    id: `finding_${stableId(`${path}:edge:${edge.scope}:${edge.packageName}`)}`,
    kind,
    severity: edge.scope === "production" ? "critical" : "high",
    path,
    ...packageName ? { packageName } : {},
    pattern: edge.packageName,
    message: `Forbidden shared cloud runtime is a reachable ${edge.scope} dependency${via}${where}`,
    evidenceRefs: []
  };
}
var BUN_LOCKFILE = "bun.lock";
function lockfileTextFindings(file, severity) {
  const findings = [];
  for (const { pattern, message } of LOCKFILE_TEXT_PATTERNS) {
    if (!file.text.includes(pattern))
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:${pattern}`)}`,
      kind: file.kind,
      severity,
      path: file.path,
      pattern,
      message: `${message} (source reference)`,
      evidenceRefs: []
    });
  }
  return findings;
}
function lockfileUnwalkedNameFindings(file, severity, walk) {
  const explained = new Set([...walk.edges.map((edge) => edge.packageName), ...walk.clearedByLayout]);
  const findings = [];
  for (const { pattern, message } of MODULE_PATTERNS) {
    if (explained.has(pattern))
      continue;
    if (!lockfileNamesPackage(file.text, pattern))
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:${pattern}`)}`,
      kind: file.kind,
      severity,
      path: file.path,
      pattern,
      message: `${message} (lockfile names it outside any edge the walk could read)`,
      evidenceRefs: []
    });
  }
  return findings;
}
function lockfileFindings(file, severity, packageName) {
  if (basename(file.path) !== BUN_LOCKFILE)
    return textFindings(file, severity);
  const walk = lockfileWalk(file.text, FORBIDDEN_LOCKFILE_PACKAGES);
  if (walk === null)
    return textFindings(file, severity);
  return [
    ...walk.edges.map((edge) => edgeFinding(edge, file.path, "lockfile", packageName)),
    ...lockfileUnwalkedNameFindings(file, severity, walk),
    ...lockfileTextFindings(file, severity)
  ];
}
function scanFindings(file, severity, packageName) {
  if (file.kind === "package_manifest") {
    return [...dependencyFindings(file), ...pathFindings(file, severity), ...textFindings(file, "high")];
  }
  if (file.kind === "lockfile") {
    return [...pathFindings(file, severity), ...lockfileFindings(file, severity, packageName)];
  }
  return [...pathFindings(file, severity), ...textFindings(file, severity)];
}
function shouldReadPath(path) {
  for (const entry of PATH_CONFIG_PATTERNS) {
    if (path.includes(entry.pattern))
      return entry.checkKind;
  }
  const name = basename(path);
  if (name === "package.json")
    return "package_manifest";
  if (LOCKFILES.has(name))
    return "lockfile";
  if (name === ".env" || name.startsWith(".env."))
    return "runtime_config";
  if (!/\.(cjs|cts|js|json|jsx|mjs|mts|sh|ts|tsx|toml|ya?ml)$/i.test(name))
    return null;
  const parts = path.split(/[\\/]/);
  if (parts.length === 1)
    return "source_import";
  return parts.some((part) => SOURCE_DIRS.has(part)) ? "source_import" : null;
}
function collectDirectoryFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join2(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name))
          walk(full);
        continue;
      }
      if (!entry.isFile())
        continue;
      const kind = shouldReadPath(relative(root, full).replaceAll("\\", "/"));
      if (!kind)
        continue;
      const stat = statSync(full);
      if (stat.size > MAX_TEXT_BYTES)
        continue;
      files.push({ path: relative(root, full).replaceAll("\\", "/"), text: readFileSync(full, "utf8"), kind });
    }
  }
  walk(root);
  return files;
}
function collectTarballFiles(target) {
  const entries = listArchiveEntries(target);
  const archiveRoot = commonArchiveRoot(entries);
  const files = [];
  for (const entry of entries) {
    const normalized = normalizeArchiveEntry(entry, archiveRoot);
    if (!normalized)
      continue;
    const kind = shouldReadPath(normalized);
    if (!kind)
      continue;
    let text;
    try {
      text = readArchiveMemberText(target, entry);
    } catch (error2) {
      if (error2 instanceof Error && (error2.code === "ENOBUFS" || error2.message.includes("maxBuffer"))) {
        continue;
      }
      throw error2;
    }
    const artifactKind = kind === "package_manifest" || kind === "lockfile" ? kind : "packed_artifact";
    files.push({ path: normalized, text, kind: artifactKind });
  }
  return files;
}
function collectScanFiles(target) {
  const stat = statSync(target);
  if (stat.isDirectory())
    return { files: collectDirectoryFiles(target), scanMode: "source_tree" };
  if (stat.isFile() && isPackedArtifactPath(target))
    return { files: collectTarballFiles(target), scanMode: "packed_artifact" };
  throw new Error("no-cloud scan target must be a directory, .tgz, or .tar.gz file");
}
function portableSubject(resolved, scanMode, packageName) {
  if (scanMode === "packed_artifact") {
    const artifactName = basename(resolved);
    return {
      kind: "artifact",
      id: artifactName,
      uri: `artifact://${artifactName}`
    };
  }
  const repoId = packageName ?? basename(resolved);
  return {
    kind: "repo",
    id: repoId,
    uri: `repo://${repoId}`
  };
}
function scanNoCloudTarget(target, options = {}) {
  const resolved = resolve2(target);
  const { files, scanMode } = collectScanFiles(resolved);
  const packageFile = files.find((file) => file.path === "package.json") ?? files.find((file) => file.path.endsWith("/package.json"));
  const packageInfo = packageFile ? packageVersionFromPackageJson(packageFile.text) : {};
  const subject = portableSubject(resolved, scanMode, packageInfo.name);
  const targetRef = (checkId) => `${subject.uri}#${checkId}`;
  const findings = files.flatMap((file) => {
    if (file.kind === "lockfile")
      return scanFindings(file, "high", packageInfo.name);
    if (file.kind === "packed_artifact")
      return scanFindings(file, "critical", packageInfo.name);
    return scanFindings(file, "high", packageInfo.name);
  });
  const manifestProvided = Object.prototype.hasOwnProperty.call(options, "manifest") && options.manifest !== undefined;
  const manifestResult = manifestProvided ? AppCloudManifestSchema.safeParse(options.manifest) : null;
  const manifestFindings = [];
  if (manifestResult && !manifestResult.success) {
    manifestFindings.push({
      id: "finding_app_cloud_manifest_invalid",
      kind: "app_cloud_manifest",
      severity: "critical",
      pattern: SCHEMA_IDS.appCloudManifest,
      message: manifestResult.error.issues.map((issue2) => `${issue2.path.join(".") || "<root>"}: ${issue2.message}`).join("; "),
      evidenceRefs: []
    });
  }
  if (manifestResult?.success && packageInfo.name && manifestResult.data.packageName !== packageInfo.name) {
    manifestFindings.push({
      id: "finding_app_cloud_manifest_package_mismatch",
      kind: "app_cloud_manifest",
      severity: "critical",
      pattern: "packageName",
      message: `App cloud manifest packageName ${manifestResult.data.packageName} does not match scanned package ${packageInfo.name}`,
      evidenceRefs: []
    });
  }
  if (manifestResult?.success && packageInfo.version && manifestResult.data.packageVersion && manifestResult.data.packageVersion !== packageInfo.version) {
    manifestFindings.push({
      id: "finding_app_cloud_manifest_version_mismatch",
      kind: "app_cloud_manifest",
      severity: "high",
      pattern: "packageVersion",
      message: `App cloud manifest packageVersion ${manifestResult.data.packageVersion} does not match scanned package ${packageInfo.version}`,
      evidenceRefs: []
    });
  }
  const packagePresenceFindings = packageFile ? [] : [missingPackageJsonFinding()];
  const allFindings = [...packagePresenceFindings, ...findings, ...manifestFindings];
  const status = allFindings.some((finding) => finding.severity === "high" || finding.severity === "critical") ? "failed" : "succeeded";
  const packageChecks = [...packagePresenceFindings, ...files.filter((file) => file.kind === "package_manifest").flatMap((file) => scanFindings(file, "high", packageInfo.name))];
  const lockChecks = files.filter((file) => file.kind === "lockfile").flatMap((file) => scanFindings(file, "high", packageInfo.name));
  const sourceChecks = files.filter((file) => file.kind === "source_import" || file.kind === "runtime_config").flatMap((file) => scanFindings(file, "high", packageInfo.name));
  const artifactChecks = files.filter((file) => file.kind === "packed_artifact").flatMap((file) => scanFindings(file, "critical", packageInfo.name));
  const checks3 = [
    {
      id: "package_manifest",
      kind: "package_manifest",
      status: packageChecks.length > 0 ? "failed" : "succeeded",
      target: targetRef("package_manifest"),
      findings: packageChecks,
      evidenceRefs: []
    },
    {
      id: "lockfile",
      kind: "lockfile",
      status: lockChecks.length > 0 ? "failed" : "succeeded",
      target: targetRef("lockfile"),
      findings: lockChecks,
      evidenceRefs: []
    },
    {
      id: "source_runtime",
      kind: scanMode === "packed_artifact" ? "packed_artifact" : "source_import",
      status: sourceChecks.length + artifactChecks.length > 0 ? "failed" : "succeeded",
      target: targetRef("source_runtime"),
      findings: [...sourceChecks, ...artifactChecks],
      evidenceRefs: []
    }
  ];
  if (manifestProvided) {
    checks3.push({
      id: "app_cloud_manifest",
      kind: "app_cloud_manifest",
      status: manifestResult?.success && manifestFindings.length === 0 ? "succeeded" : "failed",
      target: targetRef("app_cloud_manifest"),
      findings: manifestFindings,
      evidenceRefs: []
    });
  }
  return NoCloudEvidencePackSchema.parse({
    schema: SCHEMA_IDS.noCloudEvidencePack,
    id: options.id ?? `no_cloud_${stableId(`${subject.uri}:${packageInfo.version ?? ""}`)}`,
    createdAt: options.now ?? new Date().toISOString(),
    subject,
    packageName: packageInfo.name,
    packageVersion: packageInfo.version,
    generatedBy: options.generatedBy,
    scanMode,
    status,
    verdict: status === "succeeded" ? "passed" : "failed",
    appCloudManifest: manifestResult?.success ? manifestResult.data : undefined,
    checks: checks3,
    findings: allFindings
  });
}
export {
  withoutInlinedDeclarations,
  scanNoCloudTarget
};
