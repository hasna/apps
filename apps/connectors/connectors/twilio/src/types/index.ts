// Twilio Connect Types

// ============================================
// Configuration
// ============================================

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  first_page_uri: string;
  end: number;
  previous_page_uri: string | null;
  uri: string;
  page_size: number;
  start: number;
  next_page_uri: string | null;
  page: number;
  [key: string]: T[] | string | number | null | undefined;
}

// ============================================
// Message Types
// ============================================

export type MessageStatus =
  | 'accepted'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'delivered'
  | 'undelivered'
  | 'receiving'
  | 'received'
  | 'read';

export type MessageDirection = 'inbound' | 'outbound-api' | 'outbound-call' | 'outbound-reply';

export interface Message {
  account_sid: string;
  api_version: string;
  body: string;
  date_created: string;
  date_sent: string | null;
  date_updated: string;
  direction: MessageDirection;
  error_code: number | null;
  error_message: string | null;
  from: string;
  messaging_service_sid: string | null;
  num_media: string;
  num_segments: string;
  price: string | null;
  price_unit: string | null;
  sid: string;
  status: MessageStatus;
  subresource_uris: {
    media: string;
    feedback: string;
  };
  to: string;
  uri: string;
}

export interface MessageListResponse {
  end: number;
  first_page_uri: string;
  messages: Message[];
  next_page_uri: string | null;
  page: number;
  page_size: number;
  previous_page_uri: string | null;
  start: number;
  uri: string;
}

export interface SendMessageParams {
  To: string;
  From?: string;
  MessagingServiceSid?: string;
  Body?: string;
  MediaUrl?: string[];
  StatusCallback?: string;
  MaxPrice?: string;
  ValidityPeriod?: number;
  ForceDelivery?: boolean;
  ContentRetention?: 'retain' | 'discard';
  AddressRetention?: 'retain' | 'obfuscate';
  SmartEncoded?: boolean;
  PersistentAction?: string[];
  ShortenUrls?: boolean;
  ScheduleType?: 'fixed';
  SendAt?: string;
  SendAsMms?: boolean;
  ContentSid?: string;
  ContentVariables?: string;
  RiskCheck?: 'enable' | 'disable';
}

export interface ListMessagesParams {
  To?: string;
  From?: string;
  DateSent?: string;
  DateSentBefore?: string;
  DateSentAfter?: string;
  PageSize?: number;
  Page?: number;
  PageToken?: string;
}

// ============================================
// Call Types
// ============================================

export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'canceled'
  | 'completed'
  | 'failed'
  | 'busy'
  | 'no-answer';

export type CallDirection = 'inbound' | 'outbound-api' | 'outbound-dial';

export interface Call {
  account_sid: string;
  annotation: string | null;
  answered_by: string | null;
  api_version: string;
  caller_name: string | null;
  date_created: string;
  date_updated: string;
  direction: CallDirection;
  duration: string | null;
  end_time: string | null;
  forwarded_from: string | null;
  from: string;
  from_formatted: string;
  group_sid: string | null;
  parent_call_sid: string | null;
  phone_number_sid: string;
  price: string | null;
  price_unit: string | null;
  queue_time: string;
  sid: string;
  start_time: string | null;
  status: CallStatus;
  subresource_uris: {
    notifications: string;
    recordings: string;
    streams: string;
    payments: string;
    siprec: string;
    events: string;
    feedback: string;
    feedback_summaries: string;
    user_defined_messages: string;
    user_defined_message_subscriptions: string;
    transcriptions: string;
  };
  to: string;
  to_formatted: string;
  trunk_sid: string | null;
  uri: string;
}

export interface CallListResponse {
  calls: Call[];
  end: number;
  first_page_uri: string;
  next_page_uri: string | null;
  page: number;
  page_size: number;
  previous_page_uri: string | null;
  start: number;
  uri: string;
}

