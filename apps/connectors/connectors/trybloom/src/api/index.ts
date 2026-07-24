import type {
  TrybloomConfig,
  ListBrandsParams,
  CreateBrandRequest,
  CreateGenerationRequest,
  EditImageRequest,
  ResizeImageRequest,
  UploadImageRequest,
  RawRequestOptions,
  TrybloomJson,
} from '../types';
import { TrybloomClient, encodePathSegment } from './client';

function bodyWithoutKeys(
  body: Record<string, unknown>,
  excludedKeys: string[],
): Record<string, unknown> {
  const excluded = new Set(excludedKeys);
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !excluded.has(key)),
  );
}

export class Trybloom {
  private readonly client: TrybloomClient;

  constructor(config: TrybloomConfig) {
    this.client = new TrybloomClient(config);
  }

  async listBrands(params?: ListBrandsParams): Promise<TrybloomJson> {
    return this.client.get<TrybloomJson>('/brands', params);
  }

  async getBrand(brandId: string): Promise<TrybloomJson> {
    return this.client.get<TrybloomJson>(`/brands/${encodePathSegment(brandId)}`);
  }

  async createBrand(body: CreateBrandRequest): Promise<TrybloomJson> {
    return this.client.post<TrybloomJson>('/brands', body);
  }

  async createGeneration(body: CreateGenerationRequest): Promise<TrybloomJson> {
    const payload = bodyWithoutKeys(body as Record<string, unknown>, ['brandId']);
    return this.client.post<TrybloomJson>('/generations', payload);
  }

  async getGeneration(generationId: string): Promise<TrybloomJson> {
    return this.client.get<TrybloomJson>(`/generations/${encodePathSegment(generationId)}`);
  }

  async editImage(body: EditImageRequest): Promise<TrybloomJson> {
    return this.client.post<TrybloomJson>('/images/edit', body);
  }

  async resizeImage(body: ResizeImageRequest): Promise<TrybloomJson> {
    return this.client.post<TrybloomJson>('/images/resize', body);
  }

  async uploadImage(body: UploadImageRequest): Promise<TrybloomJson> {
    return this.client.post<TrybloomJson>('/images/upload', body);
  }

  async rawRequest(options: RawRequestOptions): Promise<TrybloomJson> {
    const { path, method = 'GET', body, params, headers } = options;
    return this.client.request<TrybloomJson>(path, { method, body, params, headers });
  }

  static fromEnv(): Trybloom {
    const apiKey = process.env.TRYBLOOM_API_KEY;
    if (!apiKey) {
      throw new Error('TRYBLOOM_API_KEY environment variable is required');
    }
    return new Trybloom({
      apiKey,
      baseUrl: process.env.TRYBLOOM_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { TrybloomClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
