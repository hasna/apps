/**
 * Pure output-efficiency primitives for Hasna CLI and MCP adapters.
 *
 * This module performs no I/O and has no dependency on Commander, MCP,
 * credentials, URLs, environment variables, clocks, or hosted transports.
 * Callers provide already-authorized records and decide where bytes are sent.
 */

export const OUTPUT_PAGE_CONTRACT_VERSION = 1 as const;

export type OutputContractErrorCode =
  | "OUTPUT_INVALID_RECORD"
  | "OUTPUT_INVALID_FIELD"
  | "OUTPUT_UNKNOWN_FIELD"
  | "OUTPUT_REQUIRED_FIELD_MISSING"
  | "OUTPUT_ACCESSOR_PROPERTY"
  | "OUTPUT_INVALID_PAGE"
  | "OUTPUT_UNSUPPORTED_VALUE"
  | "OUTPUT_NON_FINITE_NUMBER"
  | "OUTPUT_CIRCULAR_REFERENCE"
  | "OUTPUT_INVALID_BUDGET"
  | "OUTPUT_CONTINUATION_REQUIRED"
  | "OUTPUT_ITEM_EXCEEDS_BUDGET"
  | "OUTPUT_BUDGET_TOO_SMALL";

/** Stable, value-redacting error raised by the pure output contract. */
export class OutputContractError extends TypeError {
  readonly code: OutputContractErrorCode;
  readonly path?: string;

  constructor(code: OutputContractErrorCode, message: string, path?: string) {
    super(message);
    this.name = "OutputContractError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

const OUTPUT_ERROR_CODES: ReadonlySet<string> = new Set<OutputContractErrorCode>([
  "OUTPUT_INVALID_RECORD",
  "OUTPUT_INVALID_FIELD",
  "OUTPUT_UNKNOWN_FIELD",
  "OUTPUT_REQUIRED_FIELD_MISSING",
  "OUTPUT_ACCESSOR_PROPERTY",
  "OUTPUT_INVALID_PAGE",
  "OUTPUT_UNSUPPORTED_VALUE",
  "OUTPUT_NON_FINITE_NUMBER",
  "OUTPUT_CIRCULAR_REFERENCE",
  "OUTPUT_INVALID_BUDGET",
  "OUTPUT_CONTINUATION_REQUIRED",
  "OUTPUT_ITEM_EXCEEDS_BUDGET",
  "OUTPUT_BUDGET_TOO_SMALL",
]);

/** Cross-package/realm-safe guard for adapter error mapping. */
export function isOutputContractError(value: unknown): value is OutputContractError {
  if (typeof value !== "object" || value === null) return false;
  try {
    const name = Object.getOwnPropertyDescriptor(value, "name");
    const code = Object.getOwnPropertyDescriptor(value, "code");
    const message = Object.getOwnPropertyDescriptor(value, "message");
    const path = Object.getOwnPropertyDescriptor(value, "path");
    return name?.value === "OutputContractError"
      && typeof message?.value === "string"
      && typeof code?.value === "string"
      && OUTPUT_ERROR_CODES.has(code.value)
      && (path === undefined || path.value === undefined || typeof path.value === "string");
  } catch {
    return false;
  }
}

export type UnknownFieldPolicy = "error" | "omit";

export interface ProjectionOptions {
  /** Fields that are always emitted before caller-selected fields. */
  requiredFields?: readonly string[];
  /** Missing selected fields refuse by default; `omit` is an explicit relaxation. */
  unknownFields?: UnknownFieldPolicy;
  /** Undefined optional values are omitted by default because JSON cannot represent them. */
  omitUndefined?: boolean;
}

const UNSAFE_FIELD_NAMES = new Set(["__proto__", "prototype", "constructor"]);

function assertFieldName(field: string, label: string): void {
  if (typeof field !== "string" || field.trim().length === 0 || UNSAFE_FIELD_NAMES.has(field)) {
    throw new OutputContractError("OUTPUT_INVALID_FIELD", `${label} contains an invalid field name`);
  }
}

function copyFieldArray(value: readonly string[], label: string): string[] {
  if (!Array.isArray(value)) {
    throw new OutputContractError("OUTPUT_INVALID_FIELD", `${label} must be an array`);
  }
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor) {
      throw new OutputContractError("OUTPUT_INVALID_FIELD", `${label} must not be sparse`);
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `${label}[${index}] is an accessor and was not evaluated`);
    }
    assertFieldName(descriptor.value as string, label);
    output.push(descriptor.value as string);
  }
  return output;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/**
 * Select exact top-level fields without mutating the source record.
 *
 * Accessors and exotic objects refuse rather than executing caller code during
 * projection. Required fields always refuse when absent or undefined.
 */
