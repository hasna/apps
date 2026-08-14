// Teamdeck Connector — Resource management and time tracking for agencies
import { TeamdeckClient } from './client';
import type { TeamdeckConfig, TDResource, TDProject, TDTimeEntry, TDBooking, TDVacation } from '../types';
export { TeamdeckClient } from './client';

export class Teamdeck {
  private readonly client: TeamdeckClient;
  constructor(config: TeamdeckConfig) { this.client = new TeamdeckClient(config); }
  static fromEnv(): Teamdeck {
    const apiKey = process.env.TEAMDECK_API_KEY;
    if (!apiKey) throw new Error('TEAMDECK_API_KEY environment variable is required');
    return new Teamdeck({ apiKey });
  }

  async listResources(options?: { page?: number; limit?: number }): Promise<TDResource[]> {
    return this.client.request<TDResource[]>('/resources', { params: options as Record<string, number | undefined> });
  }
  async getResource(id: number): Promise<TDResource> { return this.client.request<TDResource>(`/resources/${id}`); }

  async listProjects(options?: { page?: number; limit?: number; archived?: boolean }): Promise<TDProject[]> {
    return this.client.request<TDProject[]>('/projects', { params: options as Record<string, string | number | undefined> });
  }
  async getProject(id: number): Promise<TDProject> { return this.client.request<TDProject>(`/projects/${id}`); }
  async createProject(data: { name: string; color?: string; budget?: number }): Promise<TDProject> {
    return this.client.request<TDProject>('/projects', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTimeEntries(options?: { resourceId?: number; projectId?: number; from?: string; to?: string; page?: number }): Promise<TDTimeEntry[]> {
    return this.client.request<TDTimeEntry[]>('/time-entries', { params: { resource_id: options?.resourceId, project_id: options?.projectId, from: options?.from, to: options?.to, page: options?.page } });
  }
  async createTimeEntry(data: { resource_id: number; project_id: number; minutes: number; weekday: string; description?: string }): Promise<TDTimeEntry> {
    return this.client.request<TDTimeEntry>('/time-entries', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteTimeEntry(id: number): Promise<void> { await this.client.request(`/time-entries/${id}`, { method: 'DELETE' }); }

  async listBookings(options?: { resourceId?: number; projectId?: number; from?: string; to?: string }): Promise<TDBooking[]> {
    return this.client.request<TDBooking[]>('/bookings', { params: { resource_id: options?.resourceId, project_id: options?.projectId, from: options?.from, to: options?.to } });
  }
  async createBooking(data: { resource_id: number; project_id: number; start_date: string; end_date: string; hours_per_day: number }): Promise<TDBooking> {
    return this.client.request<TDBooking>('/bookings', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteBooking(id: number): Promise<void> { await this.client.request(`/bookings/${id}`, { method: 'DELETE' }); }

  async listVacations(options?: { resourceId?: number; from?: string; to?: string }): Promise<TDVacation[]> {
    return this.client.request<TDVacation[]>('/vacations', { params: { resource_id: options?.resourceId, from: options?.from, to: options?.to } });
  }

  getClient(): TeamdeckClient { return this.client; }
}
