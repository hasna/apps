import type { WorkatoClient } from './client';
import type {
  LookupRowInput,
  LookupRowOptions,
  PaginatedListOptions,
  UpdateLookupRowInput,
} from '../types';

export class LookupTablesApi {
  constructor(private readonly client: WorkatoClient) {}

  list(options: PaginatedListOptions = {}) {
    return this.client.get('/lookup_tables', {
      per_page: options.perPage,
      page: options.page,
    });
  }

  get(id: number) {
    return this.client.get(`/lookup_tables/${id}`);
  }

  lookupRow(options: LookupRowOptions) {
    if (!options.column?.trim()) {
      throw new Error('Workato: column is required');
    }
    return this.client.get(`/lookup_tables/${options.tableId}/rows`, {
      column: options.column.trim(),
      value: String(options.value),
    });
  }

  createRow(input: LookupRowInput) {
    return this.client.post(`/lookup_tables/${input.tableId}/rows`, {
      data: input.data,
    });
  }

  updateRow(input: UpdateLookupRowInput) {
    return this.client.put(`/lookup_tables/${input.tableId}/rows/${input.rowId}`, {
      data: input.data,
    });
  }

  deleteRow(tableId: number, rowId: number) {
    return this.client.delete(`/lookup_tables/${tableId}/rows/${rowId}`);
  }
}
