import type { ConnectorClient } from './client';
import type { FieldValue, FieldValueCreateParams } from '../types';

export class FieldValuesApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(data: FieldValueCreateParams): Promise<FieldValue> {
    return this.client.post<FieldValue>('/field-values', data);
  }

  async update(id: number, value: unknown): Promise<FieldValue> {
    return this.client.put<FieldValue>(`/field-values/${id}`, { value });
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/field-values/${id}`);
  }
}
