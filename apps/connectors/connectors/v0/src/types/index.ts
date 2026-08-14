// v0 Platform API Connector Types

export interface V0Config {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface User {
  id: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface UserScopesResponse {
  scopes?: Array<{ id: string; name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface Project {
  id: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ListProjectsParams {
  limit?: number;
  offset?: number;
  scopeId?: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  icon?: string;
  environmentVariables?: Record<string, string>;
  instructions?: string;
  vercelProjectId?: string;
  privacy?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  icon?: string;
  environmentVariables?: Record<string, string>;
  instructions?: string;
  vercelProjectId?: string;
  privacy?: string;
}

export interface PaginatedResponse<T> {
  data?: T[];
  items?: T[];
  [key: string]: unknown;
}

export interface Chat {
  id: string;
  name?: string;
  projectId?: string;
  [key: string]: unknown;
}

export interface ListChatsParams {
  limit?: number;
  offset?: number;
  isFavorite?: boolean;
  vercelProjectId?: string;
  branch?: string;
  projectId?: string;
  scopeId?: string;
}

export interface CreateChatRequest {
  initialMessage?: string;
  projectId?: string;
  privacy?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  attachments?: unknown[];
  modelConfiguration?: Record<string, unknown>;
  system?: string;
}

export interface InitChatRequest {
  type?: string;
  files?: Array<{ name: string; content: string; [key: string]: unknown }>;
  repo?: Record<string, unknown>;
  initialContext?: string;
  projectId?: string;
  privacy?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  system?: string;
}

export interface ChatMessage {
  id: string;
  role?: string;
  content?: string;
  [key: string]: unknown;
}

export interface ListChatMessagesParams {
  limit?: number;
  cursor?: string;
}

export interface SendChatMessageRequest {
  message: string;
  attachments?: unknown[];
  system?: string;
  modelConfiguration?: Record<string, unknown>;
  responseMode?: string;
}

export interface Deployment {
  id: string;
  projectId?: string;
  chatId?: string;
  [key: string]: unknown;
}

export interface CreateDeploymentRequest {
  projectId?: string;
  chatId?: string;
  versionId?: string;
  environment?: string;
  name?: string;
}

export interface ListDeploymentsParams {
  projectId?: string;
  chatId?: string;
  versionId?: string;
  limit?: number;
  offset?: number;
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    index: number;
    message?: ChatCompletionMessage;
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class V0ApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'V0ApiError';
    this.statusCode = statusCode;
  }
}
