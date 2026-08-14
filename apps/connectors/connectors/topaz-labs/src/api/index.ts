import type {
  TopazAsyncImageRequest,
  TopazAsyncResponse,
  TopazBinaryInput,
  TopazBulkEstimateRequest,
  TopazBulkEstimationResult,
  TopazDownloadResponse,
  TopazEstimateRequest,
  TopazEstimationResponse,
  TopazLabsConfig,
  TopazModelSettingValue,
  TopazStatusesResponse,
  TopazStatusResponse,
} from '../types';
import { TopazLabsClient } from './client';

export { TopazLabsClient, DEFAULT_BASE_URL } from './client';

type AsyncOperation =
  | 'enhance'
  | 'enhanceGenerative'
  | 'sharpen'
  | 'sharpenGenerative'
  | 'denoise'
  | 'restore'
  | 'lighting'
  | 'matting'
  | 'tool';

const ASYNC_PATHS: Record<AsyncOperation, string> = {
  enhance: '/enhance/async',
  enhanceGenerative: '/enhance-gen/async',
  sharpen: '/sharpen/async',
  sharpenGenerative: '/sharpen-gen/async',
  denoise: '/denoise/async',
  restore: '/restore-gen/async',
  lighting: '/lighting/async',
  matting: '/matting/async',
  tool: '/tool/async',
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Topaz Labs: ${label} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, label);
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Topaz Labs: ${label} is required`);
  }
  return value;
}

function definedEntries<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null));
}

function appendFormValue(
  form: FormData,
  key: string,
  value: TopazModelSettingValue | TopazBinaryInput | undefined,
  filename?: string,
): void {
  if (value === undefined || value === null) return;
  if (value instanceof Blob) {
    if (filename) {
      form.append(key, value, filename);
    } else {
      form.append(key, value);
    }
    return;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    if (value instanceof ArrayBuffer) {
      const blob = new Blob([value]);
      if (filename) {
        form.append(key, blob, filename);
      } else {
        form.append(key, blob);
      }
      return;
    }
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    const blob = new Blob([bytes.buffer as ArrayBuffer]);
    if (filename) {
      form.append(key, blob, filename);
    } else {
      form.append(key, blob);
    }
    return;
  }
  form.append(key, String(value));
}

function appendModelSettings(
  form: FormData,
  settings?: Record<string, TopazModelSettingValue | undefined>,
): void {
  if (!settings) return;
  for (const [key, value] of Object.entries(settings)) {
    appendFormValue(form, key, value);
  }
}

function buildAsyncForm(options: TopazAsyncImageRequest): FormData {
  const sourceId = optionalString(options.sourceId, 'sourceId');
  const sourceUrl = optionalString(options.sourceUrl, 'sourceUrl');
  if (!options.image && !sourceId && !sourceUrl) {
    throw new Error('Topaz Labs: image, sourceUrl, or sourceId is required');
  }

  const form = new FormData();
  appendFormValue(form, 'image', options.image, options.filename);
  appendFormValue(form, 'source_id', sourceId);
  appendFormValue(form, 'source_url', sourceUrl);
  appendFormValue(form, 'model', optionalString(options.model, 'model'));
  appendFormValue(form, 'output_height', options.outputHeight);
  appendFormValue(form, 'output_width', options.outputWidth);
  appendFormValue(form, 'crop_to_fill', options.cropToFill);
  appendFormValue(form, 'output_format', optionalString(options.outputFormat, 'outputFormat'));
  appendFormValue(form, 'webhook_url', optionalString(options.webhookUrl, 'webhookUrl'));
  appendModelSettings(form, options.modelSettings);
  return form;
}

function buildEstimateForm(options: TopazEstimateRequest): FormData {
  const form = new FormData();
  appendFormValue(form, 'category', optionalString(options.category, 'category'));
  appendFormValue(form, 'model', optionalString(options.model, 'model'));
  appendFormValue(form, 'input_height', requireFiniteNumber(options.inputHeight, 'inputHeight'));
  appendFormValue(form, 'input_width', requireFiniteNumber(options.inputWidth, 'inputWidth'));
  appendFormValue(form, 'output_height', options.outputHeight);
  appendFormValue(form, 'output_width', options.outputWidth);
  appendFormValue(form, 'crop_to_fill', options.cropToFill);
  appendFormValue(form, 'output_format', optionalString(options.outputFormat, 'outputFormat'));
  appendModelSettings(form, options.modelSettings);
  return form;
}

function encodeProcessId(processId: string): string {
  return encodeURIComponent(requireString(processId, 'processId'));
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
    return new TopazLabs({
      apiKey,
      baseUrl: process.env.TOPAZ_LABS_BASE_URL,
    });
  }

  async submit(operation: AsyncOperation, options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.client.post<TopazAsyncResponse>(ASYNC_PATHS[operation], buildAsyncForm(options));
  }

  async enhance(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('enhance', options);
  }

  async enhanceGenerative(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('enhanceGenerative', options);
  }

  async sharpen(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('sharpen', options);
  }

  async sharpenGenerative(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('sharpenGenerative', options);
  }

  async denoise(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('denoise', options);
  }

  async restore(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('restore', options);
  }

  async lighting(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('lighting', options);
  }

  async matting(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('matting', options);
  }

  async tool(options: TopazAsyncImageRequest): Promise<TopazAsyncResponse> {
    return this.submit('tool', options);
  }

  async listStatuses(options: {
    paginated?: boolean;
    limit?: number;
    cursor?: string;
  } = {}): Promise<TopazStatusesResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      paginated: options.paginated,
      limit: options.limit,
      cursor: optionalString(options.cursor, 'cursor'),
    };
    return this.client.get<TopazStatusesResponse>('/status', params);
  }

  async getStatus(processId: string): Promise<TopazStatusResponse> {
    return this.client.get<TopazStatusResponse>(`/status/${encodeProcessId(processId)}`);
  }

  async deleteStatus(processId: string): Promise<void> {
    await this.client.delete(`/status/${encodeProcessId(processId)}`);
  }

  async deleteAllStatuses(): Promise<{ deleted_count: number }> {
    return this.client.delete<{ deleted_count: number }>('/status');
  }

  async getDownloadOutput(processId: string): Promise<TopazDownloadResponse> {
    return this.client.get<TopazDownloadResponse>(`/download/${encodeProcessId(processId)}`);
  }

  async getDownloadInput(processId: string): Promise<TopazDownloadResponse> {
    return this.client.get<TopazDownloadResponse>(`/download/input/${encodeProcessId(processId)}`);
  }

  async estimate(options: TopazEstimateRequest): Promise<TopazEstimationResponse> {
    return this.client.post<TopazEstimationResponse>('/estimate', buildEstimateForm(options));
  }

  async estimateGenerative(options: TopazEstimateRequest): Promise<TopazEstimationResponse> {
    return this.client.post<TopazEstimationResponse>('/estimate-gen', buildEstimateForm(options));
  }

  async estimateBulk(items: TopazBulkEstimateRequest[]): Promise<TopazBulkEstimationResult[]> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Topaz Labs: items is required');
    }
    return this.client.post<TopazBulkEstimationResult[]>('/estimate-bulk', items.map(item => definedEntries({
      category: item.category,
      model: item.model,
      input_height: requireFiniteNumber(item.inputHeight, 'inputHeight'),
      input_width: requireFiniteNumber(item.inputWidth, 'inputWidth'),
      output_height: item.outputHeight,
      output_width: item.outputWidth,
      crop_to_fill: item.cropToFill,
      output_format: item.outputFormat,
      ...item.modelSettings,
    })));
  }

  async cancel(processId: string): Promise<void> {
    await this.client.delete(`/cancel/${encodeProcessId(processId)}`);
  }

  getClient(): TopazLabsClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}
