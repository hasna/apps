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

// src/output.ts
var OUTPUT_PAGE_CONTRACT_VERSION = 1;

class OutputContractError extends TypeError {
  code;
  path;
  constructor(code, message, path) {
    super(message);
    this.name = "OutputContractError";
    this.code = code;
    if (path !== undefined)
      this.path = path;
  }
}
var OUTPUT_ERROR_CODES = new Set([
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
  "OUTPUT_BUDGET_TOO_SMALL"
]);
function isOutputContractError(value) {
  if (typeof value !== "object" || value === null)
    return false;
  try {
    const name = Object.getOwnPropertyDescriptor(value, "name");
    const code = Object.getOwnPropertyDescriptor(value, "code");
    const message = Object.getOwnPropertyDescriptor(value, "message");
    const path = Object.getOwnPropertyDescriptor(value, "path");
    return name?.value === "OutputContractError" && typeof message?.value === "string" && typeof code?.value === "string" && OUTPUT_ERROR_CODES.has(code.value) && (path === undefined || path.value === undefined || typeof path.value === "string");
  } catch {
    return false;
  }
}
var UNSAFE_FIELD_NAMES = new Set(["__proto__", "prototype", "constructor"]);
function assertFieldName(field, label) {
  if (typeof field !== "string" || field.trim().length === 0 || UNSAFE_FIELD_NAMES.has(field)) {
    throw new OutputContractError("OUTPUT_INVALID_FIELD", `${label} contains an invalid field name`);
  }
}
function copyFieldArray(value, label) {
  if (!Array.isArray(value)) {
    throw new OutputContractError("OUTPUT_INVALID_FIELD", `${label} must be an array`);
  }
  const output = [];
  for (let index = 0;index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor) {
      throw new OutputContractError("OUTPUT_INVALID_FIELD", `${label} must not be sparse`);
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `${label}[${index}] is an accessor and was not evaluated`);
    }
    assertFieldName(descriptor.value, label);
    output.push(descriptor.value);
  }
  return output;
}
function plainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
function projectRecord(record, fields, options = {}) {
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
  const required = new Set;
  const ordered = [];
  const seen = new Set;
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
  const output = {};
  for (const field of ordered) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, field);
    } catch {
      throw new OutputContractError("OUTPUT_INVALID_RECORD", "projection input could not be inspected safely");
    }
    if (!descriptor) {
      if (required.has(field)) {
        throw new OutputContractError("OUTPUT_REQUIRED_FIELD_MISSING", `required output field ${JSON.stringify(field)} is missing`, field);
      }
      if (unknownFields === "error") {
        throw new OutputContractError("OUTPUT_UNKNOWN_FIELD", `selected output field ${JSON.stringify(field)} is missing`, field);
      }
      continue;
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `output field ${JSON.stringify(field)} is an accessor and was not evaluated`, field);
    }
    if (descriptor.value === undefined) {
      if (required.has(field)) {
        throw new OutputContractError("OUTPUT_REQUIRED_FIELD_MISSING", `required output field ${JSON.stringify(field)} is undefined`, field);
      }
      if (omitUndefined)
        continue;
    }
    Object.defineProperty(output, field, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return output;
}
function projectRecords(records, fields, options = {}) {
  if (!Array.isArray(records)) {
    throw new OutputContractError("OUTPUT_INVALID_RECORD", "projection records must be an array");
  }
  const output = [];
  for (let index = 0;index < records.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(records, index);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `projection record at index ${index} is not a data property`);
    }
    output.push(projectRecord(descriptor.value, fields, options));
  }
  return output;
}
var OUTPUT_PAGE_BRAND = Symbol("hasna.output-page.v1");
function assertSafeNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `${name} must be a non-negative safe integer`);
  }
}
function assertPositiveSafeInteger(value, code, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OutputContractError(code, `${name} must be a positive safe integer`);
  }
}
function usableCursor(value) {
  return typeof value === "string" && value.trim().length > 0 || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function inferCursorSemantics(cursor, nextCursor, explicit) {
  if (explicit !== undefined && explicit !== "offset" && explicit !== "opaque" && explicit !== "whole-query") {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "cursorSemantics must be offset, opaque, or whole-query");
  }
  if (explicit !== undefined)
    return explicit;
  if (typeof cursor === "number" || typeof nextCursor === "number")
    return "offset";
  if (typeof cursor === "string" || typeof nextCursor === "string")
    return "opaque";
  return "offset";
}
function checkedOffsetEnd(offset, count) {
  const end = offset + count;
  if (!Number.isSafeInteger(end)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "numeric cursor plus count exceeds the safe integer range");
  }
  return end;
}
function brandPageEnvelope(items, meta) {
  const envelope = { items, _meta: meta };
  Object.defineProperty(envelope, OUTPUT_PAGE_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return Object.freeze(envelope);
}
function normalizedReasons(reasons) {
  const result = [];
  const seen = new Set;
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
function copyDataArray(value, label) {
  if (!Array.isArray(value)) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `${label} must be an array`);
  }
  const output = [];
  for (let index = 0;index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", `${label} must not be sparse`);
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `${label}[${index}] is an accessor and was not evaluated`);
    }
    output.push(descriptor.value);
  }
  return output;
}
function createPageEnvelope(input) {
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
    if (cursor !== null && typeof cursor !== "number" || nextCursor !== null && typeof nextCursor !== "number") {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "offset cursors must be non-negative safe integers or null");
    }
    const offset = cursor ?? 0;
    const consumed = checkedOffsetEnd(offset, items.length);
    if (input.complete && offset !== 0) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "complete=true from a nonzero offset requires cursorSemantics=whole-query");
    }
    if (input.hasMore) {
      if (consumed <= offset) {
        throw new OutputContractError("OUTPUT_INVALID_PAGE", "offset continuation requires at least one emitted item");
      }
      if (nextCursor !== consumed) {
        throw new OutputContractError("OUTPUT_INVALID_PAGE", `offset next_cursor must equal cursor + count (${consumed})`);
      }
      if (total !== null && consumed >= total) {
        throw new OutputContractError("OUTPUT_INVALID_PAGE", "has_more=true cannot continue at or past the known total");
      }
    } else if (total !== null && consumed !== total) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", consumed < total ? "terminal offset page ends before the known total" : "terminal offset page extends past the known total");
    }
  } else if (cursorSemantics === "opaque") {
    if (cursor !== null && typeof cursor !== "string" || nextCursor !== null && typeof nextCursor !== "string") {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "opaque cursors must be non-empty strings or null");
    }
    if (input.hasMore && cursor !== null && nextCursor === cursor) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "opaque next_cursor must differ from cursor");
    }
    if (input.complete && cursor !== null) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "complete=true from a continued opaque cursor requires cursorSemantics=whole-query");
    }
    if (input.hasMore && total !== null && items.length === total) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "has_more=true contradicts count=total");
    }
    if (cursor === null && !input.hasMore && total !== null && items.length < total && input.truncated !== true) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "initial opaque page ends before the known total without continuation or declared truncation");
    }
  } else {
    if (input.hasMore) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "whole-query cursor semantics cannot advertise another page");
    }
    if (total !== null && items.length < total && !input.truncated) {
      throw new OutputContractError("OUTPUT_INVALID_PAGE", "whole-query page ends before the known total without declaring truncation");
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
  let fields;
  if (input.fields !== undefined) {
    const copiedFields = copyDataArray(input.fields, "fields");
    fields = [...new Set(copiedFields)];
    for (const field of fields)
      assertFieldName(field, "fields");
  }
  let sort;
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
    assertFieldName(field.value, "sort.field");
    sort = { field: field.value, direction: direction.value };
  }
  if (input.byteLength !== undefined)
    assertSafeNonNegativeInteger(input.byteLength, "byteLength");
  if (input.maxBytes !== undefined)
    assertPositiveSafeInteger(input.maxBytes, "OUTPUT_INVALID_PAGE", "maxBytes");
  if (input.byteLength !== undefined && input.maxBytes !== undefined && input.byteLength > input.maxBytes) {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", "byteLength cannot exceed maxBytes");
  }
  const meta = {
    contract_version: OUTPUT_PAGE_CONTRACT_VERSION,
    count: items.length,
    total,
    limit: input.limit,
    cursor,
    next_cursor: nextCursor,
    cursor_semantics: cursorSemantics,
    has_more: input.hasMore,
    complete: input.complete,
    truncated
  };
  if (reasons.length > 0)
    meta.truncation_reasons = Object.freeze(reasons);
  if (input.detail !== undefined)
    meta.detail = input.detail;
  if (fields !== undefined)
    meta.fields = Object.freeze(fields);
  if (sort !== undefined)
    meta.sort = Object.freeze(sort);
  if (input.byteLength !== undefined)
    meta.byte_length = input.byteLength;
  if (input.maxBytes !== undefined)
    meta.max_bytes = input.maxBytes;
  const frozenItems = Object.freeze(items);
  const frozenMeta = Object.freeze(meta);
  return brandPageEnvelope(frozenItems, frozenMeta);
}
var PAGE_ENVELOPE_KEYS = new Set(["items", "_meta"]);
var PAGE_META_KEYS = new Set([
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
  "max_bytes"
]);
function assertOnlyEnumerableKeys(record, allowed, label) {
  let keys;
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
function ownData(record, key, required) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new OutputContractError("OUTPUT_INVALID_PAGE", `page field ${JSON.stringify(key)} could not be inspected safely`);
  }
  if (!descriptor) {
    if (required)
      throw new OutputContractError("OUTPUT_INVALID_PAGE", `page field ${JSON.stringify(key)} is required`);
    return;
  }
  if (descriptor.get || descriptor.set) {
    throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `page field ${JSON.stringify(key)} is an accessor and was not evaluated`);
  }
  return descriptor.value;
}
function validatePageEnvelope(value) {
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
  const input = {
    items,
    limit: ownData(metaValue, "limit", true),
    cursor: ownData(metaValue, "cursor", true),
    nextCursor: ownData(metaValue, "next_cursor", true),
    cursorSemantics: ownData(metaValue, "cursor_semantics", true),
    hasMore: ownData(metaValue, "has_more", true),
    complete: ownData(metaValue, "complete", true),
    total: ownData(metaValue, "total", true),
    truncated: ownData(metaValue, "truncated", true)
  };
  const truncationReasons = ownData(metaValue, "truncation_reasons", false);
  const detail = ownData(metaValue, "detail", false);
  const fields = ownData(metaValue, "fields", false);
  const sort = ownData(metaValue, "sort", false);
  const byteLength = ownData(metaValue, "byte_length", false);
  const maxBytes = ownData(metaValue, "max_bytes", false);
  if (truncationReasons !== undefined)
    input.truncationReasons = truncationReasons;
  if (detail !== undefined)
    input.detail = detail;
  if (fields !== undefined)
    input.fields = fields;
  if (sort !== undefined)
    input.sort = sort;
  if (byteLength !== undefined)
    input.byteLength = byteLength;
  if (maxBytes !== undefined)
    input.maxBytes = maxBytes;
  return createPageEnvelope(input);
}
function childPath(path, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}
function normalizeJson(value, path, active) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
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
      const output2 = [];
      for (let index = 0;index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor) {
          throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `sparse array entry at ${path}[${index}]`, `${path}[${index}]`);
        }
        if (descriptor.get || descriptor.set) {
          throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `accessor property at ${path}[${index}] was not evaluated`, `${path}[${index}]`);
        }
        output2.push(normalizeJson(descriptor.value, `${path}[${index}]`, active));
      }
      return output2;
    }
    if (!plainRecord(value)) {
      throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `non-plain JSON object at ${path}`, path);
    }
    let keys;
    let symbols;
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
    const output = Object.create(null);
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
function validateSerializationOptions(options) {
  if (options.pretty !== undefined && typeof options.pretty !== "boolean") {
    throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", "pretty must be a boolean");
  }
  if (options.trailingNewline !== undefined && typeof options.trailingNewline !== "boolean") {
    throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", "trailingNewline must be a boolean");
  }
}
function serializeJson(value, options = {}) {
  validateSerializationOptions(options);
  const normalized = normalizeJson(value, "$", new WeakSet);
  const text = JSON.stringify(normalized, null, options.pretty ? 2 : undefined);
  return options.trailingNewline ? `${text}
` : text;
}
function serializeJsonLine(value) {
  return `${serializeJson(value)}
`;
}
function serializeJsonLines(values) {
  if (!Array.isArray(values)) {
    throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", "JSONL input must be an array");
  }
  const lines = [];
  for (let index = 0;index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor) {
      throw new OutputContractError("OUTPUT_UNSUPPORTED_VALUE", `sparse JSONL record at $[${index}]`, `$[${index}]`);
    }
    if (descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `JSONL record at $[${index}] is an accessor`, `$[${index}]`);
    }
    const normalized = normalizeJson(descriptor.value, `$[${index}]`, new WeakSet);
    lines.push(JSON.stringify(normalized));
  }
  return lines.length === 0 ? "" : `${lines.join(`
