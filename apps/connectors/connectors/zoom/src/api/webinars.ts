import type { ZoomClient } from './client';
import type {
  ZoomWebinar,
  ZoomWebinarListResponse,
  ZoomWebinarDetail,
  ZoomWebinarCreateRequest,
} from '../types';

/**
 * Zoom Webinars API
 */
export class WebinarsApi {
  private readonly client: ZoomClient;

  constructor(client: ZoomClient) {
    this.client = client;
  }

  /**
   * List webinars for a user
   */
  async listWebinars(
    userId: string = 'me',
    options: {
      type?: 'scheduled' | 'upcoming';
      pageSize?: number;
      pageNumber?: number;
      nextPageToken?: string;
    } = {}
  ): Promise<ZoomWebinarListResponse> {
    return this.client.request<ZoomWebinarListResponse>(`/users/${encodeURIComponent(userId)}/webinars`, {
      params: {
        type: options.type,
        page_size: options.pageSize,
        page_number: options.pageNumber,
        next_page_token: options.nextPageToken,
      },
    });
  }

  /**
   * Get webinar details
   */
  async getWebinar(webinarId: string | number): Promise<ZoomWebinarDetail> {
    return this.client.request<ZoomWebinarDetail>(`/webinars/${webinarId}`);
  }

  /**
   * Create a webinar
   */
  async createWebinar(
    userId: string = 'me',
    webinar: ZoomWebinarCreateRequest
  ): Promise<ZoomWebinarDetail> {
    // Default to webinar type if not specified
    const webinarData = {
      ...webinar,
      type: webinar.type ?? 5, // 5 = Webinar
    };

    return this.client.request<ZoomWebinarDetail>(`/users/${encodeURIComponent(userId)}/webinars`, {
      method: 'POST',
      body: webinarData,
    });
  }

  /**
   * Update a webinar
   */
  async updateWebinar(
    webinarId: string | number,
    updates: Partial<ZoomWebinarCreateRequest>
  ): Promise<void> {
    await this.client.request(`/webinars/${webinarId}`, {
      method: 'PATCH',
      body: updates,
    });
  }

  /**
   * Delete a webinar
   */
  async deleteWebinar(
    webinarId: string | number,
    options: {
      occurrenceId?: string;
      cancelWebinarReminder?: boolean;
    } = {}
  ): Promise<void> {
    await this.client.request(`/webinars/${webinarId}`, {
      method: 'DELETE',
      params: {
        occurrence_id: options.occurrenceId,
        cancel_webinar_reminder: options.cancelWebinarReminder,
      },
    });
  }

  /**
   * End a webinar
   */
  async endWebinar(webinarId: string | number): Promise<void> {
    await this.client.request(`/webinars/${webinarId}/status`, {
      method: 'PUT',
      body: { action: 'end' },
    });
  }

  /**
   * List past webinar instances
   */
  async listPastWebinarInstances(webinarId: string | number): Promise<{ webinars: ZoomWebinar[] }> {
    return this.client.request<{ webinars: ZoomWebinar[] }>(`/past_webinars/${webinarId}/instances`);
  }
}