export interface MakeCallParams {
  To: string;
  From: string;
  Url?: string;
  Twiml?: string;
  ApplicationSid?: string;
  Method?: 'GET' | 'POST';
  FallbackUrl?: string;
  FallbackMethod?: 'GET' | 'POST';
  StatusCallback?: string;
  StatusCallbackEvent?: string[];
  StatusCallbackMethod?: 'GET' | 'POST';
  SendDigits?: string;
  Timeout?: number;
  Record?: boolean;
  RecordingChannels?: 'mono' | 'dual';
  RecordingStatusCallback?: string;
  RecordingStatusCallbackMethod?: 'GET' | 'POST';
  SipAuthUsername?: string;
  SipAuthPassword?: string;
  MachineDetection?: 'Enable' | 'DetectMessageEnd';
  MachineDetectionTimeout?: number;
  AsyncAmd?: boolean;
  AsyncAmdStatusCallback?: string;
  AsyncAmdStatusCallbackMethod?: 'GET' | 'POST';
  Byoc?: string;
  CallReason?: string;
  CallToken?: string;
  RecordingTrack?: 'inbound' | 'outbound' | 'both';
  TimeLimit?: number;
  MaxPricePerMinute?: string;
}

export interface UpdateCallParams {
  Url?: string;
  Method?: 'GET' | 'POST';
  Status?: 'canceled' | 'completed';
  FallbackUrl?: string;
  FallbackMethod?: 'GET' | 'POST';
  StatusCallback?: string;
  StatusCallbackMethod?: 'GET' | 'POST';
  Twiml?: string;
  TimeLimit?: number;
}

export interface ListCallsParams {
  To?: string;
  From?: string;
  ParentCallSid?: string;
  Status?: CallStatus;
  StartTime?: string;
  StartTimeBefore?: string;
  StartTimeAfter?: string;
  EndTime?: string;
  EndTimeBefore?: string;
  EndTimeAfter?: string;
  PageSize?: number;
  Page?: number;
  PageToken?: string;
}

// ============================================
// Phone Number Types
// ============================================

export interface IncomingPhoneNumber {
  account_sid: string;
  address_sid: string | null;
  address_requirements: 'none' | 'any' | 'local' | 'foreign';
  api_version: string;
  beta: boolean;
  bundle_sid: string | null;
  capabilities: {
    voice: boolean;
    SMS: boolean;
    MMS: boolean;
    fax: boolean;
  };
  date_created: string;
  date_updated: string;
  emergency_address_sid: string | null;
  emergency_address_status: 'registered' | 'unregistered' | 'pending-registration' | 'registration-failure' | 'pending-unregistration' | 'unregistration-failure';
  emergency_status: 'Active' | 'Inactive';
  friendly_name: string;
  identity_sid: string | null;
  origin: 'twilio' | 'hosted';
  phone_number: string;
  sid: string;
  sms_application_sid: string | null;
  sms_fallback_method: 'GET' | 'POST';
  sms_fallback_url: string | null;
  sms_method: 'GET' | 'POST';
  sms_url: string | null;
  status_callback: string | null;
  status_callback_method: 'GET' | 'POST';
  trunk_sid: string | null;
  uri: string;
  voice_application_sid: string | null;
  voice_caller_id_lookup: boolean;
  voice_fallback_method: 'GET' | 'POST';
  voice_fallback_url: string | null;
  voice_method: 'GET' | 'POST';
  voice_receive_mode: 'voice' | 'fax';
  voice_url: string | null;
  subresource_uris: {
    assigned_add_ons: string;
  };
}

export interface IncomingPhoneNumberListResponse {
  end: number;
  first_page_uri: string;
  incoming_phone_numbers: IncomingPhoneNumber[];
  next_page_uri: string | null;
  page: number;
  page_size: number;
  previous_page_uri: string | null;
  start: number;
  uri: string;
}

export interface AvailablePhoneNumber {
  address_requirements: 'none' | 'any' | 'local' | 'foreign';
  beta: boolean;
  capabilities: {
    voice: boolean;
    SMS: boolean;
    MMS: boolean;
    fax: boolean;
  };
  friendly_name: string;
  iso_country: string;
  lata: string | null;
  latitude: string | null;
  locality: string | null;
  longitude: string | null;
  phone_number: string;
  postal_code: string | null;
  rate_center: string | null;
  region: string | null;
}

