import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexMeeting,
  WebexMeetingCreateRequest,
  WebexMeetingUpdateRequest,
  ListMeetingsOptions,
} from '../types';

export class MeetingsApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListMeetingsOptions = {}): Promise<WebexMeeting[]> {
    const response = await this.client.get<PaginatedResponse<WebexMeeting>>('/meetings', {
      meetingNumber: options.meetingNumber,
      webLink: options.webLink,
      from: options.from,
      to: options.to,
      hostEmail: options.hostEmail,
      siteUrl: options.siteUrl,
      max: options.max,
    });
    return response.items ?? [];
  }

  async get(meetingId: string): Promise<WebexMeeting> {
    return this.client.get<WebexMeeting>(`/meetings/${encodeURIComponent(meetingId)}`);
  }

  async create(meeting: WebexMeetingCreateRequest): Promise<WebexMeeting> {
    return this.client.post<WebexMeeting>('/meetings', meeting);
  }

  async update(meetingId: string, updates: WebexMeetingUpdateRequest): Promise<WebexMeeting> {
    return this.client.patch<WebexMeeting>(`/meetings/${encodeURIComponent(meetingId)}`, updates);
  }

  async delete(meetingId: string): Promise<void> {
    await this.client.delete(`/meetings/${encodeURIComponent(meetingId)}`);
  }
}
