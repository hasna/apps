import type { ZohoMeetingClient } from './client';

export class RecordingsApi {
  constructor(private readonly client: ZohoMeetingClient) {}

  list(options: {
    sessionKey?: string;
    webinarKey?: string;
    from?: number;
    limit?: number;
    type?: 'meeting' | 'webinar';
  } = {}) {
    return this.client.request('/recordings', {
      params: {
        session_key: options.sessionKey,
        webinar_key: options.webinarKey,
        from: options.from,
        limit: options.limit,
        type: options.type,
      },
    });
  }

  get(recordingId: string) {
    return this.client.request(`/recordings/${encodeURIComponent(recordingId)}`);
  }

  delete(recordingId: string) {
    return this.client.request(`/recordings/${encodeURIComponent(recordingId)}`, {
      method: 'DELETE',
    });
  }
}
