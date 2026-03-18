export interface PlivoConfig { authId: string; authToken: string; }

export interface PlivoMessage { message_uuid: string; from: string; to: string; text: string; type: string; message_state: string; message_time: string; total_rate: string; total_amount: string; units: number; }
export interface PlivoMessageList { meta: { limit: number; offset: number; total_count: number }; objects: PlivoMessage[]; }
export interface PlivoCall { call_uuid: string; from_number: string; to_number: string; direction: string; call_duration: number; bill_duration: number; total_amount: string; end_time: string; initiation_time: string; answer_time: string; hangup_cause_name: string; }
export interface PlivoCallList { meta: { limit: number; offset: number; total_count: number }; objects: PlivoCall[]; }
export interface PlivoNumber { number: string; alias: string; application: string; type: string; sub_account: string | null; added_on: string; country: string; region: string; }
export interface PlivoAccount { account_type: string; auth_id: string; city: string; name: string; cash_credits: string; created: string; enabled: boolean; state: string; timezone: string; }

export class PlivoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PlivoApiError'; this.statusCode = statusCode; }
}
