import type { TinesClient } from './client';
import type { TinesTunnel } from '../types';

export class TunnelsApi {
  constructor(private readonly client: TinesClient) {}

  list(): Promise<TinesTunnel[]> {
    return this.client.request<TinesTunnel[]>('/tunnels');
  }
}
