// ApptiveGrid Connector — Low-code backend/database platform
import { ApptiveGridClient } from './client';
import type { ApptiveGridConfig, AGSpace, AGGrid, AGEntity, AGEntityList, AGForm } from '../types';
export { ApptiveGridClient } from './client';

export class ApptiveGrid {
  private readonly client: ApptiveGridClient;
  constructor(config: ApptiveGridConfig) { this.client = new ApptiveGridClient(config); }
  static fromEnv(): ApptiveGrid {
    const token = process.env.APPTIVEGRID_TOKEN;
    if (!token) throw new Error('APPTIVEGRID_TOKEN is required');
    return new ApptiveGrid({ token });
  }

  async listSpaces(): Promise<AGSpace[]> { return this.client.request<AGSpace[]>('/spaces'); }
  async getSpace(spaceId: string): Promise<AGSpace> { return this.client.request<AGSpace>(`/spaces/${spaceId}`); }

  async listGrids(spaceId: string): Promise<AGGrid[]> { return this.client.request<AGGrid[]>(`/spaces/${spaceId}/grids`); }
  async getGrid(spaceId: string, gridId: string): Promise<AGGrid> { return this.client.request<AGGrid>(`/spaces/${spaceId}/grids/${gridId}`); }

  async listEntities(spaceId: string, gridId: string, options?: { page?: number; pageSize?: number }): Promise<AGEntityList> {
    return this.client.request<AGEntityList>(`/spaces/${spaceId}/grids/${gridId}/entities`, { params: { page: options?.page, pageSize: options?.pageSize } });
  }
  async getEntity(spaceId: string, gridId: string, entityId: string): Promise<AGEntity> {
    return this.client.request<AGEntity>(`/spaces/${spaceId}/grids/${gridId}/entities/${entityId}`);
  }
  async createEntity(spaceId: string, gridId: string, fields: Record<string, unknown>): Promise<AGEntity> {
    return this.client.request<AGEntity>(`/spaces/${spaceId}/grids/${gridId}/entities`, { method: 'POST', body: { fields } });
  }
  async updateEntity(spaceId: string, gridId: string, entityId: string, fields: Record<string, unknown>): Promise<AGEntity> {
    return this.client.request<AGEntity>(`/spaces/${spaceId}/grids/${gridId}/entities/${entityId}`, { method: 'PUT', body: { fields } });
  }
  async deleteEntity(spaceId: string, gridId: string, entityId: string): Promise<void> {
    await this.client.request(`/spaces/${spaceId}/grids/${gridId}/entities/${entityId}`, { method: 'DELETE' });
  }

  async listForms(spaceId: string, gridId: string): Promise<AGForm[]> { return this.client.request<AGForm[]>(`/spaces/${spaceId}/grids/${gridId}/forms`); }

  getClient(): ApptiveGridClient { return this.client; }
}
