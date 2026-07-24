import { isProxy } from 'node:util/types';

/** Hard Stage-A aggregate limits. Callers cannot raise these ceilings. */
export const MAX_INGEST_BODY_BYTES = 8_388_608;
export const MAX_INGEST_BATCH_ITEMS = 4_096;
export const MAX_JSON_STRUCTURAL_TOKENS = 65_536;
export const MAX_JSON_PROPERTIES = 32_768;
export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_OBJECT_PROPERTIES = 256;
export const MAX_JSON_NODES = 4_096;
export const MAX_JSON_KEY_BYTES = 16_384;
export const MAX_JSON_STRING_BYTES = MAX_INGEST_BODY_BYTES;
const DANGEROUS_DATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface BoundedDataGraphOptions {
  readonly label?: string;
  readonly maxBytes?: number;
}

/**
 * Clone an untrusted already-materialized data graph without invoking getters,
 * proxy traps, iterators, toJSON hooks, or custom prototypes. The clone is
 * bounded before callers enumerate it and contains JSON-compatible data only.
 */
export function cloneBoundedDataGraph<T>(
  value: T,
  options: BoundedDataGraphOptions = {},
): T {
  const label = options.label === 'Provider response'
    ? 'Provider response'
    : options.label === 'Stored data'
      ? 'Stored data'
      : 'Input';
  const maxBytes = options.maxBytes ?? MAX_INGEST_BODY_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_INGEST_BODY_BYTES) {
    throw new Error(`${label} byte limit must be between 0 and ${MAX_INGEST_BODY_BYTES}.`);
  }
  const active = new WeakSet<object>();
  const clones = new WeakMap<object, unknown[] | Record<string, unknown>>();
  const completedExpansionBytes = new WeakMap<object, number>();
  let nodes = 0;
  let properties = 0;

  const boundedAdd = (left: number, right: number): number => {
    const total = left + right;
    if (total > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes} byte hard limit.`);
    }
    return total;
  };

  const primitiveBytes = (entry: null | boolean | number | string): number => {
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

  const clone = (entry: unknown, depth: number): { value: unknown; expansionBytes: number } => {
    if (entry === undefined) {
      throw new Error(`${label} contains undefined, which is not JSON data.`);
    }
    if (entry === null || typeof entry === 'boolean') {
      return {
        value: entry,
        expansionBytes: primitiveBytes(entry as null | boolean),
      };
    }
    if (typeof entry === 'string') {
      return { value: entry, expansionBytes: primitiveBytes(entry) };
    }
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new Error(`${label} contains a non-finite number.`);
      return { value: entry, expansionBytes: primitiveBytes(entry) };
    }
    if (typeof entry !== 'object') {
      throw new Error(`${label} contains unsupported non-data values.`);
    }
    if (isProxy(entry)) throw new Error(`${label} proxy inputs are unsupported.`);
    if (active.has(entry)) throw new Error(`${label} cyclic graphs are unsupported.`);
    const existing = clones.get(entry);
    if (existing) {
      const expansionBytes = completedExpansionBytes.get(entry);
      if (expansionBytes === undefined) {
        throw new Error(`${label} cyclic graphs are unsupported.`);
      }
      return { value: existing, expansionBytes };
    }
    if (++nodes > MAX_JSON_NODES) {
      throw new Error(`${label} exceeds the ${MAX_JSON_NODES} node hard limit.`);
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`${label} exceeds the ${MAX_JSON_DEPTH} level depth hard limit.`);
    }
    const array = Array.isArray(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (
      (array && prototype !== Array.prototype)
      || (!array && prototype !== Object.prototype && prototype !== null)
    ) {
      throw new Error(`${label} custom prototypes are unsupported.`);
    }
    if (array && entry.length > MAX_INGEST_BATCH_ITEMS) {
      throw new Error(`${label} array exceeds the ${MAX_INGEST_BATCH_ITEMS} item hard limit.`);
    }

    let keys: (string | symbol)[];
    try {
      keys = Reflect.ownKeys(entry);
    } catch {
      throw new Error(`${label} properties could not be enumerated safely.`);
    }
    let dataKeys: (string | symbol)[];
    if (array) {
      const expectedKeys = new Set<string>(['length']);
      for (let index = 0; index < entry.length; index += 1) {
        expectedKeys.add(String(index));
      }
      for (let index = 0; index < entry.length; index += 1) {
        if (!keys.includes(String(index))) {
          throw new Error(`${label} sparse arrays are unsupported.`);
        }
      }
      if (
        keys.length !== expectedKeys.size
        || keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
      ) {
        throw new Error(`${label} array own keys must be exactly canonical dense indexes and length.`);
      }
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(entry, 'length');
      } catch {
        throw new Error(`${label} property descriptors could not be inspected safely.`);
      }
      if (
        !lengthDescriptor
        || !('value' in lengthDescriptor)
        || lengthDescriptor.value !== entry.length
        || lengthDescriptor.writable !== true
        || lengthDescriptor.enumerable !== false
        || lengthDescriptor.configurable !== false
      ) {
        throw new Error(`${label} array length descriptor is noncanonical.`);
      }
      for (let index = 0; index < entry.length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        } catch {
          throw new Error(`${label} property descriptors could not be inspected safely.`);
        }
        if (!descriptor) throw new Error(`${label} sparse arrays are unsupported.`);
        if (!('value' in descriptor)) throw new Error(`${label} accessor properties are unsupported.`);
        if (
          descriptor.enumerable !== true
          || descriptor.writable !== true
          || descriptor.configurable !== true
        ) {
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

    const target: unknown[] | Record<string, unknown> = array
      ? new Array(entry.length)
      : Object.create(null);
    clones.set(entry, target);
    active.add(entry);
    let expansionBytes = 2;
    for (const key of dataKeys) {
      if (typeof key !== 'string') throw new Error(`${label} symbol properties are unsupported.`);
      if (DANGEROUS_DATA_KEYS.has(key)) {
        throw new Error(`${label} contains a dangerous key.`);
      }
      if (Buffer.byteLength(key) > MAX_JSON_KEY_BYTES) {
        throw new Error(`${label} exceeds the ${MAX_JSON_KEY_BYTES} key byte hard limit.`);
      }
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(entry, key);
      } catch {
        throw new Error(`${label} property descriptors could not be inspected safely.`);
      }
      if (!descriptor || !('value' in descriptor)) {
        throw new Error(`${label} accessor properties are unsupported.`);
      }
      if (!array && descriptor.enumerable !== true) {
        throw new Error(`${label} non-enumerable object properties are unsupported.`);
      }
      const cloned = clone(descriptor.value, depth + 1);
      const separatorBytes = expansionBytes === 2 ? 0 : 1;
      expansionBytes = boundedAdd(expansionBytes, separatorBytes);
      if (!array) {
        expansionBytes = boundedAdd(
          expansionBytes,
          Buffer.byteLength(JSON.stringify(key)) + 1,
        );
      }
      expansionBytes = boundedAdd(expansionBytes, cloned.expansionBytes);
      Object.defineProperty(target, array ? Number(key) : key, {
        value: cloned.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    active.delete(entry);
    completedExpansionBytes.set(entry, expansionBytes);
    return { value: target, expansionBytes };
  };

  return clone(value, 0).value as T;
}

export function hardLimit(
  requested: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const value = requested ?? fallback;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}.`);
  }
  return value;
}

