// PostHog Connector — Product analytics and feature flags
import { PostHogClient } from './client';
import type { PostHogConfig, PHEvent, PHPerson, PHFeatureFlag, PHInsight, PHCohort } from '../types';
export { PostHogClient } from './client';

export class PostHog {
  private readonly client: PostHogClient;
  private readonly projectId: string | undefined;

  constructor(config: PostHogConfig) {
    this.client = new PostHogClient(config);
    this.projectId = config.projectId;
  }

  static fromEnv(): PostHog {
    const apiKey = process.env.POSTHOG_API_KEY;
    if (!apiKey) throw new Error('POSTHOG_API_KEY environment variable is required');
    return new PostHog({ apiKey, host: process.env.POSTHOG_HOST, projectId: process.env.POSTHOG_PROJECT_ID });
  }

  private projectPath(path: string): string {
    if (!this.projectId) throw new Error('projectId is required for this operation');
    return `/projects/${this.projectId}${path}`;
  }

  // Events
  async listEvents(options?: { event?: string; distinct_id?: string; limit?: number; after?: string; before?: string }): Promise<{ results: PHEvent[]; next: string | null }> {
    return this.client.request(this.projectPath('/events/'), { params: options as Record<string, string | number | undefined> });
  }

  // Persons
  async listPersons(options?: { search?: string; limit?: number; offset?: number }): Promise<{ results: PHPerson[]; count: number }> {
    return this.client.request(this.projectPath('/persons/'), { params: options as Record<string, string | number | undefined> });
  }
  async getPerson(personId: string): Promise<PHPerson> {
    return this.client.request<PHPerson>(this.projectPath(`/persons/${personId}/`));
  }
  async deletePerson(personId: string): Promise<void> {
    await this.client.request(this.projectPath(`/persons/${personId}/`), { method: 'DELETE' });
  }

  // Feature Flags
  async listFeatureFlags(): Promise<{ results: PHFeatureFlag[] }> {
    return this.client.request(this.projectPath('/feature_flags/'));
  }
  async getFeatureFlag(flagId: number): Promise<PHFeatureFlag> {
    return this.client.request<PHFeatureFlag>(this.projectPath(`/feature_flags/${flagId}/`));
  }
  async createFeatureFlag(data: { key: string; name?: string; active?: boolean; rollout_percentage?: number }): Promise<PHFeatureFlag> {
    return this.client.request<PHFeatureFlag>(this.projectPath('/feature_flags/'), { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateFeatureFlag(flagId: number, data: Partial<{ active: boolean; rollout_percentage: number; name: string }>): Promise<PHFeatureFlag> {
    return this.client.request<PHFeatureFlag>(this.projectPath(`/feature_flags/${flagId}/`), { method: 'PATCH', body: data as Record<string, unknown> });
  }

  // Cohorts
  async listCohorts(): Promise<{ results: PHCohort[] }> {
    return this.client.request(this.projectPath('/cohorts/'));
  }

  // Insights
  async listInsights(options?: { limit?: number; search?: string }): Promise<{ results: PHInsight[] }> {
    return this.client.request(this.projectPath('/insights/'), { params: options as Record<string, string | number | undefined> });
  }

  // Capture (send events — uses different endpoint, no project ID)
  async capture(events: Array<{ event: string; distinct_id: string; properties?: Record<string, unknown>; timestamp?: string }>): Promise<void> {
    const host = this.client.baseUrl.replace('/api', '');
    await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: (this.client as unknown as { apiKey: string }).apiKey, batch: events }),
    });
  }

  getClient(): PostHogClient { return this.client; }
}
