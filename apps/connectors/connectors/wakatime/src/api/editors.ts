import type { WakatimeClient } from './client';

export class EditorsApi {
  constructor(private readonly client: WakatimeClient) {}

  async list(): Promise<unknown> {
    return this.client.get('/editors');
  }
}
