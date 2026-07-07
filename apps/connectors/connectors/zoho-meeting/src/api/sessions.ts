import type { ZohoMeetingClient } from './client';
import type {
  ZohoMeetingSessionCreateInput,
  ZohoMeetingSessionUpdateInput,
} from '../types';

export class SessionsApi {
  constructor(private readonly client: ZohoMeetingClient) {}

  list(options: {
    from?: number;
    limit?: number;
    sortColumn?: 'created_time' | 'start_time';
    sortOrder?: 'asc' | 'desc';
    type?: 'all' | 'upcoming' | 'past' | 'ondemand' | 'recurring';
  } = {}) {
    return this.client.request('/sessions', {
      params: {
        from: options.from,
        limit: options.limit,
        sort_column: options.sortColumn,
        sort_order: options.sortOrder,
        type: options.type,
      },
    });
  }

  get(sessionKey: string) {
    return this.client.request(`/sessions/${encodeURIComponent(sessionKey)}`);
  }

  create(input: ZohoMeetingSessionCreateInput) {
    return this.client.request('/sessions', {
      method: 'POST',
      body: {
        topic: input.topic,
        agenda: input.agenda,
        start_time: input.startTime,
        duration: input.duration,
        timezone: input.timezone,
        participants: input.participants,
        recurring_details: input.recurringDetails,
        mute_on_entry: input.isMuteAttendee,
        video_off_on_entry: input.isVideoOff,
        start_recording_on_join: input.autoStartRecording,
        co_host_emails: input.coHostEmails,
      },
    });
  }

  update(sessionKey: string, input: ZohoMeetingSessionUpdateInput) {
    return this.client.request(`/sessions/${encodeURIComponent(sessionKey)}`, {
      method: 'PUT',
      body: {
        topic: input.topic,
        agenda: input.agenda,
        start_time: input.startTime,
        duration: input.duration,
        timezone: input.timezone,
      },
    });
  }

  delete(sessionKey: string) {
    return this.client.request(`/sessions/${encodeURIComponent(sessionKey)}`, {
      method: 'DELETE',
    });
  }

  start(sessionKey: string) {
    return this.client.request(`/sessions/${encodeURIComponent(sessionKey)}/start`, {
      method: 'POST',
    });
  }

  end(sessionKey: string) {
    return this.client.request(`/sessions/${encodeURIComponent(sessionKey)}/end`, {
      method: 'POST',
    });
  }
}
