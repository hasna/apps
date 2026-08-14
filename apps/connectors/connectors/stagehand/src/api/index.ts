import { StagehandClient, type RequestOptions, type StagehandClientConfig } from './client';
import type {
  ActRequest,
  ActResponse,
  AgentExecuteRequest,
  AgentExecuteResponse,
  ExtractRequest,
  ExtractResponse,
  NavigateRequest,
  NavigateResponse,
  ObserveRequest,
  ObserveResponse,
  RawRequestOptions,
  ReplayResponse,
  SessionEndResponse,
  SessionStartRequest,
  SessionStartResponse,
} from '../types';

export { StagehandClient, DEFAULT_BASE_URL } from './client';
export type { StagehandClientConfig, RequestOptions } from './client';

export class Stagehand {
  private readonly client: StagehandClient;

  constructor(config: StagehandClientConfig) {
    this.client = new StagehandClient(config);
  }

  static fromEnv(): Stagehand {
    const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
    const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID;
    const modelApiKey = process.env.MODEL_API_KEY;
    const baseUrl = process.env.STAGEHAND_BASE_URL;

    if (!browserbaseApiKey) {
      throw new Error('BROWSERBASE_API_KEY environment variable is required');
    }
    if (!modelApiKey) {
      throw new Error('MODEL_API_KEY environment variable is required');
    }

    return new Stagehand({ browserbaseApiKey, browserbaseProjectId, modelApiKey, baseUrl });
  }

  async startSession(body: SessionStartRequest): Promise<SessionStartResponse> {
    return this.client.post<SessionStartResponse>('/v1/sessions/start', body);
  }

  async navigate(sessionId: string, body: NavigateRequest): Promise<NavigateResponse> {
    return this.client.post<NavigateResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/navigate`, body);
  }

  async act(sessionId: string, body: ActRequest): Promise<ActResponse> {
    return this.client.post<ActResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/act`, body);
  }

  async observe(sessionId: string, body: ObserveRequest): Promise<ObserveResponse> {
    return this.client.post<ObserveResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/observe`, body);
  }

  async extract(sessionId: string, body: ExtractRequest): Promise<ExtractResponse> {
    return this.client.post<ExtractResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/extract`, body);
  }

  async agentExecute(sessionId: string, body: AgentExecuteRequest): Promise<AgentExecuteResponse> {
    return this.client.post<AgentExecuteResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/agentExecute`, body);
  }

  async replay(sessionId: string): Promise<ReplayResponse> {
    return this.client.get<ReplayResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/replay`);
  }

  async endSession(sessionId: string): Promise<SessionEndResponse> {
    return this.client.post<SessionEndResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/end`);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const method = (options.method || 'GET').toUpperCase() as NonNullable<RequestOptions['method']>;
    return this.client.request<T>(options.path, {
      method,
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): StagehandClient {
    return this.client;
  }

  getBrowserbaseApiKeyPreview(): string {
    return this.client.getBrowserbaseApiKeyPreview();
  }

  getModelApiKeyPreview(): string {
    return this.client.getModelApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}
