import type { CompressRequest, CompressResponse } from '../types';
import { DEFAULT_COMPRESSION_MODEL } from '../types';
import type { TheTokenCompanyClient } from './client';

interface ApiCompressResponse {
  output: string;
  output_tokens: number;
  original_input_tokens?: number;
  input_tokens?: number;
  tokens_saved?: number;
  compression_ratio?: number;
}

export class CompressApi {
  constructor(private readonly client: TheTokenCompanyClient) {}

  async compress(request: CompressRequest): Promise<CompressResponse> {
    const body: CompressRequest = {
      model: request.model ?? DEFAULT_COMPRESSION_MODEL,
      input: request.input,
    };

    if (request.compression_settings) {
      body.compression_settings = request.compression_settings;
    }

    if (request.app_id) {
      body.app_id = request.app_id;
    }

    const response = await this.client.post<ApiCompressResponse>('/compress', body);
    const inputTokens = response.input_tokens ?? response.original_input_tokens ?? 0;
    const tokensSaved = response.tokens_saved ?? inputTokens - response.output_tokens;
    const compressionRatio =
      response.compression_ratio ??
      (response.output_tokens === 0 ? 0 : inputTokens / response.output_tokens);

    return {
      output: response.output,
      output_tokens: response.output_tokens,
      input_tokens: inputTokens,
      tokens_saved: tokensSaved,
      compression_ratio: compressionRatio,
    };
  }
}
