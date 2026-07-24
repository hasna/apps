export interface TextsidekickConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SidekickDocument {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface SidekickWorker {
  id: string;
  name?: string;
  phone_number?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SidekickMessage {
  id: string;
  body?: string;
  worker_id?: string;
  direction?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface SidekickEscalation {
  id: string;
  status?: string;
  worker_id?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface SidekickTutorial {
  id: string;
  title?: string;
  content?: string;
  [key: string]: unknown;
}

export interface SidekickPhoneNumber {
  phone_number?: string;
  [key: string]: unknown;
}

export interface ListResponse<T> {
  data?: T[];
  items?: T[];
  [key: string]: unknown;
}

export class TextsidekickApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TextsidekickApiError';
    this.statusCode = statusCode;
  }
}
