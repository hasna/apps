// Float Connector — Resource management and team scheduling
import { FloatClient } from './client';
import type { FloatConfig, FLPerson, FLProject, FLTask, FLTimeOff, FLClient, FLDepartment } from '../types';
export { FloatClient } from './client';

export class Float {
  private readonly client: FloatClient;
  constructor(config: FloatConfig) { this.client = new FloatClient(config); }
  static fromEnv(): Float {
    const token = process.env.FLOAT_TOKEN;
    if (!token) throw new Error('FLOAT_TOKEN is required');
    return new Float({ token });
  }

  async listPeople(options?: { page?: number; per_page?: number }): Promise<FLPerson[]> {
    return this.client.request<FLPerson[]>('/people', { params: { page: options?.page, per_page: options?.per_page } });
  }
  async getPerson(personId: number): Promise<FLPerson> { return this.client.request<FLPerson>(`/people/${personId}`); }

  async listProjects(options?: { page?: number; per_page?: number; active?: number }): Promise<FLProject[]> {
    return this.client.request<FLProject[]>('/projects', { params: { page: options?.page, per_page: options?.per_page, active: options?.active } });
  }
  async getProject(projectId: number): Promise<FLProject> { return this.client.request<FLProject>(`/projects/${projectId}`); }
  async createProject(data: { name: string; client?: string; color?: string; budget_total?: number; tags?: string[] }): Promise<FLProject> {
    return this.client.request<FLProject>('/projects', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTasks(options?: { start_date?: string; end_date?: string; people_id?: number; project_id?: number }): Promise<FLTask[]> {
    return this.client.request<FLTask[]>('/tasks', { params: { start_date: options?.start_date, end_date: options?.end_date, people_id: options?.people_id, project_id: options?.project_id } });
  }
  async createTask(data: { project_id: number; people_id: number; name?: string; start_date: string; end_date: string; hours: number }): Promise<FLTask> {
    return this.client.request<FLTask>('/tasks', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateTask(taskId: number, data: { name?: string; start_date?: string; end_date?: string; hours?: number }): Promise<FLTask> {
    return this.client.request<FLTask>(`/tasks/${taskId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteTask(taskId: number): Promise<void> { await this.client.request(`/tasks/${taskId}`, { method: 'DELETE' }); }

  async listTimeOff(options?: { people_id?: number; start_date?: string; end_date?: string }): Promise<FLTimeOff[]> {
    return this.client.request<FLTimeOff[]>('/timeoffs', { params: { people_id: options?.people_id, start_date: options?.start_date, end_date: options?.end_date } });
  }

  async listClients(): Promise<FLClient[]> { return this.client.request<FLClient[]>('/clients'); }
  async listDepartments(): Promise<FLDepartment[]> { return this.client.request<FLDepartment[]>('/departments'); }

  getClient(): FloatClient { return this.client; }
}