export interface AvailablePhoneNumberListResponse {
  available_phone_numbers: AvailablePhoneNumber[];
  end: number;
  first_page_uri: string;
  next_page_uri: string | null;
  page: number;
  page_size: number;
  previous_page_uri: string | null;
  start: number;
  uri: string;
}

export interface SearchAvailableNumbersParams {
  AreaCode?: string;
  Contains?: string;
  SmsEnabled?: boolean;
  MmsEnabled?: boolean;
  VoiceEnabled?: boolean;
  FaxEnabled?: boolean;
  ExcludeAllAddressRequired?: boolean;
  ExcludeLocalAddressRequired?: boolean;
  ExcludeForeignAddressRequired?: boolean;
  Beta?: boolean;
  NearNumber?: string;
  NearLatLong?: string;
  Distance?: number;
  InPostalCode?: string;
  InRegion?: string;
  InRateCenter?: string;
  InLata?: string;
  InLocality?: string;
  PageSize?: number;
  Page?: number;
}

export interface BuyPhoneNumberParams {
  PhoneNumber?: string;
  AreaCode?: string;
  FriendlyName?: string;
  SmsApplicationSid?: string;
  SmsFallbackMethod?: 'GET' | 'POST';
  SmsFallbackUrl?: string;
  SmsMethod?: 'GET' | 'POST';
  SmsUrl?: string;
  StatusCallback?: string;
  StatusCallbackMethod?: 'GET' | 'POST';
  VoiceApplicationSid?: string;
  VoiceCallerIdLookup?: boolean;
  VoiceFallbackMethod?: 'GET' | 'POST';
  VoiceFallbackUrl?: string;
  VoiceMethod?: 'GET' | 'POST';
  VoiceReceiveMode?: 'voice' | 'fax';
  VoiceUrl?: string;
  IdentitySid?: string;
  AddressSid?: string;
  EmergencyStatus?: 'Active' | 'Inactive';
  EmergencyAddressSid?: string;
  TrunkSid?: string;
  BundleSid?: string;
}

export interface UpdatePhoneNumberParams {
  AccountSid?: string;
  FriendlyName?: string;
  SmsApplicationSid?: string;
  SmsFallbackMethod?: 'GET' | 'POST';
  SmsFallbackUrl?: string;
  SmsMethod?: 'GET' | 'POST';
  SmsUrl?: string;
  StatusCallback?: string;
  StatusCallbackMethod?: 'GET' | 'POST';
  VoiceApplicationSid?: string;
  VoiceCallerIdLookup?: boolean;
  VoiceFallbackMethod?: 'GET' | 'POST';
  VoiceFallbackUrl?: string;
  VoiceMethod?: 'GET' | 'POST';
  VoiceReceiveMode?: 'voice' | 'fax';
  VoiceUrl?: string;
  EmergencyStatus?: 'Active' | 'Inactive';
  EmergencyAddressSid?: string;
  TrunkSid?: string;
  IdentitySid?: string;
  AddressSid?: string;
  BundleSid?: string;
}

// ============================================
// Verify Types
// ============================================

export interface VerifyService {
  sid: string;
  account_sid: string;
  friendly_name: string;
  code_length: number;
  lookup_enabled: boolean;
  psd2_enabled: boolean;
  skip_sms_to_landlines: boolean;
  dtmf_input_required: boolean;
  tts_name: string | null;
  mailer_sid: string | null;
  do_not_share_warning_enabled: boolean;
  custom_code_enabled: boolean;
  push_include_date: boolean;
  push_apn_credential_sid: string | null;
  push_fcm_credential_sid: string | null;
  totp_issuer: string | null;
  totp_time_step: number;
  totp_code_length: number;
  totp_skew: number;
  default_template_sid: string | null;
  verify_event_subscription_enabled: boolean;
  whatsapp_msg_service_sid: string | null;
  date_created: string;
  date_updated: string;
  url: string;
  links: {
    verification_checks: string;
    verifications: string;
    rate_limits: string;
    messaging_configurations: string;
    entities: string;
    webhooks: string;
    access_tokens: string;
  };
}

