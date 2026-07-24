export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type OutputFormat = "json" | "pretty";
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface ZymblyConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: HttpMethod;
  body?: JsonValue | string;
  headers?: Record<string, string>;
  query?: QueryParams;
  auth?: boolean;
}

export class ZymblyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ZymblyApiError";
  }
}
