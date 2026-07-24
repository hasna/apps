import type { WatiClient } from './client';
import type { AddLabelsParams, RemoveLabelsParams, WatiApiResponse } from '../types';

export class LabelsApi {
  constructor(private readonly client: WatiClient) {}

  async addLabelsToContact(params: AddLabelsParams): Promise<WatiApiResponse> {
    const { whatsappNumber, labels } = params;
    return this.client.post<WatiApiResponse>(
      `/api/v1/addLabels/${encodeURIComponent(whatsappNumber)}`,
      { labels },
    );
  }

  async removeLabelsFromContact(params: RemoveLabelsParams): Promise<WatiApiResponse> {
    const { whatsappNumber, labels } = params;
    return this.client.post<WatiApiResponse>(
      `/api/v1/deleteLabels/${encodeURIComponent(whatsappNumber)}`,
      { labels },
    );
  }
}
