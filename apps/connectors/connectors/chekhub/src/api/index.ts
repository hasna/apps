// Chekhub Connector — Field service management and work order tracking
import { ChekhubClient } from './client';
import type { ChekhubConfig, CHWorkOrder, CHWorkOrderList, CHAsset, CHLocation, CHTechnician, CHChecklist } from '../types';
export { ChekhubClient } from './client';

export class Chekhub {
  private readonly client: ChekhubClient;
  constructor(config: ChekhubConfig) { this.client = new ChekhubClient(config); }
  static fromEnv(): Chekhub {
    const token = process.env.CHEKHUB_TOKEN;
    if (!token) throw new Error('CHEKHUB_TOKEN is required');
    return new Chekhub({ token });
  }

  async listWorkOrders(options?: { page?: number; per_page?: number; status?: string; assignee_id?: string }): Promise<CHWorkOrderList> {
    return this.client.request<CHWorkOrderList>('/work-orders', { params: { page: options?.page, per_page: options?.per_page, status: options?.status, assignee_id: options?.assignee_id } });
  }
  async getWorkOrder(workOrderId: string): Promise<CHWorkOrder> { return this.client.request<CHWorkOrder>(`/work-orders/${workOrderId}`); }
  async createWorkOrder(data: { title: string; description?: string; priority?: string; assignee_id?: string; location_id?: string; due_date?: string }): Promise<CHWorkOrder> {
    return this.client.request<CHWorkOrder>('/work-orders', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateWorkOrder(workOrderId: string, data: { title?: string; status?: string; priority?: string; assignee_id?: string }): Promise<CHWorkOrder> {
    return this.client.request<CHWorkOrder>(`/work-orders/${workOrderId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async completeWorkOrder(workOrderId: string): Promise<CHWorkOrder> {
    return this.client.request<CHWorkOrder>(`/work-orders/${workOrderId}/complete`, { method: 'POST' });
  }

  async listAssets(options?: { location_id?: string }): Promise<CHAsset[]> {
    return this.client.request<CHAsset[]>('/assets', { params: { location_id: options?.location_id } });
  }
  async getAsset(assetId: string): Promise<CHAsset> { return this.client.request<CHAsset>(`/assets/${assetId}`); }

  async listLocations(): Promise<CHLocation[]> { return this.client.request<CHLocation[]>('/locations'); }
  async listTechnicians(): Promise<CHTechnician[]> { return this.client.request<CHTechnician[]>('/technicians'); }

  async getChecklist(workOrderId: string): Promise<CHChecklist> { return this.client.request<CHChecklist>(`/work-orders/${workOrderId}/checklist`); }

  getClient(): ChekhubClient { return this.client; }
}
