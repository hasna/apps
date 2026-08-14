// Zoom Connector Types

// ============================================
// Configuration
// ============================================

export interface ZoomConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface ZoomTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextPageToken?: string;
  hasMore: boolean;
}

export interface ZoomPagination {
  page_count?: number;
  page_number?: number;
  page_size?: number;
  total_records?: number;
  next_page_token?: string;
}

// ============================================
// User Types
// ============================================

export interface ZoomUser {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  type: number; // 1=Basic, 2=Licensed, 3=On-prem
  status?: string;
  pmi?: number;
  timezone?: string;
  dept?: string;
  created_at?: string;
  last_login_time?: string;
  language?: string;
  phone_number?: string;
  pic_url?: string;
  role_name?: string;
  verified?: number;
  account_id?: string;
}

export interface ZoomUserListResponse extends ZoomPagination {
  users: ZoomUser[];
}

export interface ZoomMeResponse extends ZoomUser {
  account_number?: number;
  cms_user_id?: string;
  company?: string;
  host_key?: string;
  jid?: string;
  job_title?: string;
  location?: string;
  personal_meeting_url?: string;
  use_pmi?: boolean;
  vanity_url?: string;
}

// ============================================
// Meeting Types
// ============================================

export interface ZoomMeeting {
  uuid?: string;
  id: number;
  host_id?: string;
  topic: string;
  type: number; // 1=Instant, 2=Scheduled, 3=Recurring no fixed time, 8=Recurring fixed time
  start_time?: string;
  duration?: number;
  timezone?: string;
  created_at?: string;
  join_url?: string;
  start_url?: string;
  password?: string;
  agenda?: string;
  status?: string;
}

export interface ZoomMeetingListResponse extends ZoomPagination {
  meetings: ZoomMeeting[];
}

export interface ZoomMeetingCreateRequest {
  topic: string;
  type?: number;
  start_time?: string;
  duration?: number;
  timezone?: string;
  password?: string;
  agenda?: string;
  settings?: ZoomMeetingSettings;
}

export interface ZoomMeetingSettings {
  host_video?: boolean;
  participant_video?: boolean;
  join_before_host?: boolean;
  mute_upon_entry?: boolean;
  waiting_room?: boolean;
  auto_recording?: 'local' | 'cloud' | 'none';
  approval_type?: number;
  registration_type?: number;
  audio?: 'both' | 'telephony' | 'voip';
}

export interface ZoomMeetingDetail extends ZoomMeeting {
  settings?: ZoomMeetingSettings;
  recurrence?: ZoomRecurrence;
  occurrences?: ZoomOccurrence[];
}

export interface ZoomRecurrence {
  type: number; // 1=Daily, 2=Weekly, 3=Monthly
  repeat_interval?: number;
  weekly_days?: string;
  monthly_day?: number;
  monthly_week?: number;
  monthly_week_day?: number;
  end_times?: number;
  end_date_time?: string;
}

export interface ZoomOccurrence {
  occurrence_id: string;
  start_time: string;
  duration: number;
  status: string;
}

// ============================================
// Webinar Types
// ============================================

export interface ZoomWebinar {
  uuid?: string;
  id: number;
  host_id?: string;
  topic: string;
  type: number; // 5=Webinar, 6=Recurring webinar no fixed time, 9=Recurring webinar fixed time
  start_time?: string;
  duration?: number;
  timezone?: string;
  created_at?: string;
  join_url?: string;
  agenda?: string;
  status?: string;
}

export interface ZoomWebinarListResponse extends ZoomPagination {
  webinars: ZoomWebinar[];
}

export interface ZoomWebinarCreateRequest {
  topic: string;
  type?: number;
  start_time?: string;
  duration?: number;
  timezone?: string;
  password?: string;
  agenda?: string;
  settings?: ZoomWebinarSettings;
}

export interface ZoomWebinarSettings {
  host_video?: boolean;
  panelists_video?: boolean;
  practice_session?: boolean;
  hd_video?: boolean;
  approval_type?: number;
  registration_type?: number;
  audio?: 'both' | 'telephony' | 'voip';
  auto_recording?: 'local' | 'cloud' | 'none';
  on_demand?: boolean;
}

export interface ZoomWebinarDetail extends ZoomWebinar {
  settings?: ZoomWebinarSettings;
  recurrence?: ZoomRecurrence;
  occurrences?: ZoomOccurrence[];
}

// ============================================
// Recording Types
// ============================================

export interface ZoomRecording {
  uuid: string;
  id: number;
  account_id: string;
  host_id: string;
  topic: string;
  type: number;
  start_time: string;
  timezone?: string;
  duration: number;
  total_size?: number;
  recording_count?: number;
  share_url?: string;
  recording_files?: ZoomRecordingFile[];
}

export interface ZoomRecordingFile {
  id?: string;
  meeting_id?: string;
  recording_start?: string;
  recording_end?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  play_url?: string;
  download_url?: string;
  status?: string;
  recording_type?: string;
}

export interface ZoomRecordingListResponse extends ZoomPagination {
  from?: string;
  to?: string;
  meetings: ZoomRecording[];
}

// ============================================
// Report Types
// ============================================

export interface ZoomMeetingReport {
  uuid: string;
  id: number;
  topic: string;
  host: string;
  email: string;
  user_type: string;
  start_time: string;
  end_time: string;
  duration: string;
  participants: number;
  has_pstn: boolean;
  has_voip: boolean;
  has_3rd_party_audio: boolean;
  has_video: boolean;
  has_screen_share: boolean;
  has_recording: boolean;
  has_sip: boolean;
}

export interface ZoomReportMeetingsResponse extends ZoomPagination {
  from?: string;
  to?: string;
  meetings: ZoomMeetingReport[];
}

export interface ZoomParticipantReport {
  id?: string;
  user_id?: string;
  name?: string;
  user_email?: string;
  join_time?: string;
  leave_time?: string;
  duration?: number;
  attentiveness_score?: string;
  failover?: boolean;
  status?: string;
}

export interface ZoomReportParticipantsResponse extends ZoomPagination {
  participants: ZoomParticipantReport[];
}

// ============================================
// API Error Types
// ============================================

export interface ZoomApiErrorDetail {
  code: number;
  message: string;
}

export class ZoomApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;

  constructor(message: string, statusCode: number, code?: number) {
    super(message);
    this.name = 'ZoomApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
