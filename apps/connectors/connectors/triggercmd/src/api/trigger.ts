import type { ConnectorClient } from './client';
import type { TriggerParams, TriggerResponse } from '../types';

export class TriggerApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Trigger a remote command
   * POST /api/run/triggerSave
   */
  async run(params: TriggerParams, queryParams?: { params?: string }): Promise<TriggerResponse> {
    const body: Record<string, unknown> = {
      computer: params.computer,
      trigger: params.trigger,
    };
    if (params.params !== undefined) {
      body.params = params.params;
    }

    const urlParams: Record<string, string | undefined> = {};
    if (queryParams?.params !== undefined) {
      urlParams.params = queryParams.params;
    }

    return this.client.post<TriggerResponse>('/api/run/triggerSave', body, urlParams);
  }
}
