import { encodePathSegment, type TesterArmyClient } from './client';
import type { JsonBody } from '../types';

export class WebhooksApi {
  constructor(private readonly client: TesterArmyClient) {}

  triggerProject(
    webhookId: string,
    secret: string,
    body: JsonBody = {},
    headers?: Record<string, string>,
  ): Promise<unknown> {
    return this.client.request(`/v1/webhook/${encodePathSegment(webhookId)}/${encodePathSegment(secret)}`, {
      method: 'POST',
      body,
      headers,
      auth: false,
    });
  }

  triggerGroup(
    webhookId: string,
    secret: string,
    body: JsonBody = {},
    headers?: Record<string, string>,
  ): Promise<unknown> {
    return this.client.request(
      `/v1/groups/webhook/${encodePathSegment(webhookId)}/${encodePathSegment(secret)}`,
      {
        method: 'POST',
        body,
        headers,
        auth: false,
      },
    );
  }
}
