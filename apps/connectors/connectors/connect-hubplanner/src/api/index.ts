// Hub Planner Connector — Resource scheduling and project planning
import { HubPlannerClient } from './client';
import type { HubPlannerConfig, HPResource, HPProject, HPBooking, HPEvent } from '../types';
export { HubPlannerClient } from './client';

export class HubPlanner {
  private readonly client: HubPlannerClient;
  constructor(config: HubPlannerConfig) { this.client = new HubPlannerClient(config); }

  static fromEnv(): HubPlanner {
    const apiKey = process.env.HUBPLANNER_API_KEY;
    if (!apiKey) throw new Error('HUBPLANNER_API_KEY environment variable is required');
    return new HubPlanner({ apiKey });
  }

  // Resources (team members)
  async listResources(): Promise<HPResource[]> { return this.client.request<HPResource[]>('/resource'); }
  async getResource(id: string): Promise<HPResource> { return this.client.request<HPResource>(`/resource/${id}`); }
  async createResource(data: { firstName: string; lastName: string; email: string; role?: string }): Promise<HPResource> {
    return this.client.request<HPResource>('/resource', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateResource(id: string, data: Partial<HPResource>): Promise<HPResource> {
    return this.client.request<HPResource>(`/resource/${id}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteResource(id: string): Promise<void> { await this.client.request(`/resource/${id}`, { method: 'DELETE' }); }

  // Projects
  async listProjects(options?: { status?: string }): Promise<HPProject[]> {
    return this.client.request<HPProject[]>('/project', { params: options as Record<string, string | undefined> });
  }
  async getProject(id: string): Promise<HPProject> { return this.client.request<HPProject>(`/project/${id}`); }
  async createProject(data: { name: string; description?: string; startDate?: string; endDate?: string }): Promise<HPProject> {
    return this.client.request<HPProject>('/project', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateProject(id: string, data: Partial<HPProject>): Promise<HPProject> {
    return this.client.request<HPProject>(`/project/${id}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteProject(id: string): Promise<void> { await this.client.request(`/project/${id}`, { method: 'DELETE' }); }

  // Bookings
  async listBookings(options?: { resourceId?: string; projectId?: string; start?: string; end?: string }): Promise<HPBooking[]> {
    return this.client.request<HPBooking[]>('/booking', { params: options as Record<string, string | undefined> });
  }
  async createBooking(data: { project: string; resource: string; start: string; end: string; duration?: number }): Promise<HPBooking> {
    return this.client.request<HPBooking>('/booking', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateBooking(id: string, data: Partial<HPBooking>): Promise<HPBooking> {
    return this.client.request<HPBooking>(`/booking/${id}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteBooking(id: string): Promise<void> { await this.client.request(`/booking/${id}`, { method: 'DELETE' }); }

  getClient(): HubPlannerClient { return this.client; }
}
