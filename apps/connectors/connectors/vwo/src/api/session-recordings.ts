import type { ConnectorClient } from './client';
import type { SessionRecording, SessionRecordingListParams } from '../types';

export class SessionRecordingsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: SessionRecordingListParams): Promise<unknown> {
    return this.client.get('/session-recordings', params);
  }

  async get(id: string | number): Promise<SessionRecording> {
    return this.client.get<SessionRecording>(`/session-recordings/${encodeURIComponent(String(id))}`);
  }
}
