/** Generated dependency-light Stage A public boundary. */
import type * as Runtime from "./storage.runtime.js";
import { assertTodosLocalStorageRole as assertStageALocalStorageRole } from "./storage/config.js";
export type * from "./storage.runtime.js";
export { TodosHostedStorageUnavailableError } from "./storage/authority-floor.js";

function loadRuntimeOwner(): typeof import("./stage-a-public-runtime.js") {
  assertStageALocalStorageRole(process.env);
  const ownerSpecifier = import.meta.url.endsWith(".ts") ? "./stage-a-public-runtime.ts" : "./stage-a-public-runtime.js";
  return require(ownerSpecifier) as typeof import("./stage-a-public-runtime.js");
}

function loadRuntime(): typeof Runtime {
  return loadRuntimeOwner().storage;
}

function assertPublicSqliteBoundaryArguments(args: readonly unknown[]): void {
  loadRuntimeOwner().assertPublicSqliteBoundaryArguments(args);
}

type LazyPublicValueKind = "array" | "date" | "map" | "null-object" | "object" | "regexp" | "set";

function lazyPublicValue(name: keyof typeof Runtime, kind: LazyPublicValueKind): unknown {
  const target: object = kind === "array" ? []
    : kind === "date" ? new Date(0)
      : kind === "map" ? new Map()
        : kind === "null-object" ? Object.create(null)
          : kind === "regexp" ? new RegExp("")
            : kind === "set" ? new Set()
              : {};
  let resolved: object | undefined;
  let publicProxy: object;
  const methodWrappers = new WeakMap<Function, Function>();
  const guardedOperationObjects = new WeakMap<object, object>();
  const targetPrototype = Reflect.getPrototypeOf(target);
  const targetConstructor = targetPrototype === null ? undefined : Reflect.get(targetPrototype, "constructor", targetPrototype);
  const resolve = (): object => {
    assertStageALocalStorageRole(process.env);
    if (resolved) return resolved;
    const value = Reflect.get(loadRuntime(), name);
    if (value === null || typeof value !== "object") throw new TypeError(`public export ${String(name)} is not an object`);
    resolved = value;
    return value;
  };
  const operationReceiver = (): object => {
    const value = resolve();
    return Reflect.isExtensible(target) ? value : target;
  };
  const guardOperationObject = (operationObject: object): object => {
    const cachedProxy = guardedOperationObjects.get(operationObject);
    if (cachedProxy) return cachedProxy;
    const operationMethods = new WeakMap<Function, Function>();
    const operationPrototype = Reflect.getPrototypeOf(operationObject);
    const operationConstructor = operationPrototype === null
      ? undefined : Reflect.get(operationPrototype, "constructor", operationPrototype);
    let operationProxy: object;
    const authorize = (): object => { resolve(); return operationObject; };
    const publicize = (property: PropertyKey, value: unknown): unknown => {
      if (value === operationObject) return operationProxy;
      if (typeof value !== "function") return value;
      if (property === "constructor" && value === operationConstructor) return value;
      const cachedMethod = operationMethods.get(value);
      if (cachedMethod) return cachedMethod;
      let methodProxy!: Function;
      methodProxy = new Proxy(value, {
        apply(_method, _thisArg, args) {
          const receiver = authorize();
          const result = Reflect.apply(value, receiver, args);
          return result === receiver ? operationProxy : result;
        },
        construct(_method, args, newTarget) {
          authorize();
          return Reflect.construct(value, args, newTarget);
        },
      });
      operationMethods.set(value, methodProxy);
      operationMethods.set(methodProxy, methodProxy);
      return methodProxy;
    };
    operationProxy = new Proxy(operationObject, {
      get(_target, property) { const receiver = authorize(); return publicize(property, Reflect.get(receiver, property, receiver)); },
      set(_target, property, value) { return Reflect.set(authorize(), property, value, operationObject); },
      has(_target, property) { return Reflect.has(authorize(), property); },
      ownKeys() { return Reflect.ownKeys(authorize()); },
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(authorize(), property);
        if (!descriptor || !("value" in descriptor) || descriptor.configurable === false) return descriptor;
        return { ...descriptor, value: publicize(property, descriptor.value) };
      },
      defineProperty(_target, property, descriptor) { return Reflect.defineProperty(authorize(), property, descriptor); },
      deleteProperty(_target, property) { return Reflect.deleteProperty(authorize(), property); },
      getPrototypeOf() { return Reflect.getPrototypeOf(authorize()); },
      setPrototypeOf(_target, prototype) { return Reflect.setPrototypeOf(authorize(), prototype); },
      isExtensible() { return Reflect.isExtensible(authorize()); },
      preventExtensions() { return Reflect.preventExtensions(authorize()); },
    });
    guardedOperationObjects.set(operationObject, operationProxy);
    return operationProxy;
  };
  const isIteratorFactory = (property: PropertyKey): boolean => property === Symbol.iterator
    || ((kind === "array" || kind === "map" || kind === "set")
      && (property === "entries" || property === "keys" || property === "values"));
  const callbackReceiverIndex = (property: PropertyKey): number | undefined => {
    if ((kind === "map" || kind === "set") && property === "forEach") return 2;
    if (kind !== "array") return undefined;
    if (property === "reduce" || property === "reduceRight") return 3;
    return property === "every" || property === "filter" || property === "find"
      || property === "findIndex" || property === "findLast" || property === "findLastIndex"
      || property === "flatMap" || property === "forEach" || property === "map" || property === "some"
      ? 2 : undefined;
  };
  const publicizeCallbackArguments = (property: PropertyKey, args: unknown[], receiver: object): unknown[] => {
    const receiverIndex = callbackReceiverIndex(property);
    if (receiverIndex === undefined || typeof args[0] !== "function") return args;
    const callback = args[0] as Function;
    const guardedCallback = function (this: unknown, ...callbackArgs: unknown[]): unknown {
      resolve();
      if (callbackArgs[receiverIndex] === receiver) callbackArgs[receiverIndex] = publicProxy;
      return Reflect.apply(callback, this, callbackArgs);
    };
    return [guardedCallback, ...args.slice(1)];
  };
  const publicizeProperty = (receiver: object, property: PropertyKey, value: unknown): unknown => {
    if (value === receiver) return publicProxy;
    if (typeof value !== "function") return value;
    if (property === "constructor" && value === targetConstructor) return value;
    const cached = methodWrappers.get(value);
    if (cached) return cached;
    let wrapper!: Function;
    wrapper = new Proxy(value, {
      apply(_method, _thisArg, args) {
        const currentReceiver = operationReceiver();
        const result = Reflect.apply(value, currentReceiver, publicizeCallbackArguments(property, args, currentReceiver));
        if (result === currentReceiver) return publicProxy;
        return isIteratorFactory(property) && result !== null && typeof result === "object"
          ? guardOperationObject(result) : result;
      },
      construct(_method, args, newTarget) {
        const currentReceiver = operationReceiver();
        const result = Reflect.construct(value, args, newTarget);
        return result === currentReceiver ? publicProxy : result;
      },
    });
    methodWrappers.set(value, wrapper);
    methodWrappers.set(wrapper, wrapper);
    return wrapper;
  };
  const publicizeDescriptor = (receiver: object, property: PropertyKey, descriptor: PropertyDescriptor): PropertyDescriptor =>
    "value" in descriptor ? { ...descriptor, value: publicizeProperty(receiver, property, descriptor.value) } : descriptor;
  const materializeTarget = (): boolean => {
    const value = resolve();
    if (!Reflect.isExtensible(target)) return true;
    if (kind === "map") {
      for (const [entryKey, entryValue] of value as Map<unknown, unknown>)
        (target as Map<unknown, unknown>).set(entryKey, entryValue);
    } else if (kind === "set") {
      for (const entryValue of value as Set<unknown>) (target as Set<unknown>).add(entryValue);
    } else if (kind === "date") {
      (target as Date).setTime((value as Date).getTime());
    }
    for (const property of Reflect.ownKeys(value)) {
      const rawDescriptor = Reflect.getOwnPropertyDescriptor(value, property);
      if (!rawDescriptor) continue;
      const descriptor = publicizeDescriptor(value, property, rawDescriptor);
      const current = Reflect.getOwnPropertyDescriptor(target, property);
      if (current && !current.configurable) {
        if ("value" in descriptor && "value" in current) {
          if (!Reflect.defineProperty(target, property, { value: descriptor.value, writable: descriptor.writable })) return false;
        } else if (descriptor.get !== current.get || descriptor.set !== current.set) return false;
        continue;
      }
      if (!Reflect.defineProperty(target, property, descriptor)) return false;
    }
    return Reflect.preventExtensions(target);
  };
  publicProxy = new Proxy(target, {
    get(_target, property) {
      const receiver = operationReceiver();
      const value = Reflect.get(receiver, property, receiver);
      return publicizeProperty(receiver, property, value);
    },
    set(_target, property, value) { const receiver = operationReceiver(); return Reflect.set(receiver, property, value, receiver); },
    has(_target, property) { return Reflect.has(operationReceiver(), property); },
    ownKeys() { return Reflect.ownKeys(operationReceiver()); },
    getOwnPropertyDescriptor(_target, property) {
      resolve();
      if (!Reflect.isExtensible(target)) return Reflect.getOwnPropertyDescriptor(target, property);
      if (kind === "array" && property === "length") {
        (target as unknown[]).length = (resolve() as unknown[]).length;
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
      const receiver = resolve();
      const descriptor = Reflect.getOwnPropertyDescriptor(receiver, property);
      return descriptor ? { ...publicizeDescriptor(receiver, property, descriptor), configurable: true } : undefined;
    },
    defineProperty(_target, property, descriptor) { return Reflect.defineProperty(operationReceiver(), property, descriptor); },
    deleteProperty(_target, property) { return Reflect.deleteProperty(operationReceiver(), property); },
    getPrototypeOf() { resolve(); return Reflect.getPrototypeOf(target); },
    setPrototypeOf(_target, prototype) { resolve(); return prototype === Reflect.getPrototypeOf(target); },
    isExtensible() { resolve(); return Reflect.isExtensible(target); },
    preventExtensions() { return materializeTarget(); },
  });
  return publicProxy;
}

