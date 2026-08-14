import { redact } from "../lib/format.js";

const MAX_CONTEXT_DEPTH = 6;
const MAX_CONTEXT_ENTRIES = 64;
const MAX_CONTEXT_NODES = 256;
const MAX_CONTEXT_STRING_LENGTH = 640;
const MAX_CONTEXT_KEY_LENGTH = 80;
const SAFE_CONTEXT_KEY = /^[A-Za-z0-9_.-]+$/;
const UNSAFE_CONTEXT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

interface SanitizeState {
  remainingNodes: number;
  stack: WeakSet<object>;
}

function sanitizedString(value: string): string {
  return redact(value, MAX_CONTEXT_STRING_LENGTH) ?? "";
}

function sanitizedKey(key: string, index: number): string {
  const scrubbed = sanitizedString(key);
  if (
    scrubbed.length > 0 &&
    scrubbed.length <= MAX_CONTEXT_KEY_LENGTH &&
    SAFE_CONTEXT_KEY.test(scrubbed) &&
    !UNSAFE_CONTEXT_KEYS.has(scrubbed)
  ) {
    return scrubbed;
  }
  return `field_${index + 1}`;
}

function ownDataValue(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : "[unavailable]";
  } catch {
    return "[unavailable]";
  }
}

function sanitizeValue(value: unknown, state: SanitizeState, depth: number): unknown {
  if (state.remainingNodes <= 0) return "[truncated]";
  state.remainingNodes -= 1;

  if (typeof value === "string") return sanitizedString(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return sanitizedString(value.toString());
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return "[unsupported]";
  if (depth >= MAX_CONTEXT_DEPTH) return "[truncated]";
  if (state.stack.has(value)) return "[circular]";

  state.stack.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthValue = ownDataValue(value, "length");
      const length = typeof lengthValue === "number" && Number.isSafeInteger(lengthValue) && lengthValue >= 0
        ? lengthValue
        : 0;
      const result: unknown[] = [];
      for (let index = 0; index < Math.min(length, MAX_CONTEXT_ENTRIES); index += 1) {
        result.push(sanitizeValue(ownDataValue(value, String(index)), state, depth + 1));
      }
      if (length > MAX_CONTEXT_ENTRIES) result.push("[truncated]");
      return result;
    }

    if (value instanceof Error) {
      const name = ownDataValue(value, "name");
      const message = ownDataValue(value, "message");
      const result: Record<string, unknown> = {
        name: sanitizedString(typeof name === "string" ? name : "Error"),
        message: sanitizedString(typeof message === "string" ? message : ""),
      };
      const code = ownDataValue(value, "code");
      if (typeof code === "string") result.code = sanitizedString(code);
      return result;
    }

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      return "[unavailable]";
    }
    if (prototype !== Object.prototype && prototype !== null) return "[unsupported object]";

    const keys: string[] = [];
    try {
      for (const key in value as Record<string, unknown>) {
        keys.push(key);
        if (keys.length > MAX_CONTEXT_ENTRIES) break;
      }
    } catch {
      return "[unavailable]";
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const [index, key] of keys.slice(0, MAX_CONTEXT_ENTRIES).entries()) {
      result[sanitizedKey(key, index)] = sanitizeValue(ownDataValue(value, key), state, depth + 1);
    }
    if (keys.length > MAX_CONTEXT_ENTRIES) result.truncated = true;
    return result;
  } finally {
    state.stack.delete(value);
  }
}

export function sanitizeCliErrorContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeValue(
    context,
    { remainingNodes: MAX_CONTEXT_NODES, stack: new WeakSet<object>() },
    0,
  );
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}