export function projectRecord(
  record: unknown,
  fields: readonly string[],
  options: ProjectionOptions = {},
): Record<string, unknown> {
  if (!plainRecord(record)) {
    throw new OutputContractError("OUTPUT_INVALID_RECORD", "projection input must be a plain record");
  }

  const requiredFields = copyFieldArray(options.requiredFields ?? [], "requiredFields");
  const selectedFields = copyFieldArray(fields, "fields");
  const unknownFields = options.unknownFields ?? "error";
  const omitUndefined = options.omitUndefined ?? true;
  if (unknownFields !== "error" && unknownFields !== "omit") {
    throw new OutputContractError("OUTPUT_INVALID_FIELD", "unknownFields must be error or omit");
  }
  if (typeof omitUndefined !== "boolean") {
    throw new OutputContractError("OUTPUT_INVALID_FIELD", "omitUndefined must be a boolean");
  }
  const required = new Set<string>();
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const field of requiredFields) {
    required.add(field);
    if (!seen.has(field)) {
      seen.add(field);
      ordered.push(field);
    }
  }
  for (const field of selectedFields) {
    if (!seen.has(field)) {
      seen.add(field);
      ordered.push(field);
    }
  }

  const output: Record<string, unknown> = {};
  for (const field of ordered) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, field);
    } catch {
      throw new OutputContractError("OUTPUT_INVALID_RECORD", "projection input could not be inspected safely");
    }
    if (!descriptor) {
      if (required.has(field)) {
        throw new OutputContractError(
          "OUTPUT_REQUIRED_FIELD_MISSING",
          `required output field ${JSON.stringify(field)} is missing`,
          field,
        );
      }
      if (unknownFields === "error") {
        throw new OutputContractError(
          "OUTPUT_UNKNOWN_FIELD",
          `selected output field ${JSON.stringify(field)} is missing`,
          field,
        );
      }
      continue;
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError(
        "OUTPUT_ACCESSOR_PROPERTY",
        `output field ${JSON.stringify(field)} is an accessor and was not evaluated`,
        field,
      );
    }
    if (descriptor.value === undefined) {
      if (required.has(field)) {
        throw new OutputContractError(
          "OUTPUT_REQUIRED_FIELD_MISSING",
          `required output field ${JSON.stringify(field)} is undefined`,
          field,
        );
      }
      if (omitUndefined) continue;
    }
    Object.defineProperty(output, field, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

export function projectRecords(
  records: readonly unknown[],
  fields: readonly string[],
  options: ProjectionOptions = {},
): Array<Record<string, unknown>> {
  if (!Array.isArray(records)) {
    throw new OutputContractError("OUTPUT_INVALID_RECORD", "projection records must be an array");
  }
  const output: Array<Record<string, unknown>> = [];
  for (let index = 0; index < records.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(records, index);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `projection record at index ${index} is not a data property`);
    }
    output.push(projectRecord(descriptor.value, fields, options));
  }
  return output;
}

export type OutputCursor = string | number | null;
export type OutputCursorSemantics = "offset" | "opaque" | "whole-query";
export type OutputSortDirection = "asc" | "desc";

const OUTPUT_PAGE_BRAND: unique symbol = Symbol("hasna.output-page.v1");

export interface OutputSort {
  field: string;
  direction: OutputSortDirection;
}

