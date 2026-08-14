// Flotiq Connector — Headless CMS and content management API
import { FlotiqClient } from './client';
import type { FlotiqConfig, FlotiqContentType, FlotiqContentTypeList, FlotiqObject, FlotiqObjectList, FlotiqMedia, FlotiqMediaList } from '../types';
export { FlotiqClient } from './client';

export class Flotiq {
  private readonly client: FlotiqClient;
  constructor(config: FlotiqConfig) { this.client = new FlotiqClient(config); }
  static fromEnv(): Flotiq {
    const apiKey = process.env.FLOTIQ_API_KEY;
    if (!apiKey) throw new Error('FLOTIQ_API_KEY is required');
    return new Flotiq({ apiKey });
  }

  async listContentTypes(options?: { page?: number; limit?: number }): Promise<FlotiqContentTypeList> {
    return this.client.request<FlotiqContentTypeList>('/internal/contenttype', { params: { page: options?.page, limit: options?.limit } });
  }
  async getContentType(name: string): Promise<FlotiqContentType> { return this.client.request<FlotiqContentType>(`/internal/contenttype/${name}`); }
  async createContentType(data: { name: string; label: string; schemaDefinition: Record<string, unknown> }): Promise<FlotiqContentType> {
    return this.client.request<FlotiqContentType>('/internal/contenttype', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteContentType(name: string): Promise<void> { await this.client.request(`/internal/contenttype/${name}`, { method: 'DELETE' }); }

  async listObjects(contentType: string, options?: { page?: number; limit?: number; order_by?: string; order_direction?: string }): Promise<FlotiqObjectList> {
    return this.client.request<FlotiqObjectList>(`/content/${contentType}`, { params: { page: options?.page, limit: options?.limit, order_by: options?.order_by, order_direction: options?.order_direction } });
  }
  async getObject(contentType: string, objectId: string): Promise<FlotiqObject> { return this.client.request<FlotiqObject>(`/content/${contentType}/${objectId}`); }
  async createObject(contentType: string, data: Record<string, unknown>): Promise<FlotiqObject> {
    return this.client.request<FlotiqObject>(`/content/${contentType}`, { method: 'POST', body: data });
  }
  async updateObject(contentType: string, objectId: string, data: Record<string, unknown>): Promise<FlotiqObject> {
    return this.client.request<FlotiqObject>(`/content/${contentType}/${objectId}`, { method: 'PUT', body: data });
  }
  async deleteObject(contentType: string, objectId: string): Promise<void> { await this.client.request(`/content/${contentType}/${objectId}`, { method: 'DELETE' }); }

  async searchObjects(contentType: string, query: string, options?: { page?: number; limit?: number }): Promise<FlotiqObjectList> {
    return this.client.request<FlotiqObjectList>(`/content/${contentType}`, { params: { filters: JSON.stringify({ contains: query }), page: options?.page, limit: options?.limit } });
  }

  async listMedia(options?: { page?: number; limit?: number }): Promise<FlotiqMediaList> {
    return this.client.request<FlotiqMediaList>('/content/_media', { params: { page: options?.page, limit: options?.limit } });
  }
  async getMedia(mediaId: string): Promise<FlotiqMedia> { return this.client.request<FlotiqMedia>(`/content/_media/${mediaId}`); }
  async deleteMedia(mediaId: string): Promise<void> { await this.client.request(`/content/_media/${mediaId}`, { method: 'DELETE' }); }

  getClient(): FlotiqClient { return this.client; }
}
