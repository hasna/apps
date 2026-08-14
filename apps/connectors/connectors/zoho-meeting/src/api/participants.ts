import type { ZohoMeetingClient } from './client';
import type { ZohoMeetingParticipantInput } from '../types';

export class ParticipantsApi {
  constructor(private readonly client: ZohoMeetingClient) {}

  list(sessionKey: string, options: { from?: number; limit?: number } = {}) {
    return this.client.request(
      `/sessions/${encodeURIComponent(sessionKey)}/participants`,
      {
        params: {
          from: options.from,
          limit: options.limit,
        },
      },
    );
  }

  add(sessionKey: string, participants: ZohoMeetingParticipantInput[]) {
    return this.client.request(
      `/sessions/${encodeURIComponent(sessionKey)}/participants`,
      {
        method: 'POST',
        body: { participants },
      },
    );
  }

  remove(sessionKey: string, participantId: string) {
    return this.client.request(
      `/sessions/${encodeURIComponent(sessionKey)}/participants/${encodeURIComponent(participantId)}`,
      { method: 'DELETE' },
    );
  }
}
