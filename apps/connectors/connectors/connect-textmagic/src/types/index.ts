export interface TextmagicConfig {
  username: string;
  apiKey: string;
  baseUrl?: string;
}

export interface TextmagicMessage {
  id: number;
  receiver: string;
  messageTime: string;
  status: string;
  text: string;
  charset: string;
  price: number;
  partsCount: number;
  country: string;
}

export interface SendMessageResult {
  id: number;
  href: string;
  type: string;
  sessionId: number;
  bulkId: number;
  messageId: number;
  scheduleId: number;
}

export interface Contact {
  id: number;
  phone: string;
  email: string | null;
  firstName: string;
  lastName: string;
  companyName: string | null;
  country: { id: string; name: string } | null;
}

export interface TextmagicAccount {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  balance: number;
  currency: { id: string; htmlSymbol: string };
}

export class TextmagicApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TextmagicApiError';
    this.statusCode = statusCode;
  }
}
