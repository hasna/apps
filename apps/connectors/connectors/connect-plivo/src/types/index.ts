export interface PlivoConfig {
  authId: string;
  authToken: string;
  baseUrl?: string;
}

export interface PlivoMessage {
  api_id: string;
  message_uuid: string;
  message: string;
}

export interface PlivoMessageRecord {
  message_uuid: string;
  from_number: string;
  to_number: string;
  text: string;
  message_direction: 'inbound' | 'outbound';
  message_state: 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'received';
  message_type: 'sms' | 'mms';
  add_time: string;
  total_amount: string;
  units: number;
}

export interface PlivoCall {
  request_uuid: string;
}

export interface PlivoCallRecord {
  call_uuid: string;
  from_number: string;
  to_number: string;
  call_direction: 'inbound' | 'outbound';
  call_state: string;
  answer_time: string | null;
  end_time: string | null;
  total_amount: string;
  total_duration: number;
  bill_duration: number;
  bill_rate: string;
}

export interface PlivoNumber {
  number: string;
  country: string;
  type: 'local' | 'tollfree' | 'mobile';
  sms_enabled: boolean;
  voice_enabled: boolean;
  monthly_rental_rate: string;
  application: string | null;
}

export interface PlivoAccount {
  auth_id: string;
  account_type: string;
  cash_credits: string;
  city: string;
  name: string;
  email: string;
  enabled: boolean;
}

export class PlivoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'PlivoApiError';
    this.statusCode = statusCode;
  }
}
