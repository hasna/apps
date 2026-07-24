import type { VelaClient } from './client';
import type {
  CancelMeetingParams,
  ListParams,
  Meeting,
  RescheduleMeetingParams,
} from '../types';

export class MeetingsApi {
  constructor(private readonly client: VelaClient) {}

  async list(params?: ListParams): Promise<Meeting[]> {
    return this.client.get<Meeting[]>('/meetings', params);
  }

  async get(meetingId: string): Promise<Meeting> {
    return this.client.get<Meeting>(`/meetings/${encodeURIComponent(meetingId)}`);
  }

  async cancel(meetingId: string, params?: CancelMeetingParams): Promise<Meeting> {
    return this.client.post<Meeting>(
      `/meetings/${encodeURIComponent(meetingId)}/cancel`,
      params ?? {},
    );
  }

  async reschedule(meetingId: string, params: RescheduleMeetingParams): Promise<Meeting> {
    return this.client.post<Meeting>(
      `/meetings/${encodeURIComponent(meetingId)}/reschedule`,
      params,
    );
  }
}
