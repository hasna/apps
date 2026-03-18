export interface VerifaliaConfig { username: string; password: string; }

export interface VFEmailValidation { id: string; status: 'InProgress' | 'Completed' | 'Expired' | 'Deleted'; entries: VFEntry[]; created_on: string; completed_on: string | null; }
export interface VFEntry { input_data: string; classification: 'Deliverable' | 'Undeliverable' | 'Risky' | 'Unknown'; status: string; email_address: string; is_free_email_address: boolean; is_disposable_email_address: boolean; is_role_account: boolean; syntax_failure_index: number | null; }
export interface VFCreditsBalance { free_daily: { available: number; used: number }; credits: { available: number; used: number }; }

export class VerifaliaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'VerifaliaApiError'; this.statusCode = statusCode; }
}
