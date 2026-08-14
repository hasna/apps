import type {
  StatuspageConfig,
  StatuspagePage,
  StatuspageComponent,
  StatuspageIncident,
  CreateIncidentInput,
  UpdateIncidentInput,
} from '../types';
import { StatuspageClient } from './client';

export { StatuspageClient } from './client';

export class Statuspage {
  private readonly client: StatuspageClient;

  constructor(config: StatuspageConfig) {
    this.client = new StatuspageClient(config);
  }

  static fromEnv(): Statuspage {
    const apiKey = process.env.STATUSPAGE_API_KEY;
    if (!apiKey) {
      throw new Error('STATUSPAGE_API_KEY environment variable is required');
    }
    return new Statuspage({
      apiKey,
      pageId: process.env.STATUSPAGE_PAGE_ID,
    });
  }

  async listPages(): Promise<StatuspagePage[]> {
    return this.client.get<StatuspagePage[]>('/pages');
  }

  async getPage(pageId: string): Promise<StatuspagePage> {
    return this.client.get<StatuspagePage>(`/pages/${pageId}`);
  }

  async listIncidents(
    pageId: string,
    options?: { q?: string; limit?: number; page?: number },
  ): Promise<StatuspageIncident[]> {
    return this.client.get<StatuspageIncident[]>(`/pages/${pageId}/incidents`, {
      q: options?.q,
      limit: options?.limit,
      page: options?.page,
    });
  }

  async getIncident(pageId: string, incidentId: string): Promise<StatuspageIncident> {
    return this.client.get<StatuspageIncident>(`/pages/${pageId}/incidents/${incidentId}`);
  }

  async createIncident(pageId: string, input: CreateIncidentInput): Promise<StatuspageIncident> {
    return this.client.post<StatuspageIncident>(`/pages/${pageId}/incidents`, { incident: input });
  }

  async updateIncident(
    pageId: string,
    incidentId: string,
    input: UpdateIncidentInput,
  ): Promise<StatuspageIncident> {
    return this.client.patch<StatuspageIncident>(`/pages/${pageId}/incidents/${incidentId}`, {
      incident: input,
    });
  }

  async listComponents(pageId: string): Promise<StatuspageComponent[]> {
    return this.client.get<StatuspageComponent[]>(`/pages/${pageId}/components`);
  }

  async getComponent(pageId: string, componentId: string): Promise<StatuspageComponent> {
    return this.client.get<StatuspageComponent>(`/pages/${pageId}/components/${componentId}`);
  }

  async validate(pageId: string): Promise<{ valid: boolean; page?: StatuspagePage }> {
    const page = await this.getPage(pageId);
    return { valid: true, page };
  }

  getClient(): StatuspageClient {
    return this.client;
  }
}
