// Windmill API Platform API Types

export interface WindmillApiPlatformConfig {
  apiKey: string;
  baseUrl: string;
  workspace: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type QueryParams = Record<string, string | number | boolean | undefined>;
export type ScriptArgs = Record<string, unknown>;

export interface RunScriptOptions {
  path: string;
  args?: ScriptArgs;
  query?: QueryParams;
}

export interface RawRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  query?: QueryParams;
  headers?: Record<string, string>;
}

export class WindmillApiPlatformApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'WindmillApiPlatformApiError';
  }
}
