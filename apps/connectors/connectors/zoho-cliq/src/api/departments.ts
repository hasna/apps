import type { ZohoCliqClient } from './client';

export class DepartmentsApi {
  constructor(private readonly client: ZohoCliqClient) {}

  async list(): Promise<unknown> {
    return this.client.get('/organization/departments');
  }
}
