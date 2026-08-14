// Strapi Connector — Open-source headless CMS and content API
import { StrapiClient } from './client';
import type { StrapiConfig, StrapiEntry, StrapiEntryList, StrapiSingleEntry, StrapiContentType, StrapiUser, StrapiMedia } from '../types';
export { StrapiClient } from './client';

export class Strapi {
  private readonly client: StrapiClient;
  constructor(config: StrapiConfig) { this.client = new StrapiClient(config); }
  static fromEnv(): Strapi {
    const url = process.env.STRAPI_URL;
    const token = process.env.STRAPI_TOKEN;
    if (!url || !token) throw new Error('STRAPI_URL and STRAPI_TOKEN are required');
    return new Strapi({ url, token });
  }

  async find(contentType: string, options?: { page?: number; pageSize?: number; sort?: string; filters?: string; populate?: string; fields?: string }): Promise<StrapiEntryList> {
    return this.client.request<StrapiEntryList>(`/${contentType}`, { params: { 'pagination[page]': options?.page, 'pagination[pageSize]': options?.pageSize, sort: options?.sort, filters: options?.filters, populate: options?.populate, fields: options?.fields } });
  }
  async findOne(contentType: string, id: number, options?: { populate?: string; fields?: string }): Promise<StrapiSingleEntry> {
    return this.client.request<StrapiSingleEntry>(`/${contentType}/${id}`, { params: { populate: options?.populate, fields: options?.fields } });
  }
  async create(contentType: string, data: Record<string, unknown>): Promise<StrapiSingleEntry> {
    return this.client.request<StrapiSingleEntry>(`/${contentType}`, { method: 'POST', body: { data } });
  }
  async update(contentType: string, id: number, data: Record<string, unknown>): Promise<StrapiSingleEntry> {
    return this.client.request<StrapiSingleEntry>(`/${contentType}/${id}`, { method: 'PUT', body: { data } });
  }
  async remove(contentType: string, id: number): Promise<StrapiSingleEntry> {
    return this.client.request<StrapiSingleEntry>(`/${contentType}/${id}`, { method: 'DELETE' });
  }

  async listContentTypes(): Promise<{ data: StrapiContentType[] }> { return this.client.request('/content-type-builder/content-types'); }

  async listUsers(options?: { page?: number; pageSize?: number }): Promise<StrapiUser[]> {
    return this.client.request<StrapiUser[]>('/users', { params: { 'pagination[page]': options?.page, 'pagination[pageSize]': options?.pageSize } });
  }
  async getUser(userId: number): Promise<StrapiUser> { return this.client.request<StrapiUser>(`/users/${userId}`); }
  async getMe(): Promise<StrapiUser> { return this.client.request<StrapiUser>('/users/me'); }

  async listMedia(options?: { page?: number; pageSize?: number }): Promise<StrapiMedia[]> {
    return this.client.request<StrapiMedia[]>('/upload/files', { params: { 'pagination[page]': options?.page, 'pagination[pageSize]': options?.pageSize } });
  }
  async getMedia(mediaId: number): Promise<StrapiMedia> { return this.client.request<StrapiMedia>(`/upload/files/${mediaId}`); }
  async deleteMedia(mediaId: number): Promise<void> { await this.client.request(`/upload/files/${mediaId}`, { method: 'DELETE' }); }

  getClient(): StrapiClient { return this.client; }
}