`)}
`;
}
function utf8ByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
function measureJson(value, options = {}) {
  const text = serializeJson(value, options);
  return { text, bytes: utf8ByteLength(text) };
}
function measureJsonLines(values) {
  const text = serializeJsonLines(values);
  return { text, bytes: utf8ByteLength(text) };
}
function serializePageJsonLines(envelope) {
  const validated = validatePageEnvelope(envelope);
  const records = [];
  for (let index = 0;index < validated.items.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(validated.items, index);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new OutputContractError("OUTPUT_ACCESSOR_PROPERTY", `page item at index ${index} is not a data property`);
    }
    records.push({ _type: "item", item: descriptor.value });
  }
  records.push({ _type: "page_receipt", _meta: validated._meta });
  return serializeJsonLines(records);
}
function envelopeInput(envelope, items, overrides = {}) {
  const meta = envelope._meta;
  const base = {
    items,
    limit: meta.limit,
    cursor: meta.cursor,
    nextCursor: meta.next_cursor,
    cursorSemantics: meta.cursor_semantics,
    hasMore: meta.has_more,
    complete: meta.complete,
    total: meta.total,
    truncated: meta.truncated
  };
  if (meta.truncation_reasons !== undefined)
    base.truncationReasons = meta.truncation_reasons;
  if (meta.detail !== undefined)
    base.detail = meta.detail;
  if (meta.fields !== undefined)
    base.fields = meta.fields;
  if (meta.sort !== undefined)
    base.sort = meta.sort;
  return Object.assign(base, overrides);
}
function serializeEnvelopeWithMetrics(input, maxBytes, options) {
  const base = createPageEnvelope(input);
  let byteLength = 0;
  for (let attempt = 0;attempt < 12; attempt += 1) {
    const meta = Object.freeze({ ...base._meta, byte_length: byteLength, max_bytes: maxBytes });
    const envelope = brandPageEnvelope(base.items, meta);
    const text = serializeJson(envelope, options);
    const bytes = utf8ByteLength(text);
    if (bytes === byteLength)
      return { envelope, text, bytes };
    byteLength = bytes;
  }
  throw new OutputContractError("OUTPUT_INVALID_BUDGET", "byte-length metadata did not converge");
}
function fitPageToByteBudget(envelope, options) {
  assertPositiveSafeInteger(options.maxBytes, "OUTPUT_INVALID_BUDGET", "maxBytes");
  const validated = validatePageEnvelope(envelope);
  const serialization = options.serialization ?? {};
  const full = serializeEnvelopeWithMetrics(envelopeInput(validated, validated.items), options.maxBytes, serialization);
  if (full.bytes <= options.maxBytes) {
    return {
      ...full,
      max_bytes: options.maxBytes,
      omitted_items: 0
    };
  }
  if (validated.items.length === 0) {
    throw new OutputContractError("OUTPUT_BUDGET_TOO_SMALL", "byte budget cannot contain the empty page envelope");
  }
  if (options.nextCursorForIndex !== undefined && typeof options.nextCursorForIndex !== "function") {
    throw new OutputContractError("OUTPUT_CONTINUATION_REQUIRED", "nextCursorForIndex must be a function");
  }
  if (validated._meta.cursor_semantics === "whole-query") {
    throw new OutputContractError("OUTPUT_CONTINUATION_REQUIRED", "a whole-query page cannot be byte-clipped without changing its declared cursor semantics");
  }
  if (validated._meta.cursor_semantics === "opaque" && !options.nextCursorForIndex) {
    throw new OutputContractError("OUTPUT_CONTINUATION_REQUIRED", "byte clipping an opaque page requires nextCursorForIndex so omitted items remain reachable");
  }
  const originalReasons = validated._meta.truncation_reasons ?? [];
  const reasons = [...new Set([...originalReasons, "byte_budget"])];
  const offset = validated._meta.cursor_semantics === "offset" ? validated._meta.cursor ?? 0 : null;
  for (let count = validated.items.length - 1;count >= 1; count -= 1) {
    const nextCursor = offset === null ? options.nextCursorForIndex(count) : checkedOffsetEnd(offset, count);
    const candidate = serializeEnvelopeWithMetrics(envelopeInput(validated, validated.items.slice(0, count), {
      nextCursor,
      hasMore: true,
      complete: false,
      truncated: true,
      truncationReasons: reasons
    }), options.maxBytes, serialization);
    if (candidate.bytes <= options.maxBytes) {
      return {
        ...candidate,
        max_bytes: options.maxBytes,
        omitted_items: validated.items.length - count
      };
    }
  }
  throw new OutputContractError("OUTPUT_ITEM_EXCEEDS_BUDGET", "the first page item cannot fit without being split or skipped");
}
export {
  validatePageEnvelope,
  utf8ByteLength,
  serializePageJsonLines,
  serializeJsonLines,
  serializeJsonLine,
  serializeJson,
  projectRecords,
  projectRecord,
  measureJsonLines,
  measureJson,
  isOutputContractError,
  fitPageToByteBudget,
  createPageEnvelope,
  OutputContractError,
  OUTPUT_PAGE_CONTRACT_VERSION
};
