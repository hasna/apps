import type { UpCloudClient } from './client';
import type { Account, Plan, Zone } from '../types';

export class AccountApi {
  constructor(private client: UpCloudClient) {}

  async getAccount(): Promise<{ account: Account }> {
    return this.client.get<{ account: Account }>('/account');
  }

  async getAccountDetails(): Promise<unknown> {
    return this.client.get('/account/details');
  }

  async listSubAccounts(): Promise<unknown> {
    return this.client.get('/account/sub');
  }

  async listPrices(): Promise<unknown> {
    return this.client.get('/price');
  }

  async listPlans(): Promise<{ plans: { plan: Plan[] } }> {
    return this.client.get<{ plans: { plan: Plan[] } }>('/plan');
  }

  async listZones(): Promise<{ zones: { zone: Zone[] } }> {
    return this.client.get<{ zones: { zone: Zone[] } }>('/zone');
  }

  async listTimezones(): Promise<unknown> {
    return this.client.get('/timezone');
  }

  async listTags(): Promise<unknown> {
    return this.client.get('/tag');
  }

  async listHosts(): Promise<unknown> {
    return this.client.get('/host');
  }

  async getHost(id: number): Promise<unknown> {
    return this.client.get(`/host/${id}`);
  }

  async listPermissions(): Promise<unknown> {
    return this.client.get('/permission');
  }
}
