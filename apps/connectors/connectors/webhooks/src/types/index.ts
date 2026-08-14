export interface WebhooksConfig {
  defaultUrl?: string;
  signingSecret?: string;
}

export interface WebhookSendOptions {
  url?: string;
  body: unknown;
  headers?: Record<string, string>;
}

export interface WebhookSendJsonOptions {
  url?: string;
  payload: Record<string, unknown>;
}

export interface WebhookPingOptions {
  url?: string;
}

export interface WebhookListIncomingOptions {
  limit?: number;
  sinceMs?: number;
}

export interface WebhookSendResult {
  ok: boolean;
  status: number;
  response: string;
  url: string;
}

export interface WebhookPingResult {
  ok: boolean;
  status: number;
  url: string;
}

export interface WebhookListIncomingResult {
  message: string;
  limit: number;
  sinceMs?: number;
  hint: string;
  events: never[];
}

export interface ProfileConfig {
  defaultUrl?: string;
  signingSecret?: string;
}
