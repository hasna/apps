import type {
  Content,
  ContentPart,
  EmbedContentOptions,
  EndpointPredictOptions,
  EndpointRawPredictOptions,
  GenerateContentOptions,
  GenerationConfig,
  PredictImageOptions,
  RawRequestOptions,
  VertexAiConfig,
} from '../types';
import { VertexAiApiError } from '../types';
import { getLocation, isTokenExpired, setTokens } from '../utils/config';

export const VERTEX_AI_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_LOCATION = 'us-central1';
const MAX_RETRIES = 3;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
}

export class VertexAiClient {
  private accessToken: string;
  private readonly refreshToken?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly projectId?: string;
  private readonly location: string;
  private readonly tokenProvider?: () => Promise<string>;

  constructor(config: VertexAiConfig & { tokenProvider?: () => Promise<string> }) {
    if (!config.accessToken && !config.tokenProvider) {
      throw new VertexAiApiError('Access token is required', 401);
    }
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.projectId = config.projectId;
    this.location = config.location || DEFAULT_LOCATION;
    this.tokenProvider = config.tokenProvider;
  }

  getProjectId(): string | undefined {
    return this.projectId;
  }

  getLocation(): string {
    return this.location;
  }

  static getAuthorizationUrl(clientId: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: VERTEX_AI_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${OAUTH_AUTH_URL}?${params.toString()}`;
  }

  static async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new VertexAiApiError(
        (errorData as { error_description?: string }).error_description || 'Token exchange failed',
        response.status,
        errorData,
      );
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async refreshAccessToken(): Promise<{ accessToken: string; expiresIn?: number }> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new VertexAiApiError('Refresh token and OAuth credentials are required', 401);
    }

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new VertexAiApiError(
        (errorData as { error_description?: string }).error_description || 'Token refresh failed',
        response.status,
        errorData,
      );
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    setTokens({ accessToken: data.access_token, expiresIn: data.expires_in });
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }

  private baseUrl(location?: string): string {
    const loc = location || this.location || getLocation();
    return `https://${loc}-aiplatform.googleapis.com/v1`;
  }

  private publisherModelPath(options: {
    projectId: string;
    location?: string;
    publisher?: string;
    model: string;
  }): string {
    const loc = options.location || this.location || getLocation();
    const publisher = options.publisher ?? 'google';
    return `/projects/${encodeURIComponent(options.projectId)}/locations/${encodeURIComponent(loc)}/publishers/${encodeURIComponent(publisher)}/models/${encodeURIComponent(options.model)}`;
  }

  private endpointPath(options: { projectId: string; location?: string; endpointId: string }): string {
    const loc = options.location || this.location || getLocation();
    return `/projects/${encodeURIComponent(options.projectId)}/locations/${encodeURIComponent(loc)}/endpoints/${encodeURIComponent(options.endpointId)}`;
  }

  private buildGenerationBody(options: GenerateContentOptions): Record<string, unknown> {
    const generationConfig: GenerationConfig = { ...options.generationConfig };
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (options.topP !== undefined) generationConfig.topP = options.topP;
    if (options.topK !== undefined) generationConfig.topK = options.topK;
    if (options.candidateCount !== undefined) generationConfig.candidateCount = options.candidateCount;

    const body: Record<string, unknown> = { contents: options.contents };
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
    if (options.systemInstruction) {
      body.systemInstruction =
        typeof options.systemInstruction === 'string'
          ? { parts: [{ text: options.systemInstruction }] }
          : options.systemInstruction;
    }
    if (options.tools) body.tools = options.tools;
    if (options.safetySettings) body.safetySettings = options.safetySettings;
    return body;
  }

  private async resolveAccessToken(): Promise<string> {
    if (this.tokenProvider) return this.tokenProvider();
    if (isTokenExpired() && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      return refreshed.accessToken;
    }
    return this.accessToken;
  }

