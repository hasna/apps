export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type OutputFormat = "json" | "pretty";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | Date | null | undefined;

export interface QueryParams {
  [key: string]: QueryValue | QueryValue[];
}

export type RequestBody = JsonValue | string | Uint8Array | ArrayBuffer | Blob | FormData;
export type ResponseType = "json" | "text" | "arrayBuffer";

export interface CloudflareWorkersConfig {
  apiToken?: string;
  accountId?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface CloudflareWorkersRawResponse {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export interface CloudflareWorkersRequestOptions {
  method?: HttpMethod;
  query?: QueryParams;
  body?: RequestBody;
  headers?: Record<string, string>;
  rawBody?: boolean;
  responseType?: ResponseType;
  signal?: AbortSignal;
}

export class CloudflareWorkersApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CloudflareWorkersApiError";
  }
}
