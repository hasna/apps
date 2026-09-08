/** Small structural interfaces keep Worker logic testable without a Cloudflare runtime. */
export interface FetchBinding {
  fetch(request: Request): Promise<Response>;
}

export interface RegistryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  transaction<T>(callback: (storage: RegistryStorage) => Promise<T>): Promise<T>;
}

export interface RegistryNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): FetchBinding;
}

export interface StationRecord {
  id: string;
  binding: string;
}

export interface PreviewRecord {
  key: string;
  hostname: string;
  fence: number;
  expiresAt: number;
  stationId?: string;
  instanceId?: string;
}

export interface RouterEnv {
  PREVIEWS: RegistryNamespace;
  CONTROL_TOKEN: string;
  ROUTER_TOKEN: string;
  GATEWAY_TOKEN: string;
  [binding: string]: unknown;
}

export const CONTROL_PATH = "/__servers/control";
export const LEASE_DURATION_MS = 60_000;

export class ControlError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function errorResponse(error: unknown): Response {
  return error instanceof ControlError
    ? json({ error: error.message, code: error.code }, error.status)
    : json({ error: "Preview service unavailable", code: "UNAVAILABLE" }, 503);
}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ControlError(400, "INVALID_INPUT", `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) {
    throw new ControlError(400, "INVALID_INPUT", `${name} must be a lowercase identifier`);
  }
  return value;
}

export function previewKey(value: unknown): string {
  if (typeof value !== "string" || value.split("/").length !== 4) {
    throw new ControlError(400, "INVALID_INPUT", "key must be product/app/environment/name");
  }
  for (const part of value.split("/")) identifier(part, "key segment");
  return value;
}

export function hostname(value: unknown): string {
  if (typeof value !== "string" || value.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/.test(value)) {
    throw new ControlError(400, "INVALID_INPUT", "hostname must be a permanent workers.dev hostname");
  }
  return value;
}

export function bindingName(value: unknown): string {
  if (typeof value !== "string" || !/^STATION_[A-Z0-9_]{1,100}$/.test(value)) {
    throw new ControlError(400, "INVALID_INPUT", "Invalid station binding");
  }
  return value;
}

/** Compare digests to avoid returning early on the first mismatching secret byte. */
export async function secretMatches(actual: string | null, expected: unknown): Promise<boolean> {
  if (typeof expected !== "string" || expected.length < 32 || !actual || actual.length > 4096) return false;
  const encode = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(actual)),
    crypto.subtle.digest("SHA-256", encode.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

export async function readControl(request: Request): Promise<Record<string, unknown>> {
  if (request.method !== "POST") throw new ControlError(405, "METHOD_NOT_ALLOWED", "Use POST");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ControlError(415, "CONTENT_TYPE", "Use application/json");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ControlError(400, "INVALID_INPUT", "Missing JSON body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new ControlError(413, "TOO_LARGE", "Control request is too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return record(JSON.parse(new TextDecoder().decode(bytes)), "request");
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError(400, "INVALID_INPUT", "Invalid JSON body");
  } finally {
    reader.releaseLock();
  }
}

/** All routing/authentication metadata is rewritten at each trusted hop. */
export function clearProxyHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (name.startsWith("x-servers-") || name.startsWith("x-forwarded-") ||
        name.startsWith("cf-access-") || name === "forwarded" || name === "x-real-ip") {
      headers.delete(name);
    }
  }
}
