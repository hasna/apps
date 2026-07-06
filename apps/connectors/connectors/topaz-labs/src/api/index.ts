import type {
  TopazLabsConfig,
  TopazJob,
  TopazJobList,
  TopazModel,
  TopazPreset,
  TopazTag,
  TopazUploadUrl,
  TopazCredits,
  TopazUsage,
  TopazAccount,
  TopazWebhook,
} from '../types';
import { TopazLabsClient } from './client';

export { TopazLabsClient, DEFAULT_BASE_URL } from './client';

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Topaz Labs: ${label} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function requireNonEmptyRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Topaz Labs: ${label} is required`);
  }
  const result = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined),
  );
  if (Object.keys(result).length === 0) {
    throw new Error(`Topaz Labs: ${label} is required`);
  }
  return result;
}

function definedEntries(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

export class TopazLabs {
  private readonly client: TopazLabsClient;

  constructor(config: TopazLabsConfig) {
    this.client = new TopazLabsClient(config);
  }

  static fromEnv(): TopazLabs {
    const apiKey = process.env.TOPAZ_LABS_API_KEY || process.env.CONNECTOR_API_KEY;
    if (!apiKey) {
      throw new Error('TOPAZ_LABS_API_KEY is required');
    }
    return new TopazLabs({ apiKey });
  }

  async enhance(options: {
    imageUrl: string;
    outputFormat?: 'jpg' | 'png' | 'tiff';
    outputQuality?: number;
    outputColorSpace?: string;
    outputBitDepth?: number;
    model?: string;
    faceDetection?: 'auto' | 'off' | 'subject';
    faceDetectionParent?: string;
    subjectDetection?: string;
    faceCreativity?: number;
    faceOption?: string;
    sharpen?: number;
    denoise?: number;
    deblur?: number;
    lighting?: number;
    colorEnhancement?: number;
    sceneType?: string;
    preset?: string;
    outputWidth?: number;
    outputHeight?: number;
    outputResolution?: number;
    ipi?: boolean;
    tags?: string[];
  }): Promise<TopazJob> {
    return this.client.post<TopazJob>('/enhance', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      output_format: options.outputFormat,
      output_quality: options.outputQuality,
      output_color_space: options.outputColorSpace,
      output_bit_depth: options.outputBitDepth,
      model: options.model,
      face_detection: options.faceDetection,
      face_detection_parent: options.faceDetectionParent,
      subject_detection: options.subjectDetection,
      face_creativity: options.faceCreativity,
      face_option: options.faceOption,
      sharpen: options.sharpen,
      denoise: options.denoise,
      deblur: options.deblur,
      lighting: options.lighting,
      color_enhancement: options.colorEnhancement,
      scene_type: options.sceneType,
      preset: options.preset,
      output_width: options.outputWidth,
      output_height: options.outputHeight,
      output_resolution: options.outputResolution,
      ipi: options.ipi,
      tags: options.tags,
    }));
  }

  async upscale(options: {
    imageUrl: string;
    scale?: 1 | 2 | 4 | 6;
    model?: string;
    outputFormat?: 'jpg' | 'png' | 'tiff';
    outputQuality?: number;
  }): Promise<TopazJob> {
    return this.client.post<TopazJob>('/upscale', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      scale: options.scale ?? 2,
      model: options.model,
      output_format: options.outputFormat,
      output_quality: options.outputQuality,
    }));
  }

  async sharpen(options: {
    imageUrl: string;
    model?: string;
    sharpenAmount?: number;
    outputFormat?: string;
  }): Promise<TopazJob> {
    return this.client.post<TopazJob>('/sharpen', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      model: options.model,
      sharpen_amount: options.sharpenAmount,
      output_format: options.outputFormat,
    }));
  }

  async denoise(options: {
    imageUrl: string;
    model?: 'standard' | 'low_light' | 'severe_noise';
    strength?: number;
    outputFormat?: string;
  }): Promise<TopazJob> {
    return this.client.post<TopazJob>('/denoise', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      model: options.model,
      strength: options.strength,
      output_format: options.outputFormat,
    }));
  }

  async restore(options: {
    imageUrl: string;
    restorationStrength?: number;
    recoverFaces?: boolean;
    outputFormat?: string;
  }): Promise<TopazJob> {
    return this.client.post<TopazJob>('/restore', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      restoration_strength: options.restorationStrength,
      recover_faces: options.recoverFaces,
      output_format: options.outputFormat,
    }));
  }

  async generativeUpscale(options: {
    imageUrl: string;
    scale?: 1 | 2 | 4;
    prompt?: string;
    creativity?: number;
    outputFormat?: string;
  }): Promise<TopazJob> {
    return this.client.post<TopazJob>('/generative-upscale', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      scale: options.scale,
      prompt: options.prompt,
      creativity: options.creativity,
      output_format: options.outputFormat,
    }));
  }

  async lighting(options: {
    imageUrl: string;
    strength?: number;
    relight?: boolean;
    outputFormat?: string;
  }): Promise<TopazJob> {
    return this.client.post<TopazJob>('/lighting', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      strength: options.strength,
      relight: options.relight,
      output_format: options.outputFormat,
    }));
  }

  async previewEnhance(options: {
    imageUrl: string;
    tile?: { x: number; y: number; width: number; height: number };
    modelOverrides?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/enhance/preview', definedEntries({
      image_url: requireString(options.imageUrl, 'imageUrl'),
      tile: options.tile,
      model_overrides: options.modelOverrides,
    }));
  }

  async batchSubmit(options: {
    items: Array<Record<string, unknown>>;
    preset?: string;
    webhookUrl?: string;
  }): Promise<TopazJob> {
    if (!Array.isArray(options.items) || options.items.length === 0) {
      throw new Error('Topaz Labs: items is required');
    }
    return this.client.post<TopazJob>('/batch', definedEntries({
      items: options.items,
      preset: options.preset,
      webhook_url: options.webhookUrl,
    }));
  }

  async getJob(id: string): Promise<TopazJob> {
    return this.client.get<TopazJob>(`/jobs/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  async listJobs(options: {
    status?: 'queued' | 'processing' | 'completed' | 'failed';
    limit?: number;
    cursor?: string;
  } = {}): Promise<TopazJobList> {
    const params: Record<string, string | number | undefined> = {};
    if (options.status) params.status = options.status;
    if (options.limit !== undefined) params.limit = options.limit;
    const cursor = optionalString(options.cursor, 'cursor');
    if (cursor) params.cursor = cursor;
    return this.client.get<TopazJobList>('/jobs', params);
  }

  async cancelJob(id: string): Promise<TopazJob> {
    return this.client.post<TopazJob>(`/jobs/${encodeURIComponent(requireString(id, 'id'))}/cancel`, {});
  }

  async deleteJob(id: string): Promise<void> {
    await this.client.delete(`/jobs/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  async listModels(options: {
    feature?: 'enhance' | 'upscale' | 'sharpen' | 'denoise' | 'restore' | 'generative-upscale';
  } = {}): Promise<{ models?: TopazModel[] }> {
    const params: Record<string, string | undefined> = {};
    if (options.feature) params.feature = options.feature;
    return this.client.get('/models', params);
  }

  async getModel(id: string): Promise<TopazModel> {
    return this.client.get<TopazModel>(`/models/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  async listPresets(options: { feature?: string } = {}): Promise<{ presets?: TopazPreset[] }> {
    const feature = optionalString(options.feature, 'feature');
    const params: Record<string, string | undefined> = {};
    if (feature) params.feature = feature;
    return this.client.get('/presets', params);
  }

  async createPreset(options: {
    name: string;
    feature: string;
    settings: Record<string, unknown>;
    description?: string;
  }): Promise<TopazPreset> {
    return this.client.post<TopazPreset>('/presets', definedEntries({
      name: requireString(options.name, 'name'),
      feature: requireString(options.feature, 'feature'),
      settings: requireNonEmptyRecord(options.settings, 'settings'),
      description: options.description,
    }));
  }

  async updatePreset(id: string, data: Record<string, unknown>): Promise<TopazPreset> {
    return this.client.patch<TopazPreset>(
      `/presets/${encodeURIComponent(requireString(id, 'id'))}`,
      requireNonEmptyRecord(data, 'data'),
    );
  }

  async deletePreset(id: string): Promise<void> {
    await this.client.delete(`/presets/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  async listTags(): Promise<{ tags?: TopazTag[] }> {
    return this.client.get('/tags');
  }

  async createTag(name: string): Promise<TopazTag> {
    return this.client.post<TopazTag>('/tags', { name: requireString(name, 'name') });
  }

  async deleteTag(id: string): Promise<void> {
    await this.client.delete(`/tags/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  async createUploadUrl(options: {
    filename: string;
    contentType?: string;
  }): Promise<TopazUploadUrl> {
    return this.client.post<TopazUploadUrl>('/uploads', definedEntries({
      filename: requireString(options.filename, 'filename'),
      content_type: options.contentType,
    }));
  }

  async getCredits(): Promise<TopazCredits> {
    return this.client.get<TopazCredits>('/credits');
  }

  async getUsage(options: { from?: string; to?: string } = {}): Promise<TopazUsage> {
    const params: Record<string, string | undefined> = {};
    const from = optionalString(options.from, 'from');
    const to = optionalString(options.to, 'to');
    if (from) params.from = from;
    if (to) params.to = to;
    return this.client.get<TopazUsage>('/usage', params);
  }

  async getAccount(): Promise<TopazAccount> {
    return this.client.get<TopazAccount>('/account');
  }

  async listWebhooks(): Promise<{ webhooks?: TopazWebhook[] }> {
    return this.client.get('/webhooks');
  }

  async createWebhook(options: {
    url: string;
    events: string[];
    secret?: string;
    active?: boolean;
  }): Promise<TopazWebhook> {
    if (!Array.isArray(options.events) || options.events.length === 0) {
      throw new Error('Topaz Labs: events is required');
    }
    return this.client.post<TopazWebhook>('/webhooks', definedEntries({
      url: requireString(options.url, 'url'),
      events: options.events,
      secret: options.secret,
      active: options.active,
    }));
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.client.delete(`/webhooks/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  getClient(): TopazLabsClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}
