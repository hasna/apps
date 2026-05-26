import { GeminiClient, type GeminiClientConfig } from './client';
import { GenerateApi } from './generate';
import { ImagesApi } from './images';
import { VideoApi } from './video';
import { SpeechApi } from './speech';
import { EmbeddingsApi } from './embeddings';
import { FilesApi } from './files';
import { ModelsApi } from './models';

/**
 * Main Google Gemini Connector class
 * Provides access to all Gemini API endpoints
 */
export class Gemini {
  private readonly client: GeminiClient;

  // API modules
  public readonly generate: GenerateApi;
  public readonly images: ImagesApi;
  public readonly video: VideoApi;
  public readonly speech: SpeechApi;
  public readonly embeddings: EmbeddingsApi;
  public readonly files: FilesApi;
  public readonly models: ModelsApi;

  constructor(config: GeminiClientConfig) {
    this.client = new GeminiClient(config);
    this.generate = new GenerateApi(this.client);
    this.images = new ImagesApi(this.client);
    this.video = new VideoApi(this.client);
    this.speech = new SpeechApi(this.client);
    this.embeddings = new EmbeddingsApi(this.client);
    this.files = new FilesApi(this.client);
    this.models = new ModelsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for GEMINI_API_KEY
   */
  static fromEnv(): Gemini {
    const apiKey = process.env.GEMINI_API_KEY;
    const baseUrl = process.env.GEMINI_BASE_URL;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }

    return new Gemini({ apiKey, baseUrl });
  }

  /**
   * Quick text generation
   */
  async text(prompt: string, options?: { model?: string; temperature?: number }): Promise<string> {
    return this.generate.text(prompt, options);
  }

  /**
   * Quick image generation
   */
  async image(prompt: string, options?: { aspectRatio?: string; imageSize?: string }): Promise<string> {
    const images = await this.images.generate(prompt, options as any);
    return images[0]?.data || '';
  }

  /**
   * Quick embedding
   */
  async embed(text: string): Promise<number[]> {
    return this.embeddings.embed(text);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GeminiClient {
    return this.client;
  }

  /**
   * Get API key preview (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}

export { GeminiClient } from './client';
export { GenerateApi } from './generate';
export { ImagesApi } from './images';
export { VideoApi } from './video';
export { SpeechApi } from './speech';
export { EmbeddingsApi } from './embeddings';
export { FilesApi } from './files';
export { ModelsApi } from './models';
