// WhatsApp Business Cloud Connector Types
// Send messages, manage templates, and handle webhooks

// ============================================
// Configuration
// ============================================

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts' | 'interactive' | 'template' | 'reaction';

export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

// ============================================
// Contact Types
// ============================================

export interface Contact {
  addresses?: Address[];
  birthday?: string;
  emails?: Email[];
  name: Name;
  org?: Organization;
  phones?: Phone[];
  urls?: Url[];
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  type?: 'HOME' | 'WORK';
}

export interface Email {
  email?: string;
  type?: 'HOME' | 'WORK';
}

export interface Name {
  formatted_name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  suffix?: string;
  prefix?: string;
}

export interface Organization {
  company?: string;
  department?: string;
  title?: string;
}

export interface Phone {
  phone?: string;
  type?: 'CELL' | 'MAIN' | 'IPHONE' | 'HOME' | 'WORK';
  wa_id?: string;
}

export interface Url {
  url?: string;
  type?: 'HOME' | 'WORK';
}

// ============================================
// Media Types
// ============================================

export interface Media {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

export interface MediaObject {
  messaging_product: string;
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

// ============================================
// Location Types
// ============================================

export interface Location {
  longitude: number;
  latitude: number;
  name?: string;
  address?: string;
}

// ============================================
// Interactive Message Types
// ============================================

export interface Interactive {
  type: 'button' | 'list' | 'product' | 'product_list' | 'flow' | 'cta_url';
  header?: InteractiveHeader;
  body: InteractiveBody;
  footer?: InteractiveFooter;
  action: InteractiveAction;
}

export interface InteractiveHeader {
  type: 'text' | 'image' | 'video' | 'document';
  text?: string;
  image?: Media;
  video?: Media;
  document?: Media;
}

export interface InteractiveBody {
  text: string;
}

export interface InteractiveFooter {
  text: string;
}

export interface InteractiveAction {
  button?: string;
  buttons?: InteractiveButton[];
  sections?: InteractiveSection[];
  catalog_id?: string;
  product_retailer_id?: string;
  name?: string;
  parameters?: Record<string, unknown>;
}

export interface InteractiveButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export interface InteractiveSection {
  title?: string;
  rows?: InteractiveRow[];
  product_items?: ProductItem[];
}

export interface InteractiveRow {
  id: string;
  title: string;
  description?: string;
}

export interface ProductItem {
  product_retailer_id: string;
}

// ============================================
// Template Types
// ============================================

export interface Template {
  name: string;
  language: TemplateLanguage;
  components?: TemplateComponent[];
}

export interface TemplateLanguage {
  code: string;
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: string;
  parameters?: TemplateParameter[];
}

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video' | 'payload';
  text?: string;
  currency?: TemplateCurrency;
  date_time?: TemplateDateTime;
  image?: Media;
  document?: Media;
  video?: Media;
  payload?: string;
}

export interface TemplateCurrency {
  fallback_value: string;
  code: string;
  amount_1000: number;
}

export interface TemplateDateTime {
  fallback_value: string;
}

// ============================================
// Reaction Types
// ============================================

export interface Reaction {
  message_id: string;
  emoji: string;
}

// ============================================
// Message Types
// ============================================

export interface TextMessage {
  body: string;
  preview_url?: boolean;
}

export interface SendMessageInput {
  messaging_product: 'whatsapp';
  recipient_type?: 'individual';
  to: string;
  type: MessageType;
  text?: TextMessage;
  image?: Media;
  audio?: Media;
  video?: Media;
  document?: Media;
  sticker?: Media;
  location?: Location;
  contacts?: Contact[];
  interactive?: Interactive;
  template?: Template;
  reaction?: Reaction;
  context?: {
    message_id: string;
  };
}

export interface SendMessageResponse {
  messaging_product: string;
  contacts: {
    input: string;
    wa_id: string;
  }[];
  messages: {
    id: string;
    message_status?: string;
  }[];
}

// ============================================
// Business Profile Types
// ============================================

export interface BusinessProfile {
  messaging_product: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
  about?: string;
}

// ============================================
// Phone Number Types
// ============================================

export interface PhoneNumber {
  id: string;
  verified_name: string;
  code_verification_status: string;
  display_phone_number: string;
  quality_rating: string;
  platform_type?: string;
  throughput?: {
    level: string;
  };
}

export interface PhoneNumbersResponse {
  data: PhoneNumber[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
  };
}

// ============================================
// Template Management Types
// ============================================

export interface MessageTemplate {
  id: string;
  name: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'DISABLED';
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  components?: MessageTemplateComponent[];
}

export interface MessageTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  example?: {
    header_text?: string[];
    body_text?: string[][];
  };
  buttons?: MessageTemplateButton[];
}

export interface MessageTemplateButton {
  type: 'PHONE_NUMBER' | 'URL' | 'QUICK_REPLY';
  text: string;
  phone_number?: string;
  url?: string;
}

export interface MessageTemplatesResponse {
  data: MessageTemplate[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
    next?: string;
  };
}

// ============================================
// Webhook Types
// ============================================

export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: WebhookValue;
  field: string;
}

export interface WebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WebhookContact[];
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
  errors?: WebhookError[];
}

export interface WebhookContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: MessageType;
  text?: TextMessage;
  image?: MediaWebhook;
  audio?: MediaWebhook;
  video?: MediaWebhook;
  document?: MediaWebhook;
  sticker?: MediaWebhook;
  location?: Location;
  contacts?: Contact[];
  interactive?: InteractiveWebhook;
  button?: ButtonWebhook;
  context?: {
    from: string;
    id: string;
  };
}

export interface MediaWebhook {
  id: string;
  mime_type: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

export interface InteractiveWebhook {
  type: string;
  button_reply?: {
    id: string;
    title: string;
  };
  list_reply?: {
    id: string;
    title: string;
    description?: string;
  };
}

export interface ButtonWebhook {
  text: string;
  payload: string;
}

export interface WebhookStatus {
  id: string;
  status: MessageStatus;
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    expiration_timestamp?: string;
    origin?: {
      type: string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
}

export interface WebhookError {
  code: number;
  title: string;
  message: string;
  error_data?: {
    details: string;
  };
}

// ============================================
// API Error Types
// ============================================

export interface WhatsAppError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  error_data?: {
    messaging_product: string;
    details: string;
  };
  fbtrace_id: string;
}

export interface WhatsAppErrorResponse {
  error: WhatsAppError;
}

export class WhatsAppApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: number;
  public readonly errorSubcode?: number;
  public readonly fbtraceId: string;

  constructor(
    message: string,
    statusCode: number,
    errorCode: number,
    fbtraceId: string,
    errorSubcode?: number
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.errorSubcode = errorSubcode;
    this.fbtraceId = fbtraceId;
  }
}
