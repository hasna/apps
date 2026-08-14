import { WorkOSClient } from './client';
import type {
  Connection,
  Directory,
  DirectoryUser,
  Organization,
  WorkOSConfig,
  WorkOSListResponse,
  WorkOSEvent,
} from '../types';

export { WorkOSClient, DEFAULT_BASE_URL } from './client';

export interface ListOptions {
  limit?: number;
  before?: string;
  after?: string;
  order?: 'asc' | 'desc' | 'normal';
}

export class WorkOS {
  private readonly client: WorkOSClient;

  constructor(config: WorkOSConfig) {
    this.client = new WorkOSClient(config);
  }

  static fromEnv(): WorkOS {
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) {
      throw new Error('WORKOS_API_KEY environment variable is required');
    }
    return new WorkOS({ apiKey });
  }

  async listOrganizations(
    options?: ListOptions & { domains?: string[]; search?: string },
  ): Promise<WorkOSListResponse<Organization>> {
    return this.client.request<WorkOSListResponse<Organization>>('/organizations', {
      params: {
        limit: options?.limit,
        before: options?.before,
        after: options?.after,
        order: options?.order,
        domains: options?.domains,
        search: options?.search,
      },
    });
  }

  async listConnections(
    options?: ListOptions & {
      organization_id?: string;
      domain?: string;
      connection_type?: string;
      search?: string;
    },
  ): Promise<WorkOSListResponse<Connection>> {
    return this.client.request<WorkOSListResponse<Connection>>('/connections', {
      params: {
        limit: options?.limit,
        before: options?.before,
        after: options?.after,
        order: options?.order,
        organization_id: options?.organization_id,
        domain: options?.domain,
        connection_type: options?.connection_type,
        search: options?.search,
      },
    });
  }

  async listDirectories(
    options?: ListOptions & { organization_id?: string; domain?: string; search?: string },
  ): Promise<WorkOSListResponse<Directory>> {
    return this.client.request<WorkOSListResponse<Directory>>('/directories', {
      params: {
        limit: options?.limit,
        before: options?.before,
        after: options?.after,
        order: options?.order,
        organization_id: options?.organization_id,
        domain: options?.domain,
        search: options?.search,
      },
    });
  }

  async listDirectoryUsers(
    options: ListOptions & { directory_id: string },
  ): Promise<WorkOSListResponse<DirectoryUser>> {
    return this.client.request<WorkOSListResponse<DirectoryUser>>('/directory_users', {
      params: {
        directory_id: options.directory_id,
        limit: options.limit,
        before: options.before,
        after: options.after,
        order: options.order,
      },
    });
  }

  async listEvents(
    options?: ListOptions & {
      organization_id?: string;
      events?: string[];
      range_start?: string;
      range_end?: string;
    },
  ): Promise<WorkOSListResponse<WorkOSEvent>> {
    return this.client.request<WorkOSListResponse<WorkOSEvent>>('/events', {
      params: {
        limit: options?.limit,
        before: options?.before,
        after: options?.after,
        order: options?.order,
        organization_id: options?.organization_id,
        events: options?.events,
        range_start: options?.range_start,
        range_end: options?.range_end,
      },
    });
  }

  getClient(): WorkOSClient {
    return this.client;
  }
}
