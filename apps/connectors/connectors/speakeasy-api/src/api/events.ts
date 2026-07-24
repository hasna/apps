import type { ConnectorClient } from './client';
import type { CliEventBatch } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  post(workspaceID: string, events: CliEventBatch): Promise<void> {
    return this.client.post<void>(
      `/v1/workspace/${encodeURIComponent(workspaceID)}/events`,
      events as unknown as unknown[]
    );
  }
}
