import type { XAIGrokConfig } from '../types';
import { XAIGrokClient } from './client';
import { ModelsApi } from './models';
import { ChatApi } from './chat';
import { ResponsesApi } from './responses';
import { EmbeddingsApi } from './embeddings';
import { TokenizeApi } from './tokenize';
import { ImagesApi } from './images';
import { VideoApi } from './video';
import { AudioApi } from './audio';
import { FilesApi } from './files';
import { BatchesApi } from './batches';
import { CollectionsApi } from './collections';

export class XAIGrok {
  private readonly client: XAIGrokClient;

  public readonly models: ModelsApi;
  public readonly chat: ChatApi;
  public readonly responses: ResponsesApi;
  public readonly embeddings: EmbeddingsApi;
  public readonly tokenize: TokenizeApi;
  public readonly images: ImagesApi;
  public readonly video: VideoApi;
  public readonly audio: AudioApi;
  public readonly files: FilesApi;
  public readonly batches: BatchesApi;
  public readonly collections: CollectionsApi;

  constructor(config: XAIGrokConfig) {
    this.client = new XAIGrokClient(config);
    this.models = new ModelsApi(this.client);
    this.chat = new ChatApi(this.client);
    this.responses = new ResponsesApi(this.client);
    this.embeddings = new EmbeddingsApi(this.client);
    this.tokenize = new TokenizeApi(this.client);
    this.images = new ImagesApi(this.client);
    this.video = new VideoApi(this.client);
    this.audio = new AudioApi(this.client);
    this.files = new FilesApi(this.client);
    this.batches = new BatchesApi(this.client);
    this.collections = new CollectionsApi(this.client);
  }

  static fromEnv(): XAIGrok {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error('XAI_API_KEY environment variable is required');
    }
    return new XAIGrok({
      apiKey,
      baseUrl: process.env.XAI_BASE_URL,
    });
  }

  async rawRequest(options: {
    path: string;
    method?: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown> | FormData;
    query?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown> {
    return this.client.request(options.path, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      body: options.body,
      params: options.query,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): XAIGrokClient {
    return this.client;
  }
}

export const Connector = XAIGrok;

export { XAIGrokClient } from './client';
export { ModelsApi } from './models';
export { ChatApi } from './chat';
export { ResponsesApi } from './responses';
export { EmbeddingsApi } from './embeddings';
export { TokenizeApi } from './tokenize';
export { ImagesApi } from './images';
export { VideoApi } from './video';
export { AudioApi } from './audio';
export { FilesApi } from './files';
export { BatchesApi } from './batches';
export { CollectionsApi } from './collections';