  async request<T>(location: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;
    const url = `${this.baseUrl(location)}${path.startsWith('/') ? path : `/${path}`}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const accessToken = await this.resolveAccessToken();
      const requestHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...headers,
      };

      if (body !== undefined && method !== 'GET') {
        requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });

      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
      }

      if (response.status === 204) return {} as T;

      const text = await response.text();
      let data: unknown = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!response.ok) {
        const message =
          (data as { error?: { message?: string } })?.error?.message ||
          (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 200);
        throw new VertexAiApiError(`Vertex AI: ${response.status} ${message}`, response.status, data);
      }

      return data as T;
    }

    throw lastError ?? new VertexAiApiError('Vertex AI request failed', 500);
  }

  async generateContent(options: GenerateContentOptions): Promise<unknown> {
    const loc = options.location || this.location;
    return this.request(loc, `${this.publisherModelPath(options)}:generateContent`, {
      method: 'POST',
      body: this.buildGenerationBody(options),
    });
  }

  async streamGenerateContent(options: GenerateContentOptions): Promise<unknown> {
    const loc = options.location || this.location;
    return this.request(loc, `${this.publisherModelPath(options)}:streamGenerateContent`, {
      method: 'POST',
      body: this.buildGenerationBody(options),
    });
  }

  async countTokens(
    options: Pick<GenerateContentOptions, 'projectId' | 'location' | 'publisher' | 'model' | 'contents'>,
  ): Promise<unknown> {
    const loc = options.location || this.location;
    return this.request(loc, `${this.publisherModelPath(options)}:countTokens`, {
      method: 'POST',
      body: { contents: options.contents },
    });
  }

  async computeTokens(
    options: Pick<GenerateContentOptions, 'projectId' | 'location' | 'publisher' | 'model' | 'contents'>,
  ): Promise<unknown> {
    const loc = options.location || this.location;
    return this.request(loc, `${this.publisherModelPath(options)}:computeTokens`, {
      method: 'POST',
      body: { contents: options.contents },
    });
  }

  async embedContent(options: EmbedContentOptions): Promise<unknown> {
    const loc = options.location || this.location;
    return this.request(loc, `${this.publisherModelPath(options)}:embedContent`, {
      method: 'POST',
      body: {
        content: options.content,
        taskType: options.taskType,
        title: options.title,
        outputDimensionality: options.outputDimensionality,
      },
    });
  }

  async listModels(options: {
    projectId: string;
    location?: string;
    publisher?: string;
  }): Promise<unknown> {
    const loc = options.location || this.location;
    const publisher = options.publisher ?? 'google';
    const path = `/projects/${encodeURIComponent(options.projectId)}/locations/${encodeURIComponent(loc)}/publishers/${encodeURIComponent(publisher)}/models`;
    return this.request(loc, path);
  }

  async predictImage(options: PredictImageOptions): Promise<unknown> {
    const loc = options.location || this.location;
    const model = options.model ?? 'imagegeneration@006';
    return this.request(loc, `${this.publisherModelPath({ ...options, model })}:predict`, {
      method: 'POST',
      body: {
        instances: [{ prompt: options.prompt }],
        parameters: {
          sampleCount: options.sampleCount ?? 1,
          aspectRatio: options.aspectRatio ?? '1:1',
          ...options.parameters,
        },
      },
    });
  }

  async endpointPredict(options: EndpointPredictOptions): Promise<unknown> {
    const loc = options.location || this.location;
    return this.request(loc, `${this.endpointPath(options)}:predict`, {
      method: 'POST',
      body: { instances: options.instances, parameters: options.parameters },
    });
  }

  async endpointRawPredict(options: EndpointRawPredictOptions): Promise<unknown> {
    const loc = options.location || this.location;
    return this.request(loc, `${this.endpointPath(options)}:rawPredict`, {
      method: 'POST',
      headers: options.headers,
      body: options.body,
    });
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const loc = options.location || this.location;
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    return this.request(loc, path, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      body: options.body,
    });
  }
}

export function parseContentsJson(json: string): Content[] {
  const parsed = JSON.parse(json) as Content[] | Content;
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function parseContentPartsJson(json: string): { parts: ContentPart[] } {
  const parsed = JSON.parse(json) as { parts: ContentPart[] } | ContentPart[];
  if (Array.isArray(parsed)) return { parts: parsed };
  return parsed;
}
