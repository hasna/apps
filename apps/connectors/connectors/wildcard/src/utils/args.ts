const CONNECTOR = 'Wildcard';

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${CONNECTOR}: ${label} is required`);
  }
  return value.trim();
}

export function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${CONNECTOR}: ${label} must be a non-empty string`);
  }
  return value.trim();
}

export function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${CONNECTOR}: ${label} must be a finite number`);
  }
  return value;
}

export function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${CONNECTOR}: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function prune<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

export function apiPath(path: string): string {
  const clean = requireString(path, 'path');
  if (/^https?:\/\//i.test(clean)) {
    throw new Error(`${CONNECTOR}: path must be a relative API path`);
  }
  return clean.startsWith('/') ? clean : `/${clean}`;
}

export function methodFrom(value: unknown): import('../types').HttpMethod {
  const method = optionalString(value, 'method')?.toUpperCase() ?? 'GET';
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error(`${CONNECTOR}: method must be GET, POST, PUT, PATCH, or DELETE`);
  }
  return method as import('../types').HttpMethod;
}

export function queryFromArgs(
  args: Record<string, unknown>,
  keys: string[],
): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`${CONNECTOR}: ${key} must be a string, number, or boolean`);
    }
    query[key] = value;
  }
  return query;
}

export function withQuery(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function getByPath(value: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cursor = value as Record<string, unknown> | unknown[];
  for (const part of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part] as Record<string, unknown> | unknown[];
  }
  return cursor;
}

export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cursor: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  const last = parts.at(-1);
  if (last) cursor[last] = value;
}

export function parseJsonObject(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`${CONNECTOR}: unable to parse ${label}: ${error.message}`);
    }
    throw new Error(`${CONNECTOR}: unable to parse ${label}`);
  }
}