export interface OutputPageMeta {
  contract_version: typeof OUTPUT_PAGE_CONTRACT_VERSION;
  count: number;
  total: number | null;
  limit: number;
  cursor: OutputCursor;
  next_cursor: OutputCursor;
  cursor_semantics: OutputCursorSemantics;
  has_more: boolean;
  /** True only when this envelope contains the entire requested population. */
  complete: boolean;
  /** True when this representation omitted data for a named reason. */
  truncated: boolean;
  truncation_reasons?: readonly string[];
  detail?: string;
  fields?: readonly string[];
  sort?: OutputSort;
  byte_length?: number;
  max_bytes?: number;
}

export interface OutputPageEnvelope<T> {
  readonly items: readonly T[];
  readonly _meta: Readonly<OutputPageMeta>;
  readonly [OUTPUT_PAGE_BRAND]: true;
}

export interface CreatePageEnvelopeInput<T> {
  items: readonly T[];
  limit: number;
  cursor?: OutputCursor;
  nextCursor?: OutputCursor;
  /** Numeric cursors are offsets unless `whole-query` is explicit. */
  cursorSemantics?: OutputCursorSemantics;
  hasMore: boolean;
  complete: boolean;
  total?: number | null;
  truncated?: boolean;
  truncationReasons?: readonly string[];
  detail?: string;
  fields?: readonly string[];
  sort?: OutputSort;
  byteLength?: number;
  maxBytes?: number;
}

function assertSafeNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `${name} must be a non-negative safe integer`);
  }
}

function assertPositiveSafeInteger(value: number, code: OutputContractErrorCode, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OutputContractError(code, `${name} must be a positive safe integer`);
  }
}

function usableCursor(value: OutputCursor): value is string | number {
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function inferCursorSemantics(
  cursor: OutputCursor,
  nextCursor: OutputCursor,
  explicit: OutputCursorSemantics | undefined,
): OutputCursorSemantics {
  if (explicit !== undefined && explicit !== "offset" && explicit !== "opaque" && explicit !== "whole-query") {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "cursorSemantics must be offset, opaque, or whole-query");
  }
  if (explicit !== undefined) return explicit;
  if (typeof cursor === "number" || typeof nextCursor === "number") return "offset";
  if (typeof cursor === "string" || typeof nextCursor === "string") return "opaque";
  return "offset";
}

function checkedOffsetEnd(offset: number, count: number): number {
  const end = offset + count;
  if (!Number.isSafeInteger(end)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "numeric cursor plus count exceeds the safe integer range");
  }
  return end;
}

function brandPageEnvelope<T>(items: readonly T[], meta: Readonly<OutputPageMeta>): OutputPageEnvelope<T> {
  const envelope = { items, _meta: meta } as OutputPageEnvelope<T>;
  Object.defineProperty(envelope, OUTPUT_PAGE_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(envelope);
}

function normalizedReasons(reasons: readonly string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const copied = copyDataArray(reasons ?? [], "truncationReasons");
  for (const reason of copied) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "truncation reasons must be non-empty strings");
    }
    const normalized = reason.trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function copyDataArray<T>(value: readonly T[], label: string): T[] {
  if (!Array.isArray(value)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `${label} must be an array`);
  }
  const output: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", `${label} must not be sparse`);
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `${label}[${index}] is an accessor and was not evaluated`);
    }
    output.push(descriptor.value as T);
  }
  return output;
}

