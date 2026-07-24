import type { WorkatoClient } from './client';
import type { CreateFolderInput, FolderListOptions, UpdateFolderInput } from '../types';

export class FoldersApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: FolderListOptions = {}) {
    return this.client.get('/folders', {
      parent_id: options.parentId,
      per_page: options.perPage,
      page: options.page,
    });
  }

  create(input: CreateFolderInput) {
    if (!input.name?.trim()) {
      throw new Error('Workato: name is required');
    }
    return this.client.post('/folders', {
      name: input.name.trim(),
      parent_id: input.parentId,
    });
  }

  update(input: UpdateFolderInput) {
    return this.client.put(`/folders/${input.id}`, {
      name: input.name,
      parent_id: input.parentId,
    });
  }

  delete(id: number) {
    return this.client.delete(`/folders/${id}`);
  }
}
