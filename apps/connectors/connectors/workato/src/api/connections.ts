import type { WorkatoClient } from './client';
import type {
  ConnectionListOptions,
  CreateConnectionInput,
  UpdateConnectionInput,
} from '../types';

export class ConnectionsApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: ConnectionListOptions = {}) {
    return this.client.get('/connections', {
      provider: options.provider,
      folder_id: options.folderId,
      per_page: options.perPage,
      page: options.page,
    });
  }

  get(id: number) {
    return this.client.get(`/connections/${id}`);
  }

  create(input: CreateConnectionInput) {
    if (!input.name?.trim()) {
      throw new Error('Workato: name is required');
    }
    if (!input.provider?.trim()) {
      throw new Error('Workato: provider is required');
    }
    return this.client.post('/connections', {
      name: input.name.trim(),
      provider: input.provider.trim(),
      folder_id: input.folderId,
      input: input.input,
    });
  }

  update(input: UpdateConnectionInput) {
    return this.client.put(`/connections/${input.id}`, {
      name: input.name,
      input: input.input,
    });
  }

  delete(id: number) {
    return this.client.delete(`/connections/${id}`);
  }
}
