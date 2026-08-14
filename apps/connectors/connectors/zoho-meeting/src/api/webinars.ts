import type { ZohoMeetingClient } from './client';
import type {
  ZohoMeetingRegistrantInput,
  ZohoMeetingWebinarCreateInput,
  ZohoMeetingWebinarUpdateInput,
} from '../types';

export class WebinarsApi {
  constructor(private readonly client: ZohoMeetingClient) {}

  list(options: {
    from?: number;
    limit?: number;
    type?: 'all' | 'upcoming' | 'past' | 'ondemand';
    sortColumn?: 'created_time' | 'start_time';
    sortOrder?: 'asc' | 'desc';
  } = {}) {
    return this.client.request('/webinars', {
      params: {
        from: options.from,
        limit: options.limit,
        type: options.type,
        sort_column: options.sortColumn,
        sort_order: options.sortOrder,
      },
    });
  }

  get(webinarKey: string) {
    return this.client.request(`/webinars/${encodeURIComponent(webinarKey)}`);
  }

  create(input: ZohoMeetingWebinarCreateInput) {
    return this.client.request('/webinars', {
      method: 'POST',
      body: {
        topic: input.topic,
        agenda: input.agenda,
        start_time: input.startTime,
        duration: input.duration,
        timezone: input.timezone,
        registration_required: input.registrationRequired,
        registration_approval_required: input.isRegistrationApprovalRequired,
        co_organizer_emails: input.coOrganizerEmails,
        panelists: input.panelists,
        start_recording_on_join: input.autoStartRecording,
      },
    });
  }

  update(webinarKey: string, input: ZohoMeetingWebinarUpdateInput) {
    return this.client.request(`/webinars/${encodeURIComponent(webinarKey)}`, {
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

  delete(webinarKey: string) {
    return this.client.request(`/webinars/${encodeURIComponent(webinarKey)}`, {
      method: 'DELETE',
    });
  }

  start(webinarKey: string) {
    return this.client.request(`/webinars/${encodeURIComponent(webinarKey)}/start`, {
      method: 'POST',
    });
  }

  listRegistrants(
    webinarKey: string,
    options: {
      from?: number;
      limit?: number;
      status?: 'approved' | 'pending' | 'denied';
    } = {},
  ) {
    return this.client.request(
      `/webinars/${encodeURIComponent(webinarKey)}/registrants`,
      {
        params: {
          from: options.from,
          limit: options.limit,
          status: options.status,
        },
      },
    );
  }

  register(webinarKey: string, input: ZohoMeetingRegistrantInput) {
    return this.client.request(
      `/webinars/${encodeURIComponent(webinarKey)}/registrants`,
      {
        method: 'POST',
        body: {
          email: input.email,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
          custom_fields: input.customFields,
        },
      },
    );
  }

  approve(webinarKey: string, registrantIds: string[]) {
    return this.client.request(
      `/webinars/${encodeURIComponent(webinarKey)}/registrants/approve`,
      {
        method: 'POST',
        body: { registrant_ids: registrantIds },
      },
    );
  }

  deny(webinarKey: string, registrantIds: string[]) {
    return this.client.request(
      `/webinars/${encodeURIComponent(webinarKey)}/registrants/deny`,
      {
        method: 'POST',
        body: { registrant_ids: registrantIds },
      },
    );
  }

  listPolls(webinarKey: string) {
    return this.client.request(`/webinars/${encodeURIComponent(webinarKey)}/polls`);
  }
}
