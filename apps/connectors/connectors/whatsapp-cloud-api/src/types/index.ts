export interface WhatsappCloudApiConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonRecord = Record<string, unknown>;

export class WhatsappCloudApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WhatsappCloudApiError';
    this.statusCode = statusCode;
  }
}
