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

// src/knowledge-db.ts
import { Database } from "bun:sqlite";

// src/workspace.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");
var EXAMPLE_KNOWLEDGE_CANONICAL = {
  division: "xyz",
  app_type: "opensource",
  app: "knowledge",
  env: "prod",
  local_path: HASNA_KNOWLEDGE_APP_PATH,
  s3: {
    bucket: "example-knowledge-prod",
    region: "us-east-1",
    profile: "example-infra",
    prefix: ".hasna/knowledge",
    server_side_encryption: "AES256"
  },
  secrets: {
    env: "example/knowledge/prod/env",
    aws: "example/knowledge/prod/aws",
    s3: "example/knowledge/prod/s3",
    rds: null,
    future_rds: "example/knowledge/prod/rds"
  },
  source_owner: "open-files",
  evidence_doc: "docs/canonical-secrets-bootstrap-2026-06-08.md"
};
function canonicalExampleKnowledgeStorage() {
  return {
    type: "s3",
    artifacts_root: "artifacts",
    s3: {
      bucket: EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket,
      prefix: EXAMPLE_KNOWLEDGE_CANONICAL.s3.prefix,
      region: EXAMPLE_KNOWLEDGE_CANONICAL.s3.region,
      profile: EXAMPLE_KNOWLEDGE_CANONICAL.s3.profile,
      server_side_encryption: EXAMPLE_KNOWLEDGE_CANONICAL.s3.server_side_encryption
    }
  };
}
function legacyGlobalStorePath() {
  return join(homedir(), ".open-knowledge", "db.json");
}
function globalKnowledgeHome() {
  return join(homedir(), ".hasna", "knowledge");
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function legacyGlobalKnowledgeHome() {
  return join(homedir(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function legacyProjectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function resolveLegacyScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(legacyProjectKnowledgeHome(cwd));
  }
  return workspaceForHome(legacyGlobalKnowledgeHome());
}
function workspaceForHome(home) {
  return {
    home,
    configPath: join(home, "config.json"),
    jsonStorePath: join(home, "db.json"),
    knowledgeDbPath: join(home, "knowledge.db"),
    artifactsDir: join(home, "artifacts"),
    cacheDir: join(home, "cache"),
    exportsDir: join(home, "exports"),
    indexesDir: join(home, "indexes"),
    logsDir: join(home, "logs"),
    runsDir: join(home, "runs"),
    schemasDir: join(home, "schemas"),
    wikiDir: join(home, "wiki")
  };
}
function defaultKnowledgeConfig() {
  return {
    version: 1,
    mode: "local",
    hosted: {
      api_url: "https://knowledge.md"
    },
    storage: {
      type: "local",
      artifacts_root: "artifacts"
    },
    sources: {
      preferred_ref: "open-files",
      allowed_schemes: ["open-files", "s3", "file", "https", "http"]
    },
    providers: {
      default_model: "openai:gpt-5.2",
      aliases: {
        fast: "openai:gpt-5-mini",
        reasoning: "anthropic:claude-opus-4-6",
        sonnet: "anthropic:claude-sonnet-4-6",
        deepseek: "deepseek:deepseek-chat",
        "deepseek-reasoning": "deepseek:deepseek-reasoner"
      },
      openai: {
        api_key_env: "OPENAI_API_KEY",
        default_model: "gpt-5.2"
      },
      anthropic: {
        api_key_env: "ANTHROPIC_API_KEY",
        default_model: "claude-sonnet-4-6"
      },
      deepseek: {
        api_key_env: "DEEPSEEK_API_KEY",
        default_model: "deepseek-chat"
      }
    },
    embeddings: {
      default_model: "openai:text-embedding-3-small",
      dimensions: 1536,
      batch_size: 64,
      max_parallel_calls: 4
    },
    safety: {
      network: {
        web_search_enabled: false,
        s3_reads_enabled: false,
        allowed_s3_buckets: []
      },
      redaction: {
        enabled: true
      },
      approvals: {
        generated_writes_require_approval: true
      }
    }
  };
}
function ensureKnowledgeWorkspace(home) {
  const workspace = workspaceForHome(home);
  mkdirSync(workspace.home, { recursive: true, mode: 448 });
  for (const dir of [
    workspace.artifactsDir,
    workspace.cacheDir,
    workspace.exportsDir,
    workspace.indexesDir,
    workspace.logsDir,
    workspace.runsDir,
    workspace.schemasDir,
    workspace.wikiDir
  ]) {
    mkdirSync(dir, { recursive: true, mode: 448 });
  }
  if (!existsSync(workspace.configPath)) {
    writeFileSync(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}
`, { mode: 384 });
    chmodSync(workspace.configPath, 384);
  }
  return workspace;
}
function resolveScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(projectKnowledgeHome(cwd));
  }
  return workspaceForHome(globalKnowledgeHome());
}
function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}
function readKnowledgeConfig(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}
function writeKnowledgeConfig(path, config) {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}
`, { mode: 384 });
  chmodSync(path, 384);
}

// node_modules/@hasna/contracts/dist/client/storage.js
var __defProp2 = Object.defineProperty;
var __returnValue2 = (v) => v;
function __exportSetter2(name, newValue) {
  this[name] = __returnValue2.bind(null, newValue);
}
var __export2 = (target, all) => {
  for (var name in all)
    __defProp2(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter2.bind(all, name)
    });
};
var exports_external = {};
__export2(exports_external, {
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
  getParsedType: () => getParsedType,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default,
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
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNever: () => ZodNever,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  Schema: () => ZodType,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever;
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
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
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
var getParsedType = (data) => {
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

class ZodError extends Error {
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
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
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
    if (!(value instanceof ZodError)) {
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
  flatten(mapper = (issue) => issue.message) {
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
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
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
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
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
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
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
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default ? undefined : en_default
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
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
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

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
        const error = new ZodError(ctx.common.issues);
        this._error = error;
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

class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
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
        parsedType: getParsedType(input.data),
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
      parsedType: getParsedType(data)
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
      parsedType: getParsedType(data)
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
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
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
      const result = check(val);
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
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
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
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
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
    return new ZodCatch({
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
    return ZodReadonly.create(this);
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
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
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
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
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
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
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
  _addCheck(check) {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
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
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString({
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
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber extends ZodType {
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
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
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
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
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
    return new ZodNumber({
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
  _addCheck(check) {
    return new ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
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
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType {
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
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
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
  _addCheck(check) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
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

class ZodBoolean extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
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
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
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
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
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

class ZodSymbol extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
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

class ZodUndefined extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
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

class ZodNull extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
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
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType {
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

class ZodUnknown extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever extends ZodType {
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
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
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

class ZodArray extends ZodType {
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
    return new ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject extends ZodType {
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
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
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
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
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
    if (this._def.catchall instanceof ZodNever) {
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
    return new ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
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
    return new ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject({
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
    return new ZodObject({
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
    return new ZodObject({
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
    return new ZodObject({
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
    return new ZodObject({
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
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion extends ZodType {
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
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
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
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
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
ZodUnion.create = (types, params) => {
  return new ZodUnion({
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
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType {
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
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
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
      const sharedValue = mergeValues(itemA, itemB);
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

class ZodIntersection extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
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
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType {
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
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType {
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
    if (second instanceof ZodType) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType {
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

class ZodSet extends ZodType {
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

class ZodFunction extends ZodType {
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
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
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
      args: ZodTuple.create(items).rest(ZodUnknown.create())
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
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType {
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

class ZodLiteral extends ZodType {
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
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum extends ZodType {
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
    return ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum.create = createZodEnum;

class ZodNativeEnum extends ZodType {
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

class ZodPromise extends ZodType {
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

class ZodEffects extends ZodType {
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

class ZodOptional extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault extends ZodType {
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
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch extends ZodType {
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
              return new ZodError(newCtx.common.issues);
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
            return new ZodError(newCtx.common.issues);
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
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
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

class ZodBranded extends ZodType {
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

class ZodPipeline extends ZodType {
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

class ZodReadonly extends ZodType {
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
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
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
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
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
  object: ZodObject.lazycreate
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
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;
var SCHEMA_IDS = {
  actorRef: "hasna.actor_ref.v1",
  resourceRef: "hasna.resource_ref.v1",
  evidenceRef: "hasna.evidence_ref.v1",
  workRun: "hasna.work_run.v1",
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
  noCloudEvidencePack: "hasna.no_cloud_evidence_pack.v1",
  serviceContract: "hasna.service_contract.v1",
  commsEventEnvelope: "hasna.comms_event_envelope.v1",
  commsChannelMetadata: "hasna.comms_channel_metadata.v1",
  commsMessageMetadata: "hasna.comms_message_metadata.v1",
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
  storageMode: exports_external.enum(["local_only", "app_owned_cloud", "hybrid_local_cache", "external_service"]),
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
  if (value.storageMode === "local_only" && value.cloudBoundary !== "none") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "local_only storage requires cloudBoundary none",
      path: ["cloudBoundary"]
    });
  }
  if (value.storageMode === "app_owned_cloud" && value.cloudBoundary !== "app_owned") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "app_owned_cloud storage requires cloudBoundary app_owned",
      path: ["cloudBoundary"]
    });
  }
  if (value.storageMode === "hybrid_local_cache") {
    if (value.cloudBoundary !== "local_cache") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "hybrid_local_cache storage requires cloudBoundary local_cache",
        path: ["cloudBoundary"]
      });
    }
    if (!value.localCache) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "hybrid_local_cache storage requires localCache settings",
        path: ["localCache"]
      });
    }
  }
  if (value.storageMode === "external_service") {
    if (value.cloudBoundary !== "external_service") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "external_service storage requires cloudBoundary external_service",
        path: ["cloudBoundary"]
      });
    }
    if (value.cloudResources.length > 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "external_service storage must not declare app-owned cloudResources",
        path: ["cloudResources"]
      });
    }
  }
  if ((value.storageMode === "app_owned_cloud" || value.storageMode === "hybrid_local_cache") && value.cloudResources.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cloud-backed storage modes require explicit app-owned cloudResources",
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
  const allFindings = [...value.findings, ...value.checks.flatMap((check) => check.findings)];
  const blockingFindings = allFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence requires succeeded status", path: ["status"] });
    }
    if (blockingFindings.length > 0) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence cannot include high or critical findings", path: ["findings"] });
    }
    if (value.checks.some((check) => check.status !== "succeeded")) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence requires every check to be succeeded", path: ["checks"] });
    }
  }
  if (value.verdict === "failed" && allFindings.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Failed no-cloud evidence requires findings", path: ["findings"] });
  }
  if (value.status === "succeeded" && value.checks.some((check) => check.status === "failed")) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Succeeded no-cloud evidence cannot contain failed checks", path: ["checks"] });
  }
  value.checks.forEach((check, index) => {
    const checkBlockingFindings = check.findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
    if (check.status === "succeeded" && checkBlockingFindings.length > 0) {
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
    value.checks.forEach((check, index) => {
      if (check.status !== "succeeded") {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Passed proof bundles require all checks to have status succeeded",
          path: ["checks", index, "status"]
        });
      }
    });
    const hasEvidence = value.evidenceRefs.length > 0 || value.checks.some((check) => check.evidenceRefs.length > 0);
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
  if (value.verdict === "failed" && !value.checks.some((check) => check.status === "failed") && value.evidenceRefs.length === 0) {
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
var DEPLOYMENT_MODES = ["local", "self-hosted", "cloud"];
var DeploymentModeSchema = exports_external.enum(DEPLOYMENT_MODES);
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
  status: ServiceSurfaceStatusSchema,
  bin: exports_external.string().min(1).optional(),
  mcpBin: exports_external.string().min(1).optional(),
  authMode: ServiceAuthModeSchema,
  deploymentModes: exports_external.array(DeploymentModeSchema).min(1),
  health: ServiceEndpointSchema.optional(),
  readiness: ServiceEndpointSchema.optional(),
  version: ServiceEndpointSchema.optional(),
  apiBasePath: exports_external.string().regex(/^\/v[0-9]+$/, "Stable API base path must be /vN").optional(),
  openApiPath: exports_external.string().regex(/^\/[A-Za-z0-9_./:-]*$/).optional(),
  deferReason: exports_external.string().min(1).optional(),
  readinessGates: exports_external.array(DeploymentReadinessGateSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "supported") {
    if (!value.bin) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported service surfaces require a serve bin", path: ["bin"] });
    }
    if (!value.health) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported service surfaces require a health endpoint", path: ["health"] });
    }
    if (!value.version) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported service surfaces require a version endpoint", path: ["version"] });
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
  if (value.readiness && value.readiness.path !== "/ready") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Readiness endpoint must be /ready", path: ["readiness", "path"] });
  }
  if (value.version && value.version.path !== "/version") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Version endpoint must be /version", path: ["version", "path"] });
  }
});
var STORAGE_MODES = ["local", "cloud"];
var StorageModeSchema = exports_external.enum(STORAGE_MODES);
var DEPRECATED_STORAGE_MODE_ALIASES = ["remote", "hybrid", "self_hosted"];
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
function allowedBinsForName(name) {
  return ALLOWED_BIN_SUFFIXES.map((suffix) => `${name}${suffix}`);
}
function databaseUrlSecretRefFor(name) {
  return `hasna/oss/${name}/database-url`;
}
var StorageContractSchema = exports_external.object({
  mode: StorageModeSchema,
  envPrefix: exports_external.string().regex(/^HASNA_[A-Z][A-Z0-9]*_$/).optional(),
  aliasEnvPrefix: exports_external.string().regex(/^[A-Z][A-Z0-9]*_$/).optional(),
  databaseUrlSecretRef: exports_external.string().regex(/^hasna\/oss\/[a-z0-9-]+\/database-url$/).optional(),
  sqlitePath: exports_external.string().min(1).optional()
}).strict();
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
  deploymentModes: exports_external.array(DeploymentModeSchema).default(["local"]),
  serviceSurfaces: exports_external.array(ServiceSurfaceSchema).default([]),
  metadata: MetadataSchema.optional()
}).strict().superRefine((value, ctx) => {
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
    if (value.storage.mode === "cloud" && !value.storage.databaseUrlSecretRef) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "cloud storage requires a databaseUrlSecretRef (PURE REMOTE: reads and writes go to cloud Postgres)",
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
    } else if (value.storage.mode === "local" && !value.storage.sqlitePath) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "local cli-with-store storage requires sqlitePath (~/.hasna/<name>/<name>.db)",
        path: ["storage", "sqlitePath"]
      });
    }
    if (!seenBins.has(value.name)) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: `cli-with-store repos must ship the "${value.name}" bin`, path: ["bins"] });
    }
  }
  if (value.class === "service") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "service repos must declare storage", path: ["storage"] });
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
    } else if (value.storage.mode !== "cloud") {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "saas repos must use cloud storage mode", path: ["storage", "mode"] });
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
    for (const [modeIndex, deploymentMode] of surface.deploymentModes.entries()) {
      if (!value.deploymentModes.includes(deploymentMode)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `Service surface deployment mode "${deploymentMode}" must be declared in deploymentModes`,
          path: ["serviceSurfaces", index, "deploymentModes", modeIndex]
        });
      }
    }
  }
});
var HealthResponseSchema = exports_external.object({
  status: exports_external.enum(["ok", "degraded", "unavailable"]),
  version: exports_external.string().min(1),
  mode: StorageModeSchema
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
var ContractSchemaRegistry = {
  [SCHEMA_IDS.actorRef]: ActorRefSchema,
  [SCHEMA_IDS.resourceRef]: ResourceRefSchema,
  [SCHEMA_IDS.evidenceRef]: EvidenceRefSchema,
  [SCHEMA_IDS.workRun]: WorkRunSchema,
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
  [SCHEMA_IDS.serviceContract]: ServiceContractManifestSchema,
  [SCHEMA_IDS.commsEventEnvelope]: CommsEventEnvelopeSchema,
  [SCHEMA_IDS.commsChannelMetadata]: CommsChannelMetadataSchema,
  [SCHEMA_IDS.commsMessageMetadata]: CommsMessageMetadataSchema,
  [SCHEMA_IDS.app]: AppSchema,
  [SCHEMA_IDS.release]: ReleaseSchema,
  [SCHEMA_IDS.rolloutRecord]: RolloutRecordSchema,
  [SCHEMA_IDS.announcement]: AnnouncementSchema,
  [SCHEMA_IDS.audience]: AudienceSchema
};
function normalizeStorageMode(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local")
    return { mode: "local", deprecatedAlias: null };
  if (normalized === "cloud")
    return { mode: "cloud", deprecatedAlias: null };
  if (DEPRECATED_STORAGE_MODE_ALIASES.includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function defaultCloudBaseUrl(name) {
  return `https://${name}.hasna.xyz`;
}
function clientTransportEnvKeys(name) {
  const envSegment = envToken(name);
  return {
    modeKeys: [
      `HASNA_${envSegment}_STORAGE_MODE`,
      `HASNA_${envSegment}_MODE`,
      `${envSegment}_STORAGE_MODE`,
      `${envSegment}_MODE`
    ],
    apiUrlKeys: [`HASNA_${envSegment}_API_URL`, `${envSegment}_API_URL`],
    apiKeyKeys: [`HASNA_${envSegment}_API_KEY`, `${envSegment}_API_KEY`]
  };
}
function firstEnv2(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
function toV1BaseUrl(apiUrl) {
  const url = new URL(apiUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must use http or https.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1"))
    path = path.slice(0, -"/v1".length);
  url.pathname = `${path}/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}
function resolveClientTransport(name, env = process.env) {
  const keys = clientTransportEnvKeys(name);
  const modeHit = firstEnv2(env, keys.modeKeys);
  const urlHit = firstEnv2(env, keys.apiUrlKeys);
  const keyHit = firstEnv2(env, keys.apiKeyKeys);
  let mode = "local";
  let deprecatedAlias = null;
  let modeSource = "default";
  const warnings = [];
  if (modeHit) {
    const normalized = normalizeStorageMode(modeHit.value);
    mode = normalized.mode;
    deprecatedAlias = normalized.deprecatedAlias;
    modeSource = modeHit.key;
    if (deprecatedAlias) {
      warnings.push(`Deprecated mode '${deprecatedAlias}' from ${modeHit.key} is treated as 'cloud'. Prefer ${keys.modeKeys[0]}=cloud.`);
    }
  } else if (urlHit && keyHit) {
    mode = "cloud";
    modeSource = `${urlHit.key}+${keyHit.key}`;
  }
  if (mode === "local") {
    return {
      transport: "local",
      mode,
      deprecatedAlias,
      modeSource,
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: Boolean(keyHit),
      apiKeySource: keyHit ? keyHit.key : null,
      misconfigured: false,
      warning: warnings.length > 0 ? warnings.join(" ") : null
    };
  }
  if (!keyHit) {
    warnings.push(`${modeSource}=cloud but no API key is set (${keys.apiKeyKeys[0]}). Refusing to route to cloud; using local store. Set ${keys.apiKeyKeys[0]} to enable the cloud client.`);
    return {
      transport: "local",
      mode,
      deprecatedAlias,
      modeSource,
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: false,
      apiKeySource: null,
      misconfigured: true,
      warning: warnings.join(" ")
    };
  }
  const rawUrl = urlHit?.value ?? defaultCloudBaseUrl(name);
  const apiUrlSource = urlHit ? urlHit.key : "default";
  let baseUrl;
  try {
    baseUrl = toV1BaseUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Invalid API URL from ${apiUrlSource}: ${message}. Using local store.`);
    return {
      transport: "local",
      mode,
      deprecatedAlias,
      modeSource,
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: true,
      apiKeySource: keyHit.key,
      misconfigured: true,
      warning: warnings.join(" ")
    };
  }
  return {
    transport: "cloud-http",
    mode,
    deprecatedAlias,
    modeSource,
    baseUrl,
    apiUrlSource,
    apiKeyPresent: true,
    apiKeySource: keyHit.key,
    misconfigured: false,
    warning: warnings.length > 0 ? warnings.join(" ") : null
  };
}

class HasnaHttpError extends Error {
  status;
  method;
  path;
  body;
  constructor(method, path, status, body) {
    super(`Hasna cloud request failed: ${method} ${path} -> ${status}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}
var DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];
var IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
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
var defaultSleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
function createHasnaHttpTransport(options) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");
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
  async function once(method, rel, url, body, opts) {
    const headers = {
      "x-api-key": options.apiKey,
      Authorization: `Bearer ${options.apiKey}`,
      Accept: "application/json",
      ...options.headers ?? {},
      ...opts.headers ?? {}
    };
    if (opts.idempotencyKey)
      headers["Idempotency-Key"] = opts.idempotencyKey;
    const init = { method, headers };
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
    const text = await response.text();
    let parsed = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      const retry = resolveRetry(opts.retry);
      const retryable = retry ? retry.retryStatuses.includes(response.status) : false;
      return { ok: false, retryable, error: new HasnaHttpError(method, rel, response.status, parsed) };
    }
    return { ok: true, value: parsed };
  }
  async function request(method, path, body, opts = {}) {
    const upper = method.toUpperCase();
    const rel = appendQuery(path.startsWith("/") ? path : `/${path}`, opts.query);
    const url = `${base}${rel}`;
    const retry = resolveRetry(opts.retry);
    const methodRetryable = IDEMPOTENT_METHODS.has(upper) || Boolean(opts.idempotencyKey);
    const maxAttempts = retry && methodRetryable ? retry.retries + 1 : 1;
    let last = null;
    for (let attempt = 1;attempt <= maxAttempts; attempt++) {
      const result = await once(upper, rel, url, body, opts);
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
  const resolution = resolveClientTransport(name, env);
  if (resolution.misconfigured) {
    throw new Error(resolution.warning ?? `Client for '${name}' is misconfigured for cloud mode.`);
  }
  if (resolution.transport === "local" || !resolution.baseUrl) {
    return { transport: "local", client: null, resolution };
  }
  const keys = clientTransportEnvKeys(name);
  const apiKey = firstEnv2(env, keys.apiKeyKeys)?.value;
  if (!apiKey) {
    throw new Error(`Client for '${name}' resolved to cloud-http without an API key.`);
  }
  return {
    transport: "cloud-http",
    client: createHasnaHttpTransport({
      name,
      baseUrl: resolution.baseUrl,
      apiKey,
      ...overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {},
      ...overrides?.headers ? { headers: overrides.headers } : {},
      ...overrides?.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {},
      ...overrides?.retry !== undefined ? { retry: overrides.retry } : {},
      ...overrides?.sleepImpl ? { sleepImpl: overrides.sleepImpl } : {}
    }),
    resolution
  };
}
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
        if (error instanceof HasnaHttpError && error.status === 404)
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
        if (error instanceof HasnaHttpError && error.status === 404)
          return;
        throw error;
      }
    }
  };
}
function resolveStorageClient(name, env = process.env, overrides) {
  const wired = createClientTransport(name, env, overrides);
  if (wired.transport === "cloud-http") {
    return { transport: "cloud-http", client: createHasnaStorageClient(name, wired.client) };
  }
  return { transport: "local", client: null };
}

// node_modules/@hasna/contracts/dist/client/transport.js
var __defProp3 = Object.defineProperty;
var __returnValue3 = (v) => v;
function __exportSetter3(name, newValue) {
  this[name] = __returnValue3.bind(null, newValue);
}
var __export3 = (target, all) => {
  for (var name in all)
    __defProp3(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter3.bind(all, name)
    });
};
var exports_external2 = {};
__export3(exports_external2, {
  void: () => voidType2,
  util: () => util2,
  unknown: () => unknownType2,
  union: () => unionType2,
  undefined: () => undefinedType2,
  tuple: () => tupleType2,
  transformer: () => effectsType2,
  symbol: () => symbolType2,
  string: () => stringType2,
  strictObject: () => strictObjectType2,
  setErrorMap: () => setErrorMap2,
  set: () => setType2,
  record: () => recordType2,
  quotelessJson: () => quotelessJson2,
  promise: () => promiseType2,
  preprocess: () => preprocessType2,
  pipeline: () => pipelineType2,
  ostring: () => ostring2,
  optional: () => optionalType2,
  onumber: () => onumber2,
  oboolean: () => oboolean2,
  objectUtil: () => objectUtil2,
  object: () => objectType2,
  number: () => numberType2,
  nullable: () => nullableType2,
  null: () => nullType2,
  never: () => neverType2,
  nativeEnum: () => nativeEnumType2,
  nan: () => nanType2,
  map: () => mapType2,
  makeIssue: () => makeIssue2,
  literal: () => literalType2,
  lazy: () => lazyType2,
  late: () => late2,
  isValid: () => isValid2,
  isDirty: () => isDirty2,
  isAsync: () => isAsync2,
  isAborted: () => isAborted2,
  intersection: () => intersectionType2,
  instanceof: () => instanceOfType2,
  getParsedType: () => getParsedType2,
  getErrorMap: () => getErrorMap2,
  function: () => functionType2,
  enum: () => enumType2,
  effect: () => effectsType2,
  discriminatedUnion: () => discriminatedUnionType2,
  defaultErrorMap: () => en_default2,
  datetimeRegex: () => datetimeRegex2,
  date: () => dateType2,
  custom: () => custom2,
  coerce: () => coerce2,
  boolean: () => booleanType2,
  bigint: () => bigIntType2,
  array: () => arrayType2,
  any: () => anyType2,
  addIssueToContext: () => addIssueToContext2,
  ZodVoid: () => ZodVoid2,
  ZodUnknown: () => ZodUnknown2,
  ZodUnion: () => ZodUnion2,
  ZodUndefined: () => ZodUndefined2,
  ZodType: () => ZodType2,
  ZodTuple: () => ZodTuple2,
  ZodTransformer: () => ZodEffects2,
  ZodSymbol: () => ZodSymbol2,
  ZodString: () => ZodString2,
  ZodSet: () => ZodSet2,
  ZodSchema: () => ZodType2,
  ZodRecord: () => ZodRecord2,
  ZodReadonly: () => ZodReadonly2,
  ZodPromise: () => ZodPromise2,
  ZodPipeline: () => ZodPipeline2,
  ZodParsedType: () => ZodParsedType2,
  ZodOptional: () => ZodOptional2,
  ZodObject: () => ZodObject2,
  ZodNumber: () => ZodNumber2,
  ZodNullable: () => ZodNullable2,
  ZodNull: () => ZodNull2,
  ZodNever: () => ZodNever2,
  ZodNativeEnum: () => ZodNativeEnum2,
  ZodNaN: () => ZodNaN2,
  ZodMap: () => ZodMap2,
  ZodLiteral: () => ZodLiteral2,
  ZodLazy: () => ZodLazy2,
  ZodIssueCode: () => ZodIssueCode2,
  ZodIntersection: () => ZodIntersection2,
  ZodFunction: () => ZodFunction2,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind2,
  ZodError: () => ZodError2,
  ZodEnum: () => ZodEnum2,
  ZodEffects: () => ZodEffects2,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion2,
  ZodDefault: () => ZodDefault2,
  ZodDate: () => ZodDate2,
  ZodCatch: () => ZodCatch2,
  ZodBranded: () => ZodBranded2,
  ZodBoolean: () => ZodBoolean2,
  ZodBigInt: () => ZodBigInt2,
  ZodArray: () => ZodArray2,
  ZodAny: () => ZodAny2,
  Schema: () => ZodType2,
  ParseStatus: () => ParseStatus2,
  OK: () => OK2,
  NEVER: () => NEVER2,
  INVALID: () => INVALID2,
  EMPTY_PATH: () => EMPTY_PATH2,
  DIRTY: () => DIRTY2,
  BRAND: () => BRAND2
});
var util2;
(function(util22) {
  util22.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util22.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util22.assertNever = assertNever;
  util22.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util22.getValidEnumValues = (obj) => {
    const validKeys = util22.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util22.objectValues(filtered);
  };
  util22.objectValues = (obj) => {
    return util22.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util22.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util22.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util22.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util22.joinValues = joinValues;
  util22.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util2 || (util2 = {}));
var objectUtil2;
(function(objectUtil22) {
  objectUtil22.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil2 || (objectUtil2 = {}));
var ZodParsedType2 = util2.arrayToEnum([
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
      return ZodParsedType2.undefined;
    case "string":
      return ZodParsedType2.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType2.nan : ZodParsedType2.number;
    case "boolean":
      return ZodParsedType2.boolean;
    case "function":
      return ZodParsedType2.function;
    case "bigint":
      return ZodParsedType2.bigint;
    case "symbol":
      return ZodParsedType2.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType2.array;
      }
      if (data === null) {
        return ZodParsedType2.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType2.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType2.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType2.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType2.date;
      }
      return ZodParsedType2.object;
    default:
      return ZodParsedType2.unknown;
  }
};
var ZodIssueCode2 = util2.arrayToEnum([
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
var quotelessJson2 = (obj) => {
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
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
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
    return JSON.stringify(this.issues, util2.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
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
  const error = new ZodError2(issues);
  return error;
};
var errorMap2 = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode2.invalid_type:
      if (issue.received === ZodParsedType2.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode2.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util2.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode2.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util2.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode2.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode2.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util2.joinValues(issue.options)}`;
      break;
    case ZodIssueCode2.invalid_enum_value:
      message = `Invalid enum value. Expected ${util2.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode2.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode2.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode2.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode2.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util2.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode2.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode2.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode2.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode2.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode2.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode2.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util2.assertNever(issue);
  }
  return { message };
};
var en_default2 = errorMap2;
var overrideErrorMap2 = en_default2;
function setErrorMap2(map) {
  overrideErrorMap2 = map;
}
function getErrorMap2() {
  return overrideErrorMap2;
}
var makeIssue2 = (params) => {
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
var EMPTY_PATH2 = [];
function addIssueToContext2(ctx, issueData) {
  const overrideMap = getErrorMap2();
  const issue = makeIssue2({
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
  ctx.common.issues.push(issue);
}

class ParseStatus2 {
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
        return INVALID2;
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
    return ParseStatus2.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID2;
      if (value.status === "aborted")
        return INVALID2;
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
var INVALID2 = Object.freeze({
  status: "aborted"
});
var DIRTY2 = (value) => ({ status: "dirty", value });
var OK2 = (value) => ({ status: "valid", value });
var isAborted2 = (x) => x.status === "aborted";
var isDirty2 = (x) => x.status === "dirty";
var isValid2 = (x) => x.status === "valid";
var isAsync2 = (x) => typeof Promise !== "undefined" && x instanceof Promise;
var errorUtil2;
(function(errorUtil22) {
  errorUtil22.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil22.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil2 || (errorUtil2 = {}));

class ParseInputLazyPath2 {
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
var handleResult2 = (ctx, result) => {
  if (isValid2(result)) {
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
        const error = new ZodError2(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams2(params) {
  if (!params)
    return {};
  const { errorMap: errorMap22, invalid_type_error, required_error, description } = params;
  if (errorMap22 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap22)
    return { errorMap: errorMap22, description };
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
      status: new ParseStatus2,
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
    if (isAsync2(result)) {
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
    return handleResult2(ctx, result);
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
        return isValid2(result) ? {
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
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid2(result) ? {
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
    const result = await (isAsync2(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult2(ctx, result);
  }
  refine(check, message) {
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
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode2.custom,
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
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects2({
      schema: this,
      typeName: ZodFirstPartyTypeKind2.ZodEffects,
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
    return ZodPromise2.create(this, this._def);
  }
  or(option) {
    return ZodUnion2.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection2.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects2({
      ...processCreateParams2(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind2.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault2({
      ...processCreateParams2(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind2.ZodDefault
    });
  }
  brand() {
    return new ZodBranded2({
      typeName: ZodFirstPartyTypeKind2.ZodBranded,
      type: this,
      ...processCreateParams2(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch2({
      ...processCreateParams2(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind2.ZodCatch
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
    return ZodPipeline2.create(this, target);
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
var cuidRegex2 = /^c[^\s-]{8,}$/i;
var cuid2Regex2 = /^[0-9a-z]+$/;
var ulidRegex2 = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex2 = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex2 = /^[a-z0-9_-]{21}$/i;
var jwtRegex2 = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex2 = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex2 = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex2 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex2;
var ipv4Regex2 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex2 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex2 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex2 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex2 = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex2 = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource2 = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex2 = new RegExp(`^${dateRegexSource2}$`);
function timeRegexSource2(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex2(args) {
  return new RegExp(`^${timeRegexSource2(args)}$`);
}
function datetimeRegex2(args) {
  let regex = `${dateRegexSource2}T${timeRegexSource2(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP2(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex2.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex2.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT2(jwt, alg) {
  if (!jwtRegex2.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
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
function isValidCidr2(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex2.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex2.test(ip)) {
    return true;
  }
  return false;
}

class ZodString2 extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext2(ctx2, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.string,
        received: ctx2.parsedType
      });
      return INVALID2;
    }
    const status = new ParseStatus2;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext2(ctx, {
              code: ZodIssueCode2.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext2(ctx, {
              code: ZodIssueCode2.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "email",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex2) {
          emojiRegex2 = new RegExp(_emojiRegex2, "u");
        }
        if (!emojiRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "emoji",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "uuid",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "nanoid",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "cuid",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "cuid2",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "ulid",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "url",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "regex",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex2(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex2;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex2(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "duration",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP2(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "ip",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT2(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "jwt",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr2(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "cidr",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "base64",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex2.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            validation: "base64url",
            code: ZodIssueCode2.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util2.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode2.invalid_string,
      ...errorUtil2.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil2.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil2.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil2.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil2.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil2.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil2.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil2.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil2.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil2.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil2.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil2.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil2.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil2.errToObj(options) });
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
      ...errorUtil2.errToObj(options?.message)
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
      ...errorUtil2.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil2.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil2.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil2.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil2.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil2.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil2.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil2.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil2.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil2.errToObj(message));
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
    typeName: ZodFirstPartyTypeKind2.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams2(params)
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
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext2(ctx2, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.number,
        received: ctx2.parsedType
      });
      return INVALID2;
    }
    let ctx = undefined;
    const status = new ParseStatus2;
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util2.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder2(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util2.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil2.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil2.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil2.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil2.toString(message));
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
          message: errorUtil2.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber2({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil2.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil2.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil2.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil2.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil2.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil2.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil2.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil2.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil2.toString(message)
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
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util2.isInteger(ch.value));
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
    typeName: ZodFirstPartyTypeKind2.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams2(params)
  });
};

class ZodBigInt2 extends ZodType2 {
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
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus2;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util2.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext2(ctx, {
      code: ZodIssueCode2.invalid_type,
      expected: ZodParsedType2.bigint,
      received: ctx.parsedType
    });
    return INVALID2;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil2.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil2.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil2.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil2.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt2({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil2.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt2({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil2.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil2.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil2.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil2.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil2.toString(message)
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
ZodBigInt2.create = (params) => {
  return new ZodBigInt2({
    checks: [],
    typeName: ZodFirstPartyTypeKind2.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams2(params)
  });
};

class ZodBoolean2 extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.boolean,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    return OK2(input.data);
  }
}
ZodBoolean2.create = (params) => {
  return new ZodBoolean2({
    typeName: ZodFirstPartyTypeKind2.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams2(params)
  });
};

class ZodDate2 extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext2(ctx2, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.date,
        received: ctx2.parsedType
      });
      return INVALID2;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext2(ctx2, {
        code: ZodIssueCode2.invalid_date
      });
      return INVALID2;
    }
    const status = new ParseStatus2;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util2.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate2({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil2.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil2.toString(message)
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
ZodDate2.create = (params) => {
  return new ZodDate2({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind2.ZodDate,
    ...processCreateParams2(params)
  });
};

class ZodSymbol2 extends ZodType2 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.symbol,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    return OK2(input.data);
  }
}
ZodSymbol2.create = (params) => {
  return new ZodSymbol2({
    typeName: ZodFirstPartyTypeKind2.ZodSymbol,
    ...processCreateParams2(params)
  });
};

class ZodUndefined2 extends ZodType2 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.undefined,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    return OK2(input.data);
  }
}
ZodUndefined2.create = (params) => {
  return new ZodUndefined2({
    typeName: ZodFirstPartyTypeKind2.ZodUndefined,
    ...processCreateParams2(params)
  });
};

class ZodNull2 extends ZodType2 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.null,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    return OK2(input.data);
  }
}
ZodNull2.create = (params) => {
  return new ZodNull2({
    typeName: ZodFirstPartyTypeKind2.ZodNull,
    ...processCreateParams2(params)
  });
};

class ZodAny2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK2(input.data);
  }
}
ZodAny2.create = (params) => {
  return new ZodAny2({
    typeName: ZodFirstPartyTypeKind2.ZodAny,
    ...processCreateParams2(params)
  });
};

class ZodUnknown2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK2(input.data);
  }
}
ZodUnknown2.create = (params) => {
  return new ZodUnknown2({
    typeName: ZodFirstPartyTypeKind2.ZodUnknown,
    ...processCreateParams2(params)
  });
};

class ZodNever2 extends ZodType2 {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext2(ctx, {
      code: ZodIssueCode2.invalid_type,
      expected: ZodParsedType2.never,
      received: ctx.parsedType
    });
    return INVALID2;
  }
}
ZodNever2.create = (params) => {
  return new ZodNever2({
    typeName: ZodFirstPartyTypeKind2.ZodNever,
    ...processCreateParams2(params)
  });
};

class ZodVoid2 extends ZodType2 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.void,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    return OK2(input.data);
  }
}
ZodVoid2.create = (params) => {
  return new ZodVoid2({
    typeName: ZodFirstPartyTypeKind2.ZodVoid,
    ...processCreateParams2(params)
  });
};

class ZodArray2 extends ZodType2 {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType2.array) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.array,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext2(ctx, {
          code: tooBig ? ZodIssueCode2.too_big : ZodIssueCode2.too_small,
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
        addIssueToContext2(ctx, {
          code: ZodIssueCode2.too_small,
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
        addIssueToContext2(ctx, {
          code: ZodIssueCode2.too_big,
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
        return def.type._parseAsync(new ParseInputLazyPath2(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus2.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath2(ctx, item, ctx.path, i));
    });
    return ParseStatus2.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray2({
      ...this._def,
      minLength: { value: minLength, message: errorUtil2.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray2({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil2.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray2({
      ...this._def,
      exactLength: { value: len, message: errorUtil2.toString(message) }
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
    typeName: ZodFirstPartyTypeKind2.ZodArray,
    ...processCreateParams2(params)
  });
};
function deepPartialify2(schema) {
  if (schema instanceof ZodObject2) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional2.create(deepPartialify2(fieldSchema));
    }
    return new ZodObject2({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray2) {
    return new ZodArray2({
      ...schema._def,
      type: deepPartialify2(schema.element)
    });
  } else if (schema instanceof ZodOptional2) {
    return ZodOptional2.create(deepPartialify2(schema.unwrap()));
  } else if (schema instanceof ZodNullable2) {
    return ZodNullable2.create(deepPartialify2(schema.unwrap()));
  } else if (schema instanceof ZodTuple2) {
    return ZodTuple2.create(schema.items.map((item) => deepPartialify2(item)));
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
    const keys = util2.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext2(ctx2, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.object,
        received: ctx2.parsedType
      });
      return INVALID2;
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
        value: keyValidator._parse(new ParseInputLazyPath2(ctx, value, ctx.path, key)),
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
          addIssueToContext2(ctx, {
            code: ZodIssueCode2.unrecognized_keys,
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
          value: catchall._parse(new ParseInputLazyPath2(ctx, value, ctx.path, key)),
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
        return ParseStatus2.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus2.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil2.errToObj;
    return new ZodObject2({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil2.errToObj(message).message ?? defaultError
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
      typeName: ZodFirstPartyTypeKind2.ZodObject
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
    for (const key of util2.objectKeys(mask)) {
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
    for (const key of util2.objectKeys(this.shape)) {
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
    return deepPartialify2(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util2.objectKeys(this.shape)) {
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
    for (const key of util2.objectKeys(this.shape)) {
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
    return createZodEnum2(util2.objectKeys(this.shape));
  }
}
ZodObject2.create = (shape, params) => {
  return new ZodObject2({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind2.ZodObject,
    ...processCreateParams2(params)
  });
};
ZodObject2.strictCreate = (shape, params) => {
  return new ZodObject2({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind2.ZodObject,
    ...processCreateParams2(params)
  });
};
ZodObject2.lazycreate = (shape, params) => {
  return new ZodObject2({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind2.ZodObject,
    ...processCreateParams2(params)
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
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_union,
        unionErrors
      });
      return INVALID2;
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
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_union,
        unionErrors
      });
      return INVALID2;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion2.create = (types, params) => {
  return new ZodUnion2({
    options: types,
    typeName: ZodFirstPartyTypeKind2.ZodUnion,
    ...processCreateParams2(params)
  });
};
var getDiscriminator2 = (type) => {
  if (type instanceof ZodLazy2) {
    return getDiscriminator2(type.schema);
  } else if (type instanceof ZodEffects2) {
    return getDiscriminator2(type.innerType());
  } else if (type instanceof ZodLiteral2) {
    return [type.value];
  } else if (type instanceof ZodEnum2) {
    return type.options;
  } else if (type instanceof ZodNativeEnum2) {
    return util2.objectValues(type.enum);
  } else if (type instanceof ZodDefault2) {
    return getDiscriminator2(type._def.innerType);
  } else if (type instanceof ZodUndefined2) {
    return [undefined];
  } else if (type instanceof ZodNull2) {
    return [null];
  } else if (type instanceof ZodOptional2) {
    return [undefined, ...getDiscriminator2(type.unwrap())];
  } else if (type instanceof ZodNullable2) {
    return [null, ...getDiscriminator2(type.unwrap())];
  } else if (type instanceof ZodBranded2) {
    return getDiscriminator2(type.unwrap());
  } else if (type instanceof ZodReadonly2) {
    return getDiscriminator2(type.unwrap());
  } else if (type instanceof ZodCatch2) {
    return getDiscriminator2(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType2.object) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.object,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID2;
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
      const discriminatorValues = getDiscriminator2(type.shape[discriminator]);
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
    return new ZodDiscriminatedUnion2({
      typeName: ZodFirstPartyTypeKind2.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams2(params)
    });
  }
}
function mergeValues2(a, b) {
  const aType = getParsedType2(a);
  const bType = getParsedType2(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType2.object && bType === ZodParsedType2.object) {
    const bKeys = util2.objectKeys(b);
    const sharedKeys = util2.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues2(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType2.array && bType === ZodParsedType2.array) {
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
  } else if (aType === ZodParsedType2.date && bType === ZodParsedType2.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection2 extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted2(parsedLeft) || isAborted2(parsedRight)) {
        return INVALID2;
      }
      const merged = mergeValues2(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext2(ctx, {
          code: ZodIssueCode2.invalid_intersection_types
        });
        return INVALID2;
      }
      if (isDirty2(parsedLeft) || isDirty2(parsedRight)) {
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
    typeName: ZodFirstPartyTypeKind2.ZodIntersection,
    ...processCreateParams2(params)
  });
};

class ZodTuple2 extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType2.array) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.array,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID2;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.too_big,
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
      return schema._parse(new ParseInputLazyPath2(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus2.mergeArray(status, results);
      });
    } else {
      return ParseStatus2.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple2({
      ...this._def,
      rest
    });
  }
}
ZodTuple2.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple2({
    items: schemas,
    typeName: ZodFirstPartyTypeKind2.ZodTuple,
    rest: null,
    ...processCreateParams2(params)
  });
};

class ZodRecord2 extends ZodType2 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType2.object) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.object,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath2(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath2(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus2.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus2.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType2) {
      return new ZodRecord2({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind2.ZodRecord,
        ...processCreateParams2(third)
      });
    }
    return new ZodRecord2({
      keyType: ZodString2.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind2.ZodRecord,
      ...processCreateParams2(second)
    });
  }
}

class ZodMap2 extends ZodType2 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType2.map) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.map,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath2(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath2(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID2;
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
          return INVALID2;
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
ZodMap2.create = (keyType, valueType, params) => {
  return new ZodMap2({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind2.ZodMap,
    ...processCreateParams2(params)
  });
};

class ZodSet2 extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType2.set) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.set,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext2(ctx, {
          code: ZodIssueCode2.too_small,
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
        addIssueToContext2(ctx, {
          code: ZodIssueCode2.too_big,
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
          return INVALID2;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath2(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet2({
      ...this._def,
      minSize: { value: minSize, message: errorUtil2.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet2({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil2.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet2.create = (valueType, params) => {
  return new ZodSet2({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind2.ZodSet,
    ...processCreateParams2(params)
  });
};

class ZodFunction2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType2.function) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.function,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    function makeArgsIssue(args, error) {
      return makeIssue2({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap2(), en_default2].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode2.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue2({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap2(), en_default2].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode2.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise2) {
      const me = this;
      return OK2(async function(...args) {
        const error = new ZodError2([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK2(function(...args) {
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
    return new ZodFunction2({
      ...this._def,
      args: ZodTuple2.create(items).rest(ZodUnknown2.create())
    });
  }
  returns(returnType) {
    return new ZodFunction2({
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
    return new ZodFunction2({
      args: args ? args : ZodTuple2.create([]).rest(ZodUnknown2.create()),
      returns: returns || ZodUnknown2.create(),
      typeName: ZodFirstPartyTypeKind2.ZodFunction,
      ...processCreateParams2(params)
    });
  }
}

class ZodLazy2 extends ZodType2 {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy2.create = (getter, params) => {
  return new ZodLazy2({
    getter,
    typeName: ZodFirstPartyTypeKind2.ZodLazy,
    ...processCreateParams2(params)
  });
};

class ZodLiteral2 extends ZodType2 {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext2(ctx, {
        received: ctx.data,
        code: ZodIssueCode2.invalid_literal,
        expected: this._def.value
      });
      return INVALID2;
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
    typeName: ZodFirstPartyTypeKind2.ZodLiteral,
    ...processCreateParams2(params)
  });
};
function createZodEnum2(values, params) {
  return new ZodEnum2({
    values,
    typeName: ZodFirstPartyTypeKind2.ZodEnum,
    ...processCreateParams2(params)
  });
}

class ZodEnum2 extends ZodType2 {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext2(ctx, {
        expected: util2.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode2.invalid_type
      });
      return INVALID2;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext2(ctx, {
        received: ctx.data,
        code: ZodIssueCode2.invalid_enum_value,
        options: expectedValues
      });
      return INVALID2;
    }
    return OK2(input.data);
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
ZodEnum2.create = createZodEnum2;

class ZodNativeEnum2 extends ZodType2 {
  _parse(input) {
    const nativeEnumValues = util2.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType2.string && ctx.parsedType !== ZodParsedType2.number) {
      const expectedValues = util2.objectValues(nativeEnumValues);
      addIssueToContext2(ctx, {
        expected: util2.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode2.invalid_type
      });
      return INVALID2;
    }
    if (!this._cache) {
      this._cache = new Set(util2.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util2.objectValues(nativeEnumValues);
      addIssueToContext2(ctx, {
        received: ctx.data,
        code: ZodIssueCode2.invalid_enum_value,
        options: expectedValues
      });
      return INVALID2;
    }
    return OK2(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum2.create = (values, params) => {
  return new ZodNativeEnum2({
    values,
    typeName: ZodFirstPartyTypeKind2.ZodNativeEnum,
    ...processCreateParams2(params)
  });
};

class ZodPromise2 extends ZodType2 {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType2.promise && ctx.common.async === false) {
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.promise,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    const promisified = ctx.parsedType === ZodParsedType2.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK2(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise2.create = (schema, params) => {
  return new ZodPromise2({
    type: schema,
    typeName: ZodFirstPartyTypeKind2.ZodPromise,
    ...processCreateParams2(params)
  });
};

class ZodEffects2 extends ZodType2 {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind2.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext2(ctx, arg);
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
            return INVALID2;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID2;
          if (result.status === "dirty")
            return DIRTY2(result.value);
          if (status.value === "dirty")
            return DIRTY2(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID2;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID2;
        if (result.status === "dirty")
          return DIRTY2(result.value);
        if (status.value === "dirty")
          return DIRTY2(result.value);
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
          return INVALID2;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID2;
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
        if (!isValid2(base))
          return INVALID2;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid2(base))
            return INVALID2;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util2.assertNever(effect);
  }
}
ZodEffects2.create = (schema, effect, params) => {
  return new ZodEffects2({
    schema,
    typeName: ZodFirstPartyTypeKind2.ZodEffects,
    effect,
    ...processCreateParams2(params)
  });
};
ZodEffects2.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects2({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind2.ZodEffects,
    ...processCreateParams2(params)
  });
};

class ZodOptional2 extends ZodType2 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType2.undefined) {
      return OK2(undefined);
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
    typeName: ZodFirstPartyTypeKind2.ZodOptional,
    ...processCreateParams2(params)
  });
};

class ZodNullable2 extends ZodType2 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType2.null) {
      return OK2(null);
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
    typeName: ZodFirstPartyTypeKind2.ZodNullable,
    ...processCreateParams2(params)
  });
};

class ZodDefault2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType2.undefined) {
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
    typeName: ZodFirstPartyTypeKind2.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams2(params)
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
    if (isAsync2(result)) {
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
    typeName: ZodFirstPartyTypeKind2.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams2(params)
  });
};

class ZodNaN2 extends ZodType2 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType2.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext2(ctx, {
        code: ZodIssueCode2.invalid_type,
        expected: ZodParsedType2.nan,
        received: ctx.parsedType
      });
      return INVALID2;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN2.create = (params) => {
  return new ZodNaN2({
    typeName: ZodFirstPartyTypeKind2.ZodNaN,
    ...processCreateParams2(params)
  });
};
var BRAND2 = Symbol("zod_brand");

class ZodBranded2 extends ZodType2 {
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

class ZodPipeline2 extends ZodType2 {
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
          return INVALID2;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY2(inResult.value);
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
        return INVALID2;
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
    return new ZodPipeline2({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind2.ZodPipeline
    });
  }
}

class ZodReadonly2 extends ZodType2 {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid2(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync2(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly2.create = (type, params) => {
  return new ZodReadonly2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind2.ZodReadonly,
    ...processCreateParams2(params)
  });
};
function cleanParams2(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom2(check, _params = {}, fatal) {
  if (check)
    return ZodAny2.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams2(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams2(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny2.create();
}
var late2 = {
  object: ZodObject2.lazycreate
};
var ZodFirstPartyTypeKind2;
(function(ZodFirstPartyTypeKind22) {
  ZodFirstPartyTypeKind22["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind22["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind22["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind22["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind22["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind22["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind22["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind22["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind22["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind22["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind22["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind22["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind22["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind22["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind22["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind22["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind22["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind22["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind22["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind22["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind22["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind22["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind22["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind22["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind22["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind22["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind22["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind22["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind22["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind22["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind22["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind22["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind22["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind22["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind22["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind22["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind2 || (ZodFirstPartyTypeKind2 = {}));
var instanceOfType2 = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom2((data) => data instanceof cls, params);
var stringType2 = ZodString2.create;
var numberType2 = ZodNumber2.create;
var nanType2 = ZodNaN2.create;
var bigIntType2 = ZodBigInt2.create;
var booleanType2 = ZodBoolean2.create;
var dateType2 = ZodDate2.create;
var symbolType2 = ZodSymbol2.create;
var undefinedType2 = ZodUndefined2.create;
var nullType2 = ZodNull2.create;
var anyType2 = ZodAny2.create;
var unknownType2 = ZodUnknown2.create;
var neverType2 = ZodNever2.create;
var voidType2 = ZodVoid2.create;
var arrayType2 = ZodArray2.create;
var objectType2 = ZodObject2.create;
var strictObjectType2 = ZodObject2.strictCreate;
var unionType2 = ZodUnion2.create;
var discriminatedUnionType2 = ZodDiscriminatedUnion2.create;
var intersectionType2 = ZodIntersection2.create;
var tupleType2 = ZodTuple2.create;
var recordType2 = ZodRecord2.create;
var mapType2 = ZodMap2.create;
var setType2 = ZodSet2.create;
var functionType2 = ZodFunction2.create;
var lazyType2 = ZodLazy2.create;
var literalType2 = ZodLiteral2.create;
var enumType2 = ZodEnum2.create;
var nativeEnumType2 = ZodNativeEnum2.create;
var promiseType2 = ZodPromise2.create;
var effectsType2 = ZodEffects2.create;
var optionalType2 = ZodOptional2.create;
var nullableType2 = ZodNullable2.create;
var preprocessType2 = ZodEffects2.createWithPreprocess;
var pipelineType2 = ZodPipeline2.create;
var ostring2 = () => stringType2().optional();
var onumber2 = () => numberType2().optional();
var oboolean2 = () => booleanType2().optional();
var coerce2 = {
  string: (arg) => ZodString2.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber2.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean2.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt2.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate2.create({ ...arg, coerce: true })
};
var NEVER2 = INVALID2;
var SCHEMA_IDS2 = {
  actorRef: "hasna.actor_ref.v1",
  resourceRef: "hasna.resource_ref.v1",
  evidenceRef: "hasna.evidence_ref.v1",
  workRun: "hasna.work_run.v1",
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
  noCloudEvidencePack: "hasna.no_cloud_evidence_pack.v1",
  serviceContract: "hasna.service_contract.v1",
  commsEventEnvelope: "hasna.comms_event_envelope.v1",
  commsChannelMetadata: "hasna.comms_channel_metadata.v1",
  commsMessageMetadata: "hasna.comms_message_metadata.v1",
  app: "hasna.app.v1",
  release: "hasna.release.v1",
  rolloutRecord: "hasna.rollout_record.v1",
  announcement: "hasna.announcement.v1",
  audience: "hasna.audience.v1"
};
var SchemaIdSchema2 = exports_external2.string().regex(/^hasna\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.v[0-9]+$/);
var TimestampSchema2 = exports_external2.string().datetime();
var NonEmptyStringSchema2 = exports_external2.string().trim().min(1);
var UriSchema2 = NonEmptyStringSchema2.refine((value) => value.startsWith("artifact://") || value.startsWith("repo://") || value.startsWith("project://") || value.startsWith("dashboard://") || value.startsWith("render://") || value.startsWith("integration://") || value.startsWith("task://") || value.startsWith("todo://") || value.startsWith("file://") || value.startsWith("files://") || value.startsWith("mailery://") || value.startsWith("conversation://") || value.startsWith("knowledge://") || value.startsWith("memento://") || value.startsWith("https://") || value.startsWith("http://") || value.startsWith("git+https://"), "URI must use artifact://, repo://, project://, dashboard://, render://, integration://, task://, todo://, file://, files://, mailery://, conversation://, knowledge://, memento://, http(s)://, or git+https://");
var Sha256DigestSchema2 = exports_external2.string().regex(/^[a-fA-F0-9]{64}$/);
var HashStringSchema2 = exports_external2.string().regex(/^(sha256:)?[a-fA-F0-9]{64}$/);
var MetadataSchema2 = exports_external2.record(exports_external2.unknown());
var TagsSchema2 = exports_external2.array(exports_external2.string().min(1)).default([]);
var OptionalTimestampSchema2 = TimestampSchema2.nullable().optional();
var TerminalStatuses2 = new Set(["succeeded", "failed", "cancelled", "blocked", "skipped"]);
var ContractStatusSchema2 = exports_external2.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
  "unknown"
]);
function contractBaseSchema2(schema) {
  return exports_external2.object({
    schema: exports_external2.literal(schema),
    id: exports_external2.string().min(1),
    createdAt: TimestampSchema2,
    updatedAt: OptionalTimestampSchema2,
    metadata: MetadataSchema2.optional()
  }).strict();
}
var ContractEnvelopeSchema2 = exports_external2.object({
  schema: SchemaIdSchema2,
  id: exports_external2.string().min(1),
  createdAt: TimestampSchema2,
  updatedAt: OptionalTimestampSchema2,
  metadata: MetadataSchema2.optional()
}).strict();
var ActorKindSchema2 = exports_external2.enum([
  "agent",
  "human",
  "service",
  "model",
  "workflow",
  "system"
]);
var ActorRefSchema2 = contractBaseSchema2(SCHEMA_IDS2.actorRef).extend({
  kind: ActorKindSchema2,
  name: exports_external2.string().min(1).optional(),
  provider: exports_external2.string().min(1).optional(),
  accountId: exports_external2.string().min(1).optional(),
  machineId: exports_external2.string().min(1).optional(),
  capabilities: exports_external2.array(exports_external2.string().min(1)).default([])
}).strict();
var ActorPointerSchema2 = exports_external2.object({
  kind: ActorKindSchema2,
  id: exports_external2.string().min(1),
  name: exports_external2.string().min(1).optional(),
  provider: exports_external2.string().min(1).optional(),
  accountId: exports_external2.string().min(1).optional(),
  machineId: exports_external2.string().min(1).optional()
}).strict();
var ResourceKindSchema2 = exports_external2.enum([
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
var ResourceRefSchema2 = contractBaseSchema2(SCHEMA_IDS2.resourceRef).extend({
  kind: ResourceKindSchema2,
  name: exports_external2.string().min(1).optional(),
  uri: UriSchema2.optional(),
  externalId: NonEmptyStringSchema2.optional(),
  sourcePackage: NonEmptyStringSchema2.optional(),
  tags: TagsSchema2
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.externalId && value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Resource refs require uri or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ResourcePointerSchema2 = exports_external2.object({
  kind: ResourceKindSchema2,
  id: exports_external2.string().min(1),
  name: exports_external2.string().min(1).optional(),
  uri: UriSchema2.optional(),
  externalId: NonEmptyStringSchema2.optional(),
  sourcePackage: NonEmptyStringSchema2.optional(),
  tags: TagsSchema2
}).strict().superRefine((value, ctx) => {
  if (!value.uri && Boolean(value.externalId) !== Boolean(value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Resource pointers with external package locators require both sourcePackage and externalId",
      path: value.externalId ? ["sourcePackage"] : ["externalId"]
    });
  }
});
var EvidenceKindSchema2 = exports_external2.enum([
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
var RedactionStateSchema2 = exports_external2.enum(["none", "partial", "full", "unknown"]);
var EvidenceRefSchema2 = contractBaseSchema2(SCHEMA_IDS2.evidenceRef).extend({
  kind: EvidenceKindSchema2,
  uri: UriSchema2,
  sha256: Sha256DigestSchema2.optional(),
  summary: exports_external2.string().min(1).optional(),
  contentType: exports_external2.string().min(1).optional(),
  sizeBytes: exports_external2.number().int().nonnegative().optional(),
  redaction: RedactionStateSchema2.default("unknown"),
  producer: ActorPointerSchema2.optional(),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  tags: TagsSchema2
}).strict();
var EvidencePointerSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  kind: EvidenceKindSchema2.optional(),
  uri: UriSchema2.optional(),
  sha256: Sha256DigestSchema2.optional(),
  summary: exports_external2.string().min(1).optional()
}).strict();
var CostEstimateSchema2 = contractBaseSchema2(SCHEMA_IDS2.costEstimate).extend({
  currency: exports_external2.string().regex(/^[A-Z]{3}$/).default("USD"),
  amountMicros: exports_external2.number().int().nonnegative(),
  provider: exports_external2.string().min(1).optional(),
  model: exports_external2.string().min(1).optional(),
  accountId: exports_external2.string().min(1).optional(),
  promptTokens: exports_external2.number().int().nonnegative().optional(),
  completionTokens: exports_external2.number().int().nonnegative().optional(),
  totalTokens: exports_external2.number().int().nonnegative().optional(),
  basis: exports_external2.enum(["actual", "estimated", "budget", "limit"]).default("estimated"),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.promptTokens !== undefined && value.completionTokens !== undefined && value.totalTokens !== undefined && value.totalTokens !== value.promptTokens + value.completionTokens) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "totalTokens must equal promptTokens plus completionTokens when all are present",
      path: ["totalTokens"]
    });
  }
});
var DecisionStatusSchema2 = exports_external2.enum([
  "allowed",
  "denied",
  "warned",
  "approval_required",
  "selected",
  "skipped",
  "unknown"
]);
var DecisionEnvelopeSchema2 = contractBaseSchema2(SCHEMA_IDS2.decisionEnvelope).extend({
  decisionType: exports_external2.enum([
    "guardrail",
    "model_route",
    "tool_select",
    "budget",
    "secret_access",
    "approval",
    "policy",
    "other"
  ]),
  status: DecisionStatusSchema2,
  actor: ActorPointerSchema2.optional(),
  traceId: exports_external2.string().min(1).optional(),
  inputHash: HashStringSchema2.optional(),
  policyBundleId: exports_external2.string().min(1).optional(),
  selected: exports_external2.array(ResourcePointerSchema2).default([]),
  skipped: exports_external2.array(ResourcePointerSchema2).default([]),
  reason: exports_external2.string().min(1),
  obligations: exports_external2.array(exports_external2.string().min(1)).default([]),
  redactions: exports_external2.array(exports_external2.string().min(1)).default([]),
  costEstimate: CostEstimateSchema2.optional(),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "selected" && value.selected.length === 0) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Selected decisions require at least one selected resource", path: ["selected"] });
  }
  if (value.status === "skipped" && value.skipped.length === 0) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Skipped decisions require at least one skipped resource", path: ["skipped"] });
  }
  if (value.status === "denied") {
    if (value.selected.length > 0) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Denied decisions cannot include selected resources", path: ["selected"] });
    }
    if (!value.policyBundleId && value.evidenceRefs.length === 0 && value.obligations.length === 0) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Denied decisions require policy, evidence, or obligations",
        path: ["policyBundleId"]
      });
    }
  }
  if (value.status === "approval_required" && value.obligations.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Approval-required decisions require actionable obligations",
      path: ["obligations"]
    });
  }
});
var CapabilityCardSchema2 = contractBaseSchema2(SCHEMA_IDS2.capabilityCard).extend({
  kind: exports_external2.enum(["model", "tool", "machine", "agent", "lane", "connector", "service"]),
  name: exports_external2.string().min(1),
  version: exports_external2.string().min(1).optional(),
  status: exports_external2.enum(["available", "unavailable", "degraded", "unknown"]).default("unknown"),
  capabilities: exports_external2.array(exports_external2.string().min(1)).default([]),
  limitations: exports_external2.array(exports_external2.string().min(1)).default([]),
  riskLevel: exports_external2.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  costEstimate: CostEstimateSchema2.optional(),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict();
var ProviderModeSchema2 = exports_external2.enum(["mock", "fixture", "sandbox", "read_only_live", "live_mutating"]);
var ProviderSideEffectClassSchema2 = exports_external2.enum([
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
var CredentialRequirementSchema2 = exports_external2.object({
  refName: NonEmptyStringSchema2,
  requiredForModes: exports_external2.array(ProviderModeSchema2).min(1),
  allowedSecretInputs: exports_external2.array(exports_external2.enum(["credential_ref", "lease_ref"])).min(1).default(["credential_ref"]),
  failClosedDiagnostic: NonEmptyStringSchema2,
  revocationCheck: exports_external2.boolean().default(true)
}).strict();
var ProviderOperationCardSchema2 = exports_external2.object({
  operation: NonEmptyStringSchema2,
  supportedModes: exports_external2.array(ProviderModeSchema2).min(1),
  sideEffectClass: ProviderSideEffectClassSchema2,
  requiresApproval: exports_external2.boolean().default(false),
  requiresIdempotencyKey: exports_external2.boolean().default(false),
  requiresSandboxEvidence: exports_external2.boolean().default(false),
  requiresRollbackOrRevocation: exports_external2.boolean().default(false),
  rollbackOrRevocation: NonEmptyStringSchema2.optional(),
  noSideEffectSmoke: NonEmptyStringSchema2.optional(),
  reconciliation: NonEmptyStringSchema2.optional()
}).strict().superRefine((value, ctx) => {
  if (value.supportedModes.includes("live_mutating")) {
    if (value.sideEffectClass === "none" || value.sideEffectClass === "read_only") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating operations must declare a side-effecting class",
        path: ["sideEffectClass"]
      });
    }
    if (!value.requiresApproval) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating operations require approval",
        path: ["requiresApproval"]
      });
    }
    if (!value.requiresIdempotencyKey) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating operations require idempotency keys",
        path: ["requiresIdempotencyKey"]
      });
    }
    if (!value.requiresSandboxEvidence) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating operations require sandbox evidence before live proof",
        path: ["requiresSandboxEvidence"]
      });
    }
    if (!value.requiresRollbackOrRevocation || !value.rollbackOrRevocation) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating operations require rollback or revocation instructions",
        path: ["rollbackOrRevocation"]
      });
    }
    if (!value.reconciliation) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating operations require reconciliation behavior",
        path: ["reconciliation"]
      });
    }
  }
});
var ProviderCapabilityCardSchema2 = exports_external2.object({
  providerId: NonEmptyStringSchema2,
  appId: NonEmptyStringSchema2,
  adapterId: NonEmptyStringSchema2,
  ownerPackage: NonEmptyStringSchema2,
  modes: exports_external2.array(ProviderModeSchema2).min(1),
  defaultMode: ProviderModeSchema2,
  credentialRequirements: exports_external2.array(CredentialRequirementSchema2).default([]),
  operations: exports_external2.array(ProviderOperationCardSchema2).min(1),
  rateLimitPosture: NonEmptyStringSchema2,
  costPosture: NonEmptyStringSchema2.optional(),
  auditEvents: exports_external2.array(NonEmptyStringSchema2).default([]),
  redactionRules: exports_external2.array(NonEmptyStringSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (!value.modes.includes(value.defaultMode)) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "defaultMode must be one of modes",
      path: ["defaultMode"]
    });
  }
  const operationModes = new Set(value.operations.flatMap((operation) => operation.supportedModes));
  for (const mode of operationModes) {
    if (!value.modes.includes(mode)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `operation mode ${mode} is not declared in provider modes`,
        path: ["operations"]
      });
    }
  }
  if (operationModes.has("live_mutating")) {
    const liveCredential = value.credentialRequirements.some((credential) => credential.requiredForModes.includes("live_mutating"));
    if (!liveCredential) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating providers require at least one live credential reference requirement",
        path: ["credentialRequirements"]
      });
    }
    if (value.auditEvents.length === 0) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "live_mutating providers require audit events",
        path: ["auditEvents"]
      });
    }
  }
});
var ProviderLiveModeTargetSchema2 = exports_external2.object({
  appId: NonEmptyStringSchema2,
  repo: NonEmptyStringSchema2,
  priority: exports_external2.enum(["p0", "p1", "p2"]).default("p1"),
  requiredEvidence: exports_external2.array(NonEmptyStringSchema2).min(1),
  firstOperations: exports_external2.array(NonEmptyStringSchema2).min(1),
  blockedUntil: exports_external2.array(NonEmptyStringSchema2).default([])
}).strict();
var ProviderLiveModeStandardSchema2 = contractBaseSchema2(SCHEMA_IDS2.providerLiveModeStandard).extend({
  name: NonEmptyStringSchema2,
  version: NonEmptyStringSchema2,
  modes: exports_external2.array(ProviderModeSchema2).refine((modes) => ["mock", "fixture", "sandbox", "read_only_live", "live_mutating"].every((mode) => modes.includes(mode)), "provider live-mode standard must include every canonical provider mode"),
  requiredCapabilityFields: exports_external2.array(NonEmptyStringSchema2).min(1),
  liveMutationGate: exports_external2.object({
    requiredMode: exports_external2.literal("live_mutating"),
    requiredChecks: exports_external2.array(NonEmptyStringSchema2).min(1),
    forbiddenBypassSignals: exports_external2.array(NonEmptyStringSchema2).min(1),
    disabledLiveSmoke: NonEmptyStringSchema2
  }).strict(),
  noSideEffectSmoke: exports_external2.object({
    requiredForModes: exports_external2.array(ProviderModeSchema2).min(1),
    commandEvidence: exports_external2.array(NonEmptyStringSchema2).min(1),
    secretOutputScan: exports_external2.boolean().default(true)
  }).strict(),
  credentialPolicy: exports_external2.object({
    acceptedInputs: exports_external2.array(exports_external2.enum(["credential_ref", "lease_ref"])).min(1),
    rawSecretInputsAllowed: exports_external2.literal(false),
    missingCredentialBehavior: exports_external2.literal("fail_closed"),
    revocationCheckRequired: exports_external2.boolean().default(true)
  }).strict(),
  operationCards: exports_external2.array(ProviderCapabilityCardSchema2).min(1),
  firstAdoptionTargets: exports_external2.array(ProviderLiveModeTargetSchema2).min(1),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  const firstTargetApps = new Set(value.firstAdoptionTargets.map((target) => target.appId));
  const operationApps = new Set(value.operationCards.map((card) => card.appId));
  for (const appId of firstTargetApps) {
    if (!operationApps.has(appId)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `first adoption target ${appId} requires a provider capability card`,
        path: ["firstAdoptionTargets"]
      });
    }
  }
});
var ContextPackItemSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  title: exports_external2.string().min(1).optional(),
  summary: exports_external2.string().min(1),
  text: exports_external2.string().optional(),
  tokens: exports_external2.number().int().nonnegative().optional(),
  source: EvidencePointerSchema2,
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([])
}).strict();
var ContextPackSchema2 = contractBaseSchema2(SCHEMA_IDS2.contextPack).extend({
  objective: exports_external2.string().min(1),
  budget: exports_external2.object({
    maxTokens: exports_external2.number().int().positive().optional(),
    maxBytes: exports_external2.number().int().positive().optional()
  }).strict().optional(),
  items: exports_external2.array(ContextPackItemSchema2).default([]),
  citations: exports_external2.array(EvidencePointerSchema2).default([]),
  freshness: exports_external2.enum(["fresh", "stale", "unknown"]).default("unknown"),
  permissions: exports_external2.array(exports_external2.string().min(1)).default([]),
  redactions: exports_external2.array(exports_external2.string().min(1)).default([]),
  conflicts: exports_external2.array(exports_external2.string().min(1)).default([]),
  uncertainty: exports_external2.string().min(1).optional()
}).strict();
var RelativeProjectPathSchema2 = NonEmptyStringSchema2.refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "Project paths must be relative and cannot contain parent-directory segments");
var ProjectSlugSchema2 = exports_external2.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Project slugs must be lowercase dashed identifiers");
var ProjectClassificationSchema2 = exports_external2.enum(["public", "internal", "private", "sensitive"]);
var ProjectStatusSchema2 = exports_external2.enum(["draft", "active", "paused", "archived"]);
var ProjectIntegrationKindSchema2 = exports_external2.enum([
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
var IntegrationRefSchema2 = contractBaseSchema2(SCHEMA_IDS2.integrationRef).extend({
  kind: ProjectIntegrationKindSchema2,
  name: exports_external2.string().min(1),
  projectId: ProjectSlugSchema2.optional(),
  sourcePackage: NonEmptyStringSchema2.optional(),
  externalId: NonEmptyStringSchema2.optional(),
  uri: UriSchema2.optional(),
  enabled: exports_external2.boolean().default(true),
  readOnly: exports_external2.boolean().default(true),
  capabilities: exports_external2.array(exports_external2.string().min(1)).default([]),
  freshness: exports_external2.enum(["fresh", "stale", "unknown"]).default("unknown"),
  resourceRef: ResourcePointerSchema2.optional(),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  config: MetadataSchema2.optional()
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.sourcePackage && value.externalId) && !value.resourceRef) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Integration refs require uri, resourceRef, or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ProjectLayoutSchema2 = exports_external2.object({
  schemaRoot: RelativeProjectPathSchema2.default(".hasna/project"),
  dashboardManifest: RelativeProjectPathSchema2.default(".hasna/project/dashboard.render.json"),
  snapshotsDir: RelativeProjectPathSchema2.default(".hasna/project/snapshots"),
  documentsDir: RelativeProjectPathSchema2.default("documents"),
  reportsDir: RelativeProjectPathSchema2.default("reports"),
  evidenceDir: RelativeProjectPathSchema2.default(".hasna/project/evidence"),
  privateDir: RelativeProjectPathSchema2.default(".hasna/project/private")
}).strict();
var ProjectManifestSchema2 = contractBaseSchema2(SCHEMA_IDS2.projectManifest).extend({
  projectId: ProjectSlugSchema2,
  slug: ProjectSlugSchema2,
  name: exports_external2.string().min(1),
  summary: exports_external2.string().min(1).optional(),
  status: ProjectStatusSchema2.default("active"),
  classification: ProjectClassificationSchema2.default("private"),
  owner: ActorPointerSchema2.optional(),
  layout: ProjectLayoutSchema2.default({}),
  integrations: exports_external2.array(IntegrationRefSchema2).default([]),
  renderManifests: exports_external2.array(ResourcePointerSchema2).default([]),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  tags: TagsSchema2
}).strict().superRefine((value, ctx) => {
  const integrationIds = new Set;
  const renderManifestIds = new Set;
  if (value.projectId !== value.slug) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "projectId and slug must match for canonical project manifests",
      path: ["slug"]
    });
  }
  for (const [index, integration] of value.integrations.entries()) {
    if (integrationIds.has(integration.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project manifest integration ids must be unique",
        path: ["integrations", index, "id"]
      });
    }
    integrationIds.add(integration.id);
    if (integration.projectId && integration.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Integration projectId must match the manifest projectId",
        path: ["integrations", index, "projectId"]
      });
    }
  }
  for (const [index, renderManifest] of value.renderManifests.entries()) {
    if (renderManifest.kind !== "render") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project renderManifests must use resource kind render",
        path: ["renderManifests", index, "kind"]
      });
    }
    if (renderManifestIds.has(renderManifest.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project renderManifest refs must be unique",
        path: ["renderManifests", index, "id"]
      });
    }
    renderManifestIds.add(renderManifest.id);
  }
});
var RenderImportKindSchema2 = exports_external2.enum(["local", "package", "provider", "url"]);
var RenderImportSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  kind: RenderImportKindSchema2,
  specifier: exports_external2.string().min(1),
  path: RelativeProjectPathSchema2.optional(),
  packageName: exports_external2.string().min(1).optional(),
  uri: UriSchema2.optional(),
  provider: ProjectIntegrationKindSchema2.optional(),
  schemaId: SchemaIdSchema2.optional(),
  integrity: HashStringSchema2.optional(),
  resourceRef: ResourcePointerSchema2.optional(),
  optional: exports_external2.boolean().default(false)
}).strict().superRefine((value, ctx) => {
  if (value.kind === "local" && !value.path) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Local render imports require path", path: ["path"] });
  }
  if (value.kind === "package" && !value.packageName) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Package render imports require packageName", path: ["packageName"] });
  }
  if (value.kind === "provider" && !value.provider) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Provider render imports require provider", path: ["provider"] });
  }
  if (value.kind === "url" && !value.uri) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "URL render imports require uri", path: ["uri"] });
  }
});
var RenderViewKindSchema2 = exports_external2.enum(["dashboard", "canvas", "panel", "report", "document", "custom"]);
var RenderViewSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  title: exports_external2.string().min(1),
  kind: RenderViewKindSchema2,
  default: exports_external2.boolean().default(false),
  entry: RelativeProjectPathSchema2.optional(),
  imports: exports_external2.array(RenderImportSchema2).default([]),
  panelRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  dataRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  layout: MetadataSchema2.optional()
}).strict();
var RenderManifestSchema2 = contractBaseSchema2(SCHEMA_IDS2.renderManifest).extend({
  projectId: ProjectSlugSchema2,
  name: exports_external2.string().min(1),
  version: exports_external2.string().min(1),
  manifestPath: RelativeProjectPathSchema2.default(".hasna/project/dashboard.render.json"),
  renderer: exports_external2.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  views: exports_external2.array(RenderViewSchema2).min(1),
  imports: exports_external2.array(RenderImportSchema2).default([]),
  theme: MetadataSchema2.optional(),
  compatibility: exports_external2.object({
    minProjectsVersion: exports_external2.string().min(1).optional(),
    minContractsVersion: exports_external2.string().min(1).optional()
  }).strict().optional(),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  const defaults = value.views.filter((view) => view.default);
  const viewIds = new Set;
  const importIds = new Set;
  if (defaults.length > 1) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Render manifests can have at most one default view", path: ["views"] });
  }
  for (const [index, importRef] of value.imports.entries()) {
    if (importIds.has(importRef.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Render manifest import ids must be unique",
        path: ["imports", index, "id"]
      });
    }
    importIds.add(importRef.id);
  }
  for (const [viewIndex, view] of value.views.entries()) {
    if (viewIds.has(view.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Render manifest view ids must be unique",
        path: ["views", viewIndex, "id"]
      });
    }
    viewIds.add(view.id);
    const viewImportIds = new Set;
    for (const [importIndex, importRef] of view.imports.entries()) {
      if (viewImportIds.has(importRef.id)) {
        ctx.addIssue({
          code: exports_external2.ZodIssueCode.custom,
          message: "Render view import ids must be unique",
          path: ["views", viewIndex, "imports", importIndex, "id"]
        });
      }
      viewImportIds.add(importRef.id);
    }
    for (const [panelIndex, panelRef] of view.panelRefs.entries()) {
      if (panelRef.kind !== "panel") {
        ctx.addIssue({
          code: exports_external2.ZodIssueCode.custom,
          message: "Render view panelRefs must use resource kind panel",
          path: ["views", viewIndex, "panelRefs", panelIndex, "kind"]
        });
      }
    }
  }
});
var ProjectPanelStateSchema2 = exports_external2.enum(["ready", "empty", "loading", "error", "auth_required", "unavailable", "stale"]);
var ProjectPanelKindSchema2 = exports_external2.enum([
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
var ProjectPanelMetricSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  label: exports_external2.string().min(1),
  value: exports_external2.union([exports_external2.string(), exports_external2.number(), exports_external2.boolean()]),
  unit: exports_external2.string().min(1).optional(),
  status: exports_external2.enum(["good", "warning", "critical", "unknown"]).default("unknown"),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([])
}).strict();
var ProjectPanelItemSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  title: exports_external2.string().min(1),
  summary: exports_external2.string().min(1).optional(),
  status: exports_external2.string().min(1).optional(),
  priority: exports_external2.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  timestamp: TimestampSchema2.optional(),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  metadata: MetadataSchema2.optional()
}).strict();
var ProjectRenderFragmentSchema2 = exports_external2.object({
  renderer: exports_external2.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  title: exports_external2.string().min(1).optional(),
  entry: RelativeProjectPathSchema2.optional(),
  imports: exports_external2.array(RenderImportSchema2).default([]),
  spec: MetadataSchema2.default({})
}).strict();
var ProjectPanelSchema2 = contractBaseSchema2(SCHEMA_IDS2.projectPanel).extend({
  projectId: ProjectSlugSchema2,
  provider: exports_external2.object({
    kind: ProjectIntegrationKindSchema2,
    id: exports_external2.string().min(1),
    name: exports_external2.string().min(1).optional(),
    sourcePackage: NonEmptyStringSchema2.optional(),
    externalId: NonEmptyStringSchema2.optional()
  }).strict(),
  kind: ProjectPanelKindSchema2,
  title: exports_external2.string().min(1),
  summary: exports_external2.string().min(1).optional(),
  state: ProjectPanelStateSchema2.default("ready"),
  stateReason: exports_external2.string().min(1).optional(),
  generatedAt: TimestampSchema2,
  freshness: exports_external2.enum(["fresh", "stale", "unknown"]).default("unknown"),
  metrics: exports_external2.array(ProjectPanelMetricSchema2).default([]),
  items: exports_external2.array(ProjectPanelItemSchema2).default([]),
  actions: exports_external2.array(ResourcePointerSchema2).default([]),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  renderFragment: ProjectRenderFragmentSchema2.optional(),
  warnings: exports_external2.array(exports_external2.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  const reasonStates = new Set(["error", "auth_required", "unavailable", "stale"]);
  const metricIds = new Set;
  const itemIds = new Set;
  if (reasonStates.has(value.state) && !value.stateReason) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Non-ready provider states require stateReason",
      path: ["stateReason"]
    });
  }
  if (value.state === "ready" && value.metrics.length === 0 && value.items.length === 0 && !value.renderFragment) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Ready panels require metrics, items, or a renderFragment; use state=empty for empty panels",
      path: ["state"]
    });
  }
  for (const [index, metric] of value.metrics.entries()) {
    if (metricIds.has(metric.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project panel metric ids must be unique",
        path: ["metrics", index, "id"]
      });
    }
    metricIds.add(metric.id);
  }
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project panel item ids must be unique",
        path: ["items", index, "id"]
      });
    }
    itemIds.add(item.id);
  }
  for (const [index, action] of value.actions.entries()) {
    if (action.kind !== "action") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project panel actions must use resource kind action",
        path: ["actions", index, "kind"]
      });
    }
  }
});
var ProjectSnapshotSchema2 = contractBaseSchema2(SCHEMA_IDS2.projectSnapshot).extend({
  projectId: ProjectSlugSchema2,
  generatedAt: TimestampSchema2,
  status: ContractStatusSchema2.default("unknown"),
  manifestRef: ResourcePointerSchema2,
  renderManifestRef: ResourcePointerSchema2.optional(),
  panels: exports_external2.array(ProjectPanelSchema2).default([]),
  contextPacks: exports_external2.array(ContextPackSchema2).default([]),
  proofBundleRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  warnings: exports_external2.array(exports_external2.string().min(1)).default([]),
  freshness: exports_external2.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  const panelIds = new Set;
  const contextPackIds = new Set;
  if (value.manifestRef.kind !== "project") {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Project snapshot manifestRef must use resource kind project",
      path: ["manifestRef", "kind"]
    });
  }
  if (value.renderManifestRef && value.renderManifestRef.kind !== "render") {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Project snapshot renderManifestRef must use resource kind render",
      path: ["renderManifestRef", "kind"]
    });
  }
  for (const [index, proofBundleRef] of value.proofBundleRefs.entries()) {
    if (proofBundleRef.kind !== "proof_bundle") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project snapshot proofBundleRefs must use resource kind proof_bundle",
        path: ["proofBundleRefs", index, "kind"]
      });
    }
  }
  for (const [index, panel] of value.panels.entries()) {
    if (panel.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Panel projectId must match snapshot projectId",
        path: ["panels", index, "projectId"]
      });
    }
    if (panelIds.has(panel.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project snapshot panel ids must be unique",
        path: ["panels", index, "id"]
      });
    }
    panelIds.add(panel.id);
  }
  for (const [index, contextPack] of value.contextPacks.entries()) {
    if (contextPackIds.has(contextPack.id)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Project snapshot context pack ids must be unique",
        path: ["contextPacks", index, "id"]
      });
    }
    contextPackIds.add(contextPack.id);
  }
});
var ValidationCheckSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  kind: exports_external2.enum(["command", "test", "typecheck", "lint", "eval", "security", "review", "deploy", "smoke", "manual", "other"]),
  required: exports_external2.boolean().default(true),
  command: exports_external2.string().min(1).optional(),
  expected: exports_external2.string().min(1).optional(),
  timeoutMs: exports_external2.number().int().positive().optional(),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  const actionableKinds = new Set(["command", "test", "typecheck", "lint", "smoke", "eval"]);
  if (actionableKinds.has(value.kind) && !value.command && !value.expected) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Actionable validation checks require command or expected",
      path: ["command"]
    });
  }
});
var ValidationPlanSchema2 = contractBaseSchema2(SCHEMA_IDS2.validationPlan).extend({
  objective: exports_external2.string().min(1),
  subject: ResourcePointerSchema2.optional(),
  checks: exports_external2.array(ValidationCheckSchema2).min(1),
  verifier: ActorPointerSchema2.optional(),
  requiredEvidenceKinds: exports_external2.array(EvidenceKindSchema2).default([])
}).strict();
var ScaffoldTypeSchema2 = exports_external2.enum([
  "open_source",
  "internal_app",
  "platform",
  "app",
  "agent",
  "content",
  "overlay",
  "other"
]);
var ScaffoldStatusSchema2 = exports_external2.enum(["draft", "active", "deprecated", "archived"]);
var ScaffoldCapabilitySchema2 = exports_external2.enum([
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
var ScaffoldEnvVarSchema2 = exports_external2.object({
  key: exports_external2.string().regex(/^[A-Z][A-Z0-9_]*$/),
  description: exports_external2.string().min(1),
  required: exports_external2.boolean().default(false),
  ["secret"]: exports_external2.boolean().default(false),
  group: exports_external2.string().min(1).optional(),
  default: exports_external2.string().optional()
}).strict().superRefine((value, ctx) => {
  if (value.secret && value.default !== undefined) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Secret scaffold env vars cannot include defaults",
      path: ["default"]
    });
  }
});
var ScaffoldScriptSchema2 = exports_external2.object({
  name: exports_external2.string().min(1),
  command: exports_external2.string().min(1),
  description: exports_external2.string().min(1).optional(),
  required: exports_external2.boolean().default(false)
}).strict();
var ScaffoldOutputShapeSchema2 = exports_external2.object({
  packageManager: exports_external2.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  languages: exports_external2.array(exports_external2.string().min(1)).default([]),
  requiredFiles: exports_external2.array(exports_external2.string().min(1)).default([]),
  requiredDirectories: exports_external2.array(exports_external2.string().min(1)).default([]),
  optionalDirectories: exports_external2.array(exports_external2.string().min(1)).default([])
}).strict();
var ScaffoldManifestSchema2 = contractBaseSchema2(SCHEMA_IDS2.scaffoldManifest).extend({
  name: exports_external2.string().min(1),
  version: exports_external2.string().min(1),
  summary: exports_external2.string().min(1),
  type: ScaffoldTypeSchema2,
  status: ScaffoldStatusSchema2.default("draft"),
  capabilities: exports_external2.array(ScaffoldCapabilitySchema2).default([]),
  techStack: exports_external2.array(exports_external2.string().min(1)).default([]),
  tags: TagsSchema2,
  source: ResourcePointerSchema2.optional(),
  output: ScaffoldOutputShapeSchema2,
  env: exports_external2.array(ScaffoldEnvVarSchema2).default([]),
  scripts: exports_external2.array(ScaffoldScriptSchema2).default([]),
  validationChecks: exports_external2.array(ValidationCheckSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.source?.uri?.startsWith("file://")) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Public scaffold manifest source refs cannot use local file:// URIs",
      path: ["source", "uri"]
    });
  }
  if (value.status === "active" && value.validationChecks.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Active scaffold manifests require validation checks",
      path: ["validationChecks"]
    });
  }
  if (value.status === "active" && value.output.requiredFiles.length === 0 && value.output.requiredDirectories.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Active scaffold manifests require at least one required file or directory",
      path: ["output"]
    });
  }
});
var ScaffoldInstallStatusSchema2 = exports_external2.enum(["installed", "failed", "cancelled", "partial", "unknown"]);
var ScaffoldInstallRecordSchema2 = contractBaseSchema2(SCHEMA_IDS2.scaffoldInstallRecord).extend({
  scaffoldId: exports_external2.string().min(1),
  scaffoldVersion: exports_external2.string().min(1).optional(),
  manifestRef: ResourcePointerSchema2.optional(),
  target: ResourcePointerSchema2,
  status: ScaffoldInstallStatusSchema2,
  installedAt: TimestampSchema2.optional(),
  installer: ActorPointerSchema2.optional(),
  packageManager: exports_external2.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  options: MetadataSchema2.optional(),
  generatedFiles: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  proofBundleRefs: exports_external2.array(ResourcePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "installed" && !value.installedAt) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Installed scaffold records require installedAt",
      path: ["installedAt"]
    });
  }
  if (value.status === "installed" && value.generatedFiles.length === 0 && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Installed scaffold records require generated files, evidence, or proof bundle refs",
      path: ["generatedFiles"]
    });
  }
  if ((value.status === "failed" || value.status === "partial") && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Failed or partial scaffold records require evidence or proof bundle refs",
      path: ["evidenceRefs"]
    });
  }
});
var AppIdSchema2 = exports_external2.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "App ids must be lowercase dashed identifiers");
var NpmPackageNameSchema2 = exports_external2.string().regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, "Must be a valid npm package name");
var SemverSchema2 = exports_external2.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, "Must be a semver version");
var GitShaSchema2 = exports_external2.string().regex(/^[0-9a-f]{7,40}$/, "Must be a lowercase git sha (7-40 hex chars)");
var GithubUrlSchema2 = NonEmptyStringSchema2.refine((value) => value.startsWith("https://github.com/") || value.startsWith("git+https://github.com/"), "GitHub URLs must start with https://github.com/ or git+https://github.com/");
var AppLifecycleSchema2 = exports_external2.enum(["active", "stub", "deprecated", "archived"]);
var ReleaseChannelSchema2 = exports_external2.enum(["stable", "beta", "canary", "internal"]);
var AppMcpSurfaceSchema2 = exports_external2.object({
  transport: exports_external2.enum(["http", "stdio"]).default("http"),
  bin: exports_external2.string().min(1).optional(),
  url: UriSchema2.optional()
}).strict();
var AppHttpSurfaceSchema2 = exports_external2.object({
  healthPath: exports_external2.string().min(1).default("/health"),
  port: exports_external2.number().int().positive().optional(),
  baseUrl: UriSchema2.optional()
}).strict();
var AppSurfacesSchema2 = exports_external2.object({
  bins: exports_external2.array(exports_external2.string().min(1)).default([]),
  mcp: AppMcpSurfaceSchema2.optional(),
  http: AppHttpSurfaceSchema2.optional()
}).strict();
var AppSchema2 = contractBaseSchema2(SCHEMA_IDS2.app).extend({
  appId: AppIdSchema2,
  npmName: NpmPackageNameSchema2,
  repoFolder: AppIdSchema2,
  githubUrl: GithubUrlSchema2,
  projectSlug: ProjectSlugSchema2,
  surfaces: AppSurfacesSchema2.default({}),
  lifecycle: AppLifecycleSchema2,
  releaseChannel: ReleaseChannelSchema2.default("stable"),
  summary: exports_external2.string().min(1).optional(),
  tags: TagsSchema2
}).strict().superRefine((value, ctx) => {
  const seenBins = new Set;
  for (const [index, bin] of value.surfaces.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "App surface bins must be unique",
        path: ["surfaces", "bins", index]
      });
    }
    seenBins.add(bin);
  }
});
var PublishPathSchema2 = exports_external2.enum(["skill", "ci", "backfilled"]);
var ReleaseSchema2 = contractBaseSchema2(SCHEMA_IDS2.release).extend({
  appId: AppIdSchema2,
  package: NpmPackageNameSchema2,
  version: SemverSchema2,
  gitSha: GitShaSchema2,
  publishedAt: TimestampSchema2,
  publishPath: PublishPathSchema2,
  changelogRef: ResourcePointerSchema2.optional(),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.publishPath !== "backfilled" && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "skill and ci releases require publish evidence; only backfilled releases may omit it",
      path: ["evidenceRefs"]
    });
  }
});
var RolloutActionSchema2 = exports_external2.enum(["install", "update", "rollback", "freeze-blocked"]);
var RolloutVerificationSchema2 = exports_external2.object({
  cliVersion: exports_external2.string().min(1).optional(),
  mcpHealth: exports_external2.enum(["ok", "degraded", "unavailable", "not_checked"]).optional()
}).strict().superRefine((value, ctx) => {
  if (!value.cliVersion && value.mcpHealth === undefined) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Rollout verification requires at least one concrete verifier field"
    });
  }
});
var RolloutRecordSchema2 = contractBaseSchema2(SCHEMA_IDS2.rolloutRecord).extend({
  appId: AppIdSchema2,
  package: NpmPackageNameSchema2,
  version: SemverSchema2,
  machine: NonEmptyStringSchema2,
  action: RolloutActionSchema2,
  result: ContractStatusSchema2,
  verifiedBy: RolloutVerificationSchema2.optional(),
  at: TimestampSchema2,
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.action === "freeze-blocked" && value.result !== "blocked" && value.result !== "skipped") {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "freeze-blocked rollout records must report result blocked or skipped",
      path: ["result"]
    });
  }
  const hasConcreteVerification = Boolean(value.verifiedBy?.cliVersion) || value.verifiedBy?.mcpHealth !== undefined && value.verifiedBy.mcpHealth !== "not_checked";
  const hasVerifierFields = value.verifiedBy ? Object.keys(value.verifiedBy).length > 0 : false;
  if ((value.action === "install" || value.action === "update") && value.result === "succeeded" && (!value.verifiedBy || hasVerifierFields && !hasConcreteVerification)) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Succeeded install/update rollout records require concrete verification",
      path: ["verifiedBy"]
    });
  }
});
var AnnouncementChannelKindSchema2 = exports_external2.enum([
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
var AnnouncementDeliveryStatusSchema2 = exports_external2.enum([
  "pending",
  "queued",
  "sent",
  "failed",
  "skipped",
  "suppressed"
]);
var AnnouncementChannelSchema2 = exports_external2.object({
  channel: AnnouncementChannelKindSchema2,
  status: AnnouncementDeliveryStatusSchema2,
  deliveredAt: TimestampSchema2.optional(),
  detail: exports_external2.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if (value.status === "sent" && !value.deliveredAt) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Sent announcement channels require deliveredAt",
      path: ["deliveredAt"]
    });
  }
  if (value.status === "failed" && !value.detail) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Failed announcement channels require detail",
      path: ["detail"]
    });
  }
});
var AnnouncementSchema2 = contractBaseSchema2(SCHEMA_IDS2.announcement).extend({
  campaignId: NonEmptyStringSchema2,
  appId: AppIdSchema2.optional(),
  releaseRef: ResourcePointerSchema2.optional(),
  channels: exports_external2.array(AnnouncementChannelSchema2).min(1),
  audienceRef: ResourcePointerSchema2,
  sentAt: TimestampSchema2
}).strict().superRefine((value, ctx) => {
  if (value.releaseRef && value.releaseRef.kind !== "release") {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Announcement releaseRef must use resource kind release",
      path: ["releaseRef", "kind"]
    });
  }
  if (value.audienceRef.kind !== "audience") {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Announcement audienceRef must use resource kind audience",
      path: ["audienceRef", "kind"]
    });
  }
});
var AudiencePredicateKindSchema2 = exports_external2.enum(["tag", "attribute", "group"]);
var AudiencePredicateOpSchema2 = exports_external2.enum(["eq", "neq", "in", "not_in", "exists", "not_exists"]);
var AudiencePredicateValueSchema2 = exports_external2.union([exports_external2.string(), exports_external2.number(), exports_external2.boolean()]);
var AudiencePredicateSchema2 = exports_external2.object({
  kind: AudiencePredicateKindSchema2,
  key: exports_external2.string().min(1).optional(),
  op: AudiencePredicateOpSchema2.default("eq"),
  value: AudiencePredicateValueSchema2.optional(),
  values: exports_external2.array(AudiencePredicateValueSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.kind === "attribute" && !value.key) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Attribute predicates require key",
      path: ["key"]
    });
  }
  if ((value.op === "eq" || value.op === "neq") && value.value === undefined) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "eq/neq predicates require value",
      path: ["value"]
    });
  }
  if ((value.op === "in" || value.op === "not_in") && value.values.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "in/not_in predicates require values",
      path: ["values"]
    });
  }
});
var AudienceDefinitionSchema2 = exports_external2.object({
  match: exports_external2.enum(["all", "any"]).default("all"),
  predicates: exports_external2.array(AudiencePredicateSchema2).min(1)
}).strict();
var ConsentPolicySchema2 = exports_external2.enum(["opt_in", "opt_out", "transactional", "none"]);
var AudienceSchema2 = contractBaseSchema2(SCHEMA_IDS2.audience).extend({
  audienceId: AppIdSchema2,
  name: NonEmptyStringSchema2,
  definition: AudienceDefinitionSchema2,
  consentPolicy: ConsentPolicySchema2,
  suppressionSyncedAt: OptionalTimestampSchema2
}).strict();
var FORBIDDEN_SHARED_CLOUD_RUNTIMES2 = ["@hasna/cloud", "open-cloud"];
var AppCloudProviderSchema2 = exports_external2.enum([
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
var AppCloudResourceSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  provider: AppCloudProviderSchema2,
  kind: exports_external2.enum([
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
  ownerPackage: exports_external2.string().min(1),
  region: exports_external2.string().min(1).optional(),
  accountId: exports_external2.string().min(1).optional(),
  uri: UriSchema2.optional(),
  machineScoped: exports_external2.boolean().default(false)
}).strict();
var AppCloudManifestSchema2 = contractBaseSchema2(SCHEMA_IDS2.appCloudManifest).extend({
  packageName: exports_external2.string().min(1),
  packageVersion: exports_external2.string().min(1).optional(),
  appId: exports_external2.string().min(1),
  repository: ResourcePointerSchema2.optional(),
  storageMode: exports_external2.enum(["local_only", "app_owned_cloud", "hybrid_local_cache", "external_service"]),
  cloudBoundary: exports_external2.enum(["none", "app_owned", "external_service", "local_cache"]),
  cloudResources: exports_external2.array(AppCloudResourceSchema2).default([]),
  localCache: exports_external2.object({
    path: exports_external2.string().min(1).optional(),
    pullMode: exports_external2.enum(["manual", "daemon", "ci", "none"]).default("manual"),
    conflictPolicy: exports_external2.enum(["cloud_wins", "local_wins", "merge", "manual_review"]).default("manual_review")
  }).strict().optional(),
  forbiddenSharedRuntimes: exports_external2.array(exports_external2.string().min(1)).default([...FORBIDDEN_SHARED_CLOUD_RUNTIMES2]),
  dependencies: exports_external2.array(exports_external2.string().min(1)).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  const effectiveForbiddenRuntimes = new Set([...FORBIDDEN_SHARED_CLOUD_RUNTIMES2, ...value.forbiddenSharedRuntimes]);
  if (effectiveForbiddenRuntimes.has(value.packageName)) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "App-owned cloud manifests cannot be for a forbidden runtime",
      path: ["packageName"]
    });
  }
  for (const runtime of FORBIDDEN_SHARED_CLOUD_RUNTIMES2) {
    if (!value.forbiddenSharedRuntimes.includes(runtime)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `forbiddenSharedRuntimes must include ${runtime}`,
        path: ["forbiddenSharedRuntimes"]
      });
    }
  }
  for (const runtime of effectiveForbiddenRuntimes) {
    if (value.dependencies.includes(runtime)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `App-owned cloud manifests cannot depend on ${runtime}`,
        path: ["dependencies"]
      });
    }
  }
  if (value.storageMode === "local_only" && value.cloudBoundary !== "none") {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "local_only storage requires cloudBoundary none",
      path: ["cloudBoundary"]
    });
  }
  if (value.storageMode === "app_owned_cloud" && value.cloudBoundary !== "app_owned") {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "app_owned_cloud storage requires cloudBoundary app_owned",
      path: ["cloudBoundary"]
    });
  }
  if (value.storageMode === "hybrid_local_cache") {
    if (value.cloudBoundary !== "local_cache") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "hybrid_local_cache storage requires cloudBoundary local_cache",
        path: ["cloudBoundary"]
      });
    }
    if (!value.localCache) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "hybrid_local_cache storage requires localCache settings",
        path: ["localCache"]
      });
    }
  }
  if (value.storageMode === "external_service") {
    if (value.cloudBoundary !== "external_service") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "external_service storage requires cloudBoundary external_service",
        path: ["cloudBoundary"]
      });
    }
    if (value.cloudResources.length > 0) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "external_service storage must not declare app-owned cloudResources",
        path: ["cloudResources"]
      });
    }
  }
  if ((value.storageMode === "app_owned_cloud" || value.storageMode === "hybrid_local_cache") && value.cloudResources.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Cloud-backed storage modes require explicit app-owned cloudResources",
      path: ["cloudResources"]
    });
  }
  if (value.cloudBoundary === "none" && value.cloudResources.length > 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "cloudBoundary none cannot declare cloudResources",
      path: ["cloudResources"]
    });
  }
  value.cloudResources.forEach((resource, index) => {
    if (resource.ownerPackage !== value.packageName) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Cloud resources must be owned by the app package that declares the manifest",
        path: ["cloudResources", index, "ownerPackage"]
      });
    }
  });
});
var NoCloudCheckKindSchema2 = exports_external2.enum([
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
var NoCloudFindingSeveritySchema2 = exports_external2.enum(["low", "medium", "high", "critical"]);
var NoCloudFindingSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  kind: NoCloudCheckKindSchema2,
  severity: NoCloudFindingSeveritySchema2,
  path: exports_external2.string().min(1).optional(),
  packageName: exports_external2.string().min(1).optional(),
  pattern: exports_external2.string().min(1),
  message: exports_external2.string().min(1),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict();
var NoCloudCheckResultSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  kind: NoCloudCheckKindSchema2,
  status: ContractStatusSchema2,
  target: exports_external2.string().min(1),
  command: exports_external2.string().min(1).optional(),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  findings: exports_external2.array(NoCloudFindingSchema2).default([])
}).strict();
var NoCloudEvidencePackSchema2 = contractBaseSchema2(SCHEMA_IDS2.noCloudEvidencePack).extend({
  subject: ResourcePointerSchema2,
  packageName: exports_external2.string().min(1).optional(),
  packageVersion: exports_external2.string().min(1).optional(),
  generatedBy: ActorPointerSchema2.optional(),
  scanMode: exports_external2.enum(["source_tree", "packed_artifact", "published_metadata", "runtime_config", "workspace", "ci"]),
  status: ContractStatusSchema2,
  verdict: exports_external2.enum(["passed", "failed", "warning", "not_run"]),
  appCloudManifest: AppCloudManifestSchema2.optional(),
  checks: exports_external2.array(NoCloudCheckResultSchema2).min(1),
  findings: exports_external2.array(NoCloudFindingSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  const allFindings = [...value.findings, ...value.checks.flatMap((check) => check.findings)];
  const blockingFindings = allFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Passed no-cloud evidence requires succeeded status", path: ["status"] });
    }
    if (blockingFindings.length > 0) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Passed no-cloud evidence cannot include high or critical findings", path: ["findings"] });
    }
    if (value.checks.some((check) => check.status !== "succeeded")) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Passed no-cloud evidence requires every check to be succeeded", path: ["checks"] });
    }
  }
  if (value.verdict === "failed" && allFindings.length === 0) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Failed no-cloud evidence requires findings", path: ["findings"] });
  }
  if (value.status === "succeeded" && value.checks.some((check) => check.status === "failed")) {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Succeeded no-cloud evidence cannot contain failed checks", path: ["checks"] });
  }
  value.checks.forEach((check, index) => {
    const checkBlockingFindings = check.findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
    if (check.status === "succeeded" && checkBlockingFindings.length > 0) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Succeeded no-cloud checks cannot contain high or critical findings",
        path: ["checks", index, "findings"]
      });
    }
  });
});
var ProofCheckResultSchema2 = exports_external2.object({
  checkId: exports_external2.string().min(1),
  status: ContractStatusSchema2,
  summary: exports_external2.string().min(1).optional(),
  startedAt: OptionalTimestampSchema2,
  finishedAt: OptionalTimestampSchema2,
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict();
var ProofBundleSchema2 = contractBaseSchema2(SCHEMA_IDS2.proofBundle).extend({
  subject: ResourcePointerSchema2,
  validationPlanRef: ResourcePointerSchema2.optional(),
  status: ContractStatusSchema2,
  verdict: exports_external2.enum(["passed", "failed", "inconclusive", "not_run"]).default("inconclusive"),
  checks: exports_external2.array(ProofCheckResultSchema2).default([]),
  verifier: ActorPointerSchema2.optional(),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  residualRisks: exports_external2.array(exports_external2.string().min(1)).default([]),
  freshness: exports_external2.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Passed proof bundles must have status succeeded",
        path: ["status"]
      });
    }
    if (value.checks.length === 0) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Passed proof bundles require at least one check result",
        path: ["checks"]
      });
    }
    value.checks.forEach((check, index) => {
      if (check.status !== "succeeded") {
        ctx.addIssue({
          code: exports_external2.ZodIssueCode.custom,
          message: "Passed proof bundles require all checks to have status succeeded",
          path: ["checks", index, "status"]
        });
      }
    });
    const hasEvidence = value.evidenceRefs.length > 0 || value.checks.some((check) => check.evidenceRefs.length > 0);
    if (!hasEvidence) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Passed proof bundles require evidence",
        path: ["evidenceRefs"]
      });
    }
    if (!value.verifier) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Passed proof bundles require a verifier",
        path: ["verifier"]
      });
    }
  }
  if (value.verdict === "not_run" && value.checks.length > 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Not-run proof bundles cannot include check results",
      path: ["checks"]
    });
  }
  if (value.verdict === "failed" && !value.checks.some((check) => check.status === "failed") && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Failed proof bundles require a failed check or evidence",
      path: ["checks"]
    });
  }
});
var WorkRunSchema2 = contractBaseSchema2(SCHEMA_IDS2.workRun).extend({
  objective: exports_external2.string().min(1),
  status: ContractStatusSchema2,
  actor: ActorPointerSchema2,
  traceId: exports_external2.string().min(1).optional(),
  startedAt: OptionalTimestampSchema2,
  finishedAt: OptionalTimestampSchema2,
  constraints: exports_external2.array(exports_external2.string().min(1)).default([]),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  decisions: exports_external2.array(DecisionEnvelopeSchema2).default([]),
  costEstimates: exports_external2.array(CostEstimateSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  validationPlanRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  proofBundleRefs: exports_external2.array(ResourcePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.startedAt && value.finishedAt && Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "finishedAt must be after or equal to startedAt",
      path: ["finishedAt"]
    });
  }
  if (TerminalStatuses2.has(value.status) && !value.finishedAt) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Terminal work runs require finishedAt",
      path: ["finishedAt"]
    });
  }
  const hasEvidence = value.evidenceRefs.length > 0 || value.proofBundleRefs.length > 0;
  if (value.status === "succeeded" && !hasEvidence) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Succeeded work runs require evidence or a proof bundle",
      path: ["evidenceRefs"]
    });
  }
  if ((value.status === "failed" || value.status === "blocked") && !hasEvidence && value.decisions.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Failed or blocked work runs require evidence, a proof bundle, or a decision record",
      path: ["evidenceRefs"]
    });
  }
});
var TrajectoryEventSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  at: TimestampSchema2,
  kind: exports_external2.enum(["message", "tool_call", "command", "file_change", "error", "test", "decision", "verification", "status", "other"]),
  summary: exports_external2.string().min(1),
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([]),
  costEstimate: CostEstimateSchema2.optional()
}).strict();
var AgentTrajectorySchema2 = contractBaseSchema2(SCHEMA_IDS2.agentTrajectory).extend({
  actor: ActorPointerSchema2,
  workRunRef: ResourcePointerSchema2.optional(),
  events: exports_external2.array(TrajectoryEventSchema2).default([]),
  outcome: exports_external2.enum(["succeeded", "failed", "cancelled", "blocked", "unknown"]).default("unknown"),
  proofBundleRef: ResourcePointerSchema2.optional()
}).strict();
var SERVICE_CONTRACT_VERSION2 = "v1";
var RepoClassSchema2 = exports_external2.enum(["library", "cli-with-store", "service", "saas"]);
var DEPLOYMENT_MODES2 = ["local", "self-hosted", "cloud"];
var DeploymentModeSchema2 = exports_external2.enum(DEPLOYMENT_MODES2);
var ServiceSurfaceStatusSchema2 = exports_external2.enum(["supported", "deferred", "unsupported"]);
var ServiceAuthModeSchema2 = exports_external2.enum(["none", "local-only", "api-key", "session", "service-token", "custom"]);
var ServiceEndpointSchema2 = exports_external2.object({
  method: exports_external2.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: exports_external2.string().regex(/^\/[A-Za-z0-9_./:*-]*$/, "Endpoint paths must be absolute HTTP paths"),
  public: exports_external2.boolean().default(false),
  description: exports_external2.string().min(1).optional()
}).strict();
var DeploymentReadinessGateSchema2 = exports_external2.object({
  id: exports_external2.string().min(1),
  kind: exports_external2.enum(["auth", "storage", "secret-ref", "migration", "health", "readiness", "redaction", "smoke", "operator", "other"]),
  required: exports_external2.boolean().default(true),
  command: exports_external2.string().min(1).optional(),
  evidenceRef: EvidencePointerSchema2.optional(),
  status: exports_external2.enum(["pending", "passed", "failed", "blocked", "deferred"]).default("pending"),
  summary: exports_external2.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if ((value.status === "passed" || value.status === "failed" || value.status === "blocked") && !value.command && !value.evidenceRef && !value.summary) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Terminal readiness gates require command, evidenceRef, or summary",
      path: ["status"]
    });
  }
});
var ServiceSurfaceSchema2 = exports_external2.object({
  name: exports_external2.string().min(1),
  status: ServiceSurfaceStatusSchema2,
  bin: exports_external2.string().min(1).optional(),
  mcpBin: exports_external2.string().min(1).optional(),
  authMode: ServiceAuthModeSchema2,
  deploymentModes: exports_external2.array(DeploymentModeSchema2).min(1),
  health: ServiceEndpointSchema2.optional(),
  readiness: ServiceEndpointSchema2.optional(),
  version: ServiceEndpointSchema2.optional(),
  apiBasePath: exports_external2.string().regex(/^\/v[0-9]+$/, "Stable API base path must be /vN").optional(),
  openApiPath: exports_external2.string().regex(/^\/[A-Za-z0-9_./:-]*$/).optional(),
  deferReason: exports_external2.string().min(1).optional(),
  readinessGates: exports_external2.array(DeploymentReadinessGateSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "supported") {
    if (!value.bin) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Supported service surfaces require a serve bin", path: ["bin"] });
    }
    if (!value.health) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Supported service surfaces require a health endpoint", path: ["health"] });
    }
    if (!value.version) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Supported service surfaces require a version endpoint", path: ["version"] });
    }
  }
  if ((value.status === "deferred" || value.status === "unsupported") && !value.deferReason) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Deferred or unsupported service surfaces require a deferReason",
      path: ["deferReason"]
    });
  }
  if (value.health && value.health.path !== "/health") {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Health endpoint must be /health", path: ["health", "path"] });
  }
  if (value.readiness && value.readiness.path !== "/ready") {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Readiness endpoint must be /ready", path: ["readiness", "path"] });
  }
  if (value.version && value.version.path !== "/version") {
    ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Version endpoint must be /version", path: ["version", "path"] });
  }
});
var STORAGE_MODES2 = ["local", "cloud"];
var StorageModeSchema2 = exports_external2.enum(STORAGE_MODES2);
var AppNameSchema2 = exports_external2.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "App names must be lowercase dashed identifiers");
var ALLOWED_BIN_SUFFIXES2 = [
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
function allowedBinsForName2(name) {
  return ALLOWED_BIN_SUFFIXES2.map((suffix) => `${name}${suffix}`);
}
function databaseUrlSecretRefFor2(name) {
  return `hasna/oss/${name}/database-url`;
}
var StorageContractSchema2 = exports_external2.object({
  mode: StorageModeSchema2,
  envPrefix: exports_external2.string().regex(/^HASNA_[A-Z][A-Z0-9]*_$/).optional(),
  aliasEnvPrefix: exports_external2.string().regex(/^[A-Z][A-Z0-9]*_$/).optional(),
  databaseUrlSecretRef: exports_external2.string().regex(/^hasna\/oss\/[a-z0-9-]+\/database-url$/).optional(),
  sqlitePath: exports_external2.string().min(1).optional()
}).strict();
var ServiceContractManifestSchema2 = exports_external2.object({
  $schema: exports_external2.string().min(1).optional(),
  schema: exports_external2.literal(SCHEMA_IDS2.serviceContract),
  name: AppNameSchema2,
  class: RepoClassSchema2,
  contractVersion: exports_external2.literal(SERVICE_CONTRACT_VERSION2),
  kitVersion: exports_external2.string().min(1),
  description: exports_external2.string().min(1).optional(),
  bins: exports_external2.array(exports_external2.string().min(1)).default([]),
  storage: StorageContractSchema2.optional(),
  deploymentModes: exports_external2.array(DeploymentModeSchema2).default(["local"]),
  serviceSurfaces: exports_external2.array(ServiceSurfaceSchema2).default([]),
  metadata: MetadataSchema2.optional()
}).strict().superRefine((value, ctx) => {
  const allowed = new Set(allowedBinsForName2(value.name));
  const seenBins = new Set;
  for (const [index, bin] of value.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "Duplicate bin declaration", path: ["bins", index] });
    }
    seenBins.add(bin);
    if (!allowed.has(bin)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
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
        code: exports_external2.ZodIssueCode.custom,
        message: `storage.envPrefix must be HASNA_${upper}_`,
        path: ["storage", "envPrefix"]
      });
    }
    if (value.storage.databaseUrlSecretRef && value.storage.databaseUrlSecretRef !== databaseUrlSecretRefFor2(value.name)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `storage.databaseUrlSecretRef must be ${databaseUrlSecretRefFor2(value.name)}`,
        path: ["storage", "databaseUrlSecretRef"]
      });
    }
    if (value.storage.mode === "cloud" && !value.storage.databaseUrlSecretRef) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "cloud storage requires a databaseUrlSecretRef (PURE REMOTE: reads and writes go to cloud Postgres)",
        path: ["storage", "databaseUrlSecretRef"]
      });
    }
  }
  if (value.class === "library") {
    if (value.storage) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "library repos must not declare storage", path: ["storage"] });
    }
    if (hasBin("-serve") || hasBin("-mcp")) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "library repos must not ship a -serve or -mcp bin",
        path: ["bins"]
      });
    }
  }
  if (value.class === "cli-with-store") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "cli-with-store repos must declare storage", path: ["storage"] });
    } else if (value.storage.mode === "local" && !value.storage.sqlitePath) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "local cli-with-store storage requires sqlitePath (~/.hasna/<name>/<name>.db)",
        path: ["storage", "sqlitePath"]
      });
    }
    if (!seenBins.has(value.name)) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: `cli-with-store repos must ship the "${value.name}" bin`, path: ["bins"] });
    }
  }
  if (value.class === "service") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "service repos must declare storage", path: ["storage"] });
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: `service repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "service repos must declare at least one service surface",
        path: ["serviceSurfaces"]
      });
    }
  }
  if (value.class === "saas") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "saas repos must declare storage", path: ["storage"] });
    } else if (value.storage.mode !== "cloud") {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "saas repos must use cloud storage mode", path: ["storage", "mode"] });
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: `saas repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({ code: exports_external2.ZodIssueCode.custom, message: "saas repos must declare at least one service surface", path: ["serviceSurfaces"] });
    }
  }
  for (const [index, surface] of value.serviceSurfaces.entries()) {
    if (surface.bin && !seenBins.has(surface.bin)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `Service surface bin "${surface.bin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "bin"]
      });
    }
    if (surface.mcpBin && !seenBins.has(surface.mcpBin)) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `Service surface MCP bin "${surface.mcpBin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "mcpBin"]
      });
    }
    for (const [modeIndex, deploymentMode] of surface.deploymentModes.entries()) {
      if (!value.deploymentModes.includes(deploymentMode)) {
        ctx.addIssue({
          code: exports_external2.ZodIssueCode.custom,
          message: `Service surface deployment mode "${deploymentMode}" must be declared in deploymentModes`,
          path: ["serviceSurfaces", index, "deploymentModes", modeIndex]
        });
      }
    }
  }
});
var HealthResponseSchema2 = exports_external2.object({
  status: exports_external2.enum(["ok", "degraded", "unavailable"]),
  version: exports_external2.string().min(1),
  mode: StorageModeSchema2
}).strict();
var ReadyResponseSchema2 = exports_external2.object({
  ready: exports_external2.boolean(),
  reason: exports_external2.string().min(1).optional()
}).strict();
var VersionResponseSchema2 = exports_external2.object({
  version: exports_external2.string().min(1)
}).strict();
var CommsSeveritySchema2 = exports_external2.enum(["info", "notice", "breaking", "critical"]);
var CommsEventTypeSchema2 = exports_external2.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/, "Comms event types must be 2-4 lowercase dot-separated segments (<source>.<entity>.<action>)");
var COMMS_SEVERITY_TAGS2 = ["FREEZE", "UNFREEZE", "BREAKING", "CUTOVER", "POLICY", "RELEASE"];
var CommsSeverityTagSchema2 = exports_external2.enum(COMMS_SEVERITY_TAGS2);
var CommsScopeSchema2 = exports_external2.enum(["fleet", "package", "machine"]);
var CommsEventEnvelopeSchema2 = contractBaseSchema2(SCHEMA_IDS2.commsEventEnvelope).extend({
  type: CommsEventTypeSchema2,
  severity: CommsSeveritySchema2,
  scope: CommsScopeSchema2,
  summary: exports_external2.string().min(1).optional(),
  source: ActorPointerSchema2.optional(),
  affected_packages: exports_external2.array(NonEmptyStringSchema2).default([]),
  affected_machines: exports_external2.array(NonEmptyStringSchema2).default([]),
  action_required: exports_external2.boolean().default(false),
  ack_by: TimestampSchema2.optional(),
  dedupe_key: NonEmptyStringSchema2,
  resourceRefs: exports_external2.array(ResourcePointerSchema2).default([]),
  evidenceRefs: exports_external2.array(EvidencePointerSchema2).default([])
}).strict().superRefine((value, ctx) => {
  if (value.scope === "package" && value.affected_packages.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Package-scoped comms events require affected_packages",
      path: ["affected_packages"]
    });
  }
  if (value.scope === "machine" && value.affected_machines.length === 0) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Machine-scoped comms events require affected_machines",
      path: ["affected_machines"]
    });
  }
  if (value.ack_by && !value.action_required) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: "Comms events with an ack_by deadline require action_required",
      path: ["action_required"]
    });
  }
  if (value.type === "fleet.freeze" || value.type === "fleet.unfreeze") {
    if (value.severity !== "critical") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `${value.type} events are always critical`,
        path: ["severity"]
      });
    }
    if (value.scope !== "fleet") {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `${value.type} events are always fleet-scoped`,
        path: ["scope"]
      });
    }
    if (!value.action_required) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `${value.type} events require action_required`,
        path: ["action_required"]
      });
    }
  }
});
var CommsChannelClassSchema2 = exports_external2.enum(["fleet", "package", "product", "loop-lane", "initiative", "personal"]);
var CommsChannelNoiseSchema2 = exports_external2.enum(["quiet", "work", "firehose"]);
var CommsUntilHorizonSchema2 = NonEmptyStringSchema2.refine((value) => /^(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?|gate:[0-9a-f][0-9a-f-]{7,35})$/.test(value), "until must be an ISO date (YYYY-MM-DD), a UTC timestamp, or a gate id (gate:<todos-id>)");
var CommsChannelMetadataSchema2 = contractBaseSchema2(SCHEMA_IDS2.commsChannelMetadata).extend({
  class: CommsChannelClassSchema2,
  noise: CommsChannelNoiseSchema2.optional(),
  owner: NonEmptyStringSchema2.optional(),
  until: CommsUntilHorizonSchema2.optional(),
  successor: NonEmptyStringSchema2.optional()
}).strict().superRefine((value, ctx) => {
  if (value.class === "initiative") {
    if (!value.owner) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Initiative channels require an owner",
        path: ["owner"]
      });
    }
    if (!value.until) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: "Initiative channels require an until horizon (date or gate id)",
        path: ["until"]
      });
    }
  }
});
var COMMS_SEVERITY_TAG_INFO2 = {
  FREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.freeze" },
  UNFREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.unfreeze" },
  BREAKING: { defaultSeverity: "breaking", allowedSeverities: ["breaking"], requiredEventType: null },
  CUTOVER: { defaultSeverity: "notice", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  POLICY: { defaultSeverity: "breaking", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  RELEASE: { defaultSeverity: "info", allowedSeverities: ["info", "notice"], requiredEventType: null }
};
var CommsMessageMetadataSchema2 = contractBaseSchema2(SCHEMA_IDS2.commsMessageMetadata).extend({
  tag: CommsSeverityTagSchema2,
  envelope: CommsEventEnvelopeSchema2
}).strict().superRefine((value, ctx) => {
  const info = COMMS_SEVERITY_TAG_INFO2[value.tag];
  if (!info.allowedSeverities.includes(value.envelope.severity)) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: `[${value.tag}] posts allow severities ${info.allowedSeverities.join(", ")}`,
      path: ["envelope", "severity"]
    });
  }
  if (info.requiredEventType && value.envelope.type !== info.requiredEventType) {
    ctx.addIssue({
      code: exports_external2.ZodIssueCode.custom,
      message: `[${value.tag}] posts require event type ${info.requiredEventType}`,
      path: ["envelope", "type"]
    });
  }
  for (const [tag, tagInfo] of Object.entries(COMMS_SEVERITY_TAG_INFO2)) {
    if (tagInfo.requiredEventType === value.envelope.type && value.tag !== tag) {
      ctx.addIssue({
        code: exports_external2.ZodIssueCode.custom,
        message: `${value.envelope.type} events must use the [${tag}] tag`,
        path: ["tag"]
      });
    }
  }
});
var ContractSchemaRegistry2 = {
  [SCHEMA_IDS2.actorRef]: ActorRefSchema2,
  [SCHEMA_IDS2.resourceRef]: ResourceRefSchema2,
  [SCHEMA_IDS2.evidenceRef]: EvidenceRefSchema2,
  [SCHEMA_IDS2.workRun]: WorkRunSchema2,
  [SCHEMA_IDS2.decisionEnvelope]: DecisionEnvelopeSchema2,
  [SCHEMA_IDS2.costEstimate]: CostEstimateSchema2,
  [SCHEMA_IDS2.capabilityCard]: CapabilityCardSchema2,
  [SCHEMA_IDS2.providerLiveModeStandard]: ProviderLiveModeStandardSchema2,
  [SCHEMA_IDS2.contextPack]: ContextPackSchema2,
  [SCHEMA_IDS2.integrationRef]: IntegrationRefSchema2,
  [SCHEMA_IDS2.projectManifest]: ProjectManifestSchema2,
  [SCHEMA_IDS2.projectPanel]: ProjectPanelSchema2,
  [SCHEMA_IDS2.projectSnapshot]: ProjectSnapshotSchema2,
  [SCHEMA_IDS2.renderManifest]: RenderManifestSchema2,
  [SCHEMA_IDS2.agentTrajectory]: AgentTrajectorySchema2,
  [SCHEMA_IDS2.validationPlan]: ValidationPlanSchema2,
  [SCHEMA_IDS2.proofBundle]: ProofBundleSchema2,
  [SCHEMA_IDS2.scaffoldManifest]: ScaffoldManifestSchema2,
  [SCHEMA_IDS2.scaffoldInstallRecord]: ScaffoldInstallRecordSchema2,
  [SCHEMA_IDS2.appCloudManifest]: AppCloudManifestSchema2,
  [SCHEMA_IDS2.noCloudEvidencePack]: NoCloudEvidencePackSchema2,
  [SCHEMA_IDS2.serviceContract]: ServiceContractManifestSchema2,
  [SCHEMA_IDS2.commsEventEnvelope]: CommsEventEnvelopeSchema2,
  [SCHEMA_IDS2.commsChannelMetadata]: CommsChannelMetadataSchema2,
  [SCHEMA_IDS2.commsMessageMetadata]: CommsMessageMetadataSchema2,
  [SCHEMA_IDS2.app]: AppSchema2,
  [SCHEMA_IDS2.release]: ReleaseSchema2,
  [SCHEMA_IDS2.rolloutRecord]: RolloutRecordSchema2,
  [SCHEMA_IDS2.announcement]: AnnouncementSchema2,
  [SCHEMA_IDS2.audience]: AudienceSchema2
};
function envToken2(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function clientTransportEnvKeys2(name) {
  const envSegment = envToken2(name);
  return {
    modeKeys: [
      `HASNA_${envSegment}_STORAGE_MODE`,
      `HASNA_${envSegment}_MODE`,
      `${envSegment}_STORAGE_MODE`,
      `${envSegment}_MODE`
    ],
    apiUrlKeys: [`HASNA_${envSegment}_API_URL`, `${envSegment}_API_URL`],
    apiKeyKeys: [`HASNA_${envSegment}_API_KEY`, `${envSegment}_API_KEY`]
  };
}
var IDEMPOTENT_METHODS2 = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

// node_modules/@hasna/contracts/dist/mode.js
var __defProp4 = Object.defineProperty;
var __returnValue4 = (v) => v;
function __exportSetter4(name, newValue) {
  this[name] = __returnValue4.bind(null, newValue);
}
var __export4 = (target, all) => {
  for (var name in all)
    __defProp4(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter4.bind(all, name)
    });
};
var exports_external3 = {};
__export4(exports_external3, {
  void: () => voidType3,
  util: () => util3,
  unknown: () => unknownType3,
  union: () => unionType3,
  undefined: () => undefinedType3,
  tuple: () => tupleType3,
  transformer: () => effectsType3,
  symbol: () => symbolType3,
  string: () => stringType3,
  strictObject: () => strictObjectType3,
  setErrorMap: () => setErrorMap3,
  set: () => setType3,
  record: () => recordType3,
  quotelessJson: () => quotelessJson3,
  promise: () => promiseType3,
  preprocess: () => preprocessType3,
  pipeline: () => pipelineType3,
  ostring: () => ostring3,
  optional: () => optionalType3,
  onumber: () => onumber3,
  oboolean: () => oboolean3,
  objectUtil: () => objectUtil3,
  object: () => objectType3,
  number: () => numberType3,
  nullable: () => nullableType3,
  null: () => nullType3,
  never: () => neverType3,
  nativeEnum: () => nativeEnumType3,
  nan: () => nanType3,
  map: () => mapType3,
  makeIssue: () => makeIssue3,
  literal: () => literalType3,
  lazy: () => lazyType3,
  late: () => late3,
  isValid: () => isValid3,
  isDirty: () => isDirty3,
  isAsync: () => isAsync3,
  isAborted: () => isAborted3,
  intersection: () => intersectionType3,
  instanceof: () => instanceOfType3,
  getParsedType: () => getParsedType3,
  getErrorMap: () => getErrorMap3,
  function: () => functionType3,
  enum: () => enumType3,
  effect: () => effectsType3,
  discriminatedUnion: () => discriminatedUnionType3,
  defaultErrorMap: () => en_default3,
  datetimeRegex: () => datetimeRegex3,
  date: () => dateType3,
  custom: () => custom3,
  coerce: () => coerce3,
  boolean: () => booleanType3,
  bigint: () => bigIntType3,
  array: () => arrayType3,
  any: () => anyType3,
  addIssueToContext: () => addIssueToContext3,
  ZodVoid: () => ZodVoid3,
  ZodUnknown: () => ZodUnknown3,
  ZodUnion: () => ZodUnion3,
  ZodUndefined: () => ZodUndefined3,
  ZodType: () => ZodType3,
  ZodTuple: () => ZodTuple3,
  ZodTransformer: () => ZodEffects3,
  ZodSymbol: () => ZodSymbol3,
  ZodString: () => ZodString3,
  ZodSet: () => ZodSet3,
  ZodSchema: () => ZodType3,
  ZodRecord: () => ZodRecord3,
  ZodReadonly: () => ZodReadonly3,
  ZodPromise: () => ZodPromise3,
  ZodPipeline: () => ZodPipeline3,
  ZodParsedType: () => ZodParsedType3,
  ZodOptional: () => ZodOptional3,
  ZodObject: () => ZodObject3,
  ZodNumber: () => ZodNumber3,
  ZodNullable: () => ZodNullable3,
  ZodNull: () => ZodNull3,
  ZodNever: () => ZodNever3,
  ZodNativeEnum: () => ZodNativeEnum3,
  ZodNaN: () => ZodNaN3,
  ZodMap: () => ZodMap3,
  ZodLiteral: () => ZodLiteral3,
  ZodLazy: () => ZodLazy3,
  ZodIssueCode: () => ZodIssueCode3,
  ZodIntersection: () => ZodIntersection3,
  ZodFunction: () => ZodFunction3,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind3,
  ZodError: () => ZodError3,
  ZodEnum: () => ZodEnum3,
  ZodEffects: () => ZodEffects3,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion3,
  ZodDefault: () => ZodDefault3,
  ZodDate: () => ZodDate3,
  ZodCatch: () => ZodCatch3,
  ZodBranded: () => ZodBranded3,
  ZodBoolean: () => ZodBoolean3,
  ZodBigInt: () => ZodBigInt3,
  ZodArray: () => ZodArray3,
  ZodAny: () => ZodAny3,
  Schema: () => ZodType3,
  ParseStatus: () => ParseStatus3,
  OK: () => OK3,
  NEVER: () => NEVER3,
  INVALID: () => INVALID3,
  EMPTY_PATH: () => EMPTY_PATH3,
  DIRTY: () => DIRTY3,
  BRAND: () => BRAND3
});
var util3;
(function(util22) {
  util22.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util22.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util22.assertNever = assertNever;
  util22.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util22.getValidEnumValues = (obj) => {
    const validKeys = util22.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util22.objectValues(filtered);
  };
  util22.objectValues = (obj) => {
    return util22.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util22.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util22.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util22.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util22.joinValues = joinValues;
  util22.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util3 || (util3 = {}));
var objectUtil3;
(function(objectUtil22) {
  objectUtil22.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil3 || (objectUtil3 = {}));
var ZodParsedType3 = util3.arrayToEnum([
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
var getParsedType3 = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType3.undefined;
    case "string":
      return ZodParsedType3.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType3.nan : ZodParsedType3.number;
    case "boolean":
      return ZodParsedType3.boolean;
    case "function":
      return ZodParsedType3.function;
    case "bigint":
      return ZodParsedType3.bigint;
    case "symbol":
      return ZodParsedType3.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType3.array;
      }
      if (data === null) {
        return ZodParsedType3.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType3.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType3.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType3.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType3.date;
      }
      return ZodParsedType3.object;
    default:
      return ZodParsedType3.unknown;
  }
};
var ZodIssueCode3 = util3.arrayToEnum([
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
var quotelessJson3 = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError3 extends Error {
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
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
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
    if (!(value instanceof ZodError3)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util3.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
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
ZodError3.create = (issues) => {
  const error = new ZodError3(issues);
  return error;
};
var errorMap3 = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode3.invalid_type:
      if (issue.received === ZodParsedType3.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode3.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util3.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode3.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util3.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode3.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode3.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util3.joinValues(issue.options)}`;
      break;
    case ZodIssueCode3.invalid_enum_value:
      message = `Invalid enum value. Expected ${util3.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode3.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode3.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode3.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode3.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util3.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode3.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode3.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode3.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode3.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode3.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode3.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util3.assertNever(issue);
  }
  return { message };
};
var en_default3 = errorMap3;
var overrideErrorMap3 = en_default3;
function setErrorMap3(map) {
  overrideErrorMap3 = map;
}
function getErrorMap3() {
  return overrideErrorMap3;
}
var makeIssue3 = (params) => {
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
var EMPTY_PATH3 = [];
function addIssueToContext3(ctx, issueData) {
  const overrideMap = getErrorMap3();
  const issue = makeIssue3({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default3 ? undefined : en_default3
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}

class ParseStatus3 {
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
        return INVALID3;
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
    return ParseStatus3.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID3;
      if (value.status === "aborted")
        return INVALID3;
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
var INVALID3 = Object.freeze({
  status: "aborted"
});
var DIRTY3 = (value) => ({ status: "dirty", value });
var OK3 = (value) => ({ status: "valid", value });
var isAborted3 = (x) => x.status === "aborted";
var isDirty3 = (x) => x.status === "dirty";
var isValid3 = (x) => x.status === "valid";
var isAsync3 = (x) => typeof Promise !== "undefined" && x instanceof Promise;
var errorUtil3;
(function(errorUtil22) {
  errorUtil22.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil22.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil3 || (errorUtil3 = {}));

class ParseInputLazyPath3 {
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
var handleResult3 = (ctx, result) => {
  if (isValid3(result)) {
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
        const error = new ZodError3(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams3(params) {
  if (!params)
    return {};
  const { errorMap: errorMap22, invalid_type_error, required_error, description } = params;
  if (errorMap22 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap22)
    return { errorMap: errorMap22, description };
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

class ZodType3 {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType3(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType3(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus3,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType3(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync3(result)) {
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
      parsedType: getParsedType3(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult3(ctx, result);
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
      parsedType: getParsedType3(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid3(result) ? {
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
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid3(result) ? {
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
      parsedType: getParsedType3(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync3(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult3(ctx, result);
  }
  refine(check, message) {
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
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode3.custom,
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
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects3({
      schema: this,
      typeName: ZodFirstPartyTypeKind3.ZodEffects,
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
    return ZodOptional3.create(this, this._def);
  }
  nullable() {
    return ZodNullable3.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray3.create(this);
  }
  promise() {
    return ZodPromise3.create(this, this._def);
  }
  or(option) {
    return ZodUnion3.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection3.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects3({
      ...processCreateParams3(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind3.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault3({
      ...processCreateParams3(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind3.ZodDefault
    });
  }
  brand() {
    return new ZodBranded3({
      typeName: ZodFirstPartyTypeKind3.ZodBranded,
      type: this,
      ...processCreateParams3(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch3({
      ...processCreateParams3(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind3.ZodCatch
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
    return ZodPipeline3.create(this, target);
  }
  readonly() {
    return ZodReadonly3.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex3 = /^c[^\s-]{8,}$/i;
var cuid2Regex3 = /^[0-9a-z]+$/;
var ulidRegex3 = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex3 = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex3 = /^[a-z0-9_-]{21}$/i;
var jwtRegex3 = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex3 = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex3 = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex3 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex3;
var ipv4Regex3 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex3 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex3 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex3 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex3 = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex3 = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource3 = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex3 = new RegExp(`^${dateRegexSource3}$`);
function timeRegexSource3(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex3(args) {
  return new RegExp(`^${timeRegexSource3(args)}$`);
}
function datetimeRegex3(args) {
  let regex = `${dateRegexSource3}T${timeRegexSource3(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP3(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex3.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex3.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT3(jwt, alg) {
  if (!jwtRegex3.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
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
function isValidCidr3(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex3.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex3.test(ip)) {
    return true;
  }
  return false;
}

class ZodString3 extends ZodType3 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext3(ctx2, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.string,
        received: ctx2.parsedType
      });
      return INVALID3;
    }
    const status = new ParseStatus3;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext3(ctx, {
              code: ZodIssueCode3.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext3(ctx, {
              code: ZodIssueCode3.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "email",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex3) {
          emojiRegex3 = new RegExp(_emojiRegex3, "u");
        }
        if (!emojiRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "emoji",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "uuid",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "nanoid",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "cuid",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "cuid2",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "ulid",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "url",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "regex",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex3(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex3;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex3(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "duration",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP3(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "ip",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT3(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "jwt",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr3(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "cidr",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "base64",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex3.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            validation: "base64url",
            code: ZodIssueCode3.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util3.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode3.invalid_string,
      ...errorUtil3.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString3({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil3.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil3.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil3.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil3.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil3.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil3.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil3.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil3.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil3.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil3.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil3.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil3.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil3.errToObj(options) });
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
      ...errorUtil3.errToObj(options?.message)
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
      ...errorUtil3.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil3.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil3.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil3.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil3.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil3.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil3.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil3.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil3.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil3.errToObj(message));
  }
  trim() {
    return new ZodString3({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString3({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString3({
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
ZodString3.create = (params) => {
  return new ZodString3({
    checks: [],
    typeName: ZodFirstPartyTypeKind3.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams3(params)
  });
};
function floatSafeRemainder3(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber3 extends ZodType3 {
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
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext3(ctx2, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.number,
        received: ctx2.parsedType
      });
      return INVALID3;
    }
    let ctx = undefined;
    const status = new ParseStatus3;
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util3.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder3(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util3.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil3.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil3.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil3.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil3.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber3({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil3.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber3({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil3.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil3.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil3.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil3.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil3.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil3.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil3.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil3.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil3.toString(message)
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
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util3.isInteger(ch.value));
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
ZodNumber3.create = (params) => {
  return new ZodNumber3({
    checks: [],
    typeName: ZodFirstPartyTypeKind3.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams3(params)
  });
};

class ZodBigInt3 extends ZodType3 {
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
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus3;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util3.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext3(ctx, {
      code: ZodIssueCode3.invalid_type,
      expected: ZodParsedType3.bigint,
      received: ctx.parsedType
    });
    return INVALID3;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil3.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil3.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil3.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil3.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt3({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil3.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt3({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil3.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil3.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil3.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil3.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil3.toString(message)
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
ZodBigInt3.create = (params) => {
  return new ZodBigInt3({
    checks: [],
    typeName: ZodFirstPartyTypeKind3.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams3(params)
  });
};

class ZodBoolean3 extends ZodType3 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.boolean,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    return OK3(input.data);
  }
}
ZodBoolean3.create = (params) => {
  return new ZodBoolean3({
    typeName: ZodFirstPartyTypeKind3.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams3(params)
  });
};

class ZodDate3 extends ZodType3 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext3(ctx2, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.date,
        received: ctx2.parsedType
      });
      return INVALID3;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext3(ctx2, {
        code: ZodIssueCode3.invalid_date
      });
      return INVALID3;
    }
    const status = new ParseStatus3;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util3.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate3({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil3.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil3.toString(message)
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
ZodDate3.create = (params) => {
  return new ZodDate3({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind3.ZodDate,
    ...processCreateParams3(params)
  });
};

class ZodSymbol3 extends ZodType3 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.symbol,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    return OK3(input.data);
  }
}
ZodSymbol3.create = (params) => {
  return new ZodSymbol3({
    typeName: ZodFirstPartyTypeKind3.ZodSymbol,
    ...processCreateParams3(params)
  });
};

class ZodUndefined3 extends ZodType3 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.undefined,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    return OK3(input.data);
  }
}
ZodUndefined3.create = (params) => {
  return new ZodUndefined3({
    typeName: ZodFirstPartyTypeKind3.ZodUndefined,
    ...processCreateParams3(params)
  });
};

class ZodNull3 extends ZodType3 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.null,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    return OK3(input.data);
  }
}
ZodNull3.create = (params) => {
  return new ZodNull3({
    typeName: ZodFirstPartyTypeKind3.ZodNull,
    ...processCreateParams3(params)
  });
};

class ZodAny3 extends ZodType3 {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK3(input.data);
  }
}
ZodAny3.create = (params) => {
  return new ZodAny3({
    typeName: ZodFirstPartyTypeKind3.ZodAny,
    ...processCreateParams3(params)
  });
};

class ZodUnknown3 extends ZodType3 {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK3(input.data);
  }
}
ZodUnknown3.create = (params) => {
  return new ZodUnknown3({
    typeName: ZodFirstPartyTypeKind3.ZodUnknown,
    ...processCreateParams3(params)
  });
};

class ZodNever3 extends ZodType3 {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext3(ctx, {
      code: ZodIssueCode3.invalid_type,
      expected: ZodParsedType3.never,
      received: ctx.parsedType
    });
    return INVALID3;
  }
}
ZodNever3.create = (params) => {
  return new ZodNever3({
    typeName: ZodFirstPartyTypeKind3.ZodNever,
    ...processCreateParams3(params)
  });
};

class ZodVoid3 extends ZodType3 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.void,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    return OK3(input.data);
  }
}
ZodVoid3.create = (params) => {
  return new ZodVoid3({
    typeName: ZodFirstPartyTypeKind3.ZodVoid,
    ...processCreateParams3(params)
  });
};

class ZodArray3 extends ZodType3 {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType3.array) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.array,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext3(ctx, {
          code: tooBig ? ZodIssueCode3.too_big : ZodIssueCode3.too_small,
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
        addIssueToContext3(ctx, {
          code: ZodIssueCode3.too_small,
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
        addIssueToContext3(ctx, {
          code: ZodIssueCode3.too_big,
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
        return def.type._parseAsync(new ParseInputLazyPath3(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus3.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath3(ctx, item, ctx.path, i));
    });
    return ParseStatus3.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray3({
      ...this._def,
      minLength: { value: minLength, message: errorUtil3.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray3({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil3.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray3({
      ...this._def,
      exactLength: { value: len, message: errorUtil3.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray3.create = (schema, params) => {
  return new ZodArray3({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind3.ZodArray,
    ...processCreateParams3(params)
  });
};
function deepPartialify3(schema) {
  if (schema instanceof ZodObject3) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional3.create(deepPartialify3(fieldSchema));
    }
    return new ZodObject3({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray3) {
    return new ZodArray3({
      ...schema._def,
      type: deepPartialify3(schema.element)
    });
  } else if (schema instanceof ZodOptional3) {
    return ZodOptional3.create(deepPartialify3(schema.unwrap()));
  } else if (schema instanceof ZodNullable3) {
    return ZodNullable3.create(deepPartialify3(schema.unwrap()));
  } else if (schema instanceof ZodTuple3) {
    return ZodTuple3.create(schema.items.map((item) => deepPartialify3(item)));
  } else {
    return schema;
  }
}

class ZodObject3 extends ZodType3 {
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
    const keys = util3.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext3(ctx2, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.object,
        received: ctx2.parsedType
      });
      return INVALID3;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever3 && this._def.unknownKeys === "strip")) {
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
        value: keyValidator._parse(new ParseInputLazyPath3(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever3) {
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
          addIssueToContext3(ctx, {
            code: ZodIssueCode3.unrecognized_keys,
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
          value: catchall._parse(new ParseInputLazyPath3(ctx, value, ctx.path, key)),
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
        return ParseStatus3.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus3.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil3.errToObj;
    return new ZodObject3({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil3.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject3({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject3({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject3({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject3({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind3.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject3({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util3.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject3({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util3.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject3({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify3(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util3.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject3({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util3.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional3) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject3({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum3(util3.objectKeys(this.shape));
  }
}
ZodObject3.create = (shape, params) => {
  return new ZodObject3({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever3.create(),
    typeName: ZodFirstPartyTypeKind3.ZodObject,
    ...processCreateParams3(params)
  });
};
ZodObject3.strictCreate = (shape, params) => {
  return new ZodObject3({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever3.create(),
    typeName: ZodFirstPartyTypeKind3.ZodObject,
    ...processCreateParams3(params)
  });
};
ZodObject3.lazycreate = (shape, params) => {
  return new ZodObject3({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever3.create(),
    typeName: ZodFirstPartyTypeKind3.ZodObject,
    ...processCreateParams3(params)
  });
};

class ZodUnion3 extends ZodType3 {
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
      const unionErrors = results.map((result) => new ZodError3(result.ctx.common.issues));
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_union,
        unionErrors
      });
      return INVALID3;
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
      const unionErrors = issues.map((issues2) => new ZodError3(issues2));
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_union,
        unionErrors
      });
      return INVALID3;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion3.create = (types, params) => {
  return new ZodUnion3({
    options: types,
    typeName: ZodFirstPartyTypeKind3.ZodUnion,
    ...processCreateParams3(params)
  });
};
var getDiscriminator3 = (type) => {
  if (type instanceof ZodLazy3) {
    return getDiscriminator3(type.schema);
  } else if (type instanceof ZodEffects3) {
    return getDiscriminator3(type.innerType());
  } else if (type instanceof ZodLiteral3) {
    return [type.value];
  } else if (type instanceof ZodEnum3) {
    return type.options;
  } else if (type instanceof ZodNativeEnum3) {
    return util3.objectValues(type.enum);
  } else if (type instanceof ZodDefault3) {
    return getDiscriminator3(type._def.innerType);
  } else if (type instanceof ZodUndefined3) {
    return [undefined];
  } else if (type instanceof ZodNull3) {
    return [null];
  } else if (type instanceof ZodOptional3) {
    return [undefined, ...getDiscriminator3(type.unwrap())];
  } else if (type instanceof ZodNullable3) {
    return [null, ...getDiscriminator3(type.unwrap())];
  } else if (type instanceof ZodBranded3) {
    return getDiscriminator3(type.unwrap());
  } else if (type instanceof ZodReadonly3) {
    return getDiscriminator3(type.unwrap());
  } else if (type instanceof ZodCatch3) {
    return getDiscriminator3(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion3 extends ZodType3 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType3.object) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.object,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID3;
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
      const discriminatorValues = getDiscriminator3(type.shape[discriminator]);
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
    return new ZodDiscriminatedUnion3({
      typeName: ZodFirstPartyTypeKind3.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams3(params)
    });
  }
}
function mergeValues3(a, b) {
  const aType = getParsedType3(a);
  const bType = getParsedType3(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType3.object && bType === ZodParsedType3.object) {
    const bKeys = util3.objectKeys(b);
    const sharedKeys = util3.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues3(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType3.array && bType === ZodParsedType3.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues3(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType3.date && bType === ZodParsedType3.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection3 extends ZodType3 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted3(parsedLeft) || isAborted3(parsedRight)) {
        return INVALID3;
      }
      const merged = mergeValues3(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext3(ctx, {
          code: ZodIssueCode3.invalid_intersection_types
        });
        return INVALID3;
      }
      if (isDirty3(parsedLeft) || isDirty3(parsedRight)) {
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
ZodIntersection3.create = (left, right, params) => {
  return new ZodIntersection3({
    left,
    right,
    typeName: ZodFirstPartyTypeKind3.ZodIntersection,
    ...processCreateParams3(params)
  });
};

class ZodTuple3 extends ZodType3 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType3.array) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.array,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID3;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.too_big,
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
      return schema._parse(new ParseInputLazyPath3(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus3.mergeArray(status, results);
      });
    } else {
      return ParseStatus3.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple3({
      ...this._def,
      rest
    });
  }
}
ZodTuple3.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple3({
    items: schemas,
    typeName: ZodFirstPartyTypeKind3.ZodTuple,
    rest: null,
    ...processCreateParams3(params)
  });
};

class ZodRecord3 extends ZodType3 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType3.object) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.object,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath3(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath3(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus3.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus3.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType3) {
      return new ZodRecord3({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind3.ZodRecord,
        ...processCreateParams3(third)
      });
    }
    return new ZodRecord3({
      keyType: ZodString3.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind3.ZodRecord,
      ...processCreateParams3(second)
    });
  }
}

class ZodMap3 extends ZodType3 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType3.map) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.map,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath3(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath3(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID3;
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
          return INVALID3;
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
ZodMap3.create = (keyType, valueType, params) => {
  return new ZodMap3({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind3.ZodMap,
    ...processCreateParams3(params)
  });
};

class ZodSet3 extends ZodType3 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType3.set) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.set,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext3(ctx, {
          code: ZodIssueCode3.too_small,
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
        addIssueToContext3(ctx, {
          code: ZodIssueCode3.too_big,
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
          return INVALID3;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath3(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet3({
      ...this._def,
      minSize: { value: minSize, message: errorUtil3.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet3({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil3.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet3.create = (valueType, params) => {
  return new ZodSet3({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind3.ZodSet,
    ...processCreateParams3(params)
  });
};

class ZodFunction3 extends ZodType3 {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType3.function) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.function,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    function makeArgsIssue(args, error) {
      return makeIssue3({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap3(), en_default3].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode3.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue3({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap3(), en_default3].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode3.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise3) {
      const me = this;
      return OK3(async function(...args) {
        const error = new ZodError3([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK3(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError3([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError3([makeReturnsIssue(result, parsedReturns.error)]);
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
    return new ZodFunction3({
      ...this._def,
      args: ZodTuple3.create(items).rest(ZodUnknown3.create())
    });
  }
  returns(returnType) {
    return new ZodFunction3({
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
    return new ZodFunction3({
      args: args ? args : ZodTuple3.create([]).rest(ZodUnknown3.create()),
      returns: returns || ZodUnknown3.create(),
      typeName: ZodFirstPartyTypeKind3.ZodFunction,
      ...processCreateParams3(params)
    });
  }
}

class ZodLazy3 extends ZodType3 {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy3.create = (getter, params) => {
  return new ZodLazy3({
    getter,
    typeName: ZodFirstPartyTypeKind3.ZodLazy,
    ...processCreateParams3(params)
  });
};

class ZodLiteral3 extends ZodType3 {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext3(ctx, {
        received: ctx.data,
        code: ZodIssueCode3.invalid_literal,
        expected: this._def.value
      });
      return INVALID3;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral3.create = (value, params) => {
  return new ZodLiteral3({
    value,
    typeName: ZodFirstPartyTypeKind3.ZodLiteral,
    ...processCreateParams3(params)
  });
};
function createZodEnum3(values, params) {
  return new ZodEnum3({
    values,
    typeName: ZodFirstPartyTypeKind3.ZodEnum,
    ...processCreateParams3(params)
  });
}

class ZodEnum3 extends ZodType3 {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext3(ctx, {
        expected: util3.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode3.invalid_type
      });
      return INVALID3;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext3(ctx, {
        received: ctx.data,
        code: ZodIssueCode3.invalid_enum_value,
        options: expectedValues
      });
      return INVALID3;
    }
    return OK3(input.data);
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
    return ZodEnum3.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum3.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum3.create = createZodEnum3;

class ZodNativeEnum3 extends ZodType3 {
  _parse(input) {
    const nativeEnumValues = util3.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType3.string && ctx.parsedType !== ZodParsedType3.number) {
      const expectedValues = util3.objectValues(nativeEnumValues);
      addIssueToContext3(ctx, {
        expected: util3.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode3.invalid_type
      });
      return INVALID3;
    }
    if (!this._cache) {
      this._cache = new Set(util3.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util3.objectValues(nativeEnumValues);
      addIssueToContext3(ctx, {
        received: ctx.data,
        code: ZodIssueCode3.invalid_enum_value,
        options: expectedValues
      });
      return INVALID3;
    }
    return OK3(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum3.create = (values, params) => {
  return new ZodNativeEnum3({
    values,
    typeName: ZodFirstPartyTypeKind3.ZodNativeEnum,
    ...processCreateParams3(params)
  });
};

class ZodPromise3 extends ZodType3 {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType3.promise && ctx.common.async === false) {
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.promise,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    const promisified = ctx.parsedType === ZodParsedType3.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK3(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise3.create = (schema, params) => {
  return new ZodPromise3({
    type: schema,
    typeName: ZodFirstPartyTypeKind3.ZodPromise,
    ...processCreateParams3(params)
  });
};

class ZodEffects3 extends ZodType3 {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind3.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext3(ctx, arg);
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
            return INVALID3;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID3;
          if (result.status === "dirty")
            return DIRTY3(result.value);
          if (status.value === "dirty")
            return DIRTY3(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID3;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID3;
        if (result.status === "dirty")
          return DIRTY3(result.value);
        if (status.value === "dirty")
          return DIRTY3(result.value);
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
          return INVALID3;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID3;
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
        if (!isValid3(base))
          return INVALID3;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid3(base))
            return INVALID3;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util3.assertNever(effect);
  }
}
ZodEffects3.create = (schema, effect, params) => {
  return new ZodEffects3({
    schema,
    typeName: ZodFirstPartyTypeKind3.ZodEffects,
    effect,
    ...processCreateParams3(params)
  });
};
ZodEffects3.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects3({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind3.ZodEffects,
    ...processCreateParams3(params)
  });
};

class ZodOptional3 extends ZodType3 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType3.undefined) {
      return OK3(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional3.create = (type, params) => {
  return new ZodOptional3({
    innerType: type,
    typeName: ZodFirstPartyTypeKind3.ZodOptional,
    ...processCreateParams3(params)
  });
};

class ZodNullable3 extends ZodType3 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType3.null) {
      return OK3(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable3.create = (type, params) => {
  return new ZodNullable3({
    innerType: type,
    typeName: ZodFirstPartyTypeKind3.ZodNullable,
    ...processCreateParams3(params)
  });
};

class ZodDefault3 extends ZodType3 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType3.undefined) {
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
ZodDefault3.create = (type, params) => {
  return new ZodDefault3({
    innerType: type,
    typeName: ZodFirstPartyTypeKind3.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams3(params)
  });
};

class ZodCatch3 extends ZodType3 {
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
    if (isAsync3(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError3(newCtx.common.issues);
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
            return new ZodError3(newCtx.common.issues);
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
ZodCatch3.create = (type, params) => {
  return new ZodCatch3({
    innerType: type,
    typeName: ZodFirstPartyTypeKind3.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams3(params)
  });
};

class ZodNaN3 extends ZodType3 {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType3.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext3(ctx, {
        code: ZodIssueCode3.invalid_type,
        expected: ZodParsedType3.nan,
        received: ctx.parsedType
      });
      return INVALID3;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN3.create = (params) => {
  return new ZodNaN3({
    typeName: ZodFirstPartyTypeKind3.ZodNaN,
    ...processCreateParams3(params)
  });
};
var BRAND3 = Symbol("zod_brand");

class ZodBranded3 extends ZodType3 {
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

class ZodPipeline3 extends ZodType3 {
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
          return INVALID3;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY3(inResult.value);
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
        return INVALID3;
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
    return new ZodPipeline3({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind3.ZodPipeline
    });
  }
}

class ZodReadonly3 extends ZodType3 {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid3(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync3(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly3.create = (type, params) => {
  return new ZodReadonly3({
    innerType: type,
    typeName: ZodFirstPartyTypeKind3.ZodReadonly,
    ...processCreateParams3(params)
  });
};
function cleanParams3(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom3(check, _params = {}, fatal) {
  if (check)
    return ZodAny3.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams3(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams3(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny3.create();
}
var late3 = {
  object: ZodObject3.lazycreate
};
var ZodFirstPartyTypeKind3;
(function(ZodFirstPartyTypeKind22) {
  ZodFirstPartyTypeKind22["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind22["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind22["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind22["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind22["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind22["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind22["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind22["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind22["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind22["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind22["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind22["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind22["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind22["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind22["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind22["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind22["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind22["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind22["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind22["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind22["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind22["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind22["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind22["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind22["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind22["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind22["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind22["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind22["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind22["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind22["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind22["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind22["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind22["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind22["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind22["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind3 || (ZodFirstPartyTypeKind3 = {}));
var instanceOfType3 = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom3((data) => data instanceof cls, params);
var stringType3 = ZodString3.create;
var numberType3 = ZodNumber3.create;
var nanType3 = ZodNaN3.create;
var bigIntType3 = ZodBigInt3.create;
var booleanType3 = ZodBoolean3.create;
var dateType3 = ZodDate3.create;
var symbolType3 = ZodSymbol3.create;
var undefinedType3 = ZodUndefined3.create;
var nullType3 = ZodNull3.create;
var anyType3 = ZodAny3.create;
var unknownType3 = ZodUnknown3.create;
var neverType3 = ZodNever3.create;
var voidType3 = ZodVoid3.create;
var arrayType3 = ZodArray3.create;
var objectType3 = ZodObject3.create;
var strictObjectType3 = ZodObject3.strictCreate;
var unionType3 = ZodUnion3.create;
var discriminatedUnionType3 = ZodDiscriminatedUnion3.create;
var intersectionType3 = ZodIntersection3.create;
var tupleType3 = ZodTuple3.create;
var recordType3 = ZodRecord3.create;
var mapType3 = ZodMap3.create;
var setType3 = ZodSet3.create;
var functionType3 = ZodFunction3.create;
var lazyType3 = ZodLazy3.create;
var literalType3 = ZodLiteral3.create;
var enumType3 = ZodEnum3.create;
var nativeEnumType3 = ZodNativeEnum3.create;
var promiseType3 = ZodPromise3.create;
var effectsType3 = ZodEffects3.create;
var optionalType3 = ZodOptional3.create;
var nullableType3 = ZodNullable3.create;
var preprocessType3 = ZodEffects3.createWithPreprocess;
var pipelineType3 = ZodPipeline3.create;
var ostring3 = () => stringType3().optional();
var onumber3 = () => numberType3().optional();
var oboolean3 = () => booleanType3().optional();
var coerce3 = {
  string: (arg) => ZodString3.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber3.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean3.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt3.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate3.create({ ...arg, coerce: true })
};
var NEVER3 = INVALID3;
var SCHEMA_IDS3 = {
  actorRef: "hasna.actor_ref.v1",
  resourceRef: "hasna.resource_ref.v1",
  evidenceRef: "hasna.evidence_ref.v1",
  workRun: "hasna.work_run.v1",
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
  noCloudEvidencePack: "hasna.no_cloud_evidence_pack.v1",
  serviceContract: "hasna.service_contract.v1",
  commsEventEnvelope: "hasna.comms_event_envelope.v1",
  commsChannelMetadata: "hasna.comms_channel_metadata.v1",
  commsMessageMetadata: "hasna.comms_message_metadata.v1",
  app: "hasna.app.v1",
  release: "hasna.release.v1",
  rolloutRecord: "hasna.rollout_record.v1",
  announcement: "hasna.announcement.v1",
  audience: "hasna.audience.v1"
};
var SchemaIdSchema3 = exports_external3.string().regex(/^hasna\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.v[0-9]+$/);
var TimestampSchema3 = exports_external3.string().datetime();
var NonEmptyStringSchema3 = exports_external3.string().trim().min(1);
var UriSchema3 = NonEmptyStringSchema3.refine((value) => value.startsWith("artifact://") || value.startsWith("repo://") || value.startsWith("project://") || value.startsWith("dashboard://") || value.startsWith("render://") || value.startsWith("integration://") || value.startsWith("task://") || value.startsWith("todo://") || value.startsWith("file://") || value.startsWith("files://") || value.startsWith("mailery://") || value.startsWith("conversation://") || value.startsWith("knowledge://") || value.startsWith("memento://") || value.startsWith("https://") || value.startsWith("http://") || value.startsWith("git+https://"), "URI must use artifact://, repo://, project://, dashboard://, render://, integration://, task://, todo://, file://, files://, mailery://, conversation://, knowledge://, memento://, http(s)://, or git+https://");
var Sha256DigestSchema3 = exports_external3.string().regex(/^[a-fA-F0-9]{64}$/);
var HashStringSchema3 = exports_external3.string().regex(/^(sha256:)?[a-fA-F0-9]{64}$/);
var MetadataSchema3 = exports_external3.record(exports_external3.unknown());
var TagsSchema3 = exports_external3.array(exports_external3.string().min(1)).default([]);
var OptionalTimestampSchema3 = TimestampSchema3.nullable().optional();
var TerminalStatuses3 = new Set(["succeeded", "failed", "cancelled", "blocked", "skipped"]);
var ContractStatusSchema3 = exports_external3.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
  "unknown"
]);
function contractBaseSchema3(schema) {
  return exports_external3.object({
    schema: exports_external3.literal(schema),
    id: exports_external3.string().min(1),
    createdAt: TimestampSchema3,
    updatedAt: OptionalTimestampSchema3,
    metadata: MetadataSchema3.optional()
  }).strict();
}
var ContractEnvelopeSchema3 = exports_external3.object({
  schema: SchemaIdSchema3,
  id: exports_external3.string().min(1),
  createdAt: TimestampSchema3,
  updatedAt: OptionalTimestampSchema3,
  metadata: MetadataSchema3.optional()
}).strict();
var ActorKindSchema3 = exports_external3.enum([
  "agent",
  "human",
  "service",
  "model",
  "workflow",
  "system"
]);
var ActorRefSchema3 = contractBaseSchema3(SCHEMA_IDS3.actorRef).extend({
  kind: ActorKindSchema3,
  name: exports_external3.string().min(1).optional(),
  provider: exports_external3.string().min(1).optional(),
  accountId: exports_external3.string().min(1).optional(),
  machineId: exports_external3.string().min(1).optional(),
  capabilities: exports_external3.array(exports_external3.string().min(1)).default([])
}).strict();
var ActorPointerSchema3 = exports_external3.object({
  kind: ActorKindSchema3,
  id: exports_external3.string().min(1),
  name: exports_external3.string().min(1).optional(),
  provider: exports_external3.string().min(1).optional(),
  accountId: exports_external3.string().min(1).optional(),
  machineId: exports_external3.string().min(1).optional()
}).strict();
var ResourceKindSchema3 = exports_external3.enum([
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
var ResourceRefSchema3 = contractBaseSchema3(SCHEMA_IDS3.resourceRef).extend({
  kind: ResourceKindSchema3,
  name: exports_external3.string().min(1).optional(),
  uri: UriSchema3.optional(),
  externalId: NonEmptyStringSchema3.optional(),
  sourcePackage: NonEmptyStringSchema3.optional(),
  tags: TagsSchema3
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.externalId && value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Resource refs require uri or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ResourcePointerSchema3 = exports_external3.object({
  kind: ResourceKindSchema3,
  id: exports_external3.string().min(1),
  name: exports_external3.string().min(1).optional(),
  uri: UriSchema3.optional(),
  externalId: NonEmptyStringSchema3.optional(),
  sourcePackage: NonEmptyStringSchema3.optional(),
  tags: TagsSchema3
}).strict().superRefine((value, ctx) => {
  if (!value.uri && Boolean(value.externalId) !== Boolean(value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Resource pointers with external package locators require both sourcePackage and externalId",
      path: value.externalId ? ["sourcePackage"] : ["externalId"]
    });
  }
});
var EvidenceKindSchema3 = exports_external3.enum([
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
var RedactionStateSchema3 = exports_external3.enum(["none", "partial", "full", "unknown"]);
var EvidenceRefSchema3 = contractBaseSchema3(SCHEMA_IDS3.evidenceRef).extend({
  kind: EvidenceKindSchema3,
  uri: UriSchema3,
  sha256: Sha256DigestSchema3.optional(),
  summary: exports_external3.string().min(1).optional(),
  contentType: exports_external3.string().min(1).optional(),
  sizeBytes: exports_external3.number().int().nonnegative().optional(),
  redaction: RedactionStateSchema3.default("unknown"),
  producer: ActorPointerSchema3.optional(),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  tags: TagsSchema3
}).strict();
var EvidencePointerSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  kind: EvidenceKindSchema3.optional(),
  uri: UriSchema3.optional(),
  sha256: Sha256DigestSchema3.optional(),
  summary: exports_external3.string().min(1).optional()
}).strict();
var CostEstimateSchema3 = contractBaseSchema3(SCHEMA_IDS3.costEstimate).extend({
  currency: exports_external3.string().regex(/^[A-Z]{3}$/).default("USD"),
  amountMicros: exports_external3.number().int().nonnegative(),
  provider: exports_external3.string().min(1).optional(),
  model: exports_external3.string().min(1).optional(),
  accountId: exports_external3.string().min(1).optional(),
  promptTokens: exports_external3.number().int().nonnegative().optional(),
  completionTokens: exports_external3.number().int().nonnegative().optional(),
  totalTokens: exports_external3.number().int().nonnegative().optional(),
  basis: exports_external3.enum(["actual", "estimated", "budget", "limit"]).default("estimated"),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.promptTokens !== undefined && value.completionTokens !== undefined && value.totalTokens !== undefined && value.totalTokens !== value.promptTokens + value.completionTokens) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "totalTokens must equal promptTokens plus completionTokens when all are present",
      path: ["totalTokens"]
    });
  }
});
var DecisionStatusSchema3 = exports_external3.enum([
  "allowed",
  "denied",
  "warned",
  "approval_required",
  "selected",
  "skipped",
  "unknown"
]);
var DecisionEnvelopeSchema3 = contractBaseSchema3(SCHEMA_IDS3.decisionEnvelope).extend({
  decisionType: exports_external3.enum([
    "guardrail",
    "model_route",
    "tool_select",
    "budget",
    "secret_access",
    "approval",
    "policy",
    "other"
  ]),
  status: DecisionStatusSchema3,
  actor: ActorPointerSchema3.optional(),
  traceId: exports_external3.string().min(1).optional(),
  inputHash: HashStringSchema3.optional(),
  policyBundleId: exports_external3.string().min(1).optional(),
  selected: exports_external3.array(ResourcePointerSchema3).default([]),
  skipped: exports_external3.array(ResourcePointerSchema3).default([]),
  reason: exports_external3.string().min(1),
  obligations: exports_external3.array(exports_external3.string().min(1)).default([]),
  redactions: exports_external3.array(exports_external3.string().min(1)).default([]),
  costEstimate: CostEstimateSchema3.optional(),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "selected" && value.selected.length === 0) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Selected decisions require at least one selected resource", path: ["selected"] });
  }
  if (value.status === "skipped" && value.skipped.length === 0) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Skipped decisions require at least one skipped resource", path: ["skipped"] });
  }
  if (value.status === "denied") {
    if (value.selected.length > 0) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Denied decisions cannot include selected resources", path: ["selected"] });
    }
    if (!value.policyBundleId && value.evidenceRefs.length === 0 && value.obligations.length === 0) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Denied decisions require policy, evidence, or obligations",
        path: ["policyBundleId"]
      });
    }
  }
  if (value.status === "approval_required" && value.obligations.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Approval-required decisions require actionable obligations",
      path: ["obligations"]
    });
  }
});
var CapabilityCardSchema3 = contractBaseSchema3(SCHEMA_IDS3.capabilityCard).extend({
  kind: exports_external3.enum(["model", "tool", "machine", "agent", "lane", "connector", "service"]),
  name: exports_external3.string().min(1),
  version: exports_external3.string().min(1).optional(),
  status: exports_external3.enum(["available", "unavailable", "degraded", "unknown"]).default("unknown"),
  capabilities: exports_external3.array(exports_external3.string().min(1)).default([]),
  limitations: exports_external3.array(exports_external3.string().min(1)).default([]),
  riskLevel: exports_external3.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  costEstimate: CostEstimateSchema3.optional(),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict();
var ProviderModeSchema3 = exports_external3.enum(["mock", "fixture", "sandbox", "read_only_live", "live_mutating"]);
var ProviderSideEffectClassSchema3 = exports_external3.enum([
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
var CredentialRequirementSchema3 = exports_external3.object({
  refName: NonEmptyStringSchema3,
  requiredForModes: exports_external3.array(ProviderModeSchema3).min(1),
  allowedSecretInputs: exports_external3.array(exports_external3.enum(["credential_ref", "lease_ref"])).min(1).default(["credential_ref"]),
  failClosedDiagnostic: NonEmptyStringSchema3,
  revocationCheck: exports_external3.boolean().default(true)
}).strict();
var ProviderOperationCardSchema3 = exports_external3.object({
  operation: NonEmptyStringSchema3,
  supportedModes: exports_external3.array(ProviderModeSchema3).min(1),
  sideEffectClass: ProviderSideEffectClassSchema3,
  requiresApproval: exports_external3.boolean().default(false),
  requiresIdempotencyKey: exports_external3.boolean().default(false),
  requiresSandboxEvidence: exports_external3.boolean().default(false),
  requiresRollbackOrRevocation: exports_external3.boolean().default(false),
  rollbackOrRevocation: NonEmptyStringSchema3.optional(),
  noSideEffectSmoke: NonEmptyStringSchema3.optional(),
  reconciliation: NonEmptyStringSchema3.optional()
}).strict().superRefine((value, ctx) => {
  if (value.supportedModes.includes("live_mutating")) {
    if (value.sideEffectClass === "none" || value.sideEffectClass === "read_only") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating operations must declare a side-effecting class",
        path: ["sideEffectClass"]
      });
    }
    if (!value.requiresApproval) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating operations require approval",
        path: ["requiresApproval"]
      });
    }
    if (!value.requiresIdempotencyKey) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating operations require idempotency keys",
        path: ["requiresIdempotencyKey"]
      });
    }
    if (!value.requiresSandboxEvidence) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating operations require sandbox evidence before live proof",
        path: ["requiresSandboxEvidence"]
      });
    }
    if (!value.requiresRollbackOrRevocation || !value.rollbackOrRevocation) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating operations require rollback or revocation instructions",
        path: ["rollbackOrRevocation"]
      });
    }
    if (!value.reconciliation) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating operations require reconciliation behavior",
        path: ["reconciliation"]
      });
    }
  }
});
var ProviderCapabilityCardSchema3 = exports_external3.object({
  providerId: NonEmptyStringSchema3,
  appId: NonEmptyStringSchema3,
  adapterId: NonEmptyStringSchema3,
  ownerPackage: NonEmptyStringSchema3,
  modes: exports_external3.array(ProviderModeSchema3).min(1),
  defaultMode: ProviderModeSchema3,
  credentialRequirements: exports_external3.array(CredentialRequirementSchema3).default([]),
  operations: exports_external3.array(ProviderOperationCardSchema3).min(1),
  rateLimitPosture: NonEmptyStringSchema3,
  costPosture: NonEmptyStringSchema3.optional(),
  auditEvents: exports_external3.array(NonEmptyStringSchema3).default([]),
  redactionRules: exports_external3.array(NonEmptyStringSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (!value.modes.includes(value.defaultMode)) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "defaultMode must be one of modes",
      path: ["defaultMode"]
    });
  }
  const operationModes = new Set(value.operations.flatMap((operation) => operation.supportedModes));
  for (const mode of operationModes) {
    if (!value.modes.includes(mode)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `operation mode ${mode} is not declared in provider modes`,
        path: ["operations"]
      });
    }
  }
  if (operationModes.has("live_mutating")) {
    const liveCredential = value.credentialRequirements.some((credential) => credential.requiredForModes.includes("live_mutating"));
    if (!liveCredential) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating providers require at least one live credential reference requirement",
        path: ["credentialRequirements"]
      });
    }
    if (value.auditEvents.length === 0) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "live_mutating providers require audit events",
        path: ["auditEvents"]
      });
    }
  }
});
var ProviderLiveModeTargetSchema3 = exports_external3.object({
  appId: NonEmptyStringSchema3,
  repo: NonEmptyStringSchema3,
  priority: exports_external3.enum(["p0", "p1", "p2"]).default("p1"),
  requiredEvidence: exports_external3.array(NonEmptyStringSchema3).min(1),
  firstOperations: exports_external3.array(NonEmptyStringSchema3).min(1),
  blockedUntil: exports_external3.array(NonEmptyStringSchema3).default([])
}).strict();
var ProviderLiveModeStandardSchema3 = contractBaseSchema3(SCHEMA_IDS3.providerLiveModeStandard).extend({
  name: NonEmptyStringSchema3,
  version: NonEmptyStringSchema3,
  modes: exports_external3.array(ProviderModeSchema3).refine((modes) => ["mock", "fixture", "sandbox", "read_only_live", "live_mutating"].every((mode) => modes.includes(mode)), "provider live-mode standard must include every canonical provider mode"),
  requiredCapabilityFields: exports_external3.array(NonEmptyStringSchema3).min(1),
  liveMutationGate: exports_external3.object({
    requiredMode: exports_external3.literal("live_mutating"),
    requiredChecks: exports_external3.array(NonEmptyStringSchema3).min(1),
    forbiddenBypassSignals: exports_external3.array(NonEmptyStringSchema3).min(1),
    disabledLiveSmoke: NonEmptyStringSchema3
  }).strict(),
  noSideEffectSmoke: exports_external3.object({
    requiredForModes: exports_external3.array(ProviderModeSchema3).min(1),
    commandEvidence: exports_external3.array(NonEmptyStringSchema3).min(1),
    secretOutputScan: exports_external3.boolean().default(true)
  }).strict(),
  credentialPolicy: exports_external3.object({
    acceptedInputs: exports_external3.array(exports_external3.enum(["credential_ref", "lease_ref"])).min(1),
    rawSecretInputsAllowed: exports_external3.literal(false),
    missingCredentialBehavior: exports_external3.literal("fail_closed"),
    revocationCheckRequired: exports_external3.boolean().default(true)
  }).strict(),
  operationCards: exports_external3.array(ProviderCapabilityCardSchema3).min(1),
  firstAdoptionTargets: exports_external3.array(ProviderLiveModeTargetSchema3).min(1),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  const firstTargetApps = new Set(value.firstAdoptionTargets.map((target) => target.appId));
  const operationApps = new Set(value.operationCards.map((card) => card.appId));
  for (const appId of firstTargetApps) {
    if (!operationApps.has(appId)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `first adoption target ${appId} requires a provider capability card`,
        path: ["firstAdoptionTargets"]
      });
    }
  }
});
var ContextPackItemSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  title: exports_external3.string().min(1).optional(),
  summary: exports_external3.string().min(1),
  text: exports_external3.string().optional(),
  tokens: exports_external3.number().int().nonnegative().optional(),
  source: EvidencePointerSchema3,
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([])
}).strict();
var ContextPackSchema3 = contractBaseSchema3(SCHEMA_IDS3.contextPack).extend({
  objective: exports_external3.string().min(1),
  budget: exports_external3.object({
    maxTokens: exports_external3.number().int().positive().optional(),
    maxBytes: exports_external3.number().int().positive().optional()
  }).strict().optional(),
  items: exports_external3.array(ContextPackItemSchema3).default([]),
  citations: exports_external3.array(EvidencePointerSchema3).default([]),
  freshness: exports_external3.enum(["fresh", "stale", "unknown"]).default("unknown"),
  permissions: exports_external3.array(exports_external3.string().min(1)).default([]),
  redactions: exports_external3.array(exports_external3.string().min(1)).default([]),
  conflicts: exports_external3.array(exports_external3.string().min(1)).default([]),
  uncertainty: exports_external3.string().min(1).optional()
}).strict();
var RelativeProjectPathSchema3 = NonEmptyStringSchema3.refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "Project paths must be relative and cannot contain parent-directory segments");
var ProjectSlugSchema3 = exports_external3.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Project slugs must be lowercase dashed identifiers");
var ProjectClassificationSchema3 = exports_external3.enum(["public", "internal", "private", "sensitive"]);
var ProjectStatusSchema3 = exports_external3.enum(["draft", "active", "paused", "archived"]);
var ProjectIntegrationKindSchema3 = exports_external3.enum([
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
var IntegrationRefSchema3 = contractBaseSchema3(SCHEMA_IDS3.integrationRef).extend({
  kind: ProjectIntegrationKindSchema3,
  name: exports_external3.string().min(1),
  projectId: ProjectSlugSchema3.optional(),
  sourcePackage: NonEmptyStringSchema3.optional(),
  externalId: NonEmptyStringSchema3.optional(),
  uri: UriSchema3.optional(),
  enabled: exports_external3.boolean().default(true),
  readOnly: exports_external3.boolean().default(true),
  capabilities: exports_external3.array(exports_external3.string().min(1)).default([]),
  freshness: exports_external3.enum(["fresh", "stale", "unknown"]).default("unknown"),
  resourceRef: ResourcePointerSchema3.optional(),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  config: MetadataSchema3.optional()
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.sourcePackage && value.externalId) && !value.resourceRef) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Integration refs require uri, resourceRef, or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ProjectLayoutSchema3 = exports_external3.object({
  schemaRoot: RelativeProjectPathSchema3.default(".hasna/project"),
  dashboardManifest: RelativeProjectPathSchema3.default(".hasna/project/dashboard.render.json"),
  snapshotsDir: RelativeProjectPathSchema3.default(".hasna/project/snapshots"),
  documentsDir: RelativeProjectPathSchema3.default("documents"),
  reportsDir: RelativeProjectPathSchema3.default("reports"),
  evidenceDir: RelativeProjectPathSchema3.default(".hasna/project/evidence"),
  privateDir: RelativeProjectPathSchema3.default(".hasna/project/private")
}).strict();
var ProjectManifestSchema3 = contractBaseSchema3(SCHEMA_IDS3.projectManifest).extend({
  projectId: ProjectSlugSchema3,
  slug: ProjectSlugSchema3,
  name: exports_external3.string().min(1),
  summary: exports_external3.string().min(1).optional(),
  status: ProjectStatusSchema3.default("active"),
  classification: ProjectClassificationSchema3.default("private"),
  owner: ActorPointerSchema3.optional(),
  layout: ProjectLayoutSchema3.default({}),
  integrations: exports_external3.array(IntegrationRefSchema3).default([]),
  renderManifests: exports_external3.array(ResourcePointerSchema3).default([]),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  tags: TagsSchema3
}).strict().superRefine((value, ctx) => {
  const integrationIds = new Set;
  const renderManifestIds = new Set;
  if (value.projectId !== value.slug) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "projectId and slug must match for canonical project manifests",
      path: ["slug"]
    });
  }
  for (const [index, integration] of value.integrations.entries()) {
    if (integrationIds.has(integration.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project manifest integration ids must be unique",
        path: ["integrations", index, "id"]
      });
    }
    integrationIds.add(integration.id);
    if (integration.projectId && integration.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Integration projectId must match the manifest projectId",
        path: ["integrations", index, "projectId"]
      });
    }
  }
  for (const [index, renderManifest] of value.renderManifests.entries()) {
    if (renderManifest.kind !== "render") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project renderManifests must use resource kind render",
        path: ["renderManifests", index, "kind"]
      });
    }
    if (renderManifestIds.has(renderManifest.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project renderManifest refs must be unique",
        path: ["renderManifests", index, "id"]
      });
    }
    renderManifestIds.add(renderManifest.id);
  }
});
var RenderImportKindSchema3 = exports_external3.enum(["local", "package", "provider", "url"]);
var RenderImportSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  kind: RenderImportKindSchema3,
  specifier: exports_external3.string().min(1),
  path: RelativeProjectPathSchema3.optional(),
  packageName: exports_external3.string().min(1).optional(),
  uri: UriSchema3.optional(),
  provider: ProjectIntegrationKindSchema3.optional(),
  schemaId: SchemaIdSchema3.optional(),
  integrity: HashStringSchema3.optional(),
  resourceRef: ResourcePointerSchema3.optional(),
  optional: exports_external3.boolean().default(false)
}).strict().superRefine((value, ctx) => {
  if (value.kind === "local" && !value.path) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Local render imports require path", path: ["path"] });
  }
  if (value.kind === "package" && !value.packageName) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Package render imports require packageName", path: ["packageName"] });
  }
  if (value.kind === "provider" && !value.provider) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Provider render imports require provider", path: ["provider"] });
  }
  if (value.kind === "url" && !value.uri) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "URL render imports require uri", path: ["uri"] });
  }
});
var RenderViewKindSchema3 = exports_external3.enum(["dashboard", "canvas", "panel", "report", "document", "custom"]);
var RenderViewSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  title: exports_external3.string().min(1),
  kind: RenderViewKindSchema3,
  default: exports_external3.boolean().default(false),
  entry: RelativeProjectPathSchema3.optional(),
  imports: exports_external3.array(RenderImportSchema3).default([]),
  panelRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  dataRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  layout: MetadataSchema3.optional()
}).strict();
var RenderManifestSchema3 = contractBaseSchema3(SCHEMA_IDS3.renderManifest).extend({
  projectId: ProjectSlugSchema3,
  name: exports_external3.string().min(1),
  version: exports_external3.string().min(1),
  manifestPath: RelativeProjectPathSchema3.default(".hasna/project/dashboard.render.json"),
  renderer: exports_external3.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  views: exports_external3.array(RenderViewSchema3).min(1),
  imports: exports_external3.array(RenderImportSchema3).default([]),
  theme: MetadataSchema3.optional(),
  compatibility: exports_external3.object({
    minProjectsVersion: exports_external3.string().min(1).optional(),
    minContractsVersion: exports_external3.string().min(1).optional()
  }).strict().optional(),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  const defaults = value.views.filter((view) => view.default);
  const viewIds = new Set;
  const importIds = new Set;
  if (defaults.length > 1) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Render manifests can have at most one default view", path: ["views"] });
  }
  for (const [index, importRef] of value.imports.entries()) {
    if (importIds.has(importRef.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Render manifest import ids must be unique",
        path: ["imports", index, "id"]
      });
    }
    importIds.add(importRef.id);
  }
  for (const [viewIndex, view] of value.views.entries()) {
    if (viewIds.has(view.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Render manifest view ids must be unique",
        path: ["views", viewIndex, "id"]
      });
    }
    viewIds.add(view.id);
    const viewImportIds = new Set;
    for (const [importIndex, importRef] of view.imports.entries()) {
      if (viewImportIds.has(importRef.id)) {
        ctx.addIssue({
          code: exports_external3.ZodIssueCode.custom,
          message: "Render view import ids must be unique",
          path: ["views", viewIndex, "imports", importIndex, "id"]
        });
      }
      viewImportIds.add(importRef.id);
    }
    for (const [panelIndex, panelRef] of view.panelRefs.entries()) {
      if (panelRef.kind !== "panel") {
        ctx.addIssue({
          code: exports_external3.ZodIssueCode.custom,
          message: "Render view panelRefs must use resource kind panel",
          path: ["views", viewIndex, "panelRefs", panelIndex, "kind"]
        });
      }
    }
  }
});
var ProjectPanelStateSchema3 = exports_external3.enum(["ready", "empty", "loading", "error", "auth_required", "unavailable", "stale"]);
var ProjectPanelKindSchema3 = exports_external3.enum([
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
var ProjectPanelMetricSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  label: exports_external3.string().min(1),
  value: exports_external3.union([exports_external3.string(), exports_external3.number(), exports_external3.boolean()]),
  unit: exports_external3.string().min(1).optional(),
  status: exports_external3.enum(["good", "warning", "critical", "unknown"]).default("unknown"),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([])
}).strict();
var ProjectPanelItemSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  title: exports_external3.string().min(1),
  summary: exports_external3.string().min(1).optional(),
  status: exports_external3.string().min(1).optional(),
  priority: exports_external3.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  timestamp: TimestampSchema3.optional(),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  metadata: MetadataSchema3.optional()
}).strict();
var ProjectRenderFragmentSchema3 = exports_external3.object({
  renderer: exports_external3.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  title: exports_external3.string().min(1).optional(),
  entry: RelativeProjectPathSchema3.optional(),
  imports: exports_external3.array(RenderImportSchema3).default([]),
  spec: MetadataSchema3.default({})
}).strict();
var ProjectPanelSchema3 = contractBaseSchema3(SCHEMA_IDS3.projectPanel).extend({
  projectId: ProjectSlugSchema3,
  provider: exports_external3.object({
    kind: ProjectIntegrationKindSchema3,
    id: exports_external3.string().min(1),
    name: exports_external3.string().min(1).optional(),
    sourcePackage: NonEmptyStringSchema3.optional(),
    externalId: NonEmptyStringSchema3.optional()
  }).strict(),
  kind: ProjectPanelKindSchema3,
  title: exports_external3.string().min(1),
  summary: exports_external3.string().min(1).optional(),
  state: ProjectPanelStateSchema3.default("ready"),
  stateReason: exports_external3.string().min(1).optional(),
  generatedAt: TimestampSchema3,
  freshness: exports_external3.enum(["fresh", "stale", "unknown"]).default("unknown"),
  metrics: exports_external3.array(ProjectPanelMetricSchema3).default([]),
  items: exports_external3.array(ProjectPanelItemSchema3).default([]),
  actions: exports_external3.array(ResourcePointerSchema3).default([]),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  renderFragment: ProjectRenderFragmentSchema3.optional(),
  warnings: exports_external3.array(exports_external3.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  const reasonStates = new Set(["error", "auth_required", "unavailable", "stale"]);
  const metricIds = new Set;
  const itemIds = new Set;
  if (reasonStates.has(value.state) && !value.stateReason) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Non-ready provider states require stateReason",
      path: ["stateReason"]
    });
  }
  if (value.state === "ready" && value.metrics.length === 0 && value.items.length === 0 && !value.renderFragment) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Ready panels require metrics, items, or a renderFragment; use state=empty for empty panels",
      path: ["state"]
    });
  }
  for (const [index, metric] of value.metrics.entries()) {
    if (metricIds.has(metric.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project panel metric ids must be unique",
        path: ["metrics", index, "id"]
      });
    }
    metricIds.add(metric.id);
  }
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project panel item ids must be unique",
        path: ["items", index, "id"]
      });
    }
    itemIds.add(item.id);
  }
  for (const [index, action] of value.actions.entries()) {
    if (action.kind !== "action") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project panel actions must use resource kind action",
        path: ["actions", index, "kind"]
      });
    }
  }
});
var ProjectSnapshotSchema3 = contractBaseSchema3(SCHEMA_IDS3.projectSnapshot).extend({
  projectId: ProjectSlugSchema3,
  generatedAt: TimestampSchema3,
  status: ContractStatusSchema3.default("unknown"),
  manifestRef: ResourcePointerSchema3,
  renderManifestRef: ResourcePointerSchema3.optional(),
  panels: exports_external3.array(ProjectPanelSchema3).default([]),
  contextPacks: exports_external3.array(ContextPackSchema3).default([]),
  proofBundleRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  warnings: exports_external3.array(exports_external3.string().min(1)).default([]),
  freshness: exports_external3.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  const panelIds = new Set;
  const contextPackIds = new Set;
  if (value.manifestRef.kind !== "project") {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Project snapshot manifestRef must use resource kind project",
      path: ["manifestRef", "kind"]
    });
  }
  if (value.renderManifestRef && value.renderManifestRef.kind !== "render") {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Project snapshot renderManifestRef must use resource kind render",
      path: ["renderManifestRef", "kind"]
    });
  }
  for (const [index, proofBundleRef] of value.proofBundleRefs.entries()) {
    if (proofBundleRef.kind !== "proof_bundle") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project snapshot proofBundleRefs must use resource kind proof_bundle",
        path: ["proofBundleRefs", index, "kind"]
      });
    }
  }
  for (const [index, panel] of value.panels.entries()) {
    if (panel.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Panel projectId must match snapshot projectId",
        path: ["panels", index, "projectId"]
      });
    }
    if (panelIds.has(panel.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project snapshot panel ids must be unique",
        path: ["panels", index, "id"]
      });
    }
    panelIds.add(panel.id);
  }
  for (const [index, contextPack] of value.contextPacks.entries()) {
    if (contextPackIds.has(contextPack.id)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Project snapshot context pack ids must be unique",
        path: ["contextPacks", index, "id"]
      });
    }
    contextPackIds.add(contextPack.id);
  }
});
var ValidationCheckSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  kind: exports_external3.enum(["command", "test", "typecheck", "lint", "eval", "security", "review", "deploy", "smoke", "manual", "other"]),
  required: exports_external3.boolean().default(true),
  command: exports_external3.string().min(1).optional(),
  expected: exports_external3.string().min(1).optional(),
  timeoutMs: exports_external3.number().int().positive().optional(),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  const actionableKinds = new Set(["command", "test", "typecheck", "lint", "smoke", "eval"]);
  if (actionableKinds.has(value.kind) && !value.command && !value.expected) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Actionable validation checks require command or expected",
      path: ["command"]
    });
  }
});
var ValidationPlanSchema3 = contractBaseSchema3(SCHEMA_IDS3.validationPlan).extend({
  objective: exports_external3.string().min(1),
  subject: ResourcePointerSchema3.optional(),
  checks: exports_external3.array(ValidationCheckSchema3).min(1),
  verifier: ActorPointerSchema3.optional(),
  requiredEvidenceKinds: exports_external3.array(EvidenceKindSchema3).default([])
}).strict();
var ScaffoldTypeSchema3 = exports_external3.enum([
  "open_source",
  "internal_app",
  "platform",
  "app",
  "agent",
  "content",
  "overlay",
  "other"
]);
var ScaffoldStatusSchema3 = exports_external3.enum(["draft", "active", "deprecated", "archived"]);
var ScaffoldCapabilitySchema3 = exports_external3.enum([
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
var ScaffoldEnvVarSchema3 = exports_external3.object({
  key: exports_external3.string().regex(/^[A-Z][A-Z0-9_]*$/),
  description: exports_external3.string().min(1),
  required: exports_external3.boolean().default(false),
  ["secret"]: exports_external3.boolean().default(false),
  group: exports_external3.string().min(1).optional(),
  default: exports_external3.string().optional()
}).strict().superRefine((value, ctx) => {
  if (value.secret && value.default !== undefined) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Secret scaffold env vars cannot include defaults",
      path: ["default"]
    });
  }
});
var ScaffoldScriptSchema3 = exports_external3.object({
  name: exports_external3.string().min(1),
  command: exports_external3.string().min(1),
  description: exports_external3.string().min(1).optional(),
  required: exports_external3.boolean().default(false)
}).strict();
var ScaffoldOutputShapeSchema3 = exports_external3.object({
  packageManager: exports_external3.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  languages: exports_external3.array(exports_external3.string().min(1)).default([]),
  requiredFiles: exports_external3.array(exports_external3.string().min(1)).default([]),
  requiredDirectories: exports_external3.array(exports_external3.string().min(1)).default([]),
  optionalDirectories: exports_external3.array(exports_external3.string().min(1)).default([])
}).strict();
var ScaffoldManifestSchema3 = contractBaseSchema3(SCHEMA_IDS3.scaffoldManifest).extend({
  name: exports_external3.string().min(1),
  version: exports_external3.string().min(1),
  summary: exports_external3.string().min(1),
  type: ScaffoldTypeSchema3,
  status: ScaffoldStatusSchema3.default("draft"),
  capabilities: exports_external3.array(ScaffoldCapabilitySchema3).default([]),
  techStack: exports_external3.array(exports_external3.string().min(1)).default([]),
  tags: TagsSchema3,
  source: ResourcePointerSchema3.optional(),
  output: ScaffoldOutputShapeSchema3,
  env: exports_external3.array(ScaffoldEnvVarSchema3).default([]),
  scripts: exports_external3.array(ScaffoldScriptSchema3).default([]),
  validationChecks: exports_external3.array(ValidationCheckSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.source?.uri?.startsWith("file://")) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Public scaffold manifest source refs cannot use local file:// URIs",
      path: ["source", "uri"]
    });
  }
  if (value.status === "active" && value.validationChecks.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Active scaffold manifests require validation checks",
      path: ["validationChecks"]
    });
  }
  if (value.status === "active" && value.output.requiredFiles.length === 0 && value.output.requiredDirectories.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Active scaffold manifests require at least one required file or directory",
      path: ["output"]
    });
  }
});
var ScaffoldInstallStatusSchema3 = exports_external3.enum(["installed", "failed", "cancelled", "partial", "unknown"]);
var ScaffoldInstallRecordSchema3 = contractBaseSchema3(SCHEMA_IDS3.scaffoldInstallRecord).extend({
  scaffoldId: exports_external3.string().min(1),
  scaffoldVersion: exports_external3.string().min(1).optional(),
  manifestRef: ResourcePointerSchema3.optional(),
  target: ResourcePointerSchema3,
  status: ScaffoldInstallStatusSchema3,
  installedAt: TimestampSchema3.optional(),
  installer: ActorPointerSchema3.optional(),
  packageManager: exports_external3.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  options: MetadataSchema3.optional(),
  generatedFiles: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  proofBundleRefs: exports_external3.array(ResourcePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "installed" && !value.installedAt) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Installed scaffold records require installedAt",
      path: ["installedAt"]
    });
  }
  if (value.status === "installed" && value.generatedFiles.length === 0 && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Installed scaffold records require generated files, evidence, or proof bundle refs",
      path: ["generatedFiles"]
    });
  }
  if ((value.status === "failed" || value.status === "partial") && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Failed or partial scaffold records require evidence or proof bundle refs",
      path: ["evidenceRefs"]
    });
  }
});
var AppIdSchema3 = exports_external3.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "App ids must be lowercase dashed identifiers");
var NpmPackageNameSchema3 = exports_external3.string().regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, "Must be a valid npm package name");
var SemverSchema3 = exports_external3.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, "Must be a semver version");
var GitShaSchema3 = exports_external3.string().regex(/^[0-9a-f]{7,40}$/, "Must be a lowercase git sha (7-40 hex chars)");
var GithubUrlSchema3 = NonEmptyStringSchema3.refine((value) => value.startsWith("https://github.com/") || value.startsWith("git+https://github.com/"), "GitHub URLs must start with https://github.com/ or git+https://github.com/");
var AppLifecycleSchema3 = exports_external3.enum(["active", "stub", "deprecated", "archived"]);
var ReleaseChannelSchema3 = exports_external3.enum(["stable", "beta", "canary", "internal"]);
var AppMcpSurfaceSchema3 = exports_external3.object({
  transport: exports_external3.enum(["http", "stdio"]).default("http"),
  bin: exports_external3.string().min(1).optional(),
  url: UriSchema3.optional()
}).strict();
var AppHttpSurfaceSchema3 = exports_external3.object({
  healthPath: exports_external3.string().min(1).default("/health"),
  port: exports_external3.number().int().positive().optional(),
  baseUrl: UriSchema3.optional()
}).strict();
var AppSurfacesSchema3 = exports_external3.object({
  bins: exports_external3.array(exports_external3.string().min(1)).default([]),
  mcp: AppMcpSurfaceSchema3.optional(),
  http: AppHttpSurfaceSchema3.optional()
}).strict();
var AppSchema3 = contractBaseSchema3(SCHEMA_IDS3.app).extend({
  appId: AppIdSchema3,
  npmName: NpmPackageNameSchema3,
  repoFolder: AppIdSchema3,
  githubUrl: GithubUrlSchema3,
  projectSlug: ProjectSlugSchema3,
  surfaces: AppSurfacesSchema3.default({}),
  lifecycle: AppLifecycleSchema3,
  releaseChannel: ReleaseChannelSchema3.default("stable"),
  summary: exports_external3.string().min(1).optional(),
  tags: TagsSchema3
}).strict().superRefine((value, ctx) => {
  const seenBins = new Set;
  for (const [index, bin] of value.surfaces.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "App surface bins must be unique",
        path: ["surfaces", "bins", index]
      });
    }
    seenBins.add(bin);
  }
});
var PublishPathSchema3 = exports_external3.enum(["skill", "ci", "backfilled"]);
var ReleaseSchema3 = contractBaseSchema3(SCHEMA_IDS3.release).extend({
  appId: AppIdSchema3,
  package: NpmPackageNameSchema3,
  version: SemverSchema3,
  gitSha: GitShaSchema3,
  publishedAt: TimestampSchema3,
  publishPath: PublishPathSchema3,
  changelogRef: ResourcePointerSchema3.optional(),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.publishPath !== "backfilled" && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "skill and ci releases require publish evidence; only backfilled releases may omit it",
      path: ["evidenceRefs"]
    });
  }
});
var RolloutActionSchema3 = exports_external3.enum(["install", "update", "rollback", "freeze-blocked"]);
var RolloutVerificationSchema3 = exports_external3.object({
  cliVersion: exports_external3.string().min(1).optional(),
  mcpHealth: exports_external3.enum(["ok", "degraded", "unavailable", "not_checked"]).optional()
}).strict().superRefine((value, ctx) => {
  if (!value.cliVersion && value.mcpHealth === undefined) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Rollout verification requires at least one concrete verifier field"
    });
  }
});
var RolloutRecordSchema3 = contractBaseSchema3(SCHEMA_IDS3.rolloutRecord).extend({
  appId: AppIdSchema3,
  package: NpmPackageNameSchema3,
  version: SemverSchema3,
  machine: NonEmptyStringSchema3,
  action: RolloutActionSchema3,
  result: ContractStatusSchema3,
  verifiedBy: RolloutVerificationSchema3.optional(),
  at: TimestampSchema3,
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.action === "freeze-blocked" && value.result !== "blocked" && value.result !== "skipped") {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "freeze-blocked rollout records must report result blocked or skipped",
      path: ["result"]
    });
  }
  const hasConcreteVerification = Boolean(value.verifiedBy?.cliVersion) || value.verifiedBy?.mcpHealth !== undefined && value.verifiedBy.mcpHealth !== "not_checked";
  const hasVerifierFields = value.verifiedBy ? Object.keys(value.verifiedBy).length > 0 : false;
  if ((value.action === "install" || value.action === "update") && value.result === "succeeded" && (!value.verifiedBy || hasVerifierFields && !hasConcreteVerification)) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Succeeded install/update rollout records require concrete verification",
      path: ["verifiedBy"]
    });
  }
});
var AnnouncementChannelKindSchema3 = exports_external3.enum([
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
var AnnouncementDeliveryStatusSchema3 = exports_external3.enum([
  "pending",
  "queued",
  "sent",
  "failed",
  "skipped",
  "suppressed"
]);
var AnnouncementChannelSchema3 = exports_external3.object({
  channel: AnnouncementChannelKindSchema3,
  status: AnnouncementDeliveryStatusSchema3,
  deliveredAt: TimestampSchema3.optional(),
  detail: exports_external3.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if (value.status === "sent" && !value.deliveredAt) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Sent announcement channels require deliveredAt",
      path: ["deliveredAt"]
    });
  }
  if (value.status === "failed" && !value.detail) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Failed announcement channels require detail",
      path: ["detail"]
    });
  }
});
var AnnouncementSchema3 = contractBaseSchema3(SCHEMA_IDS3.announcement).extend({
  campaignId: NonEmptyStringSchema3,
  appId: AppIdSchema3.optional(),
  releaseRef: ResourcePointerSchema3.optional(),
  channels: exports_external3.array(AnnouncementChannelSchema3).min(1),
  audienceRef: ResourcePointerSchema3,
  sentAt: TimestampSchema3
}).strict().superRefine((value, ctx) => {
  if (value.releaseRef && value.releaseRef.kind !== "release") {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Announcement releaseRef must use resource kind release",
      path: ["releaseRef", "kind"]
    });
  }
  if (value.audienceRef.kind !== "audience") {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Announcement audienceRef must use resource kind audience",
      path: ["audienceRef", "kind"]
    });
  }
});
var AudiencePredicateKindSchema3 = exports_external3.enum(["tag", "attribute", "group"]);
var AudiencePredicateOpSchema3 = exports_external3.enum(["eq", "neq", "in", "not_in", "exists", "not_exists"]);
var AudiencePredicateValueSchema3 = exports_external3.union([exports_external3.string(), exports_external3.number(), exports_external3.boolean()]);
var AudiencePredicateSchema3 = exports_external3.object({
  kind: AudiencePredicateKindSchema3,
  key: exports_external3.string().min(1).optional(),
  op: AudiencePredicateOpSchema3.default("eq"),
  value: AudiencePredicateValueSchema3.optional(),
  values: exports_external3.array(AudiencePredicateValueSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.kind === "attribute" && !value.key) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Attribute predicates require key",
      path: ["key"]
    });
  }
  if ((value.op === "eq" || value.op === "neq") && value.value === undefined) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "eq/neq predicates require value",
      path: ["value"]
    });
  }
  if ((value.op === "in" || value.op === "not_in") && value.values.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "in/not_in predicates require values",
      path: ["values"]
    });
  }
});
var AudienceDefinitionSchema3 = exports_external3.object({
  match: exports_external3.enum(["all", "any"]).default("all"),
  predicates: exports_external3.array(AudiencePredicateSchema3).min(1)
}).strict();
var ConsentPolicySchema3 = exports_external3.enum(["opt_in", "opt_out", "transactional", "none"]);
var AudienceSchema3 = contractBaseSchema3(SCHEMA_IDS3.audience).extend({
  audienceId: AppIdSchema3,
  name: NonEmptyStringSchema3,
  definition: AudienceDefinitionSchema3,
  consentPolicy: ConsentPolicySchema3,
  suppressionSyncedAt: OptionalTimestampSchema3
}).strict();
var FORBIDDEN_SHARED_CLOUD_RUNTIMES3 = ["@hasna/cloud", "open-cloud"];
var AppCloudProviderSchema3 = exports_external3.enum([
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
var AppCloudResourceSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  provider: AppCloudProviderSchema3,
  kind: exports_external3.enum([
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
  ownerPackage: exports_external3.string().min(1),
  region: exports_external3.string().min(1).optional(),
  accountId: exports_external3.string().min(1).optional(),
  uri: UriSchema3.optional(),
  machineScoped: exports_external3.boolean().default(false)
}).strict();
var AppCloudManifestSchema3 = contractBaseSchema3(SCHEMA_IDS3.appCloudManifest).extend({
  packageName: exports_external3.string().min(1),
  packageVersion: exports_external3.string().min(1).optional(),
  appId: exports_external3.string().min(1),
  repository: ResourcePointerSchema3.optional(),
  storageMode: exports_external3.enum(["local_only", "app_owned_cloud", "hybrid_local_cache", "external_service"]),
  cloudBoundary: exports_external3.enum(["none", "app_owned", "external_service", "local_cache"]),
  cloudResources: exports_external3.array(AppCloudResourceSchema3).default([]),
  localCache: exports_external3.object({
    path: exports_external3.string().min(1).optional(),
    pullMode: exports_external3.enum(["manual", "daemon", "ci", "none"]).default("manual"),
    conflictPolicy: exports_external3.enum(["cloud_wins", "local_wins", "merge", "manual_review"]).default("manual_review")
  }).strict().optional(),
  forbiddenSharedRuntimes: exports_external3.array(exports_external3.string().min(1)).default([...FORBIDDEN_SHARED_CLOUD_RUNTIMES3]),
  dependencies: exports_external3.array(exports_external3.string().min(1)).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  const effectiveForbiddenRuntimes = new Set([...FORBIDDEN_SHARED_CLOUD_RUNTIMES3, ...value.forbiddenSharedRuntimes]);
  if (effectiveForbiddenRuntimes.has(value.packageName)) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "App-owned cloud manifests cannot be for a forbidden runtime",
      path: ["packageName"]
    });
  }
  for (const runtime of FORBIDDEN_SHARED_CLOUD_RUNTIMES3) {
    if (!value.forbiddenSharedRuntimes.includes(runtime)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `forbiddenSharedRuntimes must include ${runtime}`,
        path: ["forbiddenSharedRuntimes"]
      });
    }
  }
  for (const runtime of effectiveForbiddenRuntimes) {
    if (value.dependencies.includes(runtime)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `App-owned cloud manifests cannot depend on ${runtime}`,
        path: ["dependencies"]
      });
    }
  }
  if (value.storageMode === "local_only" && value.cloudBoundary !== "none") {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "local_only storage requires cloudBoundary none",
      path: ["cloudBoundary"]
    });
  }
  if (value.storageMode === "app_owned_cloud" && value.cloudBoundary !== "app_owned") {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "app_owned_cloud storage requires cloudBoundary app_owned",
      path: ["cloudBoundary"]
    });
  }
  if (value.storageMode === "hybrid_local_cache") {
    if (value.cloudBoundary !== "local_cache") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "hybrid_local_cache storage requires cloudBoundary local_cache",
        path: ["cloudBoundary"]
      });
    }
    if (!value.localCache) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "hybrid_local_cache storage requires localCache settings",
        path: ["localCache"]
      });
    }
  }
  if (value.storageMode === "external_service") {
    if (value.cloudBoundary !== "external_service") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "external_service storage requires cloudBoundary external_service",
        path: ["cloudBoundary"]
      });
    }
    if (value.cloudResources.length > 0) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "external_service storage must not declare app-owned cloudResources",
        path: ["cloudResources"]
      });
    }
  }
  if ((value.storageMode === "app_owned_cloud" || value.storageMode === "hybrid_local_cache") && value.cloudResources.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Cloud-backed storage modes require explicit app-owned cloudResources",
      path: ["cloudResources"]
    });
  }
  if (value.cloudBoundary === "none" && value.cloudResources.length > 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "cloudBoundary none cannot declare cloudResources",
      path: ["cloudResources"]
    });
  }
  value.cloudResources.forEach((resource, index) => {
    if (resource.ownerPackage !== value.packageName) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Cloud resources must be owned by the app package that declares the manifest",
        path: ["cloudResources", index, "ownerPackage"]
      });
    }
  });
});
var NoCloudCheckKindSchema3 = exports_external3.enum([
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
var NoCloudFindingSeveritySchema3 = exports_external3.enum(["low", "medium", "high", "critical"]);
var NoCloudFindingSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  kind: NoCloudCheckKindSchema3,
  severity: NoCloudFindingSeveritySchema3,
  path: exports_external3.string().min(1).optional(),
  packageName: exports_external3.string().min(1).optional(),
  pattern: exports_external3.string().min(1),
  message: exports_external3.string().min(1),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict();
var NoCloudCheckResultSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  kind: NoCloudCheckKindSchema3,
  status: ContractStatusSchema3,
  target: exports_external3.string().min(1),
  command: exports_external3.string().min(1).optional(),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  findings: exports_external3.array(NoCloudFindingSchema3).default([])
}).strict();
var NoCloudEvidencePackSchema3 = contractBaseSchema3(SCHEMA_IDS3.noCloudEvidencePack).extend({
  subject: ResourcePointerSchema3,
  packageName: exports_external3.string().min(1).optional(),
  packageVersion: exports_external3.string().min(1).optional(),
  generatedBy: ActorPointerSchema3.optional(),
  scanMode: exports_external3.enum(["source_tree", "packed_artifact", "published_metadata", "runtime_config", "workspace", "ci"]),
  status: ContractStatusSchema3,
  verdict: exports_external3.enum(["passed", "failed", "warning", "not_run"]),
  appCloudManifest: AppCloudManifestSchema3.optional(),
  checks: exports_external3.array(NoCloudCheckResultSchema3).min(1),
  findings: exports_external3.array(NoCloudFindingSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  const allFindings = [...value.findings, ...value.checks.flatMap((check) => check.findings)];
  const blockingFindings = allFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Passed no-cloud evidence requires succeeded status", path: ["status"] });
    }
    if (blockingFindings.length > 0) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Passed no-cloud evidence cannot include high or critical findings", path: ["findings"] });
    }
    if (value.checks.some((check) => check.status !== "succeeded")) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Passed no-cloud evidence requires every check to be succeeded", path: ["checks"] });
    }
  }
  if (value.verdict === "failed" && allFindings.length === 0) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Failed no-cloud evidence requires findings", path: ["findings"] });
  }
  if (value.status === "succeeded" && value.checks.some((check) => check.status === "failed")) {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Succeeded no-cloud evidence cannot contain failed checks", path: ["checks"] });
  }
  value.checks.forEach((check, index) => {
    const checkBlockingFindings = check.findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
    if (check.status === "succeeded" && checkBlockingFindings.length > 0) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Succeeded no-cloud checks cannot contain high or critical findings",
        path: ["checks", index, "findings"]
      });
    }
  });
});
var ProofCheckResultSchema3 = exports_external3.object({
  checkId: exports_external3.string().min(1),
  status: ContractStatusSchema3,
  summary: exports_external3.string().min(1).optional(),
  startedAt: OptionalTimestampSchema3,
  finishedAt: OptionalTimestampSchema3,
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict();
var ProofBundleSchema3 = contractBaseSchema3(SCHEMA_IDS3.proofBundle).extend({
  subject: ResourcePointerSchema3,
  validationPlanRef: ResourcePointerSchema3.optional(),
  status: ContractStatusSchema3,
  verdict: exports_external3.enum(["passed", "failed", "inconclusive", "not_run"]).default("inconclusive"),
  checks: exports_external3.array(ProofCheckResultSchema3).default([]),
  verifier: ActorPointerSchema3.optional(),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  residualRisks: exports_external3.array(exports_external3.string().min(1)).default([]),
  freshness: exports_external3.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Passed proof bundles must have status succeeded",
        path: ["status"]
      });
    }
    if (value.checks.length === 0) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Passed proof bundles require at least one check result",
        path: ["checks"]
      });
    }
    value.checks.forEach((check, index) => {
      if (check.status !== "succeeded") {
        ctx.addIssue({
          code: exports_external3.ZodIssueCode.custom,
          message: "Passed proof bundles require all checks to have status succeeded",
          path: ["checks", index, "status"]
        });
      }
    });
    const hasEvidence = value.evidenceRefs.length > 0 || value.checks.some((check) => check.evidenceRefs.length > 0);
    if (!hasEvidence) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Passed proof bundles require evidence",
        path: ["evidenceRefs"]
      });
    }
    if (!value.verifier) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Passed proof bundles require a verifier",
        path: ["verifier"]
      });
    }
  }
  if (value.verdict === "not_run" && value.checks.length > 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Not-run proof bundles cannot include check results",
      path: ["checks"]
    });
  }
  if (value.verdict === "failed" && !value.checks.some((check) => check.status === "failed") && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Failed proof bundles require a failed check or evidence",
      path: ["checks"]
    });
  }
});
var WorkRunSchema3 = contractBaseSchema3(SCHEMA_IDS3.workRun).extend({
  objective: exports_external3.string().min(1),
  status: ContractStatusSchema3,
  actor: ActorPointerSchema3,
  traceId: exports_external3.string().min(1).optional(),
  startedAt: OptionalTimestampSchema3,
  finishedAt: OptionalTimestampSchema3,
  constraints: exports_external3.array(exports_external3.string().min(1)).default([]),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  decisions: exports_external3.array(DecisionEnvelopeSchema3).default([]),
  costEstimates: exports_external3.array(CostEstimateSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  validationPlanRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  proofBundleRefs: exports_external3.array(ResourcePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.startedAt && value.finishedAt && Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "finishedAt must be after or equal to startedAt",
      path: ["finishedAt"]
    });
  }
  if (TerminalStatuses3.has(value.status) && !value.finishedAt) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Terminal work runs require finishedAt",
      path: ["finishedAt"]
    });
  }
  const hasEvidence = value.evidenceRefs.length > 0 || value.proofBundleRefs.length > 0;
  if (value.status === "succeeded" && !hasEvidence) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Succeeded work runs require evidence or a proof bundle",
      path: ["evidenceRefs"]
    });
  }
  if ((value.status === "failed" || value.status === "blocked") && !hasEvidence && value.decisions.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Failed or blocked work runs require evidence, a proof bundle, or a decision record",
      path: ["evidenceRefs"]
    });
  }
});
var TrajectoryEventSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  at: TimestampSchema3,
  kind: exports_external3.enum(["message", "tool_call", "command", "file_change", "error", "test", "decision", "verification", "status", "other"]),
  summary: exports_external3.string().min(1),
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([]),
  costEstimate: CostEstimateSchema3.optional()
}).strict();
var AgentTrajectorySchema3 = contractBaseSchema3(SCHEMA_IDS3.agentTrajectory).extend({
  actor: ActorPointerSchema3,
  workRunRef: ResourcePointerSchema3.optional(),
  events: exports_external3.array(TrajectoryEventSchema3).default([]),
  outcome: exports_external3.enum(["succeeded", "failed", "cancelled", "blocked", "unknown"]).default("unknown"),
  proofBundleRef: ResourcePointerSchema3.optional()
}).strict();
var SERVICE_CONTRACT_VERSION3 = "v1";
var RepoClassSchema3 = exports_external3.enum(["library", "cli-with-store", "service", "saas"]);
var DEPLOYMENT_MODES3 = ["local", "self-hosted", "cloud"];
var DeploymentModeSchema3 = exports_external3.enum(DEPLOYMENT_MODES3);
var ServiceSurfaceStatusSchema3 = exports_external3.enum(["supported", "deferred", "unsupported"]);
var ServiceAuthModeSchema3 = exports_external3.enum(["none", "local-only", "api-key", "session", "service-token", "custom"]);
var ServiceEndpointSchema3 = exports_external3.object({
  method: exports_external3.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: exports_external3.string().regex(/^\/[A-Za-z0-9_./:*-]*$/, "Endpoint paths must be absolute HTTP paths"),
  public: exports_external3.boolean().default(false),
  description: exports_external3.string().min(1).optional()
}).strict();
var DeploymentReadinessGateSchema3 = exports_external3.object({
  id: exports_external3.string().min(1),
  kind: exports_external3.enum(["auth", "storage", "secret-ref", "migration", "health", "readiness", "redaction", "smoke", "operator", "other"]),
  required: exports_external3.boolean().default(true),
  command: exports_external3.string().min(1).optional(),
  evidenceRef: EvidencePointerSchema3.optional(),
  status: exports_external3.enum(["pending", "passed", "failed", "blocked", "deferred"]).default("pending"),
  summary: exports_external3.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if ((value.status === "passed" || value.status === "failed" || value.status === "blocked") && !value.command && !value.evidenceRef && !value.summary) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Terminal readiness gates require command, evidenceRef, or summary",
      path: ["status"]
    });
  }
});
var ServiceSurfaceSchema3 = exports_external3.object({
  name: exports_external3.string().min(1),
  status: ServiceSurfaceStatusSchema3,
  bin: exports_external3.string().min(1).optional(),
  mcpBin: exports_external3.string().min(1).optional(),
  authMode: ServiceAuthModeSchema3,
  deploymentModes: exports_external3.array(DeploymentModeSchema3).min(1),
  health: ServiceEndpointSchema3.optional(),
  readiness: ServiceEndpointSchema3.optional(),
  version: ServiceEndpointSchema3.optional(),
  apiBasePath: exports_external3.string().regex(/^\/v[0-9]+$/, "Stable API base path must be /vN").optional(),
  openApiPath: exports_external3.string().regex(/^\/[A-Za-z0-9_./:-]*$/).optional(),
  deferReason: exports_external3.string().min(1).optional(),
  readinessGates: exports_external3.array(DeploymentReadinessGateSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "supported") {
    if (!value.bin) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Supported service surfaces require a serve bin", path: ["bin"] });
    }
    if (!value.health) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Supported service surfaces require a health endpoint", path: ["health"] });
    }
    if (!value.version) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Supported service surfaces require a version endpoint", path: ["version"] });
    }
  }
  if ((value.status === "deferred" || value.status === "unsupported") && !value.deferReason) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Deferred or unsupported service surfaces require a deferReason",
      path: ["deferReason"]
    });
  }
  if (value.health && value.health.path !== "/health") {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Health endpoint must be /health", path: ["health", "path"] });
  }
  if (value.readiness && value.readiness.path !== "/ready") {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Readiness endpoint must be /ready", path: ["readiness", "path"] });
  }
  if (value.version && value.version.path !== "/version") {
    ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Version endpoint must be /version", path: ["version", "path"] });
  }
});
var STORAGE_MODES3 = ["local", "cloud"];
var StorageModeSchema3 = exports_external3.enum(STORAGE_MODES3);
var DEPRECATED_STORAGE_MODE_ALIASES2 = ["remote", "hybrid", "self_hosted"];
var AppNameSchema3 = exports_external3.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "App names must be lowercase dashed identifiers");
var ALLOWED_BIN_SUFFIXES3 = [
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
function allowedBinsForName3(name) {
  return ALLOWED_BIN_SUFFIXES3.map((suffix) => `${name}${suffix}`);
}
function databaseUrlSecretRefFor3(name) {
  return `hasna/oss/${name}/database-url`;
}
var StorageContractSchema3 = exports_external3.object({
  mode: StorageModeSchema3,
  envPrefix: exports_external3.string().regex(/^HASNA_[A-Z][A-Z0-9]*_$/).optional(),
  aliasEnvPrefix: exports_external3.string().regex(/^[A-Z][A-Z0-9]*_$/).optional(),
  databaseUrlSecretRef: exports_external3.string().regex(/^hasna\/oss\/[a-z0-9-]+\/database-url$/).optional(),
  sqlitePath: exports_external3.string().min(1).optional()
}).strict();
var ServiceContractManifestSchema3 = exports_external3.object({
  $schema: exports_external3.string().min(1).optional(),
  schema: exports_external3.literal(SCHEMA_IDS3.serviceContract),
  name: AppNameSchema3,
  class: RepoClassSchema3,
  contractVersion: exports_external3.literal(SERVICE_CONTRACT_VERSION3),
  kitVersion: exports_external3.string().min(1),
  description: exports_external3.string().min(1).optional(),
  bins: exports_external3.array(exports_external3.string().min(1)).default([]),
  storage: StorageContractSchema3.optional(),
  deploymentModes: exports_external3.array(DeploymentModeSchema3).default(["local"]),
  serviceSurfaces: exports_external3.array(ServiceSurfaceSchema3).default([]),
  metadata: MetadataSchema3.optional()
}).strict().superRefine((value, ctx) => {
  const allowed = new Set(allowedBinsForName3(value.name));
  const seenBins = new Set;
  for (const [index, bin] of value.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "Duplicate bin declaration", path: ["bins", index] });
    }
    seenBins.add(bin);
    if (!allowed.has(bin)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
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
        code: exports_external3.ZodIssueCode.custom,
        message: `storage.envPrefix must be HASNA_${upper}_`,
        path: ["storage", "envPrefix"]
      });
    }
    if (value.storage.databaseUrlSecretRef && value.storage.databaseUrlSecretRef !== databaseUrlSecretRefFor3(value.name)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `storage.databaseUrlSecretRef must be ${databaseUrlSecretRefFor3(value.name)}`,
        path: ["storage", "databaseUrlSecretRef"]
      });
    }
    if (value.storage.mode === "cloud" && !value.storage.databaseUrlSecretRef) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "cloud storage requires a databaseUrlSecretRef (PURE REMOTE: reads and writes go to cloud Postgres)",
        path: ["storage", "databaseUrlSecretRef"]
      });
    }
  }
  if (value.class === "library") {
    if (value.storage) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "library repos must not declare storage", path: ["storage"] });
    }
    if (hasBin("-serve") || hasBin("-mcp")) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "library repos must not ship a -serve or -mcp bin",
        path: ["bins"]
      });
    }
  }
  if (value.class === "cli-with-store") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "cli-with-store repos must declare storage", path: ["storage"] });
    } else if (value.storage.mode === "local" && !value.storage.sqlitePath) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "local cli-with-store storage requires sqlitePath (~/.hasna/<name>/<name>.db)",
        path: ["storage", "sqlitePath"]
      });
    }
    if (!seenBins.has(value.name)) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: `cli-with-store repos must ship the "${value.name}" bin`, path: ["bins"] });
    }
  }
  if (value.class === "service") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "service repos must declare storage", path: ["storage"] });
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: `service repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "service repos must declare at least one service surface",
        path: ["serviceSurfaces"]
      });
    }
  }
  if (value.class === "saas") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "saas repos must declare storage", path: ["storage"] });
    } else if (value.storage.mode !== "cloud") {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "saas repos must use cloud storage mode", path: ["storage", "mode"] });
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: `saas repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({ code: exports_external3.ZodIssueCode.custom, message: "saas repos must declare at least one service surface", path: ["serviceSurfaces"] });
    }
  }
  for (const [index, surface] of value.serviceSurfaces.entries()) {
    if (surface.bin && !seenBins.has(surface.bin)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `Service surface bin "${surface.bin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "bin"]
      });
    }
    if (surface.mcpBin && !seenBins.has(surface.mcpBin)) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `Service surface MCP bin "${surface.mcpBin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "mcpBin"]
      });
    }
    for (const [modeIndex, deploymentMode] of surface.deploymentModes.entries()) {
      if (!value.deploymentModes.includes(deploymentMode)) {
        ctx.addIssue({
          code: exports_external3.ZodIssueCode.custom,
          message: `Service surface deployment mode "${deploymentMode}" must be declared in deploymentModes`,
          path: ["serviceSurfaces", index, "deploymentModes", modeIndex]
        });
      }
    }
  }
});
var HealthResponseSchema3 = exports_external3.object({
  status: exports_external3.enum(["ok", "degraded", "unavailable"]),
  version: exports_external3.string().min(1),
  mode: StorageModeSchema3
}).strict();
var ReadyResponseSchema3 = exports_external3.object({
  ready: exports_external3.boolean(),
  reason: exports_external3.string().min(1).optional()
}).strict();
var VersionResponseSchema3 = exports_external3.object({
  version: exports_external3.string().min(1)
}).strict();
var CommsSeveritySchema3 = exports_external3.enum(["info", "notice", "breaking", "critical"]);
var CommsEventTypeSchema3 = exports_external3.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/, "Comms event types must be 2-4 lowercase dot-separated segments (<source>.<entity>.<action>)");
var COMMS_SEVERITY_TAGS3 = ["FREEZE", "UNFREEZE", "BREAKING", "CUTOVER", "POLICY", "RELEASE"];
var CommsSeverityTagSchema3 = exports_external3.enum(COMMS_SEVERITY_TAGS3);
var CommsScopeSchema3 = exports_external3.enum(["fleet", "package", "machine"]);
var CommsEventEnvelopeSchema3 = contractBaseSchema3(SCHEMA_IDS3.commsEventEnvelope).extend({
  type: CommsEventTypeSchema3,
  severity: CommsSeveritySchema3,
  scope: CommsScopeSchema3,
  summary: exports_external3.string().min(1).optional(),
  source: ActorPointerSchema3.optional(),
  affected_packages: exports_external3.array(NonEmptyStringSchema3).default([]),
  affected_machines: exports_external3.array(NonEmptyStringSchema3).default([]),
  action_required: exports_external3.boolean().default(false),
  ack_by: TimestampSchema3.optional(),
  dedupe_key: NonEmptyStringSchema3,
  resourceRefs: exports_external3.array(ResourcePointerSchema3).default([]),
  evidenceRefs: exports_external3.array(EvidencePointerSchema3).default([])
}).strict().superRefine((value, ctx) => {
  if (value.scope === "package" && value.affected_packages.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Package-scoped comms events require affected_packages",
      path: ["affected_packages"]
    });
  }
  if (value.scope === "machine" && value.affected_machines.length === 0) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Machine-scoped comms events require affected_machines",
      path: ["affected_machines"]
    });
  }
  if (value.ack_by && !value.action_required) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: "Comms events with an ack_by deadline require action_required",
      path: ["action_required"]
    });
  }
  if (value.type === "fleet.freeze" || value.type === "fleet.unfreeze") {
    if (value.severity !== "critical") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `${value.type} events are always critical`,
        path: ["severity"]
      });
    }
    if (value.scope !== "fleet") {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `${value.type} events are always fleet-scoped`,
        path: ["scope"]
      });
    }
    if (!value.action_required) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `${value.type} events require action_required`,
        path: ["action_required"]
      });
    }
  }
});
var CommsChannelClassSchema3 = exports_external3.enum(["fleet", "package", "product", "loop-lane", "initiative", "personal"]);
var CommsChannelNoiseSchema3 = exports_external3.enum(["quiet", "work", "firehose"]);
var CommsUntilHorizonSchema3 = NonEmptyStringSchema3.refine((value) => /^(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?|gate:[0-9a-f][0-9a-f-]{7,35})$/.test(value), "until must be an ISO date (YYYY-MM-DD), a UTC timestamp, or a gate id (gate:<todos-id>)");
var CommsChannelMetadataSchema3 = contractBaseSchema3(SCHEMA_IDS3.commsChannelMetadata).extend({
  class: CommsChannelClassSchema3,
  noise: CommsChannelNoiseSchema3.optional(),
  owner: NonEmptyStringSchema3.optional(),
  until: CommsUntilHorizonSchema3.optional(),
  successor: NonEmptyStringSchema3.optional()
}).strict().superRefine((value, ctx) => {
  if (value.class === "initiative") {
    if (!value.owner) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Initiative channels require an owner",
        path: ["owner"]
      });
    }
    if (!value.until) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: "Initiative channels require an until horizon (date or gate id)",
        path: ["until"]
      });
    }
  }
});
var COMMS_SEVERITY_TAG_INFO3 = {
  FREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.freeze" },
  UNFREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.unfreeze" },
  BREAKING: { defaultSeverity: "breaking", allowedSeverities: ["breaking"], requiredEventType: null },
  CUTOVER: { defaultSeverity: "notice", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  POLICY: { defaultSeverity: "breaking", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  RELEASE: { defaultSeverity: "info", allowedSeverities: ["info", "notice"], requiredEventType: null }
};
var CommsMessageMetadataSchema3 = contractBaseSchema3(SCHEMA_IDS3.commsMessageMetadata).extend({
  tag: CommsSeverityTagSchema3,
  envelope: CommsEventEnvelopeSchema3
}).strict().superRefine((value, ctx) => {
  const info = COMMS_SEVERITY_TAG_INFO3[value.tag];
  if (!info.allowedSeverities.includes(value.envelope.severity)) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: `[${value.tag}] posts allow severities ${info.allowedSeverities.join(", ")}`,
      path: ["envelope", "severity"]
    });
  }
  if (info.requiredEventType && value.envelope.type !== info.requiredEventType) {
    ctx.addIssue({
      code: exports_external3.ZodIssueCode.custom,
      message: `[${value.tag}] posts require event type ${info.requiredEventType}`,
      path: ["envelope", "type"]
    });
  }
  for (const [tag, tagInfo] of Object.entries(COMMS_SEVERITY_TAG_INFO3)) {
    if (tagInfo.requiredEventType === value.envelope.type && value.tag !== tag) {
      ctx.addIssue({
        code: exports_external3.ZodIssueCode.custom,
        message: `${value.envelope.type} events must use the [${tag}] tag`,
        path: ["tag"]
      });
    }
  }
});
var ContractSchemaRegistry3 = {
  [SCHEMA_IDS3.actorRef]: ActorRefSchema3,
  [SCHEMA_IDS3.resourceRef]: ResourceRefSchema3,
  [SCHEMA_IDS3.evidenceRef]: EvidenceRefSchema3,
  [SCHEMA_IDS3.workRun]: WorkRunSchema3,
  [SCHEMA_IDS3.decisionEnvelope]: DecisionEnvelopeSchema3,
  [SCHEMA_IDS3.costEstimate]: CostEstimateSchema3,
  [SCHEMA_IDS3.capabilityCard]: CapabilityCardSchema3,
  [SCHEMA_IDS3.providerLiveModeStandard]: ProviderLiveModeStandardSchema3,
  [SCHEMA_IDS3.contextPack]: ContextPackSchema3,
  [SCHEMA_IDS3.integrationRef]: IntegrationRefSchema3,
  [SCHEMA_IDS3.projectManifest]: ProjectManifestSchema3,
  [SCHEMA_IDS3.projectPanel]: ProjectPanelSchema3,
  [SCHEMA_IDS3.projectSnapshot]: ProjectSnapshotSchema3,
  [SCHEMA_IDS3.renderManifest]: RenderManifestSchema3,
  [SCHEMA_IDS3.agentTrajectory]: AgentTrajectorySchema3,
  [SCHEMA_IDS3.validationPlan]: ValidationPlanSchema3,
  [SCHEMA_IDS3.proofBundle]: ProofBundleSchema3,
  [SCHEMA_IDS3.scaffoldManifest]: ScaffoldManifestSchema3,
  [SCHEMA_IDS3.scaffoldInstallRecord]: ScaffoldInstallRecordSchema3,
  [SCHEMA_IDS3.appCloudManifest]: AppCloudManifestSchema3,
  [SCHEMA_IDS3.noCloudEvidencePack]: NoCloudEvidencePackSchema3,
  [SCHEMA_IDS3.serviceContract]: ServiceContractManifestSchema3,
  [SCHEMA_IDS3.commsEventEnvelope]: CommsEventEnvelopeSchema3,
  [SCHEMA_IDS3.commsChannelMetadata]: CommsChannelMetadataSchema3,
  [SCHEMA_IDS3.commsMessageMetadata]: CommsMessageMetadataSchema3,
  [SCHEMA_IDS3.app]: AppSchema3,
  [SCHEMA_IDS3.release]: ReleaseSchema3,
  [SCHEMA_IDS3.rolloutRecord]: RolloutRecordSchema3,
  [SCHEMA_IDS3.announcement]: AnnouncementSchema3,
  [SCHEMA_IDS3.audience]: AudienceSchema3
};
function normalizeStorageMode2(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local")
    return { mode: "local", deprecatedAlias: null };
  if (normalized === "cloud")
    return { mode: "cloud", deprecatedAlias: null };
  if (DEPRECATED_STORAGE_MODE_ALIASES2.includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}

// src/generated/storage-kit/mode.ts
var DEPRECATED_STORAGE_MODE_ALIASES3 = [
  "remote",
  "hybrid",
  "self_hosted"
];
function normalizeStorageMode3(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local")
    return { mode: "local", deprecatedAlias: null };
  if (normalized === "cloud")
    return { mode: "cloud", deprecatedAlias: null };
  if (DEPRECATED_STORAGE_MODE_ALIASES3.includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}
function envToken3(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function storageEnvKeys(name) {
  const token = envToken3(name);
  return {
    modeKeys: [`HASNA_${token}_STORAGE_MODE`, `${token}_STORAGE_MODE`],
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
function resolveStorageMode(name, env = process.env) {
  const { modeKeys, databaseUrlKeys } = storageEnvKeys(name);
  const dbHit = firstEnv(env, databaseUrlKeys);
  const databaseUrlPresent = Boolean(dbHit);
  const databaseUrlSource = dbHit ? dbHit.key : null;
  const modeHit = firstEnv(env, modeKeys);
  if (!modeHit) {
    return {
      mode: "local",
      source: "default",
      deprecatedAlias: null,
      databaseUrlPresent,
      databaseUrlSource,
      warning: null
    };
  }
  const { mode, deprecatedAlias } = normalizeStorageMode3(modeHit.value);
  const warnings = [];
  if (deprecatedAlias) {
    warnings.push(`Deprecated storage mode '${deprecatedAlias}' from ${modeHit.key} is treated as 'cloud'. Set ${modeKeys[0]}=cloud instead.`);
  }
  if (mode === "cloud" && !databaseUrlPresent) {
    warnings.push(`cloud mode needs ${databaseUrlKeys[0]} (PURE REMOTE: reads and writes go to cloud Postgres).`);
  }
  if (modeHit.key !== modeKeys[0]) {
    warnings.push(`Using alias env ${modeHit.key}; the canonical key is ${modeKeys[0]}.`);
  }
  return {
    mode,
    source: modeHit.key,
    deprecatedAlias,
    databaseUrlPresent,
    databaseUrlSource,
    warning: warnings.length > 0 ? warnings.join(" ") : null
  };
}
function resolveDatabaseUrl(name, env = process.env) {
  const { databaseUrlKeys } = storageEnvKeys(name);
  const hit = firstEnv(env, databaseUrlKeys);
  return hit ? hit.value : null;
}
// src/generated/storage-kit/tls.ts
import { readFileSync as readFileSync2 } from "fs";
function sslModeFromConnectionString(connectionString) {
  const queryStart = connectionString.indexOf("?");
  const params = new URLSearchParams(queryStart === -1 ? "" : connectionString.slice(queryStart + 1));
  const sslmode = params.get("sslmode")?.trim().toLowerCase();
  if (sslmode) {
    switch (sslmode) {
      case "disable":
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        return sslmode;
      case "allow":
        return "prefer";
      default:
        throw new Error(`Unknown sslmode '${sslmode}' in connection string.`);
    }
  }
  const ssl = params.get("ssl")?.trim().toLowerCase();
  if (ssl && ["1", "true", "yes", "on", "require"].includes(ssl))
    return "require";
  return "disable";
}
function loadCaBundle(options) {
  const env = options.env ?? process.env;
  if (options.ca && options.ca.trim())
    return options.ca;
  const path = options.caCertPath ?? env.PGSSLROOTCERT ?? env.NODE_EXTRA_CA_CERTS;
  if (path && path.trim())
    return readFileSync2(path.trim(), "utf8");
  return null;
}
function resolveTlsConfig(connectionString, options = {}) {
  const mode = sslModeFromConnectionString(connectionString);
  if (mode === "disable") {
    return;
  }
  const ca = loadCaBundle(options);
  if (mode === "prefer" || mode === "require") {
    return ca ? { rejectUnauthorized: false, ca } : { rejectUnauthorized: false };
  }
  if (!ca) {
    throw new Error(`sslmode=${mode} requires a CA bundle. Set PGSSLROOTCERT (or pass caCertPath/ca) to the ` + `Amazon RDS global bundle: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`);
  }
  return { rejectUnauthorized: true, ca };
}
// src/generated/storage-kit/query.ts
function wrapExecutor(executor) {
  return {
    async query(sql, params) {
      const result = await executor.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    async many(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows;
    },
    async get(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows[0] ?? null;
    },
    async one(sql, params) {
      const result = await executor.query(sql, params);
      if (result.rows.length !== 1) {
        throw new Error(`Expected exactly one row, got ${result.rows.length}.`);
      }
      return result.rows[0];
    },
    async execute(sql, params) {
      await executor.query(sql, params);
    }
  };
}
function createQueryClient(pool) {
  const base = wrapExecutor(pool);
  return {
    ...base,
    pool,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrapExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
// src/generated/storage-kit/pool.ts
import pg from "pg";
function createPgPool(options) {
  const ssl = resolveTlsConfig(options.connectionString, {
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    ...options.env !== undefined ? { env: options.env } : {}
  });
  const config = { connectionString: options.connectionString };
  if (ssl !== undefined)
    config.ssl = ssl;
  if (options.max !== undefined)
    config.max = options.max;
  if (options.idleTimeoutMillis !== undefined)
    config.idleTimeoutMillis = options.idleTimeoutMillis;
  if (options.connectionTimeoutMillis !== undefined)
    config.connectionTimeoutMillis = options.connectionTimeoutMillis;
  if (options.applicationName !== undefined)
    config.application_name = options.applicationName;
  return new pg.Pool(config);
}
function createCloudPoolFromEnv(appName, options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveStorageMode(appName, env);
  if (resolution.mode !== "cloud") {
    throw new Error(`createCloudPoolFromEnv requires ${appName} storage mode 'cloud', got '${resolution.mode}'. ` + `Set HASNA_${appName.toUpperCase().replace(/-/g, "_")}_STORAGE_MODE=cloud.`);
  }
  const connectionString = resolveDatabaseUrl(appName, env);
  if (!connectionString) {
    throw new Error(`cloud mode for ${appName} needs a database URL. Set ` + `HASNA_${appName.toUpperCase().replace(/-/g, "_")}_DATABASE_URL.`);
  }
  const pool = createPgPool({
    connectionString,
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    env,
    ...options.max !== undefined ? { max: options.max } : {},
    ...options.idleTimeoutMillis !== undefined ? { idleTimeoutMillis: options.idleTimeoutMillis } : {},
    ...options.connectionTimeoutMillis !== undefined ? { connectionTimeoutMillis: options.connectionTimeoutMillis } : {},
    ...options.applicationName !== undefined ? { applicationName: options.applicationName } : {}
  });
  return {
    client: createQueryClient(pool),
    connectionSource: resolution.databaseUrlSource ?? "unknown"
  };
}
// src/generated/storage-kit/migrations.ts
import { createHash } from "crypto";
var DEFAULT_MIGRATION_LEDGER_TABLE = "schema_migrations";
function checksumSql(sql) {
  const normalized = sql.trim().replace(/\r\n/g, `
`);
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}
function defineMigration(id, sql) {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumSql(sql) });
}
function hasTransaction(client) {
  return typeof client.transaction === "function";
}

class MigrationLedger {
  client;
  migrations;
  ledgerTable;
  constructor(client, migrations, options = {}) {
    this.client = client;
    this.migrations = migrations;
    this.ledgerTable = options.ledgerTable ?? DEFAULT_MIGRATION_LEDGER_TABLE;
    const seen = new Set;
    for (const migration of migrations) {
      if (seen.has(migration.id))
        throw new Error(`Duplicate migration id: ${migration.id}`);
      seen.add(migration.id);
    }
  }
  async ensureLedger() {
    await this.client.execute(`CREATE TABLE IF NOT EXISTS ${this.ledgerTable} (
         id TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`);
  }
  async listApplied() {
    await this.ensureLedger();
    return this.readApplied();
  }
  async readApplied() {
    const rows = await this.client.many(`SELECT id, checksum, applied_at FROM ${this.ledgerTable} ORDER BY id ASC`);
    return rows.map((row) => ({
      id: row.id,
      checksum: row.checksum,
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at)
    }));
  }
  buildPlan(applied) {
    const known = new Set(this.migrations.map((m) => m.id));
    for (const row of applied) {
      if (!known.has(row.id)) {
        throw new Error(`Applied migration '${row.id}' is not recognized by this build (downgrade?).`);
      }
    }
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    for (const migration of this.migrations) {
      const existing = appliedById.get(migration.id);
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch for '${migration.id}': the SQL changed after it was applied.`);
      }
    }
    return this.migrations.map((migration) => ({
      migration,
      state: appliedById.has(migration.id) ? "already_applied" : "pending"
    }));
  }
  async migrate(opts = {}) {
    const dryRun = opts.dryRun === true;
    await this.ensureLedger();
    const applied = await this.readApplied();
    const plan = this.buildPlan(applied);
    if (dryRun)
      return { dryRun, applied, plan };
    for (const item of plan) {
      if (item.state === "already_applied")
        continue;
      await this.applyPendingMigration(item.migration);
    }
    return { dryRun, applied: await this.readApplied(), plan };
  }
  async applyPendingMigration(migration) {
    const apply = async (client) => {
      await client.execute(migration.sql);
      await client.execute(`INSERT INTO ${this.ledgerTable} (id, checksum, applied_at) VALUES ($1, $2, now())`, [migration.id, migration.checksum]);
    };
    if (hasTransaction(this.client)) {
      await this.client.transaction(apply);
      return;
    }
    await this.client.execute("BEGIN");
    try {
      await apply(this.client);
      await this.client.execute("COMMIT");
    } catch (error) {
      try {
        await this.client.execute("ROLLBACK");
      } catch {}
      throw error;
    }
  }
}
function createMigrationLedger(client, migrations, options = {}) {
  return new MigrationLedger(client, migrations, options);
}
// src/generated/storage-kit/health.ts
async function checkHealth(client) {
  const start = Date.now();
  try {
    await client.get("SELECT 1 AS ok");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function checkReady(client, migrations, options = {}) {
  const start = Date.now();
  try {
    const ledger = new MigrationLedger(client, migrations, options);
    const result = await ledger.migrate({ dryRun: true });
    const pending = result.plan.filter((item) => item.state === "pending").map((item) => item.migration.id);
    return { ok: pending.length === 0, latencyMs: Date.now() - start, pendingMigrations: pending };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      pendingMigrations: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// src/generated/storage-kit/index.ts
var KIT_VERSION = "0.4.0";

// src/net-guard.ts
var NETWORK_GUARD_ENV = "NODE_ENV";

class KnowledgeNetworkGuardError extends Error {
  scheme;
  port;
  constructor(message, details) {
    super(message);
    this.name = "KnowledgeNetworkGuardError";
    this.scheme = details.scheme;
    this.port = details.port;
  }
}
function isNetworkGuardActive(env = process.env) {
  return (env[NETWORK_GUARD_ENV] ?? "").trim().toLowerCase() === "test";
}
function isIpv4Loopback(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4)
    return false;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255))
    return false;
  return parts[0] === "127";
}
function isLoopbackHostname(hostname) {
  const host = hostname.trim().toLowerCase();
  if (host.length === 0)
    return false;
  if (host === "localhost" || host.endsWith(".localhost"))
    return true;
  if (isIpv4Loopback(host))
    return true;
  if (!host.startsWith("[") || !host.endsWith("]"))
    return false;
  const v6 = host.slice(1, -1);
  if (v6 === "::1" || /^(0:){7}1$/.test(v6))
    return true;
  const tail = v6.split(":").pop() ?? "";
  if (/^(::ffff:|::)/.test(v6) && isIpv4Loopback(tail))
    return true;
  return /^::(ffff:)?7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(v6);
}
function targetUrl(input) {
  if (typeof input === "string")
    return input;
  if (input instanceof URL)
    return input.href;
  return input.url;
}
function assertOutboundRequestAllowed(input, env = process.env) {
  if (!isNetworkGuardActive(env))
    return;
  const raw = targetUrl(input);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new KnowledgeNetworkGuardError(`knowledge: refused an outbound request with an unparseable target while ${NETWORK_GUARD_ENV}=test. ` + "Under test, only loopback requests are permitted.", { scheme: "unknown", port: "" });
  }
  if (isLoopbackHostname(url.hostname))
    return;
  throw new KnowledgeNetworkGuardError(`knowledge: refused a non-loopback ${url.protocol.replace(":", "")} request while ${NETWORK_GUARD_ENV}=test ` + "(target host withheld on purpose). This process resolved to the cloud backend under test, which means a " + "read or write was about to leave the machine and reach the live store. Select the mode explicitly " + `(${"HASNA_KNOWLEDGE_STORAGE_MODE"}=local) or point the API URL at 127.0.0.1 for a hermetic test.`, { scheme: url.protocol.replace(":", ""), port: url.port });
}
var REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
var MAX_GUARDED_REDIRECTS = 5;
function requestMethod(input, init) {
  if (init?.method)
    return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL))
    return input.method.toUpperCase();
  return "GET";
}
async function guardedFetch(input, init) {
  assertOutboundRequestAllowed(input);
  if (!isNetworkGuardActive() || init?.redirect !== undefined) {
    return fetch(input, init);
  }
  let from = targetUrl(input);
  let method = requestMethod(input, init);
  let body = init?.body;
  let response = await fetch(input, { ...init ?? {}, redirect: "manual" });
  for (let hop = 0;REDIRECT_STATUSES.has(response.status); hop++) {
    const location = response.headers.get("location");
    if (!location)
      return response;
    const next = new URL(location, from).href;
    assertOutboundRequestAllowed(next);
    if (hop >= MAX_GUARDED_REDIRECTS) {
      const url = new URL(next);
      throw new KnowledgeNetworkGuardError(`knowledge: refused to follow more than ${MAX_GUARDED_REDIRECTS} redirects while ${NETWORK_GUARD_ENV}=test ` + "(target host withheld on purpose). Under test the guard follows redirects itself so every hop is " + "checked, and a chain this long is a loop, not a route.", { scheme: url.protocol.replace(":", ""), port: url.port });
    }
    if (response.status === 303 || (response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD") {
      method = "GET";
      body = undefined;
    }
    const hopInit = { ...init ?? {}, method, redirect: "manual" };
    if (body === undefined)
      delete hopInit.body;
    else
      hopInit.body = body;
    response = await fetch(next, hopInit);
    from = next;
  }
  return response;
}

// src/knowledge-mode.ts
var KNOWLEDGE_APP_SLUG = "knowledge";
var ENV_KEYS = clientTransportEnvKeys2(KNOWLEDGE_APP_SLUG);
var KNOWLEDGE_MODE_ENV_KEYS = ENV_KEYS.modeKeys;
var KNOWLEDGE_API_URL_ENV_KEYS = ENV_KEYS.apiUrlKeys;
var KNOWLEDGE_API_KEY_ENV_KEYS = ENV_KEYS.apiKeyKeys;
function presentEnvNames(env, keys) {
  return keys.filter((key) => (env[key] ?? "").trim().length > 0);
}
function resolveKnowledgeModeSelection(env = process.env) {
  const pointers = [
    ...presentEnvNames(env, KNOWLEDGE_API_URL_ENV_KEYS),
    ...presentEnvNames(env, KNOWLEDGE_API_KEY_ENV_KEYS)
  ];
  const canonicalModeKey = KNOWLEDGE_MODE_ENV_KEYS[0];
  for (const name of KNOWLEDGE_MODE_ENV_KEYS) {
    const value = env[name]?.trim();
    if (!value)
      continue;
    let normalized;
    try {
      normalized = normalizeStorageMode3(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`knowledge: ${name}=${value} is not a valid mode. ${message}`);
    }
    const warnings = [];
    if (normalized.deprecatedAlias) {
      warnings.push(`Deprecated mode '${normalized.deprecatedAlias}' from ${name} is treated as 'cloud'. Prefer ${canonicalModeKey}=cloud.`);
    }
    if (name !== canonicalModeKey) {
      warnings.push(`Using alias env ${name}; the canonical key is ${canonicalModeKey}.`);
    }
    if (normalized.mode === "local" && pointers.length > 0) {
      warnings.push(`${name}=local pins the on-box store; ${pointers.join(", ")} are set but ignored.`);
    }
    return {
      mode: normalized.mode,
      source: { kind: "env", name, value },
      pointer_env_present: pointers,
      pointer_ignored: normalized.mode === "local" && pointers.length > 0,
      warning: warnings.length > 0 ? warnings.join(" ") : null
    };
  }
  return {
    mode: "local",
    source: { kind: "default", name: null, value: null },
    pointer_env_present: pointers,
    pointer_ignored: pointers.length > 0,
    warning: pointers.length > 0 ? `${pointers.join(", ")} are set but do NOT select a backend: mode is local by default. ` + `Set ${canonicalModeKey}=cloud to route reads and writes to the API, or unset those vars to silence this note.` : null
  };
}
var SERVER_MODE_CANDIDATES = ["postgres", "cloud", "self_hosted"];
var LOCAL_MODE_CANDIDATES = ["sqlite", "local"];
var derivedTokenCache = new Map;
function deriveToken(candidates, normalize, constantName) {
  const useCache = normalize === normalizeStorageMode2;
  if (useCache) {
    const hit = derivedTokenCache.get(candidates);
    if (hit !== undefined)
      return hit;
  }
  for (const candidate of candidates) {
    try {
      normalize(candidate);
      if (useCache)
        derivedTokenCache.set(candidates, candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`knowledge: no known storage token is accepted by the installed @hasna/contracts ` + `(tried ${candidates.join(", ")}). The storage-mode enum has changed; add the new ` + `token to ${constantName} in src/knowledge-mode.ts.`);
}
function serverStorageMode(normalize = normalizeStorageMode2) {
  return deriveToken(SERVER_MODE_CANDIDATES, normalize, "SERVER_MODE_CANDIDATES");
}
function localStorageMode(normalize = normalizeStorageMode2) {
  return deriveToken(LOCAL_MODE_CANDIDATES, normalize, "LOCAL_MODE_CANDIDATES");
}
function contractsStorageModeFor(mode2, normalize = normalizeStorageMode2) {
  return mode2 === "cloud" ? serverStorageMode(normalize) : localStorageMode(normalize);
}
function pinnedTransportEnv(env, mode2) {
  return { ...env, [KNOWLEDGE_MODE_ENV_KEYS[0]]: contractsStorageModeFor(mode2) };
}
function knowledgeModeReport(env = process.env) {
  const resolution = resolveKnowledgeModeSelection(env);
  return {
    ...resolution,
    store_transport: resolution.mode === "cloud" ? "api" : "local",
    api_key_present: presentEnvNames(env, KNOWLEDGE_API_KEY_ENV_KEYS).length > 0,
    network_guard_active: isNetworkGuardActive(env)
  };
}

// src/cloud-store.ts
function transportOverrides(env) {
  return {
    fetchImpl: guardedFetch,
    ...isNetworkGuardActive(env) ? { retry: false } : {}
  };
}
var KNOWLEDGE_RESOURCE = "notes";

class KnowledgeVersionConflictError extends Error {
  expected;
  current;
  code = "version_conflict";
  constructor(expected, current) {
    super(`version_conflict: this edit was written against version ${expected} but the stored entry is now at version ${current}. ` + "Nothing was written. Re-read the entry and re-apply only if the fields you are changing are untouched between the two versions.");
    this.expected = expected;
    this.current = current;
    this.name = "KnowledgeVersionConflictError";
  }
}
function toQuery(options) {
  const q = {};
  if (options.search)
    q.search = options.search;
  if (options.limit !== undefined)
    q.limit = options.limit;
  if (options.offset !== undefined)
    q.offset = options.offset;
  if (options.includeArchived || options.archivedOnly)
    q.includeArchived = true;
  return q;
}
function wrap(client) {
  return {
    baseUrl: client.baseUrl,
    async list(options = {}) {
      const wantLimit = options.limit ?? 200;
      const query2 = toQuery({ ...options, limit: Math.min(Math.max(wantLimit, 1), 200) });
      const res = await client.list(KNOWLEDGE_RESOURCE, { query: query2 });
      let items = res.items;
      if (options.archivedOnly)
        items = items.filter((x) => x.archived === true);
      if (options.tag) {
        const t = options.tag.toLowerCase();
        items = items.filter((x) => (x.tags ?? []).some((tag) => tag.toLowerCase() === t));
      }
      return { items, total: res.total };
    },
    async get(idOrShort) {
      return client.get(KNOWLEDGE_RESOURCE, idOrShort);
    },
    async create(input) {
      return client.create(KNOWLEDGE_RESOURCE, {
        ...input.id ? { id: input.id } : {},
        title: input.title,
        content: input.content,
        url: input.url ?? null,
        tags: input.tags ?? [],
        ...input.metadata ? { metadata: input.metadata } : {}
      });
    },
    async update(idOrShort, patch, options = {}) {
      try {
        return await client.update(KNOWLEDGE_RESOURCE, idOrShort, patch, {
          ...options.expectedVersion !== undefined ? { headers: { "if-match": String(options.expectedVersion) } } : {}
        });
      } catch (error) {
        if (isNotFound(error))
          return null;
        const conflict = asVersionConflict(error);
        if (conflict)
          throw conflict;
        throw error;
      }
    },
    async delete(idOrShort) {
      const existing = await client.get(KNOWLEDGE_RESOURCE, idOrShort);
      if (!existing)
        return false;
      await client.delete(KNOWLEDGE_RESOURCE, existing.id);
      return true;
    },
    async listVersions(idOrShort, options = {}) {
      try {
        return await client.transport.get(`/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions`, { query: { limit: options.limit, offset: options.offset } });
      } catch (error) {
        if (isNotFound(error))
          return null;
        throw error;
      }
    },
    async getVersion(idOrShort, version) {
      try {
        return await client.transport.get(`/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions/${version}`);
      } catch (error) {
        if (isNotFound(error))
          return null;
        throw error;
      }
    }
  };
}
function asVersionConflict(error) {
  if (!error || typeof error !== "object")
    return null;
  if (error.status !== 409)
    return null;
  const body = error.body;
  const parsed = typeof body === "string" ? safeJson(body) : body;
  const shape = parsed ?? {};
  if (shape.error !== "version_conflict")
    return null;
  return new KnowledgeVersionConflictError(Number(shape.expected ?? 0), Number(shape.current ?? 0));
}
function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function isNotFound(error) {
  return Boolean(error && typeof error === "object" && error.status === 404);
}
function resolveKnowledgeCloudStore(env = process.env) {
  if (resolveKnowledgeModeSelection(env).mode !== "cloud")
    return null;
  const resolved = resolveStorageClient(KNOWLEDGE_APP_SLUG, pinnedTransportEnv(env, "cloud"), transportOverrides(env));
  if (resolved.transport !== "cloud-http")
    return null;
  return wrap(resolved.client);
}
function isKnowledgeApiMode(env = process.env) {
  if (resolveKnowledgeModeSelection(env).mode !== "cloud")
    return false;
  return resolveStorageClient(KNOWLEDGE_APP_SLUG, pinnedTransportEnv(env, "cloud"), transportOverrides(env)).transport === "cloud-http";
}
async function fetchAllCloudItems(store) {
  const pageSize = 200;
  const all = [];
  for (let offset = 0;; offset += pageSize) {
    const { items } = await store.list({ includeArchived: true, limit: pageSize, offset });
    all.push(...items);
    if (items.length < pageSize)
      break;
    if (offset > 1e5)
      break;
  }
  return all;
}

// src/knowledge-db.ts
function assertLocalCatalogMode(operation = "catalog") {
  if (isKnowledgeApiMode()) {
    const modeKey = KNOWLEDGE_MODE_ENV_KEYS[0];
    throw new Error(`knowledge: ${operation} builds/reads the on-box sqlite RAG catalog (source ingestion, chunk embeddings, ` + `wiki compilation, cross-machine sync, machine registry). That local indexing pipeline is not available in ` + `cloud mode. In cloud mode the shared corpus is the cloud knowledge-items: 'add/list/get/update/delete' item ` + `commands AND 'search/ask/build/context' over that shared corpus all route to the cloud. Set ${modeKey}=local ` + `(or unset it \u2014 local is the default) to use the full local catalog pipeline; run 'knowledge mode' to see ` + `which variable selected the current backend.`);
  }
}
var CURRENT_SCHEMA_VERSION = 9;
var CHUNKS_FTS_TOKENIZE = "porter unicode61 remove_diacritics 2";
var MIGRATION_1 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  acl_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_revisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  hash TEXT,
  extracted_text_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(source_id, revision)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  wiki_page_id TEXT,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artifact_uri TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_backlinks (
  from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_page_id, to_page_id)
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
  source_uri TEXT NOT NULL,
  quote TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_indexes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  artifact_uri TEXT,
  shard_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, name, shard_key)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redaction_findings (
  id TEXT PRIMARY KEY,
  source_uri TEXT,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_objects (
  id TEXT PRIMARY KEY,
  artifact_uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content_type TEXT,
  hash TEXT,
  size_bytes INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  title,
  source_uri,
  content='',
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (1, datetime('now'));
`;
var MIGRATION_2 = `
DROP TABLE IF EXISTS chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='porter unicode61'
);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (2, datetime('now'));
`;
var MIGRATION_3 = `
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uri TEXT,
  decision TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_uri TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  approved_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action);
CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (3, datetime('now'));
`;
var MIGRATION_4 = `
CREATE TABLE IF NOT EXISTS vector_index_entries (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  vector_norm REAL NOT NULL,
  source_uri TEXT,
  source_ref TEXT,
  revision TEXT,
  hash TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  token_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chunk_id, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id);
CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri);
CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (4, datetime('now'));
`;
var MIGRATION_5 = `
CREATE TABLE IF NOT EXISTS reindex_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_uri TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, target_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_reindex_queue_status ON reindex_queue(status);
CREATE INDEX IF NOT EXISTS idx_reindex_queue_kind_target ON reindex_queue(kind, target_id);
CREATE INDEX IF NOT EXISTS idx_reindex_queue_source_uri ON reindex_queue(source_uri);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (5, datetime('now'));
`;
var MIGRATION_6 = `
CREATE TABLE IF NOT EXISTS knowledge_machines (
  machine_id TEXT PRIMARY KEY,
  hostname TEXT,
  platform TEXT,
  user_label TEXT,
  workspace_home TEXT,
  tailscale_dns TEXT,
  tailscale_ips_json TEXT NOT NULL DEFAULT '[]',
  ssh_target TEXT,
  last_seen_at TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_snapshots (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  workspace_home TEXT NOT NULL,
  sqlite_schema_version INTEGER NOT NULL,
  artifact_root_uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tables_json TEXT NOT NULL,
  artifact_hashes_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_changes (
  id TEXT PRIMARY KEY,
  origin_machine_id TEXT NOT NULL,
  updated_by_machine_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  base_hash TEXT,
  next_hash TEXT,
  source_ref TEXT,
  source_revision_id TEXT,
  artifact_uri TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_machine_id TEXT NOT NULL,
  remote_machine_id TEXT NOT NULL,
  local_hash TEXT,
  remote_hash TEXT,
  base_hash TEXT,
  status TEXT NOT NULL,
  resolution_strategy TEXT,
  proposed_patch_uri TEXT,
  approved_by TEXT,
  resolved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_machines_last_seen ON knowledge_machines(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_machine_created ON knowledge_sync_snapshots(machine_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_hash ON knowledge_sync_snapshots(content_hash);
CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON knowledge_sync_changes(entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_origin ON knowledge_sync_changes(origin_machine_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON knowledge_sync_changes(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (6, datetime('now'));
`;
var MIGRATION_7_TABLES_AND_INDEXES = `
CREATE TABLE IF NOT EXISTS knowledge_sync_table_clocks (
  table_name TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  logical_clock INTEGER NOT NULL DEFAULT 0,
  high_water_hash TEXT,
  high_water_bundle_id TEXT,
  origin_machine_id TEXT,
  updated_by_machine_id TEXT,
  last_applied_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(table_name, machine_id)
);

CREATE TABLE IF NOT EXISTS knowledge_sync_imports (
  bundle_id TEXT PRIMARY KEY,
  source_machine_id TEXT NOT NULL,
  target_machine_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  table_clocks_json TEXT NOT NULL,
  tables_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_bundle ON knowledge_sync_changes(bundle_id);
CREATE INDEX IF NOT EXISTS idx_sync_changes_clock ON knowledge_sync_changes(entity_kind, logical_clock);
CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_machine ON knowledge_sync_table_clocks(machine_id);
CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_updated ON knowledge_sync_table_clocks(updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_source ON knowledge_sync_imports(source_machine_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_target ON knowledge_sync_imports(target_machine_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_sync_imports_status ON knowledge_sync_imports(status);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (7, datetime('now'));
`;
var MIGRATION_8_TABLES_AND_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_wiki_pages_lifecycle_status ON wiki_pages(status, valid_to);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_last_verified ON wiki_pages(last_verified_at);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_supersedes ON wiki_pages(supersedes);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_superseded_by ON wiki_pages(superseded_by);

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (8, datetime('now'));
`;
var MIGRATION_9_REBUILD_FTS = `
BEGIN;

CREATE TEMP TABLE _chunks_fts_backup AS
  SELECT chunk_id, text, title, source_uri FROM chunks_fts;

DROP TABLE chunks_fts;

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  title,
  source_uri,
  tokenize='${CHUNKS_FTS_TOKENIZE}'
);

INSERT INTO chunks_fts (chunk_id, text, title, source_uri)
  SELECT chunk_id, text, title, source_uri FROM _chunks_fts_backup;

DROP TABLE _chunks_fts_backup;

INSERT OR IGNORE INTO schema_versions(version, applied_at)
VALUES (9, datetime('now'));

COMMIT;
`;
function openKnowledgeDb(path) {
  assertLocalCatalogMode("opening the local knowledge.db catalog");
  ensureParentDir(path);
  const db = new Database(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}
function openKnowledgeDbReadonly(path) {
  assertLocalCatalogMode("reading the local knowledge.db catalog");
  return new Database(path, { readonly: true });
}
function migrateKnowledgeDb(path) {
  const db = openKnowledgeDb(path);
  try {
    db.exec(MIGRATION_1);
    if (getSchemaVersion(db) < 2)
      db.exec(MIGRATION_2);
    if (getSchemaVersion(db) < 3)
      db.exec(MIGRATION_3);
    if (getSchemaVersion(db) < 4)
      db.exec(MIGRATION_4);
    if (getSchemaVersion(db) < 5)
      db.exec(MIGRATION_5);
    if (getSchemaVersion(db) < 6)
      db.exec(MIGRATION_6);
    if (needsMigration7(db))
      applyMigration7(db);
    if (needsMigration8(db))
      applyMigration8(db);
    if (needsMigration9(db))
      applyMigration9(db);
    return { path, schema_version: getSchemaVersion(db) };
  } finally {
    db.close();
  }
}
function getSchemaVersion(db) {
  const row = db.query("SELECT MAX(version) AS version FROM schema_versions").get();
  return row?.version ?? 0;
}
function count(db, table) {
  const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row?.n ?? 0;
}
function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
function tableExists(db, table) {
  const row = db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?").get(table);
  return Boolean(row);
}
function columnExists(db, table, column) {
  if (!tableExists(db, table))
    return false;
  const columns = db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  return columns.some((row) => row.name === column);
}
function ensureColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition};`);
  }
}
function needsMigration7(db) {
  return getSchemaVersion(db) < 7 || !columnExists(db, "knowledge_sync_changes", "logical_clock") || !columnExists(db, "knowledge_sync_changes", "bundle_id") || !tableExists(db, "knowledge_sync_table_clocks") || !tableExists(db, "knowledge_sync_imports");
}
function applyMigration7(db) {
  if (!tableExists(db, "knowledge_sync_changes"))
    db.exec(MIGRATION_6);
  ensureColumn(db, "knowledge_sync_changes", "logical_clock", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "knowledge_sync_changes", "bundle_id", "TEXT");
  db.exec(MIGRATION_7_TABLES_AND_INDEXES);
}
function needsMigration8(db) {
  return getSchemaVersion(db) < 8 || !columnExists(db, "wiki_pages", "valid_from") || !columnExists(db, "wiki_pages", "valid_to") || !columnExists(db, "wiki_pages", "supersedes") || !columnExists(db, "wiki_pages", "superseded_by") || !columnExists(db, "wiki_pages", "confidence") || !columnExists(db, "wiki_pages", "last_verified_at");
}
function applyMigration8(db) {
  if (!tableExists(db, "wiki_pages"))
    db.exec(MIGRATION_1);
  ensureColumn(db, "wiki_pages", "valid_from", "TEXT");
  ensureColumn(db, "wiki_pages", "valid_to", "TEXT");
  ensureColumn(db, "wiki_pages", "supersedes", "TEXT");
  ensureColumn(db, "wiki_pages", "superseded_by", "TEXT");
  ensureColumn(db, "wiki_pages", "confidence", "REAL");
  ensureColumn(db, "wiki_pages", "last_verified_at", "TEXT");
  db.exec(`
    UPDATE wiki_pages
    SET valid_from = COALESCE(valid_from, created_at),
        last_verified_at = COALESCE(last_verified_at, updated_at),
        confidence = COALESCE(confidence, 0.8)
    WHERE valid_from IS NULL OR last_verified_at IS NULL OR confidence IS NULL;
  `);
  db.exec(MIGRATION_8_TABLES_AND_INDEXES);
}
function ftsUsesDiacriticFolding(db) {
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get("chunks_fts");
  return Boolean(row?.sql && row.sql.includes("remove_diacritics"));
}
function needsMigration9(db) {
  if (!tableExists(db, "chunks_fts"))
    return false;
  return getSchemaVersion(db) < 9 || !ftsUsesDiacriticFolding(db);
}
function applyMigration9(db) {
  if (!tableExists(db, "chunks_fts"))
    return;
  if (ftsUsesDiacriticFolding(db)) {
    db.exec("INSERT OR IGNORE INTO schema_versions(version, applied_at) VALUES (9, datetime('now'));");
    return;
  }
  db.exec(MIGRATION_9_REBUILD_FTS);
}
function getKnowledgeDbStats(path) {
  const db = openKnowledgeDb(path);
  try {
    return {
      schema_version: getSchemaVersion(db),
      sources: count(db, "sources"),
      source_revisions: count(db, "source_revisions"),
      chunks: count(db, "chunks"),
      wiki_pages: count(db, "wiki_pages"),
      citations: count(db, "citations"),
      indexes: count(db, "knowledge_indexes"),
      runs: count(db, "runs"),
      run_events: count(db, "run_events"),
      redaction_findings: count(db, "redaction_findings"),
      audit_events: count(db, "audit_events"),
      approval_gates: count(db, "approval_gates"),
      storage_objects: count(db, "storage_objects"),
      embeddings: count(db, "chunk_embeddings"),
      vector_entries: count(db, "vector_index_entries"),
      reindex_queue: count(db, "reindex_queue"),
      knowledge_machines: count(db, "knowledge_machines"),
      sync_snapshots: count(db, "knowledge_sync_snapshots"),
      sync_changes: count(db, "knowledge_sync_changes"),
      sync_conflicts: count(db, "knowledge_sync_conflicts"),
      sync_table_clocks: count(db, "knowledge_sync_table_clocks"),
      sync_imports: count(db, "knowledge_sync_imports")
    };
  } finally {
    db.close();
  }
}

// src/db/storage-sync.ts
var STORAGE_TABLES = [
  "sources",
  "wiki_pages",
  "source_revisions",
  "chunks",
  "chunk_embeddings",
  "wiki_backlinks",
  "citations",
  "knowledge_indexes",
  "runs",
  "run_events",
  "provider_usage",
  "redaction_findings",
  "storage_objects",
  "audit_events",
  "approval_gates",
  "vector_index_entries",
  "reindex_queue",
  "knowledge_machines",
  "knowledge_sync_snapshots",
  "knowledge_sync_changes",
  "knowledge_sync_conflicts",
  "knowledge_sync_table_clocks",
  "knowledge_sync_imports"
];
var KNOWLEDGE_STORAGE_TABLES = STORAGE_TABLES;
var DEPRECATED_CLOUD_ALIASES = ["remote", "hybrid", "self_hosted"];
var KNOWLEDGE_STORAGE_MODE_ENV = "HASNA_KNOWLEDGE_STORAGE_MODE";
var KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV = "KNOWLEDGE_STORAGE_MODE";
var STORAGE_MODE_ENV = [KNOWLEDGE_STORAGE_MODE_ENV, KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV];
function readEnv(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}
function normalizeStorageMode4(value) {
  const normalized = value?.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local")
    return "local";
  if (normalized === "cloud")
    return "cloud";
  if (normalized && DEPRECATED_CLOUD_ALIASES.includes(normalized))
    return "cloud";
  return;
}
function openScopedDb(options = {}) {
  const workspace = ensureKnowledgeWorkspace(resolveScopedWorkspace(options.scope, options.cwd).home);
  migrateKnowledgeDb(workspace.knowledgeDbPath);
  return {
    db: openKnowledgeDb(workspace.knowledgeDbPath),
    path: workspace.knowledgeDbPath,
    scope: options.scope ?? "global"
  };
}
function getStorageMode() {
  const mode2 = normalizeStorageMode4(readEnv(KNOWLEDGE_STORAGE_MODE_ENV)) ?? normalizeStorageMode4(readEnv(KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV));
  if (mode2)
    return mode2;
  return "local";
}
function getSyncMetaAll(options = {}) {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    return local.db.query("SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction").all();
  } finally {
    local.db.close();
  }
}
function getStorageStatus(options = {}) {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    const sync = local.db.query("SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction").all();
    return {
      mode: getStorageMode(),
      service: "knowledge",
      scope: local.scope,
      databasePath: local.path,
      tables: STORAGE_TABLES,
      sync
    };
  } finally {
    local.db.close();
  }
}
function resolveTables(tables) {
  if (!tables || tables.length === 0)
    return [...STORAGE_TABLES];
  const allowed = new Set(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0)
    throw new Error(`Unknown knowledge sync table(s): ${invalid.join(", ")}`);
  return requested;
}
function parseStorageTables(value) {
  if (!value)
    return;
  return resolveTables(Array.isArray(value) ? value : value.split(","));
}
function ensureSyncMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _knowledge_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}
// src/db/remote-storage.ts
var KNOWLEDGE_APP_NAME = "knowledge";
function createKnowledgeCloudClient() {
  return createCloudPoolFromEnv(KNOWLEDGE_APP_NAME, { applicationName: "@hasna/knowledge" }).client;
}
// src/db/pg-migrations.ts
var PG_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    acl_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    artifact_uri TEXT,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS source_revisions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    revision TEXT NOT NULL,
    hash TEXT,
    extracted_text_uri TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(source_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    token_count INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_backlinks (
    from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(from_page_id, to_page_id)
  )`,
  `CREATE TABLE IF NOT EXISTS citations (
    id TEXT PRIMARY KEY,
    wiki_page_id TEXT REFERENCES wiki_pages(id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    source_uri TEXT NOT NULL,
    quote TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_indexes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    artifact_uri TEXT,
    shard_key TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, name, shard_key)
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    prompt TEXT,
    status TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    cost_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS provider_usage (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS redaction_findings (
    id TEXT PRIMARY KEY,
    source_uri TEXT,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    severity TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS storage_objects (
    id TEXT PRIMARY KEY,
    artifact_uri TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    content_type TEXT,
    hash TEXT,
    size_bytes INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    action TEXT NOT NULL,
    target_uri TEXT,
    decision TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS approval_gates (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_uri TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    approved_by TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS vector_index_entries (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    source_revision_id TEXT REFERENCES source_revisions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    vector_norm DOUBLE PRECISION NOT NULL,
    source_uri TEXT,
    source_ref TEXT,
    revision TEXT,
    hash TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    token_count INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(chunk_id, provider, model)
  )`,
  `CREATE TABLE IF NOT EXISTS reindex_queue (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_uri TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(kind, target_id, reason)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_machines (
    machine_id TEXT PRIMARY KEY,
    hostname TEXT,
    platform TEXT,
    user_label TEXT,
    workspace_home TEXT,
    tailscale_dns TEXT,
    tailscale_ips_json TEXT NOT NULL DEFAULT '[]',
    ssh_target TEXT,
    last_seen_at TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_snapshots (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    workspace_home TEXT NOT NULL,
    sqlite_schema_version INTEGER NOT NULL,
    artifact_root_uri TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    tables_json TEXT NOT NULL,
    artifact_hashes_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_changes (
    id TEXT PRIMARY KEY,
    origin_machine_id TEXT NOT NULL,
    updated_by_machine_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    base_hash TEXT,
    next_hash TEXT,
    source_ref TEXT,
    source_revision_id TEXT,
    artifact_uri TEXT,
    logical_clock INTEGER NOT NULL DEFAULT 0,
    bundle_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS logical_clock INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE knowledge_sync_changes ADD COLUMN IF NOT EXISTS bundle_id TEXT`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_conflicts (
    id TEXT PRIMARY KEY,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_machine_id TEXT NOT NULL,
    remote_machine_id TEXT NOT NULL,
    local_hash TEXT,
    remote_hash TEXT,
    base_hash TEXT,
    status TEXT NOT NULL,
    resolution_strategy TEXT,
    proposed_patch_uri TEXT,
    approved_by TEXT,
    resolved_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_table_clocks (
    table_name TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    logical_clock INTEGER NOT NULL DEFAULT 0,
    high_water_hash TEXT,
    high_water_bundle_id TEXT,
    origin_machine_id TEXT,
    updated_by_machine_id TEXT,
    last_applied_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    PRIMARY KEY(table_name, machine_id)
  )`,
  `CREATE TABLE IF NOT EXISTS knowledge_sync_imports (
    bundle_id TEXT PRIMARY KEY,
    source_machine_id TEXT NOT NULL,
    target_machine_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    table_clocks_json TEXT NOT NULL,
    tables_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_revisions_source ON source_revisions(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_source_revision ON chunks(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_wiki_page ON chunks(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_wiki_page ON citations(wiki_page_id)`,
  `CREATE INDEX IF NOT EXISTS idx_citations_chunk ON citations(chunk_id)`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_usage_run ON provider_usage(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_action ON approval_gates(action)`,
  `CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_provider_model ON vector_index_entries(provider, model)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_revision ON vector_index_entries(source_revision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_source_uri ON vector_index_entries(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_vector_index_status ON vector_index_entries(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_status ON reindex_queue(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_kind_target ON reindex_queue(kind, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_source_uri ON reindex_queue(source_uri)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_machines_last_seen ON knowledge_machines(last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_machine_created ON knowledge_sync_snapshots(machine_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_snapshots_hash ON knowledge_sync_snapshots(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON knowledge_sync_changes(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_origin ON knowledge_sync_changes(origin_machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_created ON knowledge_sync_changes(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_bundle ON knowledge_sync_changes(bundle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_changes_clock ON knowledge_sync_changes(entity_kind, logical_clock)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON knowledge_sync_conflicts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity ON knowledge_sync_conflicts(entity_kind, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_machine ON knowledge_sync_table_clocks(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_table_clocks_updated ON knowledge_sync_table_clocks(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_source ON knowledge_sync_imports(source_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_target ON knowledge_sync_imports(target_machine_id, applied_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_imports_status ON knowledge_sync_imports(status)`,
  `CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    short_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    url TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_short_id ON knowledge_items(short_id)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_archived ON knowledge_items(archived)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_created ON knowledge_items(created_at)`,
  `ALTER TABLE knowledge_items
     ADD COLUMN IF NOT EXISTS search_vector tsvector
     GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
       setweight(to_tsvector('english', coalesce(content, '')), 'B')
     ) STORED`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_search_vector
     ON knowledge_items USING GIN (search_vector)`,
  `ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
  `CREATE TABLE IF NOT EXISTS knowledge_item_versions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    tenant_id TEXT,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    body_uri TEXT,
    content_hash TEXT NOT NULL,
    content_bytes INTEGER NOT NULL,
    url TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    actor TEXT,
    reason TEXT,
    valid_from TEXT,
    valid_to TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    UNIQUE(item_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_item_versions_item
     ON knowledge_item_versions(item_id, version DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_item_versions_hash
     ON knowledge_item_versions(content_hash)`,
  `CREATE OR REPLACE FUNCTION knowledge_items_version_snapshot()
   RETURNS TRIGGER AS $knowledge_item_version$
   BEGIN
     IF (OLD.title, OLD.content, OLD.url, OLD.tags, OLD.metadata, OLD.archived)
        IS NOT DISTINCT FROM
        (NEW.title, NEW.content, NEW.url, NEW.tags, NEW.metadata, NEW.archived) THEN
       -- No content-bearing change: no version, no snapshot. Pin the counter so
       -- a caller cannot move it on a write the trigger otherwise ignores.
       NEW.version := OLD.version;
       RETURN NEW;
     END IF;

     INSERT INTO knowledge_item_versions
       (id, item_id, tenant_id, version, title, content, content_hash, content_bytes,
        url, tags, metadata, archived, actor, reason, valid_from, valid_to)
     VALUES
       (gen_random_uuid()::text,
        OLD.id,
        to_jsonb(OLD)->>'tenant_id',
        OLD.version,
        OLD.title,
        OLD.content,
        encode(sha256(convert_to(coalesce(OLD.content, ''), 'UTF8')), 'hex'),
        octet_length(coalesce(OLD.content, '')),
        OLD.url,
        OLD.tags,
        OLD.metadata,
        OLD.archived,
        NULLIF(current_setting('hasna.actor', true), ''),
        NULLIF(current_setting('hasna.reason', true), ''),
        OLD.updated_at,
        to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

     -- The bump and the snapshot are ONE write. The counter advances by exactly
     -- one and only here, so a caller can neither skip it nor forge it.
     NEW.version := OLD.version + 1;

     -- updated_at is TEXT and the application fills it with toISOString(), so
     -- the trigger must write the SAME shape. NOW()::text renders as
     -- '2026-07-28 21:29:56.01+00'; space (0x20) sorts below 'T' (0x54), so a
     -- column carrying both formats orders every trigger-written row before
     -- every application-written one regardless of actual time, and valid_from
     -- (copied verbatim from the row below) would stop being comparable with
     -- valid_to. One format, no casts needed at read time.
     --
     -- Only stamped when the caller did NOT set it. Import, sync replay, and
     -- backfill carry a SOURCE timestamp and kept it before this trigger
     -- existed; silently replacing it would be a regression. A writer that says
     -- nothing still gets a truthful advance.
     IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
       NEW.updated_at := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
     END IF;
     RETURN NEW;
   END
   $knowledge_item_version$ LANGUAGE plpgsql`,
  `DO $knowledge_item_version_trigger$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_knowledge_items_version'
          AND tgrelid = 'knowledge_items'::regclass
     ) THEN
       CREATE TRIGGER trg_knowledge_items_version
         BEFORE UPDATE ON knowledge_items
         FOR EACH ROW EXECUTE FUNCTION knowledge_items_version_snapshot();
     END IF;
   END
   $knowledge_item_version_trigger$`,
  `ALTER TABLE knowledge_items ENABLE ALWAYS TRIGGER trg_knowledge_items_version`,
  `CREATE OR REPLACE FUNCTION knowledge_item_versions_append_only()
   RETURNS TRIGGER AS $knowledge_item_versions_append_only$
   BEGIN
     RAISE EXCEPTION 'knowledge_item_versions is append-only: version % of item % cannot be rewritten',
       OLD.version, OLD.item_id
       USING ERRCODE = 'restrict_violation';
   END
   $knowledge_item_versions_append_only$ LANGUAGE plpgsql`,
  `DO $knowledge_item_versions_guard$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_knowledge_item_versions_append_only'
          AND tgrelid = 'knowledge_item_versions'::regclass
     ) THEN
       CREATE TRIGGER trg_knowledge_item_versions_append_only
         BEFORE UPDATE ON knowledge_item_versions
         FOR EACH ROW EXECUTE FUNCTION knowledge_item_versions_append_only();
     END IF;
   END
   $knowledge_item_versions_guard$`,
  `ALTER TABLE knowledge_item_versions ENABLE ALWAYS TRIGGER trg_knowledge_item_versions_append_only`
];
export {
  wrapExecutor,
  storageEnvKeys,
  resolveTlsConfig,
  resolveTables,
  resolveStorageMode,
  resolveDatabaseUrl,
  parseStorageTables,
  normalizeStorageMode3 as normalizeCloudStorageMode,
  getSyncMetaAll,
  getStorageStatus,
  getStorageMode,
  defineMigration,
  createMigrationLedger,
  createKnowledgeCloudClient,
  checksumSql,
  checkReady,
  checkHealth,
  STORAGE_TABLES,
  STORAGE_MODE_ENV,
  PG_MIGRATIONS,
  MigrationLedger,
  KNOWLEDGE_STORAGE_TABLES,
  KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV,
  KNOWLEDGE_STORAGE_MODE_ENV,
  KNOWLEDGE_APP_NAME,
  KIT_VERSION
};