/** Build and validate a page envelope without inferring completeness. */
export function createPageEnvelope<T>(input: CreatePageEnvelopeInput<T>): OutputPageEnvelope<T> {
  if (typeof input.hasMore !== "boolean" || typeof input.complete !== "boolean") {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "hasMore and complete must be booleans");
  }
  if (input.truncated !== undefined && typeof input.truncated !== "boolean") {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "truncated must be a boolean when present");
  }
  assertPositiveSafeInteger(input.limit, "OUTPUT_INVALID_PAGE", "limit");
  const items = copyDataArray(input.items, "items");
  if (items.length > input.limit) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "page item count cannot exceed limit");
  }

  const total = input.total ?? null;
  if (total !== null) {
    assertSafeNonNegativeInteger(total, "total");
    if (items.length > total) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "page item count cannot exceed total");
    }
  }

  const cursor = input.cursor ?? null;
  const nextCursor = input.nextCursor ?? null;
  if (cursor !== null && !usableCursor(cursor)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "cursor must be null or a usable string/non-negative integer");
  }
  if (input.hasMore && !usableCursor(nextCursor)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "has_more=true requires a usable next_cursor");
  }
  if (!input.hasMore && nextCursor !== null) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "has_more=false requires next_cursor=null");
  }

  const cursorSemantics = inferCursorSemantics(cursor, nextCursor, input.cursorSemantics);
  if (cursorSemantics === "offset") {
    if ((cursor !== null && typeof cursor !== "number") || (nextCursor !== null && typeof nextCursor !== "number")) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "offset cursors must be non-negative safe integers or null");
    }
    const offset = cursor ?? 0;
    const consumed = checkedOffsetEnd(offset, items.length);
    if (input.complete && offset !== 0) {
      throw new OutputContractError(
        "OUTPUT_INVALID_PAGE",
        "complete=true from a nonzero offset requires cursorSemantics=whole-query",
      );
    }
    if (input.hasMore) {
      if (consumed <= offset) {
        throw new OutputContractError("OUTPUT_INVALID_PAGE", "offset continuation requires at least one emitted item");
      }
      if (nextCursor !== consumed) {
        throw new OutputContractError(
          "OUTPUT_INVALID_PAGE",
          `offset next_cursor must equal cursor + count (${consumed})`,
        );
      }
      if (total !== null && consumed >= total) {
        throw new OutputContractError("OUTPUT_INVALID_PAGE", "has_more=true cannot continue at or past the known total");
      }
    } else if (total !== null && consumed !== total) {
      throw new OutputContractError(
        "OUTPUT_INVALID_PAGE",
        consumed < total
          ? "terminal offset page ends before the known total"
          : "terminal offset page extends past the known total",
      );
    }
  } else if (cursorSemantics === "opaque") {
    if ((cursor !== null && typeof cursor !== "string") || (nextCursor !== null && typeof nextCursor !== "string")) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "opaque cursors must be non-empty strings or null");
    }
    if (input.hasMore && cursor !== null && nextCursor === cursor) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "opaque next_cursor must differ from cursor");
    }
    if (input.complete && cursor !== null) {
      throw new OutputContractError(
        "OUTPUT_INVALID_PAGE",
        "complete=true from a continued opaque cursor requires cursorSemantics=whole-query",
      );
    }
    if (input.hasMore && total !== null && items.length === total) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "has_more=true contradicts count=total");
    }
  } else {
    if (input.hasMore) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "whole-query cursor semantics cannot advertise another page");
    }
    if (total !== null && items.length < total && !input.truncated) {
      throw new OutputContractError(
        "OUTPUT_INVALID_PAGE",
        "whole-query page ends before the known total without declaring truncation",
      );
    }
  }

  const truncated = input.truncated ?? false;
  const reasons = normalizedReasons(input.truncationReasons);
  if (truncated && reasons.length === 0) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "truncated=true requires at least one truncation reason");
  }
  if (!truncated && reasons.length > 0) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "truncation reasons require truncated=true");
  }
  if (input.complete && (input.hasMore || truncated)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "complete=true cannot coexist with has_more or truncation");
  }
  if (input.complete && total !== null && items.length !== total) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "complete=true with a known total requires count=total");
  }

  if (input.detail !== undefined && (typeof input.detail !== "string" || input.detail.trim().length === 0)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "detail must be a non-empty string when present");
  }
  let fields: string[] | undefined;
  if (input.fields !== undefined) {
    const copiedFields = copyDataArray(input.fields, "fields");
    fields = [...new Set(copiedFields)];
    for (const field of fields) assertFieldName(field, "fields");
  }
  let sort: OutputSort | undefined;
  if (input.sort !== undefined) {
    if (!plainRecord(input.sort)) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "sort must be a plain record");
    }
    const field = Object.getOwnPropertyDescriptor(input.sort, "field");
    const direction = Object.getOwnPropertyDescriptor(input.sort, "direction");
    if (!field || !direction || field.get || field.set || direction.get || direction.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", "sort field and direction must be own data properties");
    }
    if (direction.value !== "asc" && direction.value !== "desc") {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "sort direction must be asc or desc");
    }
    assertFieldName(field.value as string, "sort.field");
    sort = { field: field.value as string, direction: direction.value };
  }
  if (input.byteLength !== undefined) assertSafeNonNegativeInteger(input.byteLength, "byteLength");
  if (input.maxBytes !== undefined) assertPositiveSafeInteger(input.maxBytes, "OUTPUT_INVALID_PAGE", "maxBytes");
  if (input.byteLength !== undefined && input.maxBytes !== undefined && input.byteLength > input.maxBytes) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "byteLength cannot exceed maxBytes");
  }
  const meta: OutputPageMeta = {
    contract_version: OUTPUT_PAGE_CONTRACT_VERSION,
    count: items.length,
    total,
    limit: input.limit,
    cursor,
    next_cursor: nextCursor,
    cursor_semantics: cursorSemantics,
    has_more: input.hasMore,
    complete: input.complete,
    truncated,
  };
  if (reasons.length > 0) meta.truncation_reasons = Object.freeze(reasons);
  if (input.detail !== undefined) meta.detail = input.detail;
  if (fields !== undefined) meta.fields = Object.freeze(fields);
  if (sort !== undefined) meta.sort = Object.freeze(sort);
  if (input.byteLength !== undefined) meta.byte_length = input.byteLength;
  if (input.maxBytes !== undefined) meta.max_bytes = input.maxBytes;
  const frozenItems = Object.freeze(items) as readonly T[];
  const frozenMeta = Object.freeze(meta);
  return brandPageEnvelope(frozenItems, frozenMeta);
}

