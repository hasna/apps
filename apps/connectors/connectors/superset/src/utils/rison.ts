import type { ListOptions } from '../types';

/**
 * Minimal Rison encoder.
 *
 * Superset's REST API accepts a Rison-encoded `q` query-string parameter for
 * filtering, ordering and pagination on its list endpoints. Rison is a compact,
 * URI-friendly serialization of JSON-like data:
 *
 *   object  -> (key:value,key2:value2)
 *   array   -> !(a,b,c)
 *   true    -> !t
 *   false   -> !f
 *   null    -> !n
 *   number  -> as-is
 *   string  -> quoted with single quotes; `!` and `'` are escaped with `!`
 *
 * Strings are always quoted here for deterministic, unambiguous output.
 */
export function risonEncode(value: unknown): string {
  return encodeValue(value);
}

function encodeValue(value: unknown): string {
  if (value === null) return '!n';
  if (value === true) return '!t';
  if (value === false) return '!f';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot Rison-encode a non-finite number');
    }
    return String(value);
  }

  if (typeof value === 'string') {
    return encodeString(value);
  }

  if (Array.isArray(value)) {
    return `!(${value.map(encodeValue).join(',')})`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .map((key) => `${encodeString(key)}:${encodeValue(obj[key])}`);
    return `(${parts.join(',')})`;
  }

  throw new Error(`Cannot Rison-encode value of type ${typeof value}`);
}

function encodeString(str: string): string {
  // Escape the Rison quote (') and escape (!) characters. The escape char must
  // be replaced first so we don't double-escape the escapes we introduce.
  const escaped = str.replace(/!/g, '!!').replace(/'/g, "!'");
  return `'${escaped}'`;
}

/**
 * Build the Rison object used for Superset list endpoints from high-level
 * options, then encode it. Only the provided fields are included.
 */
export function buildListQuery(options: ListOptions = {}): string {
  const query: Record<string, unknown> = {};

  if (options.columns && options.columns.length > 0) {
    query.columns = options.columns;
  }

  if (options.filters && options.filters.length > 0) {
    query.filters = options.filters.map((f) => ({
      col: f.col,
      opr: f.opr,
      value: f.value,
    }));
  }

  if (options.orderColumn) {
    query.order_column = options.orderColumn;
  }

  if (options.orderDirection) {
    query.order_direction = options.orderDirection;
  }

  if (options.page !== undefined) {
    query.page = options.page;
  }

  if (options.pageSize !== undefined) {
    query.page_size = options.pageSize;
  }

  return risonEncode(query);
}
