export interface DropcontactConfig { apiKey: string; baseUrl?: string; }
export interface EnrichContactInput { email?: string; first_name?: string; last_name?: string; company?: string; website?: string; phone?: string; }
export interface EnrichedContact {
  email?: string | Array<{ email: string; qualification: string }>;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  civility?: string;
  phone?: string;
  mobile_phone?: string;
  company?: string;
  website?: string;
  linkedin?: string;
  twitter?: string;
  quality?: string;
  drop_contact_qualify?: boolean;
}
export interface EnrichResult { data: EnrichedContact[]; request_id: string; error?: boolean; reason?: string; }
export interface CreditInfo { available_credits: number; credits_per_contact: number; }
export class DropcontactApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DropcontactApiError'; this.statusCode = statusCode; }
}
