export interface StagehandConfig {
  browserbaseApiKey: string;
  modelApiKey: string;
  browserbaseProjectId?: string;
  baseUrl?: string;
}

export interface RawRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface StagehandResponse<TData = unknown> {
  success: boolean;
  data: TData;
}

export interface SessionStartRequest {
  modelName: string;
  domSettleTimeoutMs?: number;
  verbose?: 0 | 1 | 2;
  systemPrompt?: string;
  browserbaseSessionCreateParams?: Record<string, unknown>;
  browser?: Record<string, unknown>;
  selfHeal?: boolean;
  browserbaseSessionID?: string;
  experimental?: boolean;
  [key: string]: unknown;
}

export interface SessionStartResult {
  sessionId: string;
  cdpUrl?: string | null;
  available: boolean;
  [key: string]: unknown;
}

export type SessionStartResponse = StagehandResponse<SessionStartResult>;

export interface NavigateRequest {
  url: string;
  options?: {
    referer?: string;
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    [key: string]: unknown;
  };
  frameId?: string | null;
  streamResponse?: boolean;
  [key: string]: unknown;
}

export interface StagehandAction {
  [key: string]: unknown;
}

export interface VariableValue {
  value: unknown;
  description?: string;
}

export type Variables = Record<string, string | number | boolean | null | VariableValue>;

export interface StagehandModelOptions {
  model?: string | Record<string, unknown>;
  variables?: Variables;
  timeout?: number;
  selector?: string;
  ignoreSelectors?: string[];
  screenshot?: boolean;
  [key: string]: unknown;
}

export interface ActRequest {
  input: string | StagehandAction;
  options?: StagehandModelOptions;
  frameId?: string | null;
  streamResponse?: boolean;
  [key: string]: unknown;
}

export interface ObserveRequest {
  instruction?: string;
  options?: StagehandModelOptions;
  frameId?: string | null;
  streamResponse?: boolean;
  [key: string]: unknown;
}

export interface ExtractRequest {
  instruction?: string;
  schema?: Record<string, unknown>;
  options?: StagehandModelOptions;
  frameId?: string | null;
  streamResponse?: boolean;
  [key: string]: unknown;
}

export interface AgentExecuteRequest {
  agentConfig: Record<string, unknown>;
  executeOptions: {
    instruction: string;
    maxSteps?: number;
    highlightCursor?: boolean;
    useSearch?: boolean;
    toolTimeout?: number;
    variables?: Variables;
    [key: string]: unknown;
  };
  frameId?: string | null;
  streamResponse?: boolean;
  shouldCache?: boolean;
  [key: string]: unknown;
}

export type NavigateResponse = StagehandResponse<unknown>;
export type ActResponse = StagehandResponse<unknown>;
export type ObserveResponse = StagehandResponse<unknown>;
export type ExtractResponse = StagehandResponse<unknown>;
export type AgentExecuteResponse = StagehandResponse<unknown>;
export type ReplayResponse = StagehandResponse<unknown>;

export interface SessionEndResponse {
  success: boolean;
}

export class StagehandApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'StagehandApiError';
  }
}
