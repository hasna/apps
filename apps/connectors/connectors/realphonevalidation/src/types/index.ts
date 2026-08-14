export interface RealPhoneValidationConfig { apiKey: string; }

export interface RPVResult { phone: string; status: 'connected' | 'disconnected' | 'unknown'; phone_type: 'landline' | 'wireless' | 'voip' | 'unknown'; carrier: string; country_code: string; line_type: string; is_valid: boolean; error_text: string | null; }
export interface RPVBulkResult { id: string; status: string; results: RPVResult[]; total: number; }

export class RealPhoneValidationApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RealPhoneValidationApiError'; this.statusCode = statusCode; }
}
