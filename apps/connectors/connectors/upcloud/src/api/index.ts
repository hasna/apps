import { UpCloudClient } from './client';
import { AccountApi } from './account';
import { ServersApi } from './servers';
import { StorageApi } from './storage';
import { NetworkApi } from './network';
import type { UpCloudConfig } from '../types';

export { UpCloudClient, DEFAULT_BASE_URL } from './client';
export { AccountApi } from './account';
export { ServersApi } from './servers';
export { StorageApi } from './storage';
export { NetworkApi } from './network';

/**
 * UpCloud API wrapper
 */
export class UpCloud {
  private client: UpCloudClient;
  readonly account: AccountApi;
  readonly servers: ServersApi;
  readonly storage: StorageApi;
  readonly network: NetworkApi;

  constructor(config: UpCloudConfig) {
    this.client = new UpCloudClient(config);
    this.account = new AccountApi(this.client);
    this.servers = new ServersApi(this.client);
    this.storage = new StorageApi(this.client);
    this.network = new NetworkApi(this.client);
  }

  getClient(): UpCloudClient {
    return this.client;
  }
}
