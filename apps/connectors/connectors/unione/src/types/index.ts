// UniOne Connector Types

export interface UniOneConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface UniOneRecipient {
  email: string;
  name?: string;
  substitutions?: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface UniOneMessageBody {
  html?: string;
  plaintext?: string;
  amp?: string;
}

export interface UniOneMessage {
  recipients: UniOneRecipient[];
  body: UniOneMessageBody;
  subject?: string;
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  template_id?: string;
  template_engine?: 'simple' | 'velocity' | 'liquid' | 'none';
  global_substitutions?: Record<string, string>;
  track_links?: 0 | 1;
  track_read?: 0 | 1;
  options?: Record<string, unknown>;
}

export interface SendEmailParams {
  message: UniOneMessage;
  skip_unsubscribe?: number;
  schedule_time?: string;
}

export interface SendEmailResponse {
  status: string;
  job_id?: string;
  emails?: string[];
  failed_emails?: Record<string, string>;
}

export interface SubscribeEmailParams {
  list_id: string;
  email: string;
  phone?: string;
  name?: string;
  fields?: Record<string, string>;
}

export interface SubscribeEmailResponse {
  status: string;
  person_id?: number;
}

export interface ValidateEmailParams {
  email: string;
}

export interface ValidateEmailResponse {
  status: string;
  result?: string;
  cause?: string;
  email?: string;
}

export interface SetTemplateParams {
  template_id?: string;
  name?: string;
  subject?: string;
  body?: UniOneMessageBody;
  from_email?: string;
  from_name?: string;
  is_active?: boolean;
}

export interface GetTemplateParams {
  template_id: string;
}

export interface TemplateInfo {
  id: string;
  name?: string;
  subject?: string;
  is_active?: boolean;
  created?: string;
  updated?: string;
}

export interface ListTemplatesParams {
  limit?: number;
  offset?: number;
}

export interface ListTemplatesResponse {
  status: string;
  templates?: TemplateInfo[];
}

export interface GetTemplateResponse {
  status: string;
  template?: TemplateInfo & { body?: UniOneMessageBody };
}

export interface SetTemplateResponse {
  status: string;
  template_id?: string;
}

export interface WebhookInfo {
  id: number;
  url: string;
  event_format?: string;
  status?: string;
  delivery_url?: string;
  events?: Record<string, boolean>;
}

export interface ListWebhooksResponse {
  status: string;
  webhooks?: WebhookInfo[];
}

export interface ProjectInfo {
  id: number;
  name: string;
  status?: string;
}

export interface ListProjectsResponse {
  status: string;
  projects?: ProjectInfo[];
}

export class UniOneApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'UniOneApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}
