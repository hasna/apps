// Google Calendar Connector Types

// ============================================
// Configuration
// ============================================

export interface GoogleCalendarConfig {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  items: T[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

// ============================================
// Calendar Types
// ============================================

export interface Calendar {
  kind: 'calendar#calendarListEntry';
  etag: string;
  id: string;
  summary: string;
  description?: string;
  location?: string;
  timeZone?: string;
  summaryOverride?: string;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  hidden?: boolean;
  selected?: boolean;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  defaultReminders?: EventReminder[];
  notificationSettings?: {
    notifications: CalendarNotification[];
  };
  primary?: boolean;
  deleted?: boolean;
  conferenceProperties?: ConferenceProperties;
}

export interface CalendarNotification {
  type: 'eventCreation' | 'eventChange' | 'eventCancellation' | 'eventResponse' | 'agenda';
  method: 'email' | 'sms';
}

export interface ConferenceProperties {
  allowedConferenceSolutionTypes: string[];
}

export interface CalendarListResponse {
  kind: 'calendar#calendarList';
  etag: string;
  nextPageToken?: string;
  nextSyncToken?: string;
  items: Calendar[];
}

// ============================================
// Event Types
// ============================================

export interface Event {
  kind: 'calendar#event';
  etag: string;
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  creator?: EventPerson;
  organizer?: EventPerson;
  start: EventDateTime;
  end: EventDateTime;
  endTimeUnspecified?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: EventDateTime;
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  iCalUID?: string;
  sequence?: number;
  attendees?: EventAttendee[];
  attendeesOmitted?: boolean;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
  hangoutLink?: string;
  conferenceData?: ConferenceData;
  gadget?: EventGadget;
  anyoneCanAddSelf?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  privateCopy?: boolean;
  locked?: boolean;
  reminders?: {
    useDefault: boolean;
    overrides?: EventReminder[];
  };
  source?: {
    url: string;
    title: string;
  };
  attachments?: EventAttachment[];
  eventType?: 'default' | 'outOfOffice' | 'focusTime' | 'workingLocation';
}

export interface EventPerson {
  id?: string;
  email?: string;
  displayName?: string;
  self?: boolean;
}

export interface EventDateTime {
  date?: string; // YYYY-MM-DD for all-day events
  dateTime?: string; // RFC3339 timestamp
  timeZone?: string;
}

export interface EventAttendee {
  id?: string;
  email: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  optional?: boolean;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  comment?: string;
  additionalGuests?: number;
}

export interface EventReminder {
  method: 'email' | 'popup';
  minutes: number;
}

export interface EventAttachment {
  fileUrl: string;
  title?: string;
  mimeType?: string;
  iconLink?: string;
  fileId?: string;
}

export interface ConferenceData {
  createRequest?: {
    requestId: string;
    conferenceSolutionKey: {
      type: string;
    };
    status?: {
      statusCode: 'pending' | 'success' | 'failure';
    };
  };
  entryPoints?: ConferenceEntryPoint[];
  conferenceSolution?: {
    key: {
      type: string;
    };
    name: string;
    iconUri: string;
  };
  conferenceId?: string;
  signature?: string;
  notes?: string;
}

export interface ConferenceEntryPoint {
  entryPointType: 'video' | 'phone' | 'sip' | 'more';
  uri: string;
  label?: string;
  pin?: string;
  accessCode?: string;
  meetingCode?: string;
  passcode?: string;
  password?: string;
}

export interface EventGadget {
  type?: string;
  title?: string;
  link?: string;
  iconLink?: string;
  width?: number;
  height?: number;
  display?: 'icon' | 'chip';
  preferences?: Record<string, string>;
}

export interface EventListResponse {
  kind: 'calendar#events';
  etag: string;
  summary?: string;
  description?: string;
  updated?: string;
  timeZone?: string;
  accessRole?: string;
  defaultReminders?: EventReminder[];
  nextPageToken?: string;
  nextSyncToken?: string;
  items: Event[];
}

// ============================================
// API Request Types
// ============================================

export interface ListCalendarsParams {
  maxResults?: number;
  minAccessRole?: 'freeBusyReader' | 'owner' | 'reader' | 'writer';
  pageToken?: string;
  showDeleted?: boolean;
  showHidden?: boolean;
  syncToken?: string;
}

export interface ListEventsParams {
  calendarId?: string;
  iCalUID?: string;
  maxAttendees?: number;
  maxResults?: number;
  orderBy?: 'startTime' | 'updated';
  pageToken?: string;
  privateExtendedProperty?: string;
  q?: string;
  sharedExtendedProperty?: string;
  showDeleted?: boolean;
  showHiddenInvitations?: boolean;
  singleEvents?: boolean;
  syncToken?: string;
  timeMax?: string;
  timeMin?: string;
  timeZone?: string;
  updatedMin?: string;
}

export interface CreateEventParams {
  calendarId?: string;
  conferenceDataVersion?: number;
  maxAttendees?: number;
  sendNotifications?: boolean;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
  supportsAttachments?: boolean;
}

export interface UpdateEventParams extends CreateEventParams {
  eventId: string;
}

export interface DeleteEventParams {
  calendarId?: string;
  eventId: string;
  sendNotifications?: boolean;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

// ============================================
// Event Input Types
// ============================================

export interface EventInput {
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: EventDateTime;
  end: EventDateTime;
  recurrence?: string[];
  attendees?: Pick<EventAttendee, 'email' | 'displayName' | 'optional'>[];
  reminders?: {
    useDefault: boolean;
    overrides?: EventReminder[];
  };
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  transparency?: 'opaque' | 'transparent';
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  domain: string;
  reason: string;
  message: string;
  locationType?: string;
  location?: string;
}

export interface GoogleApiErrorResponse {
  error: {
    code: number;
    message: string;
    errors: ApiErrorDetail[];
    status?: string;
  };
}

export class GoogleCalendarApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
