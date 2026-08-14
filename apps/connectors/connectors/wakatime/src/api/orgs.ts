import type { WakatimeClient } from './client';
import type { OrgDashboardsOptions, UserScopedOptions } from '../types';

export class OrgsApi {
  constructor(private readonly client: WakatimeClient) {}

  async list(options: UserScopedOptions = {}): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/orgs`);
  }

  async listDashboards(options: OrgDashboardsOptions): Promise<unknown> {
    const user = this.client.userPath(options.user);
    const org = encodeURIComponent(options.org);
    return this.client.get(`${user}/orgs/${org}/dashboards`);
  }
}
