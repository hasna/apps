// Apiary Connector — API design, documentation, and testing
import { ApiaryClient } from './client';
import type { ApiaryConfig, ApiaryApi, ApiaryApiList, ApiaryBlueprint, ApiaryTest, ApiaryTestList, ApiaryTeam } from '../types';
export { ApiaryClient } from './client';

export class Apiary {
  private readonly client: ApiaryClient;
  constructor(config: ApiaryConfig) { this.client = new ApiaryClient(config); }
  static fromEnv(): Apiary {
    const token = process.env.APIARY_TOKEN;
    if (!token) throw new Error('APIARY_TOKEN is required');
    return new Apiary({ token });
  }

  async listApis(): Promise<ApiaryApiList> { return this.client.request<ApiaryApiList>('/me/apis'); }
  async getApi(apiName: string): Promise<ApiaryApi> { return this.client.request<ApiaryApi>(`/me/apis/${apiName}`); }

  async getBlueprint(apiName: string): Promise<ApiaryBlueprint> { return this.client.request<ApiaryBlueprint>(`/blueprint/get/${apiName}`); }
  async publishBlueprint(apiName: string, code: string): Promise<void> {
    await this.client.request(`/blueprint/publish/${apiName}`, { method: 'POST', body: { code } });
  }

  async listTests(apiName: string): Promise<ApiaryTestList> { return this.client.request<ApiaryTestList>(`/apis/${apiName}/tests`); }
  async getTest(apiName: string, testId: string): Promise<ApiaryTest> { return this.client.request<ApiaryTest>(`/apis/${apiName}/tests/${testId}`); }
  async runTests(apiName: string): Promise<ApiaryTest> { return this.client.request<ApiaryTest>(`/apis/${apiName}/tests`, { method: 'POST' }); }

  async getTeam(): Promise<ApiaryTeam> { return this.client.request<ApiaryTeam>('/me/team'); }

  getClient(): ApiaryClient { return this.client; }
}
