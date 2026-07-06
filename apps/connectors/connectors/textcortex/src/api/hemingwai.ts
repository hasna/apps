import type {
  ClassifyTextRequest,
  GenerateTextRequest,
  RawRequestOptions,
  RewriteTextRequest,
  SummarizeTextRequest,
  TextCortexResponse,
} from '../types';
import type { TextCortexClient } from './client';

const PATHS = {
  generate: '/hemingwai/generate_text_v3/',
  summarize: '/hemingwai/summarize_text_v1/',
  rewrite: '/hemingwai/rewrite_text_v1/',
  classify: '/hemingwai/classify_text_v1/',
} as const;

export class HemingwaiApi {
  constructor(private readonly client: TextCortexClient) {}

  generateText(request: GenerateTextRequest): Promise<TextCortexResponse> {
    return this.client.post<TextCortexResponse>(PATHS.generate, request);
  }

  summarizeText(request: SummarizeTextRequest): Promise<TextCortexResponse> {
    return this.client.post<TextCortexResponse>(PATHS.summarize, request);
  }

  rewriteText(request: RewriteTextRequest): Promise<TextCortexResponse> {
    return this.client.post<TextCortexResponse>(PATHS.rewrite, request);
  }

  classifyText(request: ClassifyTextRequest): Promise<TextCortexResponse> {
    return this.client.post<TextCortexResponse>(PATHS.classify, request);
  }

  rawRequest<T = TextCortexResponse>(options: RawRequestOptions): Promise<T> {
    const { path, method = 'POST', body, params } = options;
    return this.client.request<T>(path, { method, body, params });
  }

  extractText(response: TextCortexResponse): string {
    const outputs = response.data?.outputs;
    if (Array.isArray(outputs) && outputs.length > 0) {
      return outputs.map((item) => item.text ?? '').filter(Boolean).join('\n');
    }
    if (typeof response.message === 'string') {
      return response.message;
    }
    return JSON.stringify(response);
  }
}

export { PATHS as HEMINGWAI_PATHS };
