// Hub Planner Connector — Resource scheduling and project planning
import { HubPlannerClient } from './client';
import type { HubPlannerConfig, HPResource, HPProject, HPBooking, HPTimeEntry, HPEvent } from '../types';
export { HubPlannerClient } from './client';

export class HubPlanner {
  private readonly client: HubPlannerClient;
  constructor(config: HubPlannerConfig) { this.client = new HubPlannerClient(config); }
  static fromEnv(): HubPlanner {
    const apiKey = process.env.HUBPLANNER_API_KEY;
    if (!apiKey) throw new Error('HUBPLANNER_API_KEY is required');
    return new HubPlanner({ apiKey });
  }

  async listResources(): Promise<HPResource[]> { return this.client.request<HPResource[]>('/resources'); }
  async getResource(resourceId: string): Promise<HPResource> { return this.client.request<HPResource>(`/resources/${resourceId}`); }

  async listProjects(): Promise<HPProject[]> { return this.client.request<HPProject[]>('/projects'); }
  async getProject(projectId: string): Promise<HPProject> { return this.client.request<HPProject>(`/projects/${projectId}`); }
  async createProject(data: { name: string; status?: string; start?: string; end?: string; tags?: string[] }): Promise<HPProject> {
    return this.client.request<HPProject>('/projects', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listBookings(options?: { resource?: string; project?: string }): Promise<HPBooking[]> {
    return this.client.request<HPBooking[]>('/bookings', { params: { resource: options?.resource, project: options?.project } });
  }
  async createBooking(data: { resource: string; project: string; start: string; end: string; hours?: number; note?: string }): Promise<HPBooking> {
    return this.client.request<HPBooking>('/bookings', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteBooking(bookingId: string): Promise<void> { await this.client.request(`/bookings/${bookingId}`, { method: 'DELETE' }); }

  async listTimeEntries(options?: { resource?: string; project?: string }): Promise<HPTimeEntry[]> {
    return this.client.request<HPTimeEntry[]>('/timeentries', { params: { resource: options?.resource, project: options?.project } });
  }
  async createTimeEntry(data: { resource: string; project: string; date: string; hours: number; note?: string }): Promise<HPTimeEntry> {
    return this.client.request<HPTimeEntry>('/timeentries', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listEvents(): Promise<HPEvent[]> { return this.client.request<HPEvent[]>('/events'); }

  getClient(): HubPlannerClient { return this.client; }
}
