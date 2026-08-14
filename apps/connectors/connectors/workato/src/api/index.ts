import type { WorkatoConfig } from '../types';
import { WorkatoClient } from './client';
import { RecipesApi } from './recipes';
import { JobsApi } from './jobs';
import { ConnectionsApi } from './connections';
import { FoldersApi } from './folders';
import { ProjectsApi } from './projects';
import { LookupTablesApi } from './lookup-tables';
import { PropertiesApi } from './properties';
import { UsersApi } from './users';

export class WorkatoConnector {
  private readonly client: WorkatoClient;

  public readonly recipes: RecipesApi;
  public readonly jobs: JobsApi;
  public readonly connections: ConnectionsApi;
  public readonly folders: FoldersApi;
  public readonly projects: ProjectsApi;
  public readonly lookupTables: LookupTablesApi;
  public readonly properties: PropertiesApi;
  public readonly users: UsersApi;

  constructor(config: WorkatoConfig) {
    this.client = new WorkatoClient(config);
    this.recipes = new RecipesApi(this.client);
    this.jobs = new JobsApi(this.client);
    this.connections = new ConnectionsApi(this.client);
    this.folders = new FoldersApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.lookupTables = new LookupTablesApi(this.client);
    this.properties = new PropertiesApi(this.client);
    this.users = new UsersApi(this.client);
  }

  static fromEnv(): WorkatoConnector {
    const apiToken = process.env.WORKATO_API_TOKEN;
    if (!apiToken) {
      throw new Error('WORKATO_API_TOKEN environment variable is required');
    }
    return new WorkatoConnector({
      apiToken,
      baseUrl: process.env.WORKATO_BASE_URL,
    });
  }

  getApiTokenPreview(): string {
    return this.client.getApiTokenPreview();
  }

  getClient(): WorkatoClient {
    return this.client;
  }
}

export { WorkatoClient, DEFAULT_BASE_URL, validateBaseUrl } from './client';
export { RecipesApi } from './recipes';
export { JobsApi } from './jobs';
export { ConnectionsApi } from './connections';
export { FoldersApi } from './folders';
export { ProjectsApi } from './projects';
export { LookupTablesApi } from './lookup-tables';
export { PropertiesApi } from './properties';
export { UsersApi } from './users';
