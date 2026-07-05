import type { ConnectorClient } from './client';
import type {
  CreateFeatureParams,
  Feature,
  FeatureListResponse,
} from '../types';

/**
 * Unleash feature flag (feature) Admin API
 * @see https://docs.getunleash.io/reference/api-unleash/admin-features
 */
export class FlagsApi {
  constructor(private readonly client: ConnectorClient) {}

  private projectPath(projectId?: string): string {
    const project = projectId || this.client.projectId;
    return `/admin/projects/${encodeURIComponent(project)}/features`;
  }

  /**
   * List all feature flags in a project
   */
  async list(projectId?: string): Promise<Feature[]> {
    const response = await this.client.get<FeatureListResponse>(this.projectPath(projectId));
    return response.features;
  }

  /**
   * Get a single feature flag by name
   */
  async get(name: string, projectId?: string): Promise<Feature> {
    return this.client.get<Feature>(`${this.projectPath(projectId)}/${encodeURIComponent(name)}`);
  }

  /**
   * Create a new feature flag
   */
  async create(params: CreateFeatureParams, projectId?: string): Promise<Feature> {
    return this.client.post<Feature>(this.projectPath(projectId), {
      name: params.name,
      type: params.type ?? 'release',
      description: params.description,
      impressionData: params.impressionData ?? false,
    });
  }
}
