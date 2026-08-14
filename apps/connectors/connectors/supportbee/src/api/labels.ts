import type { ConnectorClient } from './client';
import type { Label } from '../types';

export interface LabelListResponse {
  labels: Label[];
}

export class LabelsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List all labels configured for the account.
   */
  async list(): Promise<LabelListResponse> {
    return this.client.get<LabelListResponse>('/labels');
  }

  /**
   * Apply a label to a ticket by label name.
   */
  async add(ticketId: number | string, labelName: string): Promise<unknown> {
    return this.client.post<unknown>(`/tickets/${ticketId}/labels/${encodeURIComponent(labelName)}`);
  }

  /**
   * Remove a label from a ticket by label name.
   */
  async remove(ticketId: number | string, labelName: string): Promise<void> {
    await this.client.delete(`/tickets/${ticketId}/labels/${encodeURIComponent(labelName)}`);
  }
}
