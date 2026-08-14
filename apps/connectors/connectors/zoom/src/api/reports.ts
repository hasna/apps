import type { ZoomClient } from './client';
import type {
  ZoomMeetingReport,
  ZoomReportMeetingsResponse,
  ZoomParticipantReport,
  ZoomReportParticipantsResponse,
} from '../types';

/**
 * Zoom Reports API
 */
export class ReportsApi {
  private readonly client: ZoomClient;

  constructor(client: ZoomClient) {
    this.client = client;
  }

  /**
   * Get meeting reports for a user
   */
  async getMeetingReports(
    userId: string = 'me',
    options: {
      from: string; // YYYY-MM-DD (required)
      to: string; // YYYY-MM-DD (required)
      pageSize?: number;
      nextPageToken?: string;
      type?: 'past' | 'pastOne' | 'live';
    }
  ): Promise<ZoomReportMeetingsResponse> {
    return this.client.request<ZoomReportMeetingsResponse>(`/report/users/${encodeURIComponent(userId)}/meetings`, {
      params: {
        from: options.from,
        to: options.to,
        page_size: options.pageSize,
        next_page_token: options.nextPageToken,
        type: options.type,
      },
    });
  }

  /**
   * Get detailed report for a specific meeting
   */
  async getMeetingDetail(meetingId: string | number): Promise<ZoomMeetingReport> {
    return this.client.request<ZoomMeetingReport>(`/report/meetings/${meetingId}`);
  }

  /**
   * Get meeting participants report
   */
  async getMeetingParticipants(
    meetingId: string | number,
    options: {
      pageSize?: number;
      nextPageToken?: string;
      includeFields?: string;
    } = {}
  ): Promise<ZoomReportParticipantsResponse> {
    return this.client.request<ZoomReportParticipantsResponse>(`/report/meetings/${meetingId}/participants`, {
      params: {
        page_size: options.pageSize,
        next_page_token: options.nextPageToken,
        include_fields: options.includeFields,
      },
    });
  }

  /**
   * Get webinar reports for a user
   */
  async getWebinarReports(
    userId: string = 'me',
    options: {
      from: string; // YYYY-MM-DD (required)
      to: string; // YYYY-MM-DD (required)
      pageSize?: number;
      nextPageToken?: string;
      type?: 'past' | 'live';
    }
  ): Promise<ZoomReportMeetingsResponse> {
    return this.client.request<ZoomReportMeetingsResponse>(`/report/users/${encodeURIComponent(userId)}/webinars`, {
      params: {
        from: options.from,
        to: options.to,
        page_size: options.pageSize,
        next_page_token: options.nextPageToken,
        type: options.type,
      },
    });
  }

  /**
   * Get webinar detail report
   */
  async getWebinarDetail(webinarId: string | number): Promise<ZoomMeetingReport> {
    return this.client.request<ZoomMeetingReport>(`/report/webinars/${webinarId}`);
  }

  /**
   * Get webinar participants report
   */
  async getWebinarParticipants(
    webinarId: string | number,
    options: {
      pageSize?: number;
      nextPageToken?: string;
      includeFields?: string;
    } = {}
  ): Promise<ZoomReportParticipantsResponse> {
    return this.client.request<ZoomReportParticipantsResponse>(`/report/webinars/${webinarId}/participants`, {
      params: {
        page_size: options.pageSize,
        next_page_token: options.nextPageToken,
        include_fields: options.includeFields,
      },
    });
  }

  /**
   * Get daily usage report
   */
  async getDailyUsageReport(options: {
    year: number;
    month: number;
  }): Promise<{
    year: number;
    month: number;
    dates: Array<{
      date: string;
      new_users: number;
      meetings: number;
      participants: number;
      meeting_minutes: number;
    }>;
  }> {
    return this.client.request(`/report/daily`, {
      params: {
        year: options.year,
        month: options.month,
      },
    });
  }

  /**
   * Get account operation logs
   */
  async getOperationLogs(options: {
    from: string; // YYYY-MM-DD
    to: string; // YYYY-MM-DD
    pageSize?: number;
    nextPageToken?: string;
    categoryType?: string;
  }): Promise<{
    from: string;
    to: string;
    page_size: number;
    next_page_token?: string;
    operation_logs: Array<{
      time: string;
      operator: string;
      category_type: string;
      action: string;
      operation_detail: string;
    }>;
  }> {
    return this.client.request(`/report/operationlogs`, {
      params: {
        from: options.from,
        to: options.to,
        page_size: options.pageSize,
        next_page_token: options.nextPageToken,
        category_type: options.categoryType,
      },
    });
  }
}
