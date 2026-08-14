export interface HunterConfig { apiKey: string; }

export interface HunterDomainSearch { domain: string; disposable: boolean; webmail: boolean; accept_all: boolean; pattern: string; organization: string; emails: HunterEmail[]; }
export interface HunterEmail { value: string; type: string; confidence: number; first_name: string; last_name: string; position: string; department: string; linkedin: string | null; sources: { domain: string; uri: string; extracted_on: string }[]; }
export interface HunterEmailFinder { email: string; score: number; first_name: string; last_name: string; position: string; domain: string; company: string; sources: { domain: string; uri: string }[]; }
export interface HunterVerification { email: string; result: 'deliverable' | 'undeliverable' | 'risky' | 'unknown'; score: number; regexp: boolean; gibberish: boolean; disposable: boolean; webmail: boolean; mx_records: boolean; smtp_server: boolean; smtp_check: boolean; accept_all: boolean; block: boolean; }
export interface HunterAccount { email: string; first_name: string; last_name: string; plan_name: string; plan_level: number; requests: { searches: { used: number; available: number }; verifications: { used: number; available: number } }; }

export class HunterApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HunterApiError'; this.statusCode = statusCode; }
}
