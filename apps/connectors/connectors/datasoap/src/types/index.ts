export interface DataSoapConfig { apiKey: string; }

export interface DSEmailResult { email: string; status: 'valid' | 'invalid' | 'catch_all' | 'unknown' | 'disposable'; score: number; reason: string; free_email: boolean; disposable: boolean; role_account: boolean; mx_found: boolean; smtp_check: boolean; }
export interface DSPhoneResult { phone: string; valid: boolean; type: string; carrier: string; country_code: string; country_name: string; location: string; }
export interface DSAddressResult { address: string; valid: boolean; formatted: string; street: string; city: string; state: string; postal_code: string; country: string; latitude: number; longitude: number; }
export interface DSBatchResult { id: string; status: 'pending' | 'processing' | 'completed' | 'failed'; total: number; processed: number; results_url: string | null; created_at: string; }
export interface DSCredits { total: number; used: number; remaining: number; }

export class DataSoapApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DataSoapApiError'; this.statusCode = statusCode; }
}
