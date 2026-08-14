export type OutputFormat = 'json' | 'table' | 'pretty';

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

export interface ProfileConfig {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  tokenExpiry?: number;
  projectId?: string;
  location?: string;
}

export interface VertexAiConfig {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  projectId?: string;
  location?: string;
}

export interface ContentPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
  [key: string]: unknown;
}

export interface Content {
  role?: string;
  parts: ContentPart[];
}

export interface GenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  [key: string]: unknown;
}

export interface GenerateContentOptions {
  projectId: string;
  location?: string;
  publisher?: string;
  model: string;
  contents: Content[];
  systemInstruction?: string | { parts: ContentPart[] };
  generationConfig?: GenerationConfig;
  tools?: unknown[];
  safetySettings?: unknown[];
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
}

export interface EmbedContentOptions {
  projectId: string;
  location?: string;
  publisher?: string;
  model: string;
  content: { parts: ContentPart[] };
  taskType?: string;
  title?: string;
  outputDimensionality?: number;
}

export interface PredictImageOptions {
  projectId: string;
  location?: string;
  publisher?: string;
  model?: string;
  prompt: string;
  sampleCount?: number;
  aspectRatio?: string;
  parameters?: Record<string, unknown>;
}

export interface EndpointPredictOptions {
  projectId: string;
  location?: string;
  endpointId: string;
  instances: unknown[];
  parameters?: Record<string, unknown>;
}

export interface EndpointRawPredictOptions {
  projectId: string;
  location?: string;
  endpointId: string;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RawRequestOptions {
  location?: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
}

export class VertexAiApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'VertexAiApiError';
  }

  isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  isRateLimited(): boolean {
    return this.status === 429;
  }
}
