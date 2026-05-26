// Tilda Connector — Website builder and publishing platform
import { TildaClient } from './client';
import type { TildaConfig, TildaProject, TildaProjectData, TildaPage, TildaPageFull } from '../types';
export { TildaClient } from './client';

export class Tilda {
  private readonly client: TildaClient;
  constructor(config: TildaConfig) { this.client = new TildaClient(config); }
  static fromEnv(): Tilda {
    const publicKey = process.env.TILDA_PUBLIC_KEY;
    const secretKey = process.env.TILDA_SECRET_KEY;
    if (!publicKey || !secretKey) throw new Error('TILDA_PUBLIC_KEY and TILDA_SECRET_KEY are required');
    return new Tilda({ publicKey, secretKey });
  }

  async listProjects(): Promise<TildaProject[]> { return this.client.request<TildaProject[]>('/getprojectslist'); }
  async getProject(projectId: string): Promise<TildaProjectData> { return this.client.request<TildaProjectData>('/getproject', { projectid: projectId }); }
  async getProjectExport(projectId: string): Promise<TildaProjectData> { return this.client.request<TildaProjectData>('/getprojectexport', { projectid: projectId }); }

  async listPages(projectId: string): Promise<TildaPage[]> { return this.client.request<TildaPage[]>('/getpageslist', { projectid: projectId }); }
  async getPage(pageId: string): Promise<TildaPageFull> { return this.client.request<TildaPageFull>('/getpage', { pageid: pageId }); }
  async getPageFull(pageId: string): Promise<TildaPageFull> { return this.client.request<TildaPageFull>('/getpagefull', { pageid: pageId }); }
  async getPageExport(pageId: string): Promise<TildaPageFull> { return this.client.request<TildaPageFull>('/getpageexport', { pageid: pageId }); }
  async getPageFullExport(pageId: string): Promise<TildaPageFull> { return this.client.request<TildaPageFull>('/getpagefullexport', { pageid: pageId }); }

  getClient(): TildaClient { return this.client; }
}
