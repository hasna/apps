import type { TursoClient } from './client';
import type {
  CreateDatabaseParams,
  CreateDatabaseResponse,
  Database,
  DatabaseListResponse,
  DeleteDatabaseResponse,
} from '../types';

export class DatabasesApi {
  constructor(private readonly client: TursoClient) {}

  list(params?: { group?: string; parent?: string }): Promise<DatabaseListResponse> {
    return this.client.get<DatabaseListResponse>(this.client.orgPath('/databases'), params);
  }

  get(databaseName: string): Promise<{ database: Database }> {
    const encoded = encodeURIComponent(databaseName);
    return this.client.get<{ database: Database }>(this.client.orgPath(`/databases/${encoded}`));
  }

  create(params: CreateDatabaseParams): Promise<CreateDatabaseResponse> {
    return this.client.post<CreateDatabaseResponse>(
      this.client.orgPath('/databases'),
      params as unknown as Record<string, unknown>,
    );
  }

  delete(databaseName: string): Promise<DeleteDatabaseResponse> {
    const encoded = encodeURIComponent(databaseName);
    return this.client.delete<DeleteDatabaseResponse>(this.client.orgPath(`/databases/${encoded}`));
  }
}
