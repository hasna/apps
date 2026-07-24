export interface WaboxappConfig {
  token: string;
  uid: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface SendChatParams {
  to: string;
  custom_uid: string;
  text: string;
  uid?: string;
}

export interface SendImageParams {
  to: string;
  custom_uid: string;
  url: string;
  caption?: string;
  description?: string;
  uid?: string;
}

export interface SendLinkParams {
  to: string;
  custom_uid: string;
  url: string;
  caption?: string;
  description?: string;
  url_thumb?: string;
  uid?: string;
}

export interface SendMediaParams {
  to: string;
  custom_uid: string;
  url: string;
  caption?: string;
  description?: string;
  url_thumb?: string;
  uid?: string;
}

export interface WaboxappSendResponse {
  success: boolean;
  custom_uid: string;
}

export interface WaboxappStatusResponse {
  success: boolean;
  uid: string;
  hook_url?: string;
  alias?: string;
  platform?: string;
  battery?: string;
  plugged?: string;
  locale?: string;
}

export class WaboxappApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WaboxappApiError';
    this.statusCode = statusCode;
  }
}