/**
 * Pre-scan bounded JSON/JSONL before JSON.parse materializes its object graph.
 * The scanner is deliberately syntax-agnostic; JSON.parse remains authoritative
 * after these hard aggregate ceilings have been enforced.
 */
export function assertBoundedJsonText(
  text: string,
  maxArrayItems = MAX_INGEST_BATCH_ITEMS,
  maxTopLevelValues = maxArrayItems,
): void {
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_INGEST_BODY_BYTES) {
    throw new Error(`Input exceeds the ${MAX_INGEST_BODY_BYTES} byte hard limit.`);
  }
  let inString = false;
  let escaped = false;
  let depth = 0;
  let structural = 0;
  let properties = 0;
  let nodes = 0;
  let topLevelValues = 0;
  type Frame = { kind: 'array'; items: number; expectsValue: boolean }
    | { kind: 'object'; properties: number };
  const frames: Frame[] = [];
  let topLevelValueActive = false;
  const markArrayValue = (): void => {
    const frame = frames.at(-1);
    if (frame?.kind !== 'array' || !frame.expectsValue) return;
    frame.expectsValue = false;
    if (++frame.items > maxArrayItems) {
      throw new Error(`Input array exceeds the ${maxArrayItems} item hard limit.`);
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (/\s/.test(char)) continue;
    if (depth === 0 && !topLevelValueActive) {
      topLevelValueActive = true;
      if (++topLevelValues > maxTopLevelValues) {
        throw new Error(`Input exceeds the ${maxTopLevelValues} top-level item hard limit.`);
      }
    }
    if (char === '"') {
      markArrayValue();
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      markArrayValue();
      structural += 1;
      depth += 1;
      if (++nodes > MAX_JSON_NODES) {
        throw new Error(`Input exceeds the ${MAX_JSON_NODES} node hard limit.`);
      }
      if (depth > MAX_JSON_DEPTH) throw new Error(`Input exceeds the ${MAX_JSON_DEPTH} level JSON depth limit.`);
      frames.push(char === '['
        ? { kind: 'array', items: 0, expectsValue: true }
        : { kind: 'object', properties: 0 });
    } else if (char === '}' || char === ']') {
      frames.pop();
      depth -= 1;
      if (depth === 0) topLevelValueActive = false;
    } else if (char === ',' || char === ':') {
      structural += 1;
      const frame = frames.at(-1);
      if (char === ',' && frame?.kind === 'array') frame.expectsValue = true;
      if (char === ':' && frame?.kind === 'object') {
        if (++frame.properties > MAX_JSON_OBJECT_PROPERTIES) {
          throw new Error(`Input object exceeds the ${MAX_JSON_OBJECT_PROPERTIES} property hard limit.`);
        }
        if (++properties > MAX_JSON_PROPERTIES) {
          throw new Error(`Input exceeds the ${MAX_JSON_PROPERTIES} property hard limit.`);
        }
      }
    } else {
      markArrayValue();
    }
    if (structural > MAX_JSON_STRUCTURAL_TOKENS) {
      throw new Error(`Input exceeds the ${MAX_JSON_STRUCTURAL_TOKENS} structural-token hard limit.`);
    }
  }
}

/** Parse persisted JSON only after byte/shape pre-scan, then data-clone it. */
export function parseBoundedJsonData<T>(
  text: string,
  label = 'Persisted JSON',
  maxArrayItems = MAX_INGEST_BATCH_ITEMS,
  maxTopLevelValues = 1,
): T {
  assertBoundedJsonText(text, maxArrayItems, maxTopLevelValues);
  return cloneBoundedDataGraph(JSON.parse(text), {
    label,
    maxBytes: MAX_INGEST_BODY_BYTES,
  }) as T;
}