const PAGE_ENVELOPE_KEYS = new Set(["items", "_meta"]);
const PAGE_META_KEYS = new Set([
  "contract_version",
  "count",
  "total",
  "limit",
  "cursor",
  "next_cursor",
  "cursor_semantics",
  "has_more",
  "complete",
  "truncated",
  "truncation_reasons",
  "detail",
  "fields",
  "sort",
  "byte_length",
  "max_bytes",
]);

function assertOnlyEnumerableKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  let keys: string[];
  try {
    keys = Object.keys(record);
  } catch {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `${label} could not be inspected safely`);
  }
  const unexpected = keys.filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `${label} contains unknown field ${JSON.stringify(unexpected[0])}`);
  }
}

function ownData(record: Record<string, unknown>, key: string, required: boolean): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `page field ${JSON.stringify(key)} could not be inspected safely`);
  }
  if (!descriptor) {
    if (required) throw new OutputContractError("OUTPUT_INVALID_PAGE", `page field ${JSON.stringify(key)} is required`);
    return undefined;
  }
  if (descriptor.get || descriptor.set) {
    throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `page field ${JSON.stringify(key)} is an accessor and was not evaluated`);
  }
  return descriptor.value;
}

/**
 * Runtime validation and canonicalization for JavaScript or cross-package page envelopes.
 * The returned value is branded and frozen exactly like `createPageEnvelope` output.
 */
