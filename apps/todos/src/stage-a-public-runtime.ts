/**
 * Single production owner for every Stage A public wrapper that can observe a
 * SQLite capability. Building this graph once keeps constructor provenance,
 * database singletons, and cross-subpath dispatch in one module instance.
 */
import * as contractsRuntime from "./contracts.runtime.js";
import * as rootRuntime from "./index.runtime.js";
import * as storageRuntime from "./storage.runtime.js";
import * as localSqliteRuntime from "./storage/local-sqlite.js";
import * as sqliteSnapshotRuntime from "./storage/sqlite-snapshot-runtime.js";
import * as stageAPublicHelperRuntime from "./storage/stage-a-public-helper-runtime.js";
import {
  assertPublicSqliteBoundaryArguments,
  isConstructorOwnedSqliteDatabase,
} from "./db/database.js";
import { assertTodosLocalStorageRole } from "./storage/config.js";

export const contracts = contractsRuntime;
export const localSqlite = localSqliteRuntime;
export const root = rootRuntime;
export const sqliteSnapshot = sqliteSnapshotRuntime;
export const stageAPublicHelpers = stageAPublicHelperRuntime;
export const storage = storageRuntime;

type Capability = object | Function;

const publicCapabilityByRuntime = new WeakMap<Capability, Capability>();
const runtimeCapabilityByPublic = new WeakMap<Capability, Capability>();

function isObjectLike(value: unknown): value is Capability {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isPlainResult(value: Capability): boolean {
  if (typeof value === "function") return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === null
    || prototype === Object.prototype
    || prototype === Array.prototype
    || prototype === Date.prototype
    || prototype === RegExp.prototype
    || prototype === Map.prototype
    || prototype === Set.prototype
    || ArrayBuffer.isView(value)
    || value instanceof ArrayBuffer;
}

function unwrapPublicCapability<T>(value: T): T {
  if (!isObjectLike(value)) return value;
  return (runtimeCapabilityByPublic.get(value) ?? value) as T;
}

function guardRuntimeCapability(runtimeCapability: Capability): Capability {
  const existing = publicCapabilityByRuntime.get(runtimeCapability);
  if (existing) return existing;

  const methodWrappers = new WeakMap<Function, Function>();
  let publicCapability!: Capability;
  const authorize = (): void => { assertTodosLocalStorageRole(process.env); };
  const publicizeDerived = (value: unknown): unknown => {
    if (value === runtimeCapability) return publicCapability;
    if (!isObjectLike(value) || isPlainResult(value)) return value;
    return guardRuntimeCapability(value);
  };
  const publicizeProperty = (property: PropertyKey, value: unknown): unknown => {
    if (value === runtimeCapability) return publicCapability;
    if (typeof value !== "function") return value;
    const prototype = Reflect.getPrototypeOf(runtimeCapability);
    if (property === "constructor" && prototype && value === Reflect.get(prototype, "constructor", prototype)) return value;
    const existingMethod = methodWrappers.get(value);
    if (existingMethod) return existingMethod;
    const method = new Proxy(value, {
      apply(_target, _thisArg, args) {
        authorize();
        const prepared = preparePublicSqliteBoundaryArguments(args);
        return publicizeDerived(Reflect.apply(value, runtimeCapability, prepared));
      },
      construct(_target, args, newTarget) {
        authorize();
        return publicizeDerived(Reflect.construct(value, preparePublicSqliteBoundaryArguments(args), newTarget)) as object;
      },
    });
    methodWrappers.set(value, method);
    methodWrappers.set(method, method);
    return method;
  };

  const handler: ProxyHandler<any> = {
    get(_target, property) {
      authorize();
      return publicizeProperty(property, Reflect.get(runtimeCapability, property, runtimeCapability));
    },
    set(_target, property, value) {
      authorize();
      return Reflect.set(runtimeCapability, property, unwrapPublicCapability(value), runtimeCapability);
    },
    has(_target, property) { authorize(); return Reflect.has(runtimeCapability, property); },
    ownKeys() { authorize(); return Reflect.ownKeys(runtimeCapability); },
    getOwnPropertyDescriptor(_target, property) {
      authorize();
      const descriptor = Reflect.getOwnPropertyDescriptor(runtimeCapability, property);
      if (!descriptor || !("value" in descriptor) || descriptor.configurable === false) return descriptor;
      return { ...descriptor, value: publicizeProperty(property, descriptor.value) };
    },
    defineProperty(_target, property, descriptor) {
      authorize();
      const prepared = "value" in descriptor
        ? { ...descriptor, value: unwrapPublicCapability(descriptor.value) }
        : descriptor;
      return Reflect.defineProperty(runtimeCapability, property, prepared);
    },
    deleteProperty(_target, property) { authorize(); return Reflect.deleteProperty(runtimeCapability, property); },
    getPrototypeOf() { authorize(); return Reflect.getPrototypeOf(runtimeCapability); },
    setPrototypeOf(_target, prototype) { authorize(); return Reflect.setPrototypeOf(runtimeCapability, prototype); },
    isExtensible() { authorize(); return Reflect.isExtensible(runtimeCapability); },
    preventExtensions() { authorize(); return Reflect.preventExtensions(runtimeCapability); },
    ...(typeof runtimeCapability === "function" ? {
      apply(_target: Function, _thisArg: unknown, args: unknown[]) {
        authorize();
        return publicizeDerived(Reflect.apply(runtimeCapability as Function, undefined, preparePublicSqliteBoundaryArguments(args)));
      },
      construct(_target: Function, args: unknown[], newTarget: Function) {
        authorize();
        return publicizeDerived(Reflect.construct(runtimeCapability as Function, preparePublicSqliteBoundaryArguments(args), newTarget)) as object;
      },
    } : {}),
  };
  publicCapability = new Proxy(runtimeCapability, handler);
  publicCapabilityByRuntime.set(runtimeCapability, publicCapability);
  runtimeCapabilityByPublic.set(publicCapability, runtimeCapability);
  return publicCapability;
}

function prepareBoundaryValue(value: unknown): unknown {
  if (!isObjectLike(value)) return value;
  const unwrapped = unwrapPublicCapability(value);
  if (unwrapped !== value) return unwrapped;
  const objectValue = value;

  let replacement: object | undefined;
  for (const key of ["db", "database"] as const) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(objectValue, key);
    } catch {
      assertPublicSqliteBoundaryArguments([objectValue]);
      return objectValue;
    }
    if (!descriptor || !("value" in descriptor)) continue;
    const raw = unwrapPublicCapability(descriptor.value);
    if (raw === descriptor.value) continue;
    const target = replacement ?? Object.create(
      Reflect.getPrototypeOf(objectValue),
      Object.getOwnPropertyDescriptors(objectValue),
    );
    replacement = target;
    Reflect.defineProperty(target, key, { ...descriptor, value: raw });
  }
  return replacement ?? objectValue;
}

/** Validate public SQLite inputs and replace only wrappers issued by this owner. */
export function preparePublicSqliteBoundaryArguments(args: readonly unknown[]): unknown[] {
  assertTodosLocalStorageRole(process.env);
  const prepared = args.map(prepareBoundaryValue);
  assertPublicSqliteBoundaryArguments(prepared);
  return prepared;
}

/** Keep constructor-owned SQLite capabilities on the generated public contract. */
export function publicizePublicSqliteBoundaryResult<T>(value: T): T {
  if (isObjectLike(value) && isConstructorOwnedSqliteDatabase(value)) {
    return guardRuntimeCapability(value) as T;
  }
  return value;
}

export { assertPublicSqliteBoundaryArguments };
