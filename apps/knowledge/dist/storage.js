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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
  mkdirSync(workspace.home, { recursive: true });
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
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(workspace.configPath)) {
    writeFileSync(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}
`);
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
`);
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

// src/cloud-store.ts
var KNOWLEDGE_APP_SLUG = "knowledge";
var MODE_ENV_KEYS = [
  "HASNA_KNOWLEDGE_STORAGE_MODE",
  "HASNA_KNOWLEDGE_MODE",
  "KNOWLEDGE_STORAGE_MODE",
  "KNOWLEDGE_MODE"
];
var API_URL_ENV_KEYS = ["HASNA_KNOWLEDGE_API_URL", "KNOWLEDGE_API_URL"];
var API_KEY_ENV_KEYS = ["HASNA_KNOWLEDGE_API_KEY", "KNOWLEDGE_API_KEY"];
function hasAnyEnv(env, keys) {
  return keys.some((k) => (env[k] ?? "").trim().length > 0);
}
function withInferredCloudMode(env) {
  if (hasAnyEnv(env, MODE_ENV_KEYS))
    return env;
  if (hasAnyEnv(env, API_URL_ENV_KEYS) && hasAnyEnv(env, API_KEY_ENV_KEYS)) {
    return { ...env, HASNA_KNOWLEDGE_STORAGE_MODE: "cloud" };
  }
  return env;
}
var KNOWLEDGE_RESOURCE = "notes";
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
      const query = toQuery({ ...options, limit: Math.min(Math.max(wantLimit, 1), 200) });
      const res = await client.list(KNOWLEDGE_RESOURCE, { query });
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
    async update(idOrShort, patch) {
      try {
        return await client.update(KNOWLEDGE_RESOURCE, idOrShort, patch);
      } catch (error) {
        if (isNotFound(error))
          return null;
        throw error;
      }
    },
    async delete(idOrShort) {
      const existing = await client.get(KNOWLEDGE_RESOURCE, idOrShort);
      if (!existing)
        return false;
      await client.delete(KNOWLEDGE_RESOURCE, existing.id);
      return true;
    }
  };
}
function isNotFound(error) {
  return Boolean(error && typeof error === "object" && error.status === 404);
}
function resolveKnowledgeCloudStore(env = process.env) {
  const resolved = resolveStorageClient(KNOWLEDGE_APP_SLUG, withInferredCloudMode(env));
  if (resolved.transport !== "cloud-http")
    return null;
  return wrap(resolved.client);
}
function isKnowledgeApiMode(env = process.env) {
  return resolveStorageClient(KNOWLEDGE_APP_SLUG, withInferredCloudMode(env)).transport === "cloud-http";
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
    throw new Error(`knowledge: ${operation} builds/reads the on-box sqlite RAG catalog (source ingestion, chunk embeddings, ` + `wiki compilation, cross-machine sync, machine registry). That local indexing pipeline is not available while ` + `the cloud API flip is active (HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY set). In cloud mode the shared ` + `corpus is the cloud knowledge-items: 'add/list/get/update/delete' item commands AND 'search/ask/build/context' ` + `over that shared corpus all route to the cloud. Unset the API env to use the full local catalog pipeline.`);
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
function normalizeStorageMode2(value) {
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
  const mode = normalizeStorageMode2(readEnv(KNOWLEDGE_STORAGE_MODE_ENV)) ?? normalizeStorageMode2(readEnv(KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV));
  if (mode)
    return mode;
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
// src/generated/storage-kit/mode.ts
var DEPRECATED_STORAGE_MODE_ALIASES2 = [
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
  if (DEPRECATED_STORAGE_MODE_ALIASES2.includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}
function envToken2(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function storageEnvKeys(name) {
  const token = envToken2(name);
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
  `CREATE INDEX IF NOT EXISTS idx_knowledge_items_created ON knowledge_items(created_at)`
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
