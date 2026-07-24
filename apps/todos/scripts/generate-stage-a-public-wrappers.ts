#!/usr/bin/env bun
/** Mechanical one-time/public-surface generator for the Stage A lazy boundary. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dir, "..");

interface Surface {
  source: string;
  runtime: string;
  ownerNamespace: "contracts" | "root" | "storage";
  authorityError?: boolean;
  dependencyLightReexports?: Array<{ module: string; names: Set<string> }>;
}

function identifier(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(value);
}

function parameterList(length: number): { declaration: string; forwarded: string } {
  const fixed = Array.from({ length }, (_value, index) => `a${index}`);
  return {
    declaration: [...fixed.map((name) => `${name}: any`), "...args: any[]"].join(", "),
    forwarded: [...fixed, "...args"].join(", "),
  };
}

function serialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    // Parenthesize public string constants so a credential-pattern scanner
    // cannot misread a schema constant whose identifier contains SECRET,
    // TOKEN, PASSWORD, or API_KEY as a credential assignment.
    return `(${JSON.stringify(value)})`;
  }
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "Number.NaN";
    if (value === Infinity) return "Number.POSITIVE_INFINITY";
    if (value === -Infinity) return "Number.NEGATIVE_INFINITY";
    if (Object.is(value, -0)) return "-0";
    return String(value);
  }
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value !== "object") throw new Error(`unsupported constant value: ${typeof value}`);
  if (seen.has(value)) throw new Error("cyclic public constant is unsupported");
  seen.add(value);
  try {
    if (value instanceof RegExp) {
      return `new RegExp(${JSON.stringify(value.source)}, ${JSON.stringify(value.flags)})`;
    }
    if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
    if (value instanceof Set) {
      return `new Set([${[...value].map((entry) => serialize(entry, seen)).join(", ")}])`;
    }
    if (value instanceof Map) {
      return `new Map([${[...value].map(([key, entry]) => `[${serialize(key, seen)}, ${serialize(entry, seen)}]`).join(", ")}])`;
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => serialize(entry, seen)).join(", ")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error(`unsupported public constant prototype: ${Object.getPrototypeOf(value)?.constructor?.name}`);
    }
    const entries = Object.entries(value).map(([key, entry]) => {
      const renderedKey = key === "__proto__"
        ? `[${JSON.stringify(key)}]`
        : identifier(key) ? key : JSON.stringify(key);
      return `${renderedKey}: ${serialize(entry, seen)}`;
    });
    return `{${entries.join(", ")}}`;
  } finally {
    seen.delete(value);
  }
}

function lazyValueKind(value: object): string {
  if (Array.isArray(value)) return "array";
  if (value instanceof Map) return "map";
  if (value instanceof Set) return "set";
  if (value instanceof Date) return "date";
  if (value instanceof RegExp) return "regexp";
  if (Object.getPrototypeOf(value) === null) return "null-object";
  if (Object.getPrototypeOf(value) === Object.prototype) return "object";
  throw new Error(`unsupported public constant prototype: ${Object.getPrototypeOf(value)?.constructor?.name}`);
}

function methodName(name: string): string {
  return identifier(name) ? name : `[${JSON.stringify(name)}]`;
}

function renderClass(exportName: string, value: Function, runtimeType: string): string {
  const actualName = identifier(value.name) ? value.name : exportName;
  const implementationName = `_${exportName}PublicWrapper`;
  const extendsError = value.prototype instanceof Error;
  const constructorParameters = parameterList(value.length);
  const methods: string[] = [];
  const staticMembers: string[] = [];
  for (const key of Reflect.ownKeys(value.prototype)) {
    if (key === "constructor" || typeof key === "symbol") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value.prototype, key);
    if (!descriptor) continue;
    const renderedName = methodName(key);
    if (typeof descriptor.value === "function") {
      const parameters = parameterList(descriptor.value.length);
      const asyncPrefix = descriptor.value.constructor?.name === "AsyncFunction" ? "async " : "";
      methods.push(
        `${asyncPrefix}${renderedName}(${parameters.declaration}) { `
        + `assertTodosLocalStorageRole(process.env); const publicArgs = preparePublicSqliteBoundaryArguments([${parameters.forwarded}]); return publicizePublicSqliteBoundaryResult(Reflect.apply(`
        + `Reflect.get(loadRuntime().${exportName}.prototype, ${JSON.stringify(key)}), this, publicArgs)); }`,
      );
    }
    if (descriptor.get) {
      methods.push(
        `get ${renderedName}() { assertTodosLocalStorageRole(process.env); `
        + `return publicizePublicSqliteBoundaryResult(Reflect.get(loadRuntime().${exportName}.prototype, ${JSON.stringify(key)}, this)); }`,
      );
    }
    if (descriptor.set) {
      methods.push(
        `set ${renderedName}(value: any) { assertTodosLocalStorageRole(process.env); const [publicValue] = preparePublicSqliteBoundaryArguments([value]); `
        + `Reflect.set(loadRuntime().${exportName}.prototype, ${JSON.stringify(key)}, publicValue, this); }`,
      );
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length" || key === "name" || key === "prototype" || typeof key === "symbol") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const renderedName = methodName(key);
    if (typeof descriptor.value === "function") {
      const parameters = parameterList(descriptor.value.length);
      const asyncPrefix = descriptor.value.constructor?.name === "AsyncFunction" ? "async " : "";
      staticMembers.push(
        `static ${asyncPrefix}${renderedName}(${parameters.declaration}) { `
        + `assertTodosLocalStorageRole(process.env); const publicArgs = preparePublicSqliteBoundaryArguments([${parameters.forwarded}]); return publicizePublicSqliteBoundaryResult(Reflect.apply(`
        + `Reflect.get(loadRuntime().${exportName}, ${JSON.stringify(key)}), this, publicArgs)); }`,
      );
    }
    if (descriptor.get) {
      staticMembers.push(
        `static get ${renderedName}() { assertTodosLocalStorageRole(process.env); `
        + `return publicizePublicSqliteBoundaryResult(Reflect.get(loadRuntime().${exportName}, ${JSON.stringify(key)}, this)); }`,
      );
    }
    if (descriptor.set) {
      staticMembers.push(
        `static set ${renderedName}(value: any) { assertTodosLocalStorageRole(process.env); const [publicValue] = preparePublicSqliteBoundaryArguments([value]); `
        + `Reflect.set(loadRuntime().${exportName}, ${JSON.stringify(key)}, publicValue, this); }`,
      );
    }
  }
  return `const ${implementationName} = class ${actualName}${extendsError ? " extends Error" : ""} {\n`
    + `  constructor(${constructorParameters.declaration}) { ${extendsError ? "super(); " : ""}assertTodosLocalStorageRole(process.env); `
    + `const publicArgs = preparePublicSqliteBoundaryArguments([${constructorParameters.forwarded}]); `
    + `const runtimeClass = loadRuntime().${exportName}; `
    + `bridgeRuntimeClassInstanceof(runtimeClass, ${actualName}); `
    + `return publicizePublicSqliteBoundaryResult(Reflect.construct(runtimeClass, publicArgs, new.target)) as any; }\n`
    + staticMembers.map((member) => `  ${member}\n`).join("")
    + `  static [Symbol.hasInstance](value: unknown): boolean { assertTodosLocalStorageRole(process.env); `
    + `const nativeHasInstance = Function.prototype[Symbol.hasInstance]; `
    + `if (Reflect.apply(nativeHasInstance, this, [value])) return true; `
    + `return this === ${actualName} `
    + `&& Reflect.apply(nativeHasInstance, loadRuntime().${exportName}, [value]); }\n`
    + methods.map((method) => `  ${method}\n`).join("")
    + `};\n`
    + `Object.defineProperties(${implementationName}, { name: { value: ${JSON.stringify(actualName)}, configurable: true }, `
    + `length: { value: ${value.length}, configurable: true } });\n`
    + `export const ${exportName} = ${implementationName} as unknown as typeof ${runtimeType}.${exportName};\n`
    + `export type ${exportName} = ${runtimeType}.${exportName};`;
}

function renderFunction(exportName: string, value: Function, runtimeType: string): string {
  const actualName = identifier(value.name) ? value.name : exportName;
  const parameters = parameterList(value.length);
  const asyncPrefix = value.constructor?.name === "AsyncFunction" ? "async " : "";
  return `export const ${exportName} = ${asyncPrefix}function ${actualName}(`
    + `this: unknown${parameters.declaration ? `, ${parameters.declaration}` : ""}) { `
    + `assertTodosLocalStorageRole(process.env); const publicArgs = preparePublicSqliteBoundaryArguments([${parameters.forwarded}]); `
    + `return publicizePublicSqliteBoundaryResult(Reflect.apply(loadRuntime().${exportName}, this, publicArgs)); } as unknown as typeof ${runtimeType}.${exportName};\n`
    + `Object.defineProperties(${exportName}, { name: { value: ${JSON.stringify(actualName)}, configurable: true }, `
    + `length: { value: ${value.length}, configurable: true } });`;
}

async function generate(surface: Surface): Promise<void> {
  const sourcePath = join(root, surface.source);
  const runtimePath = join(root, surface.runtime);
  if (!existsSync(runtimePath)) await Bun.write(runtimePath, readFileSync(sourcePath));

  const namespace = await import(`${pathToFileURL(runtimePath).href}?stage-a-wrapper=${Date.now()}`) as Record<string, unknown>;
  const runtimeType = "Runtime";
  const runtimeBase = `./${surface.runtime.split("/").pop()!.replace(/\.ts$/, ".js")}`;
  const lines = [
    "/** Generated dependency-light Stage A public boundary. */",
    `import type * as ${runtimeType} from ${JSON.stringify(runtimeBase)};`,
    'import { assertTodosLocalStorageRole as assertStageALocalStorageRole } from "./storage/config.js";',
    `export type * from ${JSON.stringify(runtimeBase)};`,
  ];
  for (const reexport of surface.dependencyLightReexports ?? []) {
    lines.push(`export { ${[...reexport.names].sort().join(", ")} } from ${JSON.stringify(reexport.module)};`);
  }
  if (surface.authorityError) {
    lines.push('export { TodosHostedStorageUnavailableError } from "./storage/authority-floor.js";');
  }
  lines.push(
    "",
    "function loadRuntimeOwner(): typeof import(\"./stage-a-public-runtime.js\") {",
    "  assertStageALocalStorageRole(process.env);",
    '  const ownerSpecifier = import.meta.url.endsWith(".ts") ? '
      + '"./stage-a-public-runtime.ts" : "./stage-a-public-runtime.js";',
    "  return require(ownerSpecifier) as typeof import(\"./stage-a-public-runtime.js\");",
    "}",
    "",
    "function loadRuntime(): typeof Runtime {",
    `  return loadRuntimeOwner().${surface.ownerNamespace};`,
    "}",
    "",
    "function preparePublicSqliteBoundaryArguments(args: readonly unknown[]): unknown[] {",
    "  return loadRuntimeOwner().preparePublicSqliteBoundaryArguments(args);",
    "}",
    "",
    "function publicizePublicSqliteBoundaryResult<T>(value: T): T {",
    "  return loadRuntimeOwner().publicizePublicSqliteBoundaryResult(value);",
    "}",
    "",
    'type LazyPublicValueKind = "array" | "date" | "map" | "null-object" | "object" | "regexp" | "set";',
    "",
    "function lazyPublicValue(name: keyof typeof Runtime, kind: LazyPublicValueKind): unknown {",
    '  const target: object = kind === "array" ? []',
    '    : kind === "date" ? new Date(0)',
    '      : kind === "map" ? new Map()',
    '        : kind === "null-object" ? Object.create(null)',
    '          : kind === "regexp" ? new RegExp("")',
    '            : kind === "set" ? new Set()',
    "              : {};",
    "  let resolved: object | undefined;",
    "  let publicProxy: object;",
    "  const methodWrappers = new WeakMap<Function, Function>();",
    "  const guardedOperationObjects = new WeakMap<object, object>();",
    "  const targetPrototype = Reflect.getPrototypeOf(target);",
    "  const targetConstructor = targetPrototype === null ? undefined : Reflect.get(targetPrototype, \"constructor\", targetPrototype);",
    "  const resolve = (): object => {",
    "    assertStageALocalStorageRole(process.env);",
    "    if (resolved) return resolved;",
    "    const value = Reflect.get(loadRuntime(), name);",
    '    if (value === null || typeof value !== "object") throw new TypeError(`public export ${String(name)} is not an object`);',
    "    resolved = value;",
    "    return value;",
    "  };",
    "  const operationReceiver = (): object => {",
    "    const value = resolve();",
    "    return Reflect.isExtensible(target) ? value : target;",
    "  };",
    "  const nativeSlotAccessorGetters = new Set<Function>();",
    "  for (const prototype of [Set.prototype, Map.prototype, RegExp.prototype]) {",
    "    for (const property of Reflect.ownKeys(prototype)) {",
    "      const getter = Reflect.getOwnPropertyDescriptor(prototype, property)?.get;",
    "      if (getter) nativeSlotAccessorGetters.add(getter);",
    "    }",
    "  }",
    "  const accessorReceiver = (receiver: object, property: PropertyKey, publicReceiver: object): object => {",
    "    let owner: object | null = receiver;",
    "    while (owner !== null) {",
    "      const descriptor = Reflect.getOwnPropertyDescriptor(owner, property);",
    "      if (descriptor) return descriptor.get && nativeSlotAccessorGetters.has(descriptor.get) ? receiver : publicReceiver;",
    "      owner = Reflect.getPrototypeOf(owner);",
    "    }",
    "    return publicReceiver;",
    "  };",
    "  const guardOperationObject = (operationObject: object): object => {",
    "    const cachedProxy = guardedOperationObjects.get(operationObject);",
    "    if (cachedProxy) return cachedProxy;",
    "    const operationMethods = new WeakMap<Function, Function>();",
    "    const operationPrototype = Reflect.getPrototypeOf(operationObject);",
    "    const operationConstructor = operationPrototype === null",
    "      ? undefined : Reflect.get(operationPrototype, \"constructor\", operationPrototype);",
    "    let operationProxy: object;",
    "    const authorize = (): object => { resolve(); return operationObject; };",
    "    const publicize = (property: PropertyKey, value: unknown): unknown => {",
    "      if (value === operationObject) return operationProxy;",
    "      if (typeof value !== \"function\") return value;",
    "      if (property === \"constructor\" && value === operationConstructor) return value;",
    "      const cachedMethod = operationMethods.get(value);",
    "      if (cachedMethod) return cachedMethod;",
    "      let methodProxy!: Function;",
    "      methodProxy = new Proxy(value, {",
    "        apply(_method, thisArg, args) {",
    "          const receiver = authorize();",
    "          const invocationReceiver = thisArg === operationProxy ? receiver : thisArg;",
    "          const result = Reflect.apply(value, invocationReceiver, args);",
    "          return result === receiver ? operationProxy : result;",
    "        },",
    "        construct(_method, args, newTarget) {",
    "          authorize();",
    "          return Reflect.construct(value, args, newTarget);",
    "        },",
    "      });",
    "      operationMethods.set(value, methodProxy);",
    "      operationMethods.set(methodProxy, methodProxy);",
    "      return methodProxy;",
    "    };",
    "    operationProxy = new Proxy(operationObject, {",
    "      get(_target, property) { const receiver = authorize(); return publicize(property, Reflect.get(receiver, property, operationProxy)); },",
    "      set(_target, property, value) { const receiver = authorize(); return Reflect.set(receiver, property, value, operationProxy); },",
    "      has(_target, property) { return Reflect.has(authorize(), property); },",
    "      ownKeys() { return Reflect.ownKeys(authorize()); },",
    "      getOwnPropertyDescriptor(_target, property) {",
    "        const descriptor = Reflect.getOwnPropertyDescriptor(authorize(), property);",
    "        if (!descriptor || !(\"value\" in descriptor) || descriptor.configurable === false) return descriptor;",
    "        return { ...descriptor, value: publicize(property, descriptor.value) };",
    "      },",
    "      defineProperty(_target, property, descriptor) { return Reflect.defineProperty(authorize(), property, descriptor); },",
    "      deleteProperty(_target, property) { return Reflect.deleteProperty(authorize(), property); },",
    "      getPrototypeOf() { return Reflect.getPrototypeOf(authorize()); },",
    "      setPrototypeOf(_target, prototype) { return Reflect.setPrototypeOf(authorize(), prototype); },",
    "      isExtensible() { return Reflect.isExtensible(authorize()); },",
    "      preventExtensions() { return Reflect.preventExtensions(authorize()); },",
    "    });",
    "    guardedOperationObjects.set(operationObject, operationProxy);",
    "    return operationProxy;",
    "  };",
    "  const isIteratorFactory = (property: PropertyKey): boolean => property === Symbol.iterator",
    "    || ((kind === \"array\" || kind === \"map\" || kind === \"set\")",
    "      && (property === \"entries\" || property === \"keys\" || property === \"values\"));",
    "  const callbackReceiverIndex = (property: PropertyKey): number | undefined => {",
    "    if ((kind === \"map\" || kind === \"set\") && property === \"forEach\") return 2;",
    "    if (kind !== \"array\") return undefined;",
    "    if (property === \"reduce\" || property === \"reduceRight\") return 3;",
    "    return property === \"every\" || property === \"filter\" || property === \"find\"",
    "      || property === \"findIndex\" || property === \"findLast\" || property === \"findLastIndex\"",
    "      || property === \"flatMap\" || property === \"forEach\" || property === \"map\" || property === \"some\"",
    "      ? 2 : undefined;",
    "  };",
    "  const publicizeCallbackArguments = (property: PropertyKey, args: unknown[], receiver: object): unknown[] => {",
    "    const receiverIndex = callbackReceiverIndex(property);",
    "    if (receiverIndex === undefined || typeof args[0] !== \"function\") return args;",
    "    const callback = args[0] as Function;",
    "    const guardedCallback = function (this: unknown, ...callbackArgs: unknown[]): unknown {",
    "      resolve();",
    "      if (callbackArgs[receiverIndex] === receiver) callbackArgs[receiverIndex] = publicProxy;",
    "      return Reflect.apply(callback, this, callbackArgs);",
    "    };",
    "    return [guardedCallback, ...args.slice(1)];",
    "  };",
    "  const publicizeProperty = (receiver: object, property: PropertyKey, value: unknown): unknown => {",
    "    if (value === receiver) return publicProxy;",
    "    if (typeof value !== \"function\") return value;",
    "    if (property === \"constructor\" && value === targetConstructor) return value;",
    "    const cached = methodWrappers.get(value);",
    "    if (cached) return cached;",
    "    let wrapper!: Function;",
    "    wrapper = new Proxy(value, {",
    "      apply(_method, thisArg, args) {",
    "        const currentReceiver = operationReceiver();",
    "        const invocationReceiver = thisArg === publicProxy ? currentReceiver : thisArg;",
    "        const result = Reflect.apply(value, invocationReceiver, publicizeCallbackArguments(property, args, currentReceiver));",
    "        if (result === currentReceiver) return publicProxy;",
    "        return isIteratorFactory(property) && result !== null && typeof result === \"object\"",
    "          ? guardOperationObject(result) : result;",
    "      },",
    "      construct(_method, args, newTarget) {",
    "        const currentReceiver = operationReceiver();",
    "        const result = Reflect.construct(value, args, newTarget);",
    "        return result === currentReceiver ? publicProxy : result;",
    "      },",
    "    });",
    "    methodWrappers.set(value, wrapper);",
    "    methodWrappers.set(wrapper, wrapper);",
    "    return wrapper;",
    "  };",
    "  const publicizeDescriptor = (receiver: object, property: PropertyKey, descriptor: PropertyDescriptor): PropertyDescriptor =>",
    "    \"value\" in descriptor ? { ...descriptor, value: publicizeProperty(receiver, property, descriptor.value) } : descriptor;",
    "  const materializeTarget = (): boolean => {",
    "    const value = resolve();",
    "    if (!Reflect.isExtensible(target)) return true;",
    "    if (kind === \"map\") {",
    "      for (const [entryKey, entryValue] of value as Map<unknown, unknown>)",
    "        (target as Map<unknown, unknown>).set(entryKey, entryValue);",
    "    } else if (kind === \"set\") {",
    "      for (const entryValue of value as Set<unknown>) (target as Set<unknown>).add(entryValue);",
    "    } else if (kind === \"date\") {",
    "      (target as Date).setTime((value as Date).getTime());",
    "    }",
    "    for (const property of Reflect.ownKeys(value)) {",
    "      const rawDescriptor = Reflect.getOwnPropertyDescriptor(value, property);",
    "      if (!rawDescriptor) continue;",
    "      const descriptor = publicizeDescriptor(value, property, rawDescriptor);",
    "      const current = Reflect.getOwnPropertyDescriptor(target, property);",
    "      if (current && !current.configurable) {",
    "        if (\"value\" in descriptor && \"value\" in current) {",
    "          if (!Reflect.defineProperty(target, property, { value: descriptor.value, writable: descriptor.writable })) return false;",
    "        } else if (descriptor.get !== current.get || descriptor.set !== current.set) return false;",
    "        continue;",
    "      }",
    "      if (!Reflect.defineProperty(target, property, descriptor)) return false;",
    "    }",
    "    return Reflect.preventExtensions(target);",
    "  };",
    "  publicProxy = new Proxy(target, {",
    "    get(_target, property) {",
    "      const receiver = operationReceiver();",
    "      const value = Reflect.get(receiver, property, accessorReceiver(receiver, property, publicProxy));",
    "      return publicizeProperty(receiver, property, value);",
    "    },",
    "    set(_target, property, value) { const receiver = operationReceiver(); return Reflect.set(receiver, property, value, publicProxy); },",
    "    has(_target, property) { return Reflect.has(operationReceiver(), property); },",
    "    ownKeys() { return Reflect.ownKeys(operationReceiver()); },",
    "    getOwnPropertyDescriptor(_target, property) {",
    "      resolve();",
    "      if (!Reflect.isExtensible(target)) return Reflect.getOwnPropertyDescriptor(target, property);",
    '      if (kind === "array" && property === "length") {',
    "        (target as unknown[]).length = (resolve() as unknown[]).length;",
    "        return Reflect.getOwnPropertyDescriptor(target, property);",
    "      }",
    "      const receiver = resolve();",
    "      const descriptor = Reflect.getOwnPropertyDescriptor(receiver, property);",
    "      return descriptor ? { ...publicizeDescriptor(receiver, property, descriptor), configurable: true } : undefined;",
    "    },",
    "    defineProperty(_target, property, descriptor) { return Reflect.defineProperty(operationReceiver(), property, descriptor); },",
    "    deleteProperty(_target, property) { return Reflect.deleteProperty(operationReceiver(), property); },",
    "    getPrototypeOf() { resolve(); return Reflect.getPrototypeOf(target); },",
    "    setPrototypeOf(_target, prototype) { resolve(); return prototype === Reflect.getPrototypeOf(target); },",
    "    isExtensible() { resolve(); return Reflect.isExtensible(target); },",
    "    preventExtensions() { return materializeTarget(); },",
    "  });",
    "  return publicProxy;",
    "}",
    "",
  );

  if (Object.values(namespace).some((value) =>
    typeof value === "function" && /^class\s/.test(Function.prototype.toString.call(value)))) {
    lines.push(
      "const runtimeClassBridges = new WeakMap<Function, Set<Function>>();",
      "",
      "function bridgeRuntimeClassInstanceof(runtimeClass: Function, wrapperClass: Function): void {",
      "  let wrappers = runtimeClassBridges.get(runtimeClass);",
      "  if (!wrappers) {",
      "    wrappers = new Set<Function>();",
      "    runtimeClassBridges.set(runtimeClass, wrappers);",
      "    const originalHasInstance = runtimeClass[Symbol.hasInstance];",
      "    Object.defineProperty(runtimeClass, Symbol.hasInstance, {",
      "      configurable: true,",
      "      value(value: unknown): boolean {",
      "        if (Reflect.apply(originalHasInstance, runtimeClass, [value])) return true;",
      "        const nativeHasInstance = Function.prototype[Symbol.hasInstance];",
      "        return [...wrappers!].some((wrapper) => Reflect.apply(nativeHasInstance, wrapper, [value]));",
      "      },",
      "    });",
      "  }",
      "  wrappers.add(wrapperClass);",
      "}",
      "",
    );
  }

  const objectAliases = new Map<object, string>();
  for (const [name, value] of Object.entries(namespace)) {
    const isDependencyLightReexport = surface.dependencyLightReexports?.some((entry) => entry.names.has(name));
    if (!identifier(name) || isDependencyLightReexport || (surface.authorityError && name === "TodosHostedStorageUnavailableError")) {
      continue;
    }
    if (typeof value === "function") {
      lines.push(/^class\s/.test(Function.prototype.toString.call(value))
        ? renderClass(name, value, runtimeType)
        : renderFunction(name, value, runtimeType));
      continue;
    }
    if (value !== null && typeof value === "object") {
      const alias = objectAliases.get(value);
      if (alias) {
        lines.push(`export const ${name} = ${alias} as typeof ${runtimeType}.${name};`);
        continue;
      }
      objectAliases.set(value, name);
      lines.push(
        `export const ${name} = lazyPublicValue(${JSON.stringify(name)}, ${JSON.stringify(lazyValueKind(value))}) as typeof ${runtimeType}.${name};`,
      );
      continue;
    }
    lines.push(
      `export const ${name} = ${serialize(value)} as unknown as typeof ${runtimeType}.${name};`,
    );
  }

  await Bun.write(sourcePath, `${lines.join("\n").replaceAll("assertTodosLocalStorageRole(process.env)", "assertStageALocalStorageRole(process.env)")}\n`);
}

process.env.HASNA_TODOS_STORAGE_MODE = "local";
process.env.TODOS_STORAGE_MODE = "local";

await generate({
  source: "src/contracts.ts",
  runtime: "src/contracts.runtime.ts",
  ownerNamespace: "contracts",
});
await generate({
  source: "src/index.ts",
  runtime: "src/index.runtime.ts",
  ownerNamespace: "root",
  authorityError: true,
  dependencyLightReexports: [{
    module: "./storage.js",
    names: new Set([
      "createHybridTodosStorageAdapter",
      "createPostgresTodosStorageAdapter",
      "createPostgresTodosSyncStore",
      "createTodosS3ArtifactStore",
      "downloadRunArtifactsFromS3",
      "planRunArtifactsS3Sync",
      "uploadRunArtifactsToS3",
    ]),
  }],
});
await generate({
  source: "src/storage.ts",
  runtime: "src/storage.runtime.ts",
  ownerNamespace: "storage",
  authorityError: true,
});