export interface VerifyServiceListResponse {
  services: VerifyService[];
  meta: {
    page: number;
    page_size: number;
    first_page_url: string;
    previous_page_url: string | null;
    url: string;
    next_page_url: string | null;
    key: string;
  };
}

export interface Verification {
  sid: string;
  service_sid: string;
  account_sid: string;
  to: string;
  channel: 'sms' | 'call' | 'email' | 'whatsapp';
  status: 'pending' | 'approved' | 'canceled' | 'max_attempts_reached' | 'deleted' | 'failed' | 'expired';
  valid: boolean;
  amount: string | null;
  payee: string | null;
  send_code_attempts: Array<{
    attempt_sid: string;
    channel: string;
    channel_id: string | null;
    time: string;
  }>;
  date_created: string;
  date_updated: string;
  lookup: {
    carrier: {
      error_code: number | null;
      name: string | null;
      mobile_country_code: string | null;
      mobile_network_code: string | null;
      type: string | null;
    } | null;
  } | null;
  url: string;
  sna: {
    url: string | null;
  } | null;
}

export interface VerificationCheck {
  sid: string;
  service_sid: string;
  account_sid: string;
  to: string;
  channel: 'sms' | 'call' | 'email' | 'whatsapp';
  status: 'pending' | 'approved' | 'canceled' | 'max_attempts_reached' | 'deleted' | 'failed' | 'expired';
  valid: boolean;
  amount: string | null;
  payee: string | null;
  date_created: string;
  date_updated: string;
}

export interface CreateVerificationParams {
  To: string;
  Channel: 'sms' | 'call' | 'email' | 'whatsapp';
  CustomFriendlyName?: string;
  CustomMessage?: string;
  SendDigits?: string;
  Locale?: string;
  CustomCode?: string;
  Amount?: string;
  Payee?: string;
  RateLimits?: Record<string, string>;
  ChannelConfiguration?: Record<string, string>;
  AppHash?: string;
  TemplateSid?: string;
  TemplateCustomSubstitutions?: string;
}

export interface CheckVerificationParams {
  Code?: string;
  To?: string;
  VerificationSid?: string;
  Amount?: string;
  Payee?: string;
}

// ============================================
// Conversation Types
// ============================================

export type ConversationState = 'active' | 'inactive' | 'closed';

export interface Conversation {
  account_sid: string;
  chat_service_sid: string;
  messaging_service_sid: string | null;
  sid: string;
  friendly_name: string | null;
  unique_name: string | null;
  attributes: string;
  state: ConversationState;
  date_created: string;
  date_updated: string;
  timers: {
    date_inactive: string | null;
    date_closed: string | null;
  };
  bindings: Record<string, unknown> | null;
  url: string;
  links: {
    participants: string;
    messages: string;
    webhooks: string;
  };
}

export interface ConversationListResponse {
  conversations: Conversation[];
  meta: {
    page: number;
    page_size: number;
    first_page_url: string;
    previous_page_url: string | null;
    url: string;
    next_page_url: string | null;
    key: string;
  };
}

export interface ConversationMessage {
  account_sid: string;
  conversation_sid: string;
  sid: string;
  index: number;
  author: string;
  body: string | null;
  media: Array<{
    sid: string;
    content_type: string;
    filename: string;
    size: number;
  }> | null;
  attributes: string;
  participant_sid: string | null;
  date_created: string;
  date_updated: string;
  delivery: {
    total: number;
    sent: string;
    delivered: string;
    read: string;
    failed: string;
    undelivered: string;
  } | null;
  content_sid: string | null;
  url: string;
  links: {
    delivery_receipts: string;
    channel_metadata: string;
  };
}

export interface ConversationParticipant {
  account_sid: string;
  conversation_sid: string;
  sid: string;
  identity: string | null;
  attributes: string;
  messaging_binding: {
    type: string;
    address: string;
    proxy_address: string;
  } | null;
  role_sid: string | null;
  date_created: string;
  date_updated: string;
  url: string;
  last_read_message_index: number | null;
  last_read_timestamp: string | null;
}

