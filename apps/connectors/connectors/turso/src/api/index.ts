import { TursoClient } from './client';
import { OrganizationsApi } from './organizations';
import { DatabasesApi } from './databases';
import { GroupsApi } from './groups';
import { UsageApi } from './usage';
import type { TursoConfig } from '../types';

export { TursoClient };

export class Turso {
  private readonly client: TursoClient;
  readonly organizations: OrganizationsApi;
  readonly databases: DatabasesApi;
  readonly groups: GroupsApi;
  readonly usage: UsageApi;

  constructor(config: TursoConfig) {
    this.client = new TursoClient(config);
    this.organizations = new OrganizationsApi(this.client);
    this.databases = new DatabasesApi(this.client);
    this.groups = new GroupsApi(this.client);
    this.usage = new UsageApi(this.client);
  }

  getClient(): TursoClient {
    return this.client;
  }

  listOrganizations() {
    return this.organizations.list();
  }

  validateToken() {
    return this.organizations.validateToken();
  }

  listDatabases(params?: { group?: string; parent?: string }) {
    return this.databases.list(params);
  }

  getDatabase(name: string) {
    return this.databases.get(name);
  }

  createDatabase(params: { name: string; group: string }) {
    return this.databases.create(params);
  }

  deleteDatabase(name: string) {
    return this.databases.delete(name);
  }

  listGroups() {
    return this.groups.list();
  }

  getOrganizationUsage() {
    return this.usage.getOrganizationUsage();
  }
}
