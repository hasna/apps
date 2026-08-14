// Browse AI Connector — No-code web scraping and data extraction
import { BrowseAIClient } from './client';
import type { BrowseAIConfig, BARobot, BATask, BATaskList } from '../types';
export { BrowseAIClient } from './client';

export class BrowseAI {
  private readonly client: BrowseAIClient;
  constructor(config: BrowseAIConfig) { this.client = new BrowseAIClient(config); }
  static fromEnv(): BrowseAI {
    const apiKey = process.env.BROWSEAI_API_KEY;
    if (!apiKey) throw new Error('BROWSEAI_API_KEY is required');
    return new BrowseAI({ apiKey });
  }

  async listRobots(): Promise<{ result: { robots: BARobot[] } }> { return this.client.request('/robots'); }
  async getRobot(robotId: string): Promise<{ result: { robot: BARobot } }> { return this.client.request(`/robots/${robotId}`); }

  async runRobot(robotId: string, inputParameters?: Record<string, string>): Promise<{ result: { robotTask: BATask } }> {
    return this.client.request(`/robots/${robotId}/tasks`, { method: 'POST', body: { inputParameters } as Record<string, unknown> });
  }

  async listTasks(robotId: string, options?: { page?: number }): Promise<BATaskList> {
    return this.client.request<BATaskList>(`/robots/${robotId}/tasks`, { params: { page: options?.page } });
  }
  async getTask(robotId: string, taskId: string): Promise<{ result: { robotTask: BATask } }> {
    return this.client.request(`/robots/${robotId}/tasks/${taskId}`);
  }

  getClient(): BrowseAIClient { return this.client; }
}