export interface CreateConversationParams {
  FriendlyName?: string;
  UniqueName?: string;
  Attributes?: string;
  MessagingServiceSid?: string;
  DateCreated?: string;
  DateUpdated?: string;
  State?: ConversationState;
  'Timers.Inactive'?: string;
  'Timers.Closed'?: string;
  'Bindings.Email.Address'?: string;
  'Bindings.Email.Name'?: string;
}

export interface UpdateConversationParams {
  FriendlyName?: string;
  DateCreated?: string;
  DateUpdated?: string;
  Attributes?: string;
  MessagingServiceSid?: string;
  State?: ConversationState;
  'Timers.Inactive'?: string;
  'Timers.Closed'?: string;
  'Bindings.Email.Address'?: string;
  'Bindings.Email.Name'?: string;
}

export interface AddParticipantParams {
  Identity?: string;
  'MessagingBinding.Address'?: string;
  'MessagingBinding.ProxyAddress'?: string;
  'MessagingBinding.ProjectedAddress'?: string;
  DateCreated?: string;
  DateUpdated?: string;
  Attributes?: string;
  RoleSid?: string;
}

export interface SendConversationMessageParams {
  Author?: string;
  Body?: string;
  DateCreated?: string;
  DateUpdated?: string;
  Attributes?: string;
  MediaSid?: string;
  ContentSid?: string;
  ContentVariables?: string;
}

// ============================================
// Video Types
// ============================================

export type VideoRoomType = 'go' | 'peer-to-peer' | 'group' | 'group-small';
export type VideoRoomStatus = 'in-progress' | 'completed' | 'failed';

export interface VideoRoom {
  account_sid: string;
  sid: string;
  unique_name: string;
  status: VideoRoomStatus;
  date_created: string;
  date_updated: string;
  end_time: string | null;
  duration: number | null;
  type: VideoRoomType;
  max_participants: number;
  max_participant_duration: number;
  max_concurrent_published_tracks: number | null;
  record_participants_on_connect: boolean;
  video_codecs: string[];
  audio_only: boolean;
  empty_room_timeout: number;
  unused_room_timeout: number;
  large_room: boolean;
  status_callback: string | null;
  status_callback_method: 'GET' | 'POST';
  url: string;
  links: {
    participants: string;
    recordings: string;
    recording_rules: string;
  };
}

export interface VideoRoomListResponse {
  rooms: VideoRoom[];
  meta: {
    page: number;
    page_size: number;
    first_page_url: string;
    previous_page_url: string | null;
    url: string;
    next_page_url: string | null;
    key: string;
  };
}

export interface CreateVideoRoomParams {
  EnableTurn?: boolean;
  Type?: VideoRoomType;
  UniqueName?: string;
  StatusCallback?: string;
  StatusCallbackMethod?: 'GET' | 'POST';
  MaxParticipants?: number;
  RecordParticipantsOnConnect?: boolean;
  VideoCodecs?: string[];
  MediaRegion?: string;
  RecordingRules?: string;
  AudioOnly?: boolean;
  MaxParticipantDuration?: number;
  EmptyRoomTimeout?: number;
  UnusedRoomTimeout?: number;
  LargeRoom?: boolean;
}

export interface UpdateVideoRoomParams {
  Status?: 'completed';
}

export interface ListVideoRoomsParams {
  Status?: VideoRoomStatus;
  UniqueName?: string;
  DateCreatedAfter?: string;
  DateCreatedBefore?: string;
  PageSize?: number;
  Page?: number;
  PageToken?: string;
}

// ============================================
// Lookup Types
// ============================================

