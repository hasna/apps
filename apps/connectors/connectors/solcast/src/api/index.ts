import type { SolcastConfig } from '../types';
import { SolcastClient } from './client';
import { SolcastApi } from './solcast';

export class Solcast {
  public readonly api: SolcastApi;
  private readonly client: SolcastClient;

  constructor(config: SolcastConfig) {
    this.client = new SolcastClient(config);
    this.api = new SolcastApi(this.client);
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}

export { SolcastClient } from './client';
export { SolcastApi } from './solcast';
