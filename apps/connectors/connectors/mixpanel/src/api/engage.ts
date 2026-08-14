import { MixpanelClient } from './client';
import type { ProfileOperation, ProfileResponse, QueryProfilesResponse, UserProfile } from '../types';

/**
 * Mixpanel Engage API
 * Manage user profiles
 */
export class EngageApi {
  constructor(private readonly client: MixpanelClient) {}

  /**
   * Set user profile properties (overwrites existing values)
   */
  async set(distinctId: string, properties: Record<string, unknown>): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $set: properties,
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Set user profile properties only if they don't exist
   */
  async setOnce(distinctId: string, properties: Record<string, unknown>): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $set_once: properties,
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Add numeric values to existing properties
   */
  async add(distinctId: string, properties: Record<string, number>): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $add: properties,
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Append values to list properties
   */
  async append(distinctId: string, properties: Record<string, unknown>): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $append: properties,
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Remove values from list properties
   */
  async remove(distinctId: string, properties: Record<string, unknown>): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $remove: properties,
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Unset (delete) profile properties
   */
  async unset(distinctId: string, propertyNames: string[]): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $unset: propertyNames,
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Union values with list properties
   */
  async union(distinctId: string, properties: Record<string, unknown[]>): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $union: properties,
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Delete a user profile
   */
  async delete(distinctId: string): Promise<ProfileResponse> {
    const projectToken = this.client.getProjectToken();
    if (!projectToken) {
      throw new Error('Project token is required for profile operations');
    }

    const operation: ProfileOperation = {
      $token: projectToken,
      $distinct_id: distinctId,
      $delete: '',
    };

    return this.client.trackRequest<ProfileResponse>('/engage', operation);
  }

  /**
   * Query user profiles (requires API secret)
   */
  async query(options: {
    where?: string;
    sessionId?: string;
    page?: number;
    output_properties?: string[];
  } = {}): Promise<QueryProfilesResponse> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for querying profiles');
    }

    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.where) {
      params.where = options.where;
    }
    if (options.sessionId) {
      params.session_id = options.sessionId;
    }
    if (options.page !== undefined) {
      params.page = options.page;
    }
    if (options.output_properties) {
      params.output_properties = JSON.stringify(options.output_properties);
    }

    return this.client.request<QueryProfilesResponse>(
      `/api/2.0/engage?project_id=${projectId}`,
      {
        method: 'GET',
        params,
        endpoint: 'data',
        authType: 'basic',
      }
    );
  }

  /**
   * Get a specific user profile by distinct ID
   */
  async get(distinctId: string): Promise<UserProfile | null> {
    const result = await this.query({
      where: `properties["$distinct_id"] == "${distinctId}"`,
    });

    if (result.results && result.results.length > 0) {
      return result.results[0];
    }

    return null;
  }
}