export function validatePageEnvelope<T = unknown>(value: unknown): OutputPageEnvelope<T> {
  if (!plainRecord(value)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "page envelope must be a plain record");
  }
  assertOnlyEnumerableKeys(value, PAGE_ENVELOPE_KEYS, "page envelope");
  const items = ownData(value, "items", true);
  const metaValue = ownData(value, "_meta", true);
  if (!Array.isArray(items) || !plainRecord(metaValue)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "page envelope requires an items array and _meta record");
  }
  assertOnlyEnumerableKeys(metaValue, PAGE_META_KEYS, "page metadata");
  if (ownData(metaValue, "contract_version", true) !== OUTPUT_PAGE_CONTRACT_VERSION) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "page contract_version must equal 1");
  }
  const count = ownData(metaValue, "count", true);
  if (!Number.isSafeInteger(count) || count !== items.length) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "page count must equal items.length");
  }

  const input: CreatePageEnvelopeInput<unknown> = {
    items,
    limit: ownData(metaValue, "limit", true) as number,
    cursor: ownData(metaValue, "cursor", true) as OutputCursor,
    nextCursor: ownData(metaValue, "next_cursor", true) as OutputCursor,
    cursorSemantics: ownData(metaValue, "cursor_semantics", true) as OutputCursorSemantics,
    hasMore: ownData(metaValue, "has_more", true) as boolean,
    complete: ownData(metaValue, "complete", true) as boolean,
    total: ownData(metaValue, "total", true) as number | null,
    truncated: ownData(metaValue, "truncated", true) as boolean,
  };
  const truncationReasons = ownData(metaValue, "truncation_reasons", false);
  const detail = ownData(metaValue, "detail", false);
  const fields = ownData(metaValue, "fields", false);
  const sort = ownData(metaValue, "sort", false);
  const byteLength = ownData(metaValue, "byte_length", false);
  const maxBytes = ownData(metaValue, "max_bytes", false);
  if (truncationReasons !== undefined) input.truncationReasons = truncationReasons as readonly string[];
  if (detail !== undefined) input.detail = detail as string;
  if (fields !== undefined) input.fields = fields as readonly string[];
  if (sort !== undefined) input.sort = sort as OutputSort;
  if (byteLength !== undefined) input.byteLength = byteLength as number;
  if (maxBytes !== undefined) input.maxBytes = maxBytes as number;
  return createPageEnvelope(input) as OutputPageEnvelope<T>;
}

export interface JsonSerializationOptions {
  /** Compact by default; `true` selects a stable two-space representation. */
  pretty?: boolean;
  /** Disabled by default. JSONL helpers always frame records with LF. */
  trailingNewline?: boolean;
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function normalizeJson(value: unknown, path: string, active: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OutputContractError("OUTPUT_NON_FINITE_NUMBER", `non-finite number at ${path}`, path);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `unsupported JSON value at ${path}`, path);
  }
  if (active.has(value)) {
    throw new OutputContractError("OUTPUT_CIRCULAR_REFERENCE", `circular reference at ${path}`, path);
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor) {
          throw new OutputContractError(
            "OUTPUT_UNSUPPORTED_VALUE",
            `sparse array entry at ${path}[${index}]`,
            `${path}[${index}]`,
          );
        }
        if (descriptor.get || descriptor.set) {
          throw new OutputContractError(
            "OUTPUT_ACCESSOR_PROPERTY",
            `accessor property at ${path}[${index}] was not evaluated`,
            `${path}[${index}]`,
          );
        }
        output.push(normalizeJson(descriptor.value, `${path}[${index}]`, active));
      }
      return output;
    }

    if (!plainRecord(value)) {
      throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `non-plain JSON object at ${path}`, path);
    }
    let keys: string[];
    let symbols: symbol[];
    try {
      keys = Object.keys(value).sort();
      symbols = Object.getOwnPropertySymbols(value);
    } catch {
      throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `JSON object could not be inspected at ${path}`, path);
    }
    for (const symbol of symbols) {
      const descriptor = Object.getOwnPropertyDescriptor(value, symbol);
      if (descriptor?.enumerable) {
        throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `enumerable symbol key at ${path}`, path);
      }
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `unstable property at ${childPath(path, key)}`, childPath(path, key));
      }
      if (descriptor.get || descriptor.set) {
        throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `accessor property at ${childPath(path, key)} was not evaluated`, childPath(path, key));
      }
      output[key] = normalizeJson(descriptor.value, childPath(path, key), active);
    }
    return output;
  } finally {
    active.delete(value);
  }
}