export interface LookupResult {
  calling_country_code: string;
  country_code: string;
  phone_number: string;
  national_format: string;
  valid: boolean;
  validation_errors: string[] | null;
  caller_name: {
    caller_name: string | null;
    caller_type: 'CONSUMER' | 'BUSINESS' | null;
    error_code: number | null;
  } | null;
  sim_swap: {
    last_sim_swap: {
      last_sim_swap_date: string | null;
      swapped_period: string | null;
      swapped_in_period: boolean | null;
    } | null;
    carrier_name: string | null;
    mobile_country_code: string | null;
    mobile_network_code: string | null;
    error_code: number | null;
  } | null;
  call_forwarding: {
    call_forwarding_status: boolean | null;
    error_code: number | null;
  } | null;
  live_activity: {
    connectivity: string | null;
    original_carrier: {
      name: string | null;
      mobile_country_code: string | null;
      mobile_network_code: string | null;
    } | null;
    ported: boolean | null;
    ported_carrier: {
      name: string | null;
      mobile_country_code: string | null;
      mobile_network_code: string | null;
    } | null;
    roaming: {
      roaming_country_code: string | null;
      roaming_network_code: string | null;
      roaming_network_name: string | null;
      status: string | null;
    } | null;
    error_code: number | null;
  } | null;
  line_type_intelligence: {
    carrier_name: string | null;
    error_code: number | null;
    mobile_country_code: string | null;
    mobile_network_code: string | null;
    type: string | null;
  } | null;
  identity_match: {
    first_name_match: string | null;
    last_name_match: string | null;
    address_lines_match: string | null;
    city_match: string | null;
    state_match: string | null;
    postal_code_match: string | null;
    country_match: string | null;
    date_of_birth_match: string | null;
    national_id_match: string | null;
    summary_score: number | null;
    error_code: number | null;
  } | null;
  reassigned_number: {
    last_verified_date: string | null;
    is_reassigned: boolean | null;
    error_code: number | null;
  } | null;
  sms_pumping_risk: {
    carrier_risk_category: string | null;
    carrier_risk_score: number | null;
    number_blocked: boolean | null;
    number_blocked_date: string | null;
    number_blocked_last_3_months: boolean | null;
    sms_pumping_risk_score: number | null;
    error_code: number | null;
  } | null;
  phone_number_quality_score: {
    quality_score: number | null;
    error_code: number | null;
  } | null;
  pre_fill: {
    first_name: string | null;
    last_name: string | null;
    address_line: string | null;
    city: string | null;
    postal_code: string | null;
    state: string | null;
    country_code: string | null;
    national_id: string | null;
    date_of_birth: string | null;
    error_code: number | null;
  } | null;
  url: string;
}

export interface LookupParams {
  Fields?: string;
  CountryCode?: string;
  FirstName?: string;
  LastName?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  AddressCountryCode?: string;
  NationalId?: string;
  DateOfBirth?: string;
  LastVerifiedDate?: string;
  VerificationSid?: string;
}

// ============================================
// Account Types
// ============================================

export type AccountStatus = 'active' | 'suspended' | 'closed';
export type AccountType = 'Trial' | 'Full';

export interface Account {
  auth_token: string;
  date_created: string;
  date_updated: string;
  friendly_name: string;
  owner_account_sid: string;
  sid: string;
  status: AccountStatus;
  subresource_uris: {
    available_phone_numbers: string;
    calls: string;
    conferences: string;
    incoming_phone_numbers: string;
    notifications: string;
    outgoing_caller_ids: string;
    recordings: string;
    transcriptions: string;
    addresses: string;
    signing_keys: string;
    connect_apps: string;
    sip: string;
    authorized_connect_apps: string;
    usage: string;
    keys: string;
    applications: string;
    short_codes: string;
    queues: string;
    messages: string;
    balance: string;
  };
  type: AccountType;
  uri: string;
}

export interface AccountListResponse {
  accounts: Account[];
  end: number;
  first_page_uri: string;
  next_page_uri: string | null;
  page: number;
  page_size: number;
  previous_page_uri: string | null;
  start: number;
  uri: string;
}

export interface CreateSubAccountParams {
  FriendlyName?: string;
}

export interface UpdateAccountParams {
  FriendlyName?: string;
  Status?: 'active' | 'suspended' | 'closed';
}

export interface Balance {
  account_sid: string;
  balance: string;
  currency: string;
}

// ============================================
// API Error Types
// ============================================

export interface TwilioErrorDetail {
  code: number;
  message: string;
  more_info: string;
  status: number;
}

export class TwilioApiError extends Error {
  public readonly statusCode: number;
  public readonly code: number;
  public readonly moreInfo: string;

  constructor(message: string, statusCode: number, code: number, moreInfo: string) {
    super(message);
    this.name = 'TwilioApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.moreInfo = moreInfo;
  }
}
