export type OutputFormat = "json" | "pretty";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | QueryPrimitive[] | null | undefined;

export interface ZoomInfoConfig {
  username?: string;
  password?: string;
  jwt?: string;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: HttpMethod;
  params?: Record<string, QueryValue>;
  body?: JsonValue | string;
  headers?: Record<string, string>;
  responseType?: "json" | "text";
  auth?: boolean;
}

export class ZoomInfoApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ZoomInfoApiError";
  }
}