function validateSerializationOptions(options: JsonSerializationOptions): void {
  if (options.pretty !== undefined && typeof options.pretty !== "boolean") {
    throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", "pretty must be a boolean");
  }
  if (options.trailingNewline !== undefined && typeof options.trailingNewline !== "boolean") {
    throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", "trailingNewline must be a boolean");
  }
}

/** Deterministic strict JSON: sorted record keys, finite numbers, no accessors or toJSON execution. */
export function serializeJson(value: unknown, options: JsonSerializationOptions = {}): string {
  validateSerializationOptions(options);
  const normalized = normalizeJson(value, "$", new WeakSet<object>());
  const text = JSON.stringify(normalized, null, options.pretty ? 2 : undefined);
  return options.trailingNewline ? `${text}\n` : text;
}

/** One compact deterministic JSON value followed by exactly one LF. */
export function serializeJsonLine(value: unknown): string {
  return `${serializeJson(value)}\n`;
}

/** Compact deterministic JSONL. Empty input emits an empty string. */
export function serializeJsonLines(values: readonly unknown[]): string {
  if (!Array.isArray(values)) {
    throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", "JSONL input must be an array");
  }
  const lines: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor) {
      throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `sparse JSONL record at $[${index}]`, `$[${index}]`);
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `JSONL record at $[${index}] is an accessor`, `$[${index}]`);
    }
    const normalized = normalizeJson(descriptor.value, `$[${index}]`, new WeakSet<object>());
    lines.push(JSON.stringify(normalized));
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export interface JsonMeasurement {
  text: string;
  bytes: number;
}

/** Exact UTF-8 wire-byte count, not JavaScript UTF-16 code units. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function measureJson(value: unknown, options: JsonSerializationOptions = {}): JsonMeasurement {
  const text = serializeJson(value, options);
  return { text, bytes: utf8ByteLength(text) };
}

export function measureJsonLines(values: readonly unknown[]): JsonMeasurement {
  const text = serializeJsonLines(values);
  return { text, bytes: utf8ByteLength(text) };
}

/**
 * Typed JSONL page framing. The final receipt is mandatory because omitting it
 * would make pagination, completeness, total, and truncation claims unknowable.
 * Structural inputs are revalidated and canonicalized before any item is emitted.
 */
export function serializePageJsonLines<T>(envelope: OutputPageEnvelope<T>): string {
  const validated = validatePageEnvelope<T>(envelope);
  const records: unknown[] = [];
  for (let index = 0; index < validated.items.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(validated.items, index);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `page item at index ${index} is not a data property`);
    }
    records.push({ _type: "item", item: descriptor.value });
  }
  records.push({ _type: "page_receipt", _meta: validated._meta });
  return serializeJsonLines(records);
}

export interface FitPageToByteBudgetOptions {
  maxBytes: number;
  /**
   * Opaque cursor for the first omitted item when local byte clipping occurs.
   * Required only for `cursorSemantics="opaque"`; offset cursors are derived.
   */
  nextCursorForIndex?: (firstOmittedIndex: number) => Exclude<OutputCursor, null>;
  serialization?: JsonSerializationOptions;
}

export interface BudgetedPage<T> {
  envelope: OutputPageEnvelope<T>;
  text: string;
  bytes: number;
  max_bytes: number;
  omitted_items: number;
}

function envelopeInput<T>(
  envelope: OutputPageEnvelope<T>,
  items: readonly T[],
  overrides: Partial<CreatePageEnvelopeInput<T>> = {},
): CreatePageEnvelopeInput<T> {
  const meta = envelope._meta;
  const base: CreatePageEnvelopeInput<T> = {
    items,
    limit: meta.limit,
    cursor: meta.cursor,
    nextCursor: meta.next_cursor,
    cursorSemantics: meta.cursor_semantics,
    hasMore: meta.has_more,
    complete: meta.complete,
    total: meta.total,
    truncated: meta.truncated,
  };
  if (meta.truncation_reasons !== undefined) base.truncationReasons = meta.truncation_reasons;
  if (meta.detail !== undefined) base.detail = meta.detail;
  if (meta.fields !== undefined) base.fields = meta.fields;
  if (meta.sort !== undefined) base.sort = meta.sort;
  return Object.assign(base, overrides);
}

