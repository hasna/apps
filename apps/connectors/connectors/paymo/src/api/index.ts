// Paymo Connector — Project management, time tracking, and invoicing
import { PaymoClient } from './client';
import type { PaymoConfig, PMProject, PMTask, PMTimeEntry, PMClient, PMInvoice, PMUser } from '../types';
export { PaymoClient } from './client';

export class Paymo {
  private readonly client: PaymoClient;
  constructor(config: PaymoConfig) { this.client = new PaymoClient(config); }
  static fromEnv(): Paymo {
    const apiKey = process.env.PAYMO_API_KEY;
    if (!apiKey) throw new Error('PAYMO_API_KEY is required');
    return new Paymo({ apiKey });
  }

  async listProjects(options?: { active?: boolean }): Promise<{ projects: PMProject[] }> {
    return this.client.request('/projects', { params: { where: options?.active !== undefined ? `active=${options.active}` : undefined } });
  }
  async getProject(projectId: number): Promise<{ projects: PMProject[] }> { return this.client.request(`/projects/${projectId}`); }
  async createProject(data: { name: string; description?: string; client_id?: number; budget_hours?: number }): Promise<{ projects: PMProject[] }> {
    return this.client.request('/projects', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTasks(options?: { project_id?: number; complete?: boolean }): Promise<{ tasks: PMTask[] }> {
    return this.client.request('/tasks', { params: { where: options?.project_id ? `project_id=${options.project_id}` : undefined } });
  }
  async createTask(data: { name: string; project_id: number; tasklist_id: number; user_id?: number; due_date?: string }): Promise<{ tasks: PMTask[] }> {
    return this.client.request('/tasks', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTimeEntries(options?: { task_id?: number; user_id?: number }): Promise<{ entries: PMTimeEntry[] }> {
    return this.client.request('/entries', { params: { where: options?.task_id ? `task_id=${options.task_id}` : undefined } });
  }
  async createTimeEntry(data: { task_id: number; user_id: number; start_time: string; end_time: string; description?: string }): Promise<{ entries: PMTimeEntry[] }> {
    return this.client.request('/entries', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listClients(): Promise<{ clients: PMClient[] }> { return this.client.request('/clients'); }
  async listInvoices(): Promise<{ invoices: PMInvoice[] }> { return this.client.request('/invoices'); }
  async listUsers(): Promise<{ users: PMUser[] }> { return this.client.request('/users'); }

  getClient(): PaymoClient { return this.client; }
}
