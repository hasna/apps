import type { ZoomClient } from './client';
import type {
  ZoomRecording,
  ZoomRecordingListResponse,
} from '../types';

/**
 * Zoom Cloud Recordings API
 */
export class RecordingsApi {
  private readonly client: ZoomClient;

  constructor(client: ZoomClient) {
    this.client = client;
  }

  /**
   * List recordings for a user
   */
  async listRecordings(
    userId: string = 'me',
    options: {
      from?: string; // YYYY-MM-DD
      to?: string; // YYYY-MM-DD
      pageSize?: number;
      nextPageToken?: string;
      mc?: string; // Meeting center
      trash?: boolean;
      trashType?: 'meeting_recordings' | 'recording_file';
    } = {}
  ): Promise<ZoomRecordingListResponse> {
    return this.client.request<ZoomRecordingListResponse>(`/users/${encodeURIComponent(userId)}/recordings`, {
      params: {
        from: options.from,
        to: options.to,
        page_size: options.pageSize,
        next_page_token: options.nextPageToken,
        mc: options.mc,
        trash: options.trash,
        trash_type: options.trashType,
      },
    });
  }

  /**
   * Get recording details for a meeting
   */
  async getRecording(meetingId: string | number): Promise<ZoomRecording> {
    return this.client.request<ZoomRecording>(`/meetings/${meetingId}/recordings`);
  }

  /**
   * Delete all recordings for a meeting
   */
  async deleteRecording(
    meetingId: string | number,
    options: {
      action?: 'trash' | 'delete';
    } = {}
  ): Promise<void> {
    await this.client.request(`/meetings/${meetingId}/recordings`, {
      method: 'DELETE',
      params: {
        action: options.action || 'trash',
      },
    });
  }

  /**
   * Delete a specific recording file
   */
  async deleteRecordingFile(
    meetingId: string | number,
    recordingId: string,
    options: {
      action?: 'trash' | 'delete';
    } = {}
  ): Promise<void> {
    await this.client.request(`/meetings/${meetingId}/recordings/${recordingId}`, {
      method: 'DELETE',
      params: {
        action: options.action || 'trash',
      },
    });
  }

  /**
   * Recover recordings from trash
   */
  async recoverRecordings(meetingUuid: string): Promise<void> {
    // Double URL encode the UUID as per Zoom API requirements
    const encodedUuid = encodeURIComponent(encodeURIComponent(meetingUuid));
    await this.client.request(`/meetings/${encodedUuid}/recordings/status`, {
      method: 'PUT',
      body: { action: 'recover' },
    });
  }

  /**
   * Get recording settings
   */
  async getRecordingSettings(meetingId: string | number): Promise<Record<string, unknown>> {
    return this.client.request<Record<string, unknown>>(`/meetings/${meetingId}/recordings/settings`);
  }

  /**
   * Update recording settings
   */
  async updateRecordingSettings(
    meetingId: string | number,
    settings: {
      share_recording?: 'publicly' | 'internally' | 'none';
      recording_authentication?: boolean;
      authentication_option?: string;
      authentication_domains?: string;
      viewer_download?: boolean;
      password?: string;
      on_demand?: boolean;
      approval_type?: number;
      send_email_to_host?: boolean;
      show_social_share_buttons?: boolean;
    }
  ): Promise<void> {
    await this.client.request(`/meetings/${meetingId}/recordings/settings`, {
      method: 'PATCH',
      body: settings,
    });
  }
}
