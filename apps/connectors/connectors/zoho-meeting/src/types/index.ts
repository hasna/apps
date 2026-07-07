export type ZohoMeetingDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export interface ZohoMeetingConfig {
  token: string;
  dataCenter?: ZohoMeetingDataCenter | string;
  baseUrl?: string;
}

export class ZohoMeetingApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ZohoMeetingApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ZohoMeetingParticipantInput {
  email: string;
  name?: string;
}

export interface ZohoMeetingSessionCreateInput {
  topic: string;
  agenda?: string;
  startTime: string;
  duration: number;
  timezone?: string;
  participants?: ZohoMeetingParticipantInput[];
  recurringDetails?: Record<string, unknown>;
  isMuteAttendee?: boolean;
  isVideoOff?: boolean;
  autoStartRecording?: boolean;
  coHostEmails?: string[];
}

export interface ZohoMeetingSessionUpdateInput {
  topic?: string;
  agenda?: string;
  startTime?: string;
  duration?: number;
  timezone?: string;
}

export interface ZohoMeetingWebinarCreateInput {
  topic: string;
  agenda?: string;
  startTime: string;
  duration: number;
  timezone?: string;
  registrationRequired?: boolean;
  isRegistrationApprovalRequired?: boolean;
  coOrganizerEmails?: string[];
  panelists?: ZohoMeetingParticipantInput[];
  autoStartRecording?: boolean;
}

export interface ZohoMeetingWebinarUpdateInput {
  topic?: string;
  agenda?: string;
  startTime?: string;
  duration?: number;
  timezone?: string;
}

export interface ZohoMeetingRegistrantInput {
  email: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  customFields?: Record<string, unknown>;
}

export type OutputFormat = 'json' | 'table' | 'pretty';
