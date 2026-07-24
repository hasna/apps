import type { WistiaClient } from './client';
import type { WistiaCaption, CreateCaptionParams, UpdateCaptionParams } from '../types';

export class CaptionsApi {
  constructor(private readonly client: WistiaClient) {}

  async list(mediaHashedId: string): Promise<WistiaCaption[]> {
    return this.client.get<WistiaCaption[]>(
      `/v1/medias/${encodeURIComponent(mediaHashedId)}/captions.json`,
    );
  }

  async get(mediaHashedId: string, languageCode: string): Promise<WistiaCaption> {
    return this.client.get<WistiaCaption>(
      `/v1/medias/${encodeURIComponent(mediaHashedId)}/captions/${encodeURIComponent(languageCode)}.json`,
    );
  }

  async create(mediaHashedId: string, params: CreateCaptionParams): Promise<WistiaCaption> {
    return this.client.post<WistiaCaption>(
      `/v1/medias/${encodeURIComponent(mediaHashedId)}/captions.json`,
      {
        language_code: params.languageCode,
        caption_file: params.captionFile,
        caption_file_url: params.captionFileUrl,
        name: params.name,
        is_draft: params.isDraft,
        replace_existing: params.replaceExisting,
      },
    );
  }

  async update(
    mediaHashedId: string,
    languageCode: string,
    params: UpdateCaptionParams,
  ): Promise<WistiaCaption> {
    return this.client.put<WistiaCaption>(
      `/v1/medias/${encodeURIComponent(mediaHashedId)}/captions/${encodeURIComponent(languageCode)}.json`,
      {
        caption_file: params.captionFile,
        caption_file_url: params.captionFileUrl,
        is_draft: params.isDraft,
      },
    );
  }

  async delete(mediaHashedId: string, languageCode: string): Promise<void> {
    await this.client.delete(
      `/v1/medias/${encodeURIComponent(mediaHashedId)}/captions/${encodeURIComponent(languageCode)}.json`,
    );
  }

  async purchase(mediaHashedId: string): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(
      `/v1/medias/${encodeURIComponent(mediaHashedId)}/captions/purchase.json`,
    );
  }
}
