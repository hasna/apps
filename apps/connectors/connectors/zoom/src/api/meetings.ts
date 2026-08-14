import type { ZoomClient } from './client';
import type {
  ZoomMeeting,
  ZoomMeetingListResponse,
  ZoomMeetingDetail,
  ZoomMeetingCreateRequest,
} from '../types';

/**
 * Zoom Meetings API
 */
export class MeetingsApi {
  private readonly client: ZoomClient;

  constructor(client: ZoomClient) {
    this.client = client;
  }

  /**
   * List meetings for a user
   */
  async listMeetings(
    userId: string = 'me',
    options: {
      type?: 'scheduled' | 'live' | 'upcoming' | 'upcoming_meetings' | 'previous_meetings';
      pageSize?: number;
      pageNumber?: number;
      nextPageToken?: string;
    } = {}
  ): Promise<ZoomMeetingListResponse> {
    return this.client.request<ZoomMeetingListResponse>(`/users/${encodeURIComponent(userId)}/meetings`, {
      params: {
        type: options.type,
        page_size: options.pageSize,
        page_number: options.pageNumber,
        next_page_token: options.nextPageToken,
      },
    });
  }

  /**
   * Get meeting details
   */
  async getMeeting(meetingId: string | number): Promise<ZoomMeetingDetail> {
    return this.client.request<ZoomMeetingDetail>(`/meetings/${meetingId}`);
  }

  /**
   * Create a meeting
   */
  async createMeeting(
    userId: string = 'me',
    meeting: ZoomMeetingCreateRequest
  ): Promise<ZoomMeetingDetail> {
    // Default to scheduled meeting if not specified
    const meetingData = {
      ...meeting,
      type: meeting.type ?? 2, // 2 = Scheduled meeting
    };

    return this.client.request<ZoomMeetingDetail>(`/users/${encodeURIComponent(userId)}/meetings`, {
      method: 'POST',
      body: meetingData,
    });
  }

  /**
   * Update a meeting
   */
  async updateMeeting(
    meetingId: string | number,
    updates: Partial<ZoomMeetingCreateRequest>
  ): Promise<void> {
    await this.client.request(`/meetings/${meetingId}`, {
      method: 'PATCH',
      body: updates,
    });
  }

  /**
   * Delete a meeting
   */
  async deleteMeeting(
    meetingId: string | number,
    options: {
      occurrenceId?: string;
      scheduleForReminder?: boolean;
      cancelMeetingReminder?: boolean;
    } = {}
  ): Promise<void> {
    await this.client.request(`/meetings/${meetingId}`, {
      method: 'DELETE',
      params: {
        occurrence_id: options.occurrenceId,
        schedule_for_reminder: options.scheduleForReminder,
        cancel_meeting_reminder: options.cancelMeetingReminder,
      },
    });
  }

  /**
   * End a meeting
   */
  async endMeeting(meetingId: string | number): Promise<void> {
    await this.client.request(`/meetings/${meetingId}/status`, {
      method: 'PUT',
      body: { action: 'end' },
    });
  }

  /**
   * List past meeting instances
   */
  async listPastMeetingInstances(meetingId: string | number): Promise<{ meetings: ZoomMeeting[] }> {
    return this.client.request<{ meetings: ZoomMeeting[] }>(`/past_meetings/${meetingId}/instances`);
  }

  /**
   * Get past meeting details
   */
  async getPastMeetingDetails(meetingUuid: string): Promise<ZoomMeetingDetail> {
    // Double URL encode the UUID as per Zoom API requirements
    const encodedUuid = encodeURIComponent(encodeURIComponent(meetingUuid));
    return this.client.request<ZoomMeetingDetail>(`/past_meetings/${encodedUuid}`);
  }
}
