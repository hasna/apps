import type { CompressRequest, CompressResponse } from '../types';
import { DEFAULT_COMPRESSION_MODEL } from '../types';
import type { TheTokenCompanyClient } from './client';

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

    return this.client.post<CompressResponse>('/compress', body);
  }
}