const runtimeClassBridges = new WeakMap<Function, Set<Function>>();

function bridgeRuntimeClassInstanceof(runtimeClass: Function, wrapperClass: Function): void {
  let wrappers = runtimeClassBridges.get(runtimeClass);
  if (!wrappers) {
    wrappers = new Set<Function>();
    runtimeClassBridges.set(runtimeClass, wrappers);
    const originalHasInstance = runtimeClass[Symbol.hasInstance];
    Object.defineProperty(runtimeClass, Symbol.hasInstance, {
      configurable: true,
      value(value: unknown): boolean {
        if (Reflect.apply(originalHasInstance, runtimeClass, [value])) return true;
        const nativeHasInstance = Function.prototype[Symbol.hasInstance];
        return [...wrappers!].some((wrapper) => Reflect.apply(nativeHasInstance, wrapper, [value]));
      },
    });
  }
  wrappers.add(wrapperClass);
}

export const CANONICAL_TODOS_RDS_CLUSTER = ("hasna-xyz-infra-apps-prod-postgres") as unknown as typeof Runtime.CANONICAL_TODOS_RDS_CLUSTER;
export const CANONICAL_TODOS_RDS_DATABASE = ("todos") as unknown as typeof Runtime.CANONICAL_TODOS_RDS_DATABASE;
export const CANONICAL_TODOS_RDS_RUNTIME_PATH = ("hasna/xyz/opensource/todos/prod/rds") as unknown as typeof Runtime.CANONICAL_TODOS_RDS_RUNTIME_PATH;
export const COMMENT_REDACTION_BACKFILL_CONFIRMATION = ("REDACT_STORED_TODOS_COMMENTS") as unknown as typeof Runtime.COMMENT_REDACTION_BACKFILL_CONFIRMATION;
export const DEFAULT_TODOS_POSTGRES_CURSOR_TABLE = ("todos_sync_cursors") as unknown as typeof Runtime.DEFAULT_TODOS_POSTGRES_CURSOR_TABLE;
export const DEFAULT_TODOS_POSTGRES_SYNC_TABLE = ("todos_sync_records") as unknown as typeof Runtime.DEFAULT_TODOS_POSTGRES_SYNC_TABLE;
const _PostgresScopedSlugIndexBuildErrorPublicWrapper = class PostgresScopedSlugIndexBuildError extends Error {
  constructor(a0: any, a1: any, ...args: any[]) { super(); assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); const runtimeClass = loadRuntime().PostgresScopedSlugIndexBuildError; bridgeRuntimeClassInstanceof(runtimeClass, PostgresScopedSlugIndexBuildError); return Reflect.construct(runtimeClass, [a0, a1, ...args], new.target) as any; }
  static [Symbol.hasInstance](value: unknown): boolean { assertStageALocalStorageRole(process.env); const nativeHasInstance = Function.prototype[Symbol.hasInstance]; if (Reflect.apply(nativeHasInstance, this, [value])) return true; return this === PostgresScopedSlugIndexBuildError && Reflect.apply(nativeHasInstance, loadRuntime().PostgresScopedSlugIndexBuildError, [value]); }
};
Object.defineProperties(_PostgresScopedSlugIndexBuildErrorPublicWrapper, { name: { value: "PostgresScopedSlugIndexBuildError", configurable: true }, length: { value: 2, configurable: true } });
export const PostgresScopedSlugIndexBuildError = _PostgresScopedSlugIndexBuildErrorPublicWrapper as unknown as typeof Runtime.PostgresScopedSlugIndexBuildError;
export type PostgresScopedSlugIndexBuildError = Runtime.PostgresScopedSlugIndexBuildError;
const _PostgresScopedSlugMigrationConflictErrorPublicWrapper = class PostgresScopedSlugMigrationConflictError extends Error {
  constructor(a0: any, ...args: any[]) { super(); assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); const runtimeClass = loadRuntime().PostgresScopedSlugMigrationConflictError; bridgeRuntimeClassInstanceof(runtimeClass, PostgresScopedSlugMigrationConflictError); return Reflect.construct(runtimeClass, [a0, ...args], new.target) as any; }
  static [Symbol.hasInstance](value: unknown): boolean { assertStageALocalStorageRole(process.env); const nativeHasInstance = Function.prototype[Symbol.hasInstance]; if (Reflect.apply(nativeHasInstance, this, [value])) return true; return this === PostgresScopedSlugMigrationConflictError && Reflect.apply(nativeHasInstance, loadRuntime().PostgresScopedSlugMigrationConflictError, [value]); }
};
Object.defineProperties(_PostgresScopedSlugMigrationConflictErrorPublicWrapper, { name: { value: "PostgresScopedSlugMigrationConflictError", configurable: true }, length: { value: 1, configurable: true } });
export const PostgresScopedSlugMigrationConflictError = _PostgresScopedSlugMigrationConflictErrorPublicWrapper as unknown as typeof Runtime.PostgresScopedSlugMigrationConflictError;
export type PostgresScopedSlugMigrationConflictError = Runtime.PostgresScopedSlugMigrationConflictError;
export const STORAGE_TABLES = lazyPublicValue("STORAGE_TABLES", "array") as typeof Runtime.STORAGE_TABLES;
export const TODOS_STORAGE_ENV = lazyPublicValue("TODOS_STORAGE_ENV", "object") as typeof Runtime.TODOS_STORAGE_ENV;
export const TODOS_STORAGE_FALLBACK_ENV = lazyPublicValue("TODOS_STORAGE_FALLBACK_ENV", "object") as typeof Runtime.TODOS_STORAGE_FALLBACK_ENV;
export const TODOS_STORAGE_TABLES = STORAGE_TABLES as typeof Runtime.TODOS_STORAGE_TABLES;
const _TodosShadowMirrorPublicWrapper = class TodosShadowMirror {
  constructor(a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); const runtimeClass = loadRuntime().TodosShadowMirror; bridgeRuntimeClassInstanceof(runtimeClass, TodosShadowMirror); return Reflect.construct(runtimeClass, [a0, ...args], new.target) as any; }
  static [Symbol.hasInstance](value: unknown): boolean { assertStageALocalStorageRole(process.env); const nativeHasInstance = Function.prototype[Symbol.hasInstance]; if (Reflect.apply(nativeHasInstance, this, [value])) return true; return this === TodosShadowMirror && Reflect.apply(nativeHasInstance, loadRuntime().TodosShadowMirror, [value]); }
  getMetrics(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "getMetrics"), this, [...args]); }
  enqueueUpsert(a0: any, a1: any, a2: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, a2, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "enqueueUpsert"), this, [a0, a1, a2, ...args]); }
  enqueueDelete(a0: any, a1: any, a2: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, a2, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "enqueueDelete"), this, [a0, a1, a2, ...args]); }
  async flush(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "flush"), this, [...args]); }
  idle(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "idle"), this, [...args]); }
  notifyIdle(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "notifyIdle"), this, [...args]); }
  pump(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "pump"), this, [...args]); }
  async drain(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "drain"), this, [...args]); }
  async process(a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "process"), this, [a0, ...args]); }
  ensureSchema(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "ensureSchema"), this, [...args]); }
  async push(a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowMirror.prototype, "push"), this, [a0, ...args]); }
};
Object.defineProperties(_TodosShadowMirrorPublicWrapper, { name: { value: "TodosShadowMirror", configurable: true }, length: { value: 1, configurable: true } });
export const TodosShadowMirror = _TodosShadowMirrorPublicWrapper as unknown as typeof Runtime.TodosShadowMirror;
export type TodosShadowMirror = Runtime.TodosShadowMirror;
const _TodosShadowOutboxPublicWrapper = class TodosShadowOutbox {
  constructor(a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); const runtimeClass = loadRuntime().TodosShadowOutbox; bridgeRuntimeClassInstanceof(runtimeClass, TodosShadowOutbox); return Reflect.construct(runtimeClass, [a0, ...args], new.target) as any; }
  static [Symbol.hasInstance](value: unknown): boolean { assertStageALocalStorageRole(process.env); const nativeHasInstance = Function.prototype[Symbol.hasInstance]; if (Reflect.apply(nativeHasInstance, this, [value])) return true; return this === TodosShadowOutbox && Reflect.apply(nativeHasInstance, loadRuntime().TodosShadowOutbox, [value]); }
  install(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "install"), this, [...args]); }
  getStats(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "getStats"), this, [...args]); }
  countByStatus(a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "countByStatus"), this, [a0, ...args]); }
  startLoop(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "startLoop"), this, [...args]); }
  stopLoop(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "stopLoop"), this, [...args]); }
  async flush(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "flush"), this, [...args]); }
  async drainOnce(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "drainOnce"), this, [...args]); }
  async processRow(a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "processRow"), this, [a0, ...args]); }
  async buildSnapshot(a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "buildSnapshot"), this, [a0, ...args]); }
  async readCurrent(a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "readCurrent"), this, [a0, a1, ...args]); }
  tombstone(a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "tombstone"), this, [a0, a1, ...args]); }
  ensureSchema(...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(Reflect.get(loadRuntime().TodosShadowOutbox.prototype, "ensureSchema"), this, [...args]); }
};
Object.defineProperties(_TodosShadowOutboxPublicWrapper, { name: { value: "TodosShadowOutbox", configurable: true }, length: { value: 1, configurable: true } });
export const TodosShadowOutbox = _TodosShadowOutboxPublicWrapper as unknown as typeof Runtime.TodosShadowOutbox;
export type TodosShadowOutbox = Runtime.TodosShadowOutbox;
export const assertTodosLocalStorageRole = function assertTodosLocalStorageRole(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().assertTodosLocalStorageRole, this, [...args]); } as unknown as typeof Runtime.assertTodosLocalStorageRole;
Object.defineProperties(assertTodosLocalStorageRole, { name: { value: "assertTodosLocalStorageRole", configurable: true }, length: { value: 0, configurable: true } });
export const assertTodosRemoteStorageConfig = function assertTodosRemoteStorageConfig(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().assertTodosRemoteStorageConfig, this, [a0, ...args]); } as unknown as typeof Runtime.assertTodosRemoteStorageConfig;
Object.defineProperties(assertTodosRemoteStorageConfig, { name: { value: "assertTodosRemoteStorageConfig", configurable: true }, length: { value: 1, configurable: true } });
export const assertTodosShadowConfig = function assertTodosShadowConfig(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().assertTodosShadowConfig, this, [a0, ...args]); } as unknown as typeof Runtime.assertTodosShadowConfig;
Object.defineProperties(assertTodosShadowConfig, { name: { value: "assertTodosShadowConfig", configurable: true }, length: { value: 1, configurable: true } });
export const backfillPostgresCommentRedaction = async function backfillPostgresCommentRedaction(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().backfillPostgresCommentRedaction, this, [a0, ...args]); } as unknown as typeof Runtime.backfillPostgresCommentRedaction;
Object.defineProperties(backfillPostgresCommentRedaction, { name: { value: "backfillPostgresCommentRedaction", configurable: true }, length: { value: 1, configurable: true } });
export const buildS3ObjectKey = function buildS3ObjectKey(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().buildS3ObjectKey, this, [a0, a1, ...args]); } as unknown as typeof Runtime.buildS3ObjectKey;
Object.defineProperties(buildS3ObjectKey, { name: { value: "buildS3ObjectKey", configurable: true }, length: { value: 2, configurable: true } });
export const buildS3ObjectUrl = function buildS3ObjectUrl(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().buildS3ObjectUrl, this, [a0, a1, ...args]); } as unknown as typeof Runtime.buildS3ObjectUrl;
Object.defineProperties(buildS3ObjectUrl, { name: { value: "buildS3ObjectUrl", configurable: true }, length: { value: 2, configurable: true } });
export const closeRuntimeShadowCloud = async function closeRuntimeShadowCloud(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().closeRuntimeShadowCloud, this, [...args]); } as unknown as typeof Runtime.closeRuntimeShadowCloud;
Object.defineProperties(closeRuntimeShadowCloud, { name: { value: "closeRuntimeShadowCloud", configurable: true }, length: { value: 0, configurable: true } });
export const createHybridTodosStorageAdapter = function createHybridTodosStorageAdapter(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createHybridTodosStorageAdapter, this, [a0, ...args]); } as unknown as typeof Runtime.createHybridTodosStorageAdapter;
Object.defineProperties(createHybridTodosStorageAdapter, { name: { value: "createHybridTodosStorageAdapter", configurable: true }, length: { value: 1, configurable: true } });
export const createLocalSqliteTodosStorageAdapter = function createLocalSqliteTodosStorageAdapter(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createLocalSqliteTodosStorageAdapter, this, [...args]); } as unknown as typeof Runtime.createLocalSqliteTodosStorageAdapter;
Object.defineProperties(createLocalSqliteTodosStorageAdapter, { name: { value: "createLocalSqliteTodosStorageAdapter", configurable: true }, length: { value: 0, configurable: true } });
export const createPostgresTodosStorageAdapter = function createPostgresTodosStorageAdapter(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createPostgresTodosStorageAdapter, this, [a0, ...args]); } as unknown as typeof Runtime.createPostgresTodosStorageAdapter;
Object.defineProperties(createPostgresTodosStorageAdapter, { name: { value: "createPostgresTodosStorageAdapter", configurable: true }, length: { value: 1, configurable: true } });
export const createPostgresTodosSyncStore = function createPostgresTodosSyncStore(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createPostgresTodosSyncStore, this, [a0, ...args]); } as unknown as typeof Runtime.createPostgresTodosSyncStore;
Object.defineProperties(createPostgresTodosSyncStore, { name: { value: "createPostgresTodosSyncStore", configurable: true }, length: { value: 1, configurable: true } });
export const createShadowTodosStorageAdapter = function createShadowTodosStorageAdapter(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createShadowTodosStorageAdapter, this, [a0, ...args]); } as unknown as typeof Runtime.createShadowTodosStorageAdapter;
Object.defineProperties(createShadowTodosStorageAdapter, { name: { value: "createShadowTodosStorageAdapter", configurable: true }, length: { value: 1, configurable: true } });
export const createTodosCloudQueryClient = function createTodosCloudQueryClient(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createTodosCloudQueryClient, this, [a0, ...args]); } as unknown as typeof Runtime.createTodosCloudQueryClient;
Object.defineProperties(createTodosCloudQueryClient, { name: { value: "createTodosCloudQueryClient", configurable: true }, length: { value: 1, configurable: true } });
export const createTodosCloudQueryClientFromEnv = function createTodosCloudQueryClientFromEnv(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createTodosCloudQueryClientFromEnv, this, [...args]); } as unknown as typeof Runtime.createTodosCloudQueryClientFromEnv;
Object.defineProperties(createTodosCloudQueryClientFromEnv, { name: { value: "createTodosCloudQueryClientFromEnv", configurable: true }, length: { value: 0, configurable: true } });
export const createTodosS3ArtifactStore = function createTodosS3ArtifactStore(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createTodosS3ArtifactStore, this, [a0, ...args]); } as unknown as typeof Runtime.createTodosS3ArtifactStore;
Object.defineProperties(createTodosS3ArtifactStore, { name: { value: "createTodosS3ArtifactStore", configurable: true }, length: { value: 1, configurable: true } });
export const createTodosShadowOutbox = function createTodosShadowOutbox(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().createTodosShadowOutbox, this, [a0, ...args]); } as unknown as typeof Runtime.createTodosShadowOutbox;
Object.defineProperties(createTodosShadowOutbox, { name: { value: "createTodosShadowOutbox", configurable: true }, length: { value: 1, configurable: true } });
export const createTodosStorageAdapter = function createTodosStorageAdapter(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().createTodosStorageAdapter, this, [...args]); } as unknown as typeof Runtime.createTodosStorageAdapter;
Object.defineProperties(createTodosStorageAdapter, { name: { value: "createTodosStorageAdapter", configurable: true }, length: { value: 0, configurable: true } });
export const downloadRunArtifactsFromS3 = async function downloadRunArtifactsFromS3(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().downloadRunArtifactsFromS3, this, [a0, ...args]); } as unknown as typeof Runtime.downloadRunArtifactsFromS3;
Object.defineProperties(downloadRunArtifactsFromS3, { name: { value: "downloadRunArtifactsFromS3", configurable: true }, length: { value: 1, configurable: true } });
export const ensurePostgresScopedSlugUniqueIndexes = async function ensurePostgresScopedSlugUniqueIndexes(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().ensurePostgresScopedSlugUniqueIndexes, this, [a0, ...args]); } as unknown as typeof Runtime.ensurePostgresScopedSlugUniqueIndexes;
Object.defineProperties(ensurePostgresScopedSlugUniqueIndexes, { name: { value: "ensurePostgresScopedSlugUniqueIndexes", configurable: true }, length: { value: 1, configurable: true } });
export const exportSqliteTodosStorageSnapshot = function exportSqliteTodosStorageSnapshot(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().exportSqliteTodosStorageSnapshot, this, [a0, ...args]); } as unknown as typeof Runtime.exportSqliteTodosStorageSnapshot;
Object.defineProperties(exportSqliteTodosStorageSnapshot, { name: { value: "exportSqliteTodosStorageSnapshot", configurable: true }, length: { value: 1, configurable: true } });
export const getCanonicalTodosRdsConfig = function getCanonicalTodosRdsConfig(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getCanonicalTodosRdsConfig, this, [...args]); } as unknown as typeof Runtime.getCanonicalTodosRdsConfig;
Object.defineProperties(getCanonicalTodosRdsConfig, { name: { value: "getCanonicalTodosRdsConfig", configurable: true }, length: { value: 0, configurable: true } });
export const getRuntimeShadowOutbox = function getRuntimeShadowOutbox(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().getRuntimeShadowOutbox, this, [a0, ...args]); } as unknown as typeof Runtime.getRuntimeShadowOutbox;
Object.defineProperties(getRuntimeShadowOutbox, { name: { value: "getRuntimeShadowOutbox", configurable: true }, length: { value: 1, configurable: true } });
export const getStorageDatabaseEnv = function getStorageDatabaseEnv(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getStorageDatabaseEnv, this, [...args]); } as unknown as typeof Runtime.getStorageDatabaseEnv;
Object.defineProperties(getStorageDatabaseEnv, { name: { value: "getStorageDatabaseEnv", configurable: true }, length: { value: 0, configurable: true } });
export const getStorageDatabaseUrl = function getStorageDatabaseUrl(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getStorageDatabaseUrl, this, [...args]); } as unknown as typeof Runtime.getStorageDatabaseUrl;
Object.defineProperties(getStorageDatabaseUrl, { name: { value: "getStorageDatabaseUrl", configurable: true }, length: { value: 0, configurable: true } });
export const getStorageMode = function getStorageMode(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getStorageMode, this, [...args]); } as unknown as typeof Runtime.getStorageMode;
Object.defineProperties(getStorageMode, { name: { value: "getStorageMode", configurable: true }, length: { value: 0, configurable: true } });
export const getTodosStorageDatabaseEnv = function getTodosStorageDatabaseEnv(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getTodosStorageDatabaseEnv, this, [...args]); } as unknown as typeof Runtime.getTodosStorageDatabaseEnv;
Object.defineProperties(getTodosStorageDatabaseEnv, { name: { value: "getTodosStorageDatabaseEnv", configurable: true }, length: { value: 0, configurable: true } });
export const getTodosStorageDatabaseUrl = function getTodosStorageDatabaseUrl(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getTodosStorageDatabaseUrl, this, [...args]); } as unknown as typeof Runtime.getTodosStorageDatabaseUrl;
Object.defineProperties(getTodosStorageDatabaseUrl, { name: { value: "getTodosStorageDatabaseUrl", configurable: true }, length: { value: 0, configurable: true } });
export const getTodosStorageEnvName = function getTodosStorageEnvName(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().getTodosStorageEnvName, this, [a0, a1, ...args]); } as unknown as typeof Runtime.getTodosStorageEnvName;
Object.defineProperties(getTodosStorageEnvName, { name: { value: "getTodosStorageEnvName", configurable: true }, length: { value: 2, configurable: true } });
export const getTodosStorageMode = function getTodosStorageMode(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getTodosStorageMode, this, [...args]); } as unknown as typeof Runtime.getTodosStorageMode;
Object.defineProperties(getTodosStorageMode, { name: { value: "getTodosStorageMode", configurable: true }, length: { value: 0, configurable: true } });
export const getTodosStorageShadowEnvName = function getTodosStorageShadowEnvName(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().getTodosStorageShadowEnvName, this, [...args]); } as unknown as typeof Runtime.getTodosStorageShadowEnvName;
Object.defineProperties(getTodosStorageShadowEnvName, { name: { value: "getTodosStorageShadowEnvName", configurable: true }, length: { value: 0, configurable: true } });
export const importSqliteTodosStorageSnapshot = function importSqliteTodosStorageSnapshot(this: unknown, a0: any, a1: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, a1, ...args]); return Reflect.apply(loadRuntime().importSqliteTodosStorageSnapshot, this, [a0, a1, ...args]); } as unknown as typeof Runtime.importSqliteTodosStorageSnapshot;
Object.defineProperties(importSqliteTodosStorageSnapshot, { name: { value: "importSqliteTodosStorageSnapshot", configurable: true }, length: { value: 2, configurable: true } });
export const installShadowOutboxSchema = function installShadowOutboxSchema(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().installShadowOutboxSchema, this, [a0, ...args]); } as unknown as typeof Runtime.installShadowOutboxSchema;
Object.defineProperties(installShadowOutboxSchema, { name: { value: "installShadowOutboxSchema", configurable: true }, length: { value: 1, configurable: true } });
export const isCommentRedactionBackfillComplete = function isCommentRedactionBackfillComplete(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().isCommentRedactionBackfillComplete, this, [a0, ...args]); } as unknown as typeof Runtime.isCommentRedactionBackfillComplete;
Object.defineProperties(isCommentRedactionBackfillComplete, { name: { value: "isCommentRedactionBackfillComplete", configurable: true }, length: { value: 1, configurable: true } });
export const isTodosRemoteStorageEnabled = function isTodosRemoteStorageEnabled(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().isTodosRemoteStorageEnabled, this, [a0, ...args]); } as unknown as typeof Runtime.isTodosRemoteStorageEnabled;
Object.defineProperties(isTodosRemoteStorageEnabled, { name: { value: "isTodosRemoteStorageEnabled", configurable: true }, length: { value: 1, configurable: true } });
export const isTodosShadowEnabled = function isTodosShadowEnabled(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().isTodosShadowEnabled, this, [...args]); } as unknown as typeof Runtime.isTodosShadowEnabled;
Object.defineProperties(isTodosShadowEnabled, { name: { value: "isTodosShadowEnabled", configurable: true }, length: { value: 0, configurable: true } });
export const loadStorageConfig = function loadStorageConfig(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().loadStorageConfig, this, [...args]); } as unknown as typeof Runtime.loadStorageConfig;
Object.defineProperties(loadStorageConfig, { name: { value: "loadStorageConfig", configurable: true }, length: { value: 0, configurable: true } });
export const loadTodosStorageConfig = function loadTodosStorageConfig(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().loadTodosStorageConfig, this, [...args]); } as unknown as typeof Runtime.loadTodosStorageConfig;
Object.defineProperties(loadTodosStorageConfig, { name: { value: "loadTodosStorageConfig", configurable: true }, length: { value: 0, configurable: true } });
export const maybeInstallShadowCapture = function maybeInstallShadowCapture(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().maybeInstallShadowCapture, this, [a0, ...args]); } as unknown as typeof Runtime.maybeInstallShadowCapture;
Object.defineProperties(maybeInstallShadowCapture, { name: { value: "maybeInstallShadowCapture", configurable: true }, length: { value: 1, configurable: true } });
export const normalizeTodosStorageMode = function normalizeTodosStorageMode(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().normalizeTodosStorageMode, this, [a0, ...args]); } as unknown as typeof Runtime.normalizeTodosStorageMode;
Object.defineProperties(normalizeTodosStorageMode, { name: { value: "normalizeTodosStorageMode", configurable: true }, length: { value: 1, configurable: true } });
export const parseStorageMode = function parseStorageMode(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().parseStorageMode, this, [a0, ...args]); } as unknown as typeof Runtime.parseStorageMode;
Object.defineProperties(parseStorageMode, { name: { value: "parseStorageMode", configurable: true }, length: { value: 1, configurable: true } });
export const planRunArtifactsS3Sync = function planRunArtifactsS3Sync(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().planRunArtifactsS3Sync, this, [a0, ...args]); } as unknown as typeof Runtime.planRunArtifactsS3Sync;
Object.defineProperties(planRunArtifactsS3Sync, { name: { value: "planRunArtifactsS3Sync", configurable: true }, length: { value: 1, configurable: true } });
export const postgresTodosCommentCursorIndexSql = function postgresTodosCommentCursorIndexSql(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().postgresTodosCommentCursorIndexSql, this, [...args]); } as unknown as typeof Runtime.postgresTodosCommentCursorIndexSql;
Object.defineProperties(postgresTodosCommentCursorIndexSql, { name: { value: "postgresTodosCommentCursorIndexSql", configurable: true }, length: { value: 0, configurable: true } });
export const postgresTodosScopedSlugIndexStatusSql = function postgresTodosScopedSlugIndexStatusSql(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().postgresTodosScopedSlugIndexStatusSql, this, [...args]); } as unknown as typeof Runtime.postgresTodosScopedSlugIndexStatusSql;
Object.defineProperties(postgresTodosScopedSlugIndexStatusSql, { name: { value: "postgresTodosScopedSlugIndexStatusSql", configurable: true }, length: { value: 0, configurable: true } });
export const postgresTodosScopedSlugPreflightSql = function postgresTodosScopedSlugPreflightSql(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().postgresTodosScopedSlugPreflightSql, this, [...args]); } as unknown as typeof Runtime.postgresTodosScopedSlugPreflightSql;
Object.defineProperties(postgresTodosScopedSlugPreflightSql, { name: { value: "postgresTodosScopedSlugPreflightSql", configurable: true }, length: { value: 0, configurable: true } });
export const postgresTodosScopedSlugUniqueIndexSql = function postgresTodosScopedSlugUniqueIndexSql(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().postgresTodosScopedSlugUniqueIndexSql, this, [...args]); } as unknown as typeof Runtime.postgresTodosScopedSlugUniqueIndexSql;
Object.defineProperties(postgresTodosScopedSlugUniqueIndexSql, { name: { value: "postgresTodosScopedSlugUniqueIndexSql", configurable: true }, length: { value: 0, configurable: true } });
export const postgresTodosSyncSchemaSql = function postgresTodosSyncSchemaSql(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().postgresTodosSyncSchemaSql, this, [...args]); } as unknown as typeof Runtime.postgresTodosSyncSchemaSql;
Object.defineProperties(postgresTodosSyncSchemaSql, { name: { value: "postgresTodosSyncSchemaSql", configurable: true }, length: { value: 0, configurable: true } });
export const registerShadowExitFlush = function registerShadowExitFlush(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().registerShadowExitFlush, this, [a0, ...args]); } as unknown as typeof Runtime.registerShadowExitFlush;
Object.defineProperties(registerShadowExitFlush, { name: { value: "registerShadowExitFlush", configurable: true }, length: { value: 1, configurable: true } });
export const resolveTodosStorageRole = function resolveTodosStorageRole(this: unknown, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([...args]); return Reflect.apply(loadRuntime().resolveTodosStorageRole, this, [...args]); } as unknown as typeof Runtime.resolveTodosStorageRole;
Object.defineProperties(resolveTodosStorageRole, { name: { value: "resolveTodosStorageRole", configurable: true }, length: { value: 0, configurable: true } });
export const signAwsV4Request = function signAwsV4Request(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().signAwsV4Request, this, [a0, ...args]); } as unknown as typeof Runtime.signAwsV4Request;
Object.defineProperties(signAwsV4Request, { name: { value: "signAwsV4Request", configurable: true }, length: { value: 1, configurable: true } });
export const startRuntimeShadowDrain = function startRuntimeShadowDrain(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().startRuntimeShadowDrain, this, [a0, ...args]); } as unknown as typeof Runtime.startRuntimeShadowDrain;
Object.defineProperties(startRuntimeShadowDrain, { name: { value: "startRuntimeShadowDrain", configurable: true }, length: { value: 1, configurable: true } });
export const uploadRunArtifactsToS3 = async function uploadRunArtifactsToS3(this: unknown, a0: any, ...args: any[]) { assertStageALocalStorageRole(process.env); assertPublicSqliteBoundaryArguments([a0, ...args]); return Reflect.apply(loadRuntime().uploadRunArtifactsToS3, this, [a0, ...args]); } as unknown as typeof Runtime.uploadRunArtifactsToS3;
Object.defineProperties(uploadRunArtifactsToS3, { name: { value: "uploadRunArtifactsToS3", configurable: true }, length: { value: 1, configurable: true } });
