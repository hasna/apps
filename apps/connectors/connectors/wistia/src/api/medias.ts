import type { WistiaClient } from './client';
import type { WistiaMedia, ListMediasParams, CopyMediaParams } from '../types';

export class MediasApi {
  constructor(private readonly client: WistiaClient) {}

  async list(options: ListMediasParams = {}): Promise<WistiaMedia[]> {
    return this.client.get<WistiaMedia[]>('/v1/medias.json', {
      page: options.page,
      per_page: options.perPage,
      sort_by: options.sortBy,
      sort_direction: options.sortDirection,
      project_id: options.projectId,
      type: options.type,
      name: options.name,
    });
  }

  async get(hashedId: string): Promise<WistiaMedia> {
    return this.client.get<WistiaMedia>(`/v1/medias/${encodeURIComponent(hashedId)}.json`);
  }

  async update(hashedId: string, data: Record<string, unknown>): Promise<WistiaMedia> {
    return this.client.put<WistiaMedia>(
      `/v1/medias/${encodeURIComponent(hashedId)}.json`,
      data,
    );
  }

  async delete(hashedId: string): Promise<void> {
    await this.client.delete(`/v1/medias/${encodeURIComponent(hashedId)}.json`);
  }

  async copy(hashedId: string, params: CopyMediaParams = {}): Promise<WistiaMedia> {
    return this.client.post<WistiaMedia>(
      `/v1/medias/${encodeURIComponent(hashedId)}/copy.json`,
      {
        project_id: params.projectId,
        owner_email: params.ownerEmail,
      },
    );
  }

  async getStats(hashedId: string): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(
      `/v1/medias/${encodeURIComponent(hashedId)}/stats.json`,
    );
  }

  async getCustomizations(hashedId: string): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(
      `/v1/medias/${encodeURIComponent(hashedId)}/customizations.json`,
    );
  }

  async updateCustomizations(
    hashedId: string,
    customizations: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.client.put<Record<string, unknown>>(
      `/v1/medias/${encodeURIComponent(hashedId)}/customizations.json`,
      customizations,
    );
  }

  async deleteCustomizations(hashedId: string): Promise<void> {
    await this.client.delete(
      `/v1/medias/${encodeURIComponent(hashedId)}/customizations.json`,
    );
  }

  async listInteractive(hashedId: string): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(
      `/v1/medias/${encodeURIComponent(hashedId)}/interactive.json`,
    );
  }
}
