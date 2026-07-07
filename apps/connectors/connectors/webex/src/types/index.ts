export type OutputFormat = 'json' | 'table' | 'pretty';

export interface WebexConfig {
  accessToken: string;
  baseUrl?: string;
}

export interface ProfileConfig {
  accessToken?: string;
}

export class WebexApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly trackingId?: string,
  ) {
    super(message);
    this.name = 'WebexApiError';
  }
}

export function parseWebexError(data: unknown, statusCode: number): WebexApiError {
  if (typeof data === 'object' && data !== null) {
    const err = data as Record<string, unknown>;
    const message = (err.message as string) || `Webex API Error: ${statusCode}`;
    const trackingId = err.trackingId as string | undefined;
    return new WebexApiError(message, statusCode, trackingId);
  }
  return new WebexApiError(`Webex API Error: ${statusCode}`, statusCode);
}

export interface PaginatedResponse<T> {
  items: T[];
}

export interface ListOptions {
  max?: number;
}

export interface WebexRoom {
  id: string;
  title: string;
  type: 'direct' | 'group';
  isLocked?: boolean;
  lastActivity?: string;
  creatorId?: string;
  created?: string;
  isAnnouncementOnly?: boolean;
  isPublic?: boolean;
  isReadOnly?: boolean;
  description?: string;
  teamId?: string;
}

export interface WebexRoomCreateRequest {
  title: string;
  teamId?: string;
  description?: string;
  isPublic?: boolean;
  isReadOnly?: boolean;
  isAnnouncementOnly?: boolean;
}

export interface WebexRoomUpdateRequest {
  title?: string;
  description?: string;
  isLocked?: boolean;
  isPublic?: boolean;
  isReadOnly?: boolean;
  isAnnouncementOnly?: boolean;
}

export interface WebexMembership {
  id: string;
  roomId: string;
  personId: string;
  personEmail: string;
  personDisplayName?: string;
  personOrgId?: string;
  isModerator?: boolean;
  isMonitor?: boolean;
  created?: string;
}

export interface WebexMembershipCreateRequest {
  roomId: string;
  personId?: string;
  personEmail?: string;
  isModerator?: boolean;
}

export interface WebexMembershipUpdateRequest {
  isModerator?: boolean;
  isMonitor?: boolean;
}

export interface WebexMessage {
  id: string;
  roomId: string;
  personId?: string;
  personEmail?: string;
  created?: string;
  text?: string;
  markdown?: string;
  html?: string;
  files?: WebexMessageFile[];
}

export interface WebexMessageFile {
  url: string;
  filename?: string;
}

export interface WebexMessageCreateRequest {
  roomId: string;
  text?: string;
  markdown?: string;
  parentId?: string;
  files?: string[];
}

export interface WebexPerson {
  id: string;
  emails?: string[];
  displayName?: string;
  nickName?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  orgId?: string;
  created?: string;
  lastActivity?: string;
  status?: string;
  type?: string;
}

export interface WebexPersonCreateRequest {
  emails: string[];
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export interface WebexPersonUpdateRequest {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
}

export interface WebexTeam {
  id: string;
  name: string;
  creatorId?: string;
  created?: string;
}

export interface WebexTeamCreateRequest {
  name: string;
}

export interface WebexTeamUpdateRequest {
  name: string;
}

export interface WebexMeeting {
  id: string;
  meetingNumber?: string;
  title: string;
  agenda?: string;
  password?: string;
  phoneAndVideoSystemPassword?: string;
  meetingType?: string;
  state?: string;
  timezone?: string;
  start?: string;
  end?: string;
  hostUserId?: string;
  hostDisplayName?: string;
  hostEmail?: string;
  siteUrl?: string;
  webLink?: string;
  sipAddress?: string;
  dialInIpAddress?: string;
  enabledAutoRecordMeeting?: boolean;
  allowAnyUserToBeCoHost?: boolean;
  enabledJoinBeforeHost?: boolean;
  publicMeeting?: boolean;
  invitees?: WebexMeetingInvitee[];
}

export interface WebexMeetingInvitee {
  email: string;
  displayName?: string;
  coHost?: boolean;
}

export interface WebexMeetingCreateRequest {
  title: string;
  agenda?: string;
  password?: string;
  start: string;
  end: string;
  timezone?: string;
  invitees?: WebexMeetingInvitee[];
  enabledAutoRecordMeeting?: boolean;
  allowAnyUserToBeCoHost?: boolean;
  enabledJoinBeforeHost?: boolean;
  publicMeeting?: boolean;
}

export interface WebexMeetingUpdateRequest {
  title?: string;
  agenda?: string;
  start?: string;
  end?: string;
  timezone?: string;
  invitees?: WebexMeetingInvitee[];
  enabledAutoRecordMeeting?: boolean;
  allowAnyUserToBeCoHost?: boolean;
  enabledJoinBeforeHost?: boolean;
  publicMeeting?: boolean;
}

export interface WebexRecording {
  id: string;
  meetingId?: string;
  scheduledMeetingId?: string;
  meetingSeriesId?: string;
  topic?: string;
  createTime?: string;
  timeRecorded?: string;
  hostEmail?: string;
  siteUrl?: string;
  playbackUrl?: string;
  downloadUrl?: string;
  audioDownloadUrl?: string;
  password?: string;
  format?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  shareToMe?: boolean;
  serviceType?: string;
  status?: string;
}

export interface WebexWebhook {
  id: string;
  name: string;
  targetUrl: string;
  resource: string;
  event: string;
  filter?: string;
  secret?: string;
  ownedBy?: string;
  status?: string;
  created?: string;
}

export interface WebexWebhookCreateRequest {
  name: string;
  targetUrl: string;
  resource: string;
  event: string;
  filter?: string;
  secret?: string;
}

export interface WebexWebhookUpdateRequest {
  name?: string;
  targetUrl?: string;
  resource?: string;
  event?: string;
  filter?: string;
  secret?: string;
  status?: string;
}

export interface ListRoomsOptions extends ListOptions {
  type?: 'direct' | 'group';
  sortBy?: 'id' | 'lastactivity' | 'created';
  max?: number;
}

export interface ListMembershipsOptions extends ListOptions {
  roomId?: string;
  personId?: string;
  personEmail?: string;
}

export interface ListMessagesOptions extends ListOptions {
  roomId: string;
  parentId?: string;
  mentionedPeople?: string;
  before?: string;
  beforeMessage?: string;
}

export interface ListPeopleOptions extends ListOptions {
  email?: string;
  displayName?: string;
  id?: string;
  orgId?: string;
}

export interface ListMeetingsOptions extends ListOptions {
  meetingNumber?: string;
  webLink?: string;
  from?: string;
  to?: string;
  hostEmail?: string;
  siteUrl?: string;
}

export interface ListRecordingsOptions extends ListOptions {
  from?: string;
  to?: string;
  hostEmail?: string;
  topic?: string;
  serviceType?: string;
}

export interface ListWebhooksOptions extends ListOptions {
  max?: number;
}