function serializeEnvelopeWithMetrics<T>(
  input: CreatePageEnvelopeInput<T>,
  maxBytes: number,
  options: JsonSerializationOptions,
): { envelope: OutputPageEnvelope<T>; text: string; bytes: number } {
  const base = createPageEnvelope(input);
  let byteLength = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const meta = Object.freeze({ ...base._meta, byte_length: byteLength, max_bytes: maxBytes });
    const envelope = brandPageEnvelope(base.items, meta);
    const text = serializeJson(envelope, options);
    const bytes = utf8ByteLength(text);
    if (bytes === byteLength) return { envelope, text, bytes };
    byteLength = bytes;
  }
  throw new OutputContractError("OUTPUT_INVALID_BUDGET", "byte-length metadata did not converge");
}

/**
 * Fit the largest ordered prefix of a page into an exact serialized UTF-8 budget.
 *
 * Local clipping always clears `complete`, records `byte_budget`, and requires
 * a usable continuation cursor. An item that cannot fit is refused rather than
 * skipped, preserving stable pagination order.
 */
export function fitPageToByteBudget<T>(
  envelope: OutputPageEnvelope<T>,
  options: FitPageToByteBudgetOptions,
): BudgetedPage<T> {
  assertPositiveSafeInteger(options.maxBytes, "OUTPUT_INVALID_BUDGET", "maxBytes");
  const validated = validatePageEnvelope<T>(envelope);
  const serialization = options.serialization ?? {};
  const full = serializeEnvelopeWithMetrics(envelopeInput(validated, validated.items), options.maxBytes, serialization);
  if (full.bytes <= options.maxBytes) {
    return {
      ...full,
      max_bytes: options.maxBytes,
      omitted_items: 0,
    };
  }

  if (options.nextCursorForIndex !== undefined && typeof options.nextCursorForIndex !== "function") {
    throw new OutputContractError("OUTPUT_CONTINUATION_REQUIRED", "nextCursorForIndex must be a function");
  }
  if (validated._meta.cursor_semantics === "whole-query") {
    throw new OutputContractError(
      "OUTPUT_CONTINUATION_REQUIRED",
      "a whole-query page cannot be byte-clipped without changing its declared cursor semantics",
    );
  }
  if (validated._meta.cursor_semantics === "opaque" && !options.nextCursorForIndex) {
    throw new OutputContractError(
      "OUTPUT_CONTINUATION_REQUIRED",
      "byte clipping an opaque page requires nextCursorForIndex so omitted items remain reachable",
    );
  }

  const originalReasons = validated._meta.truncation_reasons ?? [];
  const reasons = [...new Set([...originalReasons, "byte_budget"])];
  const offset = validated._meta.cursor_semantics === "offset"
    ? (validated._meta.cursor as number | null) ?? 0
    : null;
  for (let count = validated.items.length - 1; count >= 1; count -= 1) {
    const nextCursor = offset === null
      ? options.nextCursorForIndex!(count)
      : checkedOffsetEnd(offset, count);
    const candidate = serializeEnvelopeWithMetrics(
      envelopeInput(validated, validated.items.slice(0, count), {
        nextCursor,
        hasMore: true,
        complete: false,
        truncated: true,
        truncationReasons: reasons,
      }),
      options.maxBytes,
      serialization,
    );
    if (candidate.bytes <= options.maxBytes) {
      return {
        ...candidate,
        max_bytes: options.maxBytes,
        omitted_items: validated.items.length - count,
      };
    }
  }

  throw new OutputContractError(
    "OUTPUT_ITEM_EXCEEDS_BUDGET",
    "the first page item cannot fit without being split or skipped",
  );
}
