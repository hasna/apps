export interface DropcontactConfig { apiKey: string; }

export interface DCEnrichRequest { data: DCContact[]; siren?: boolean; language?: string; }
export interface DCContact { email?: string; first_name?: string; last_name?: string; full_name?: string; company?: string; website?: string; phone?: string; linkedin?: string; }
export interface DCEnrichResult { request_id: string; error: boolean; credits_left: number; success: boolean; }
export interface DCEnrichStatus { request_id: string; error: boolean; success: boolean; reason?: string; data?: DCEnrichedContact[]; credits_left: number; }
export interface DCEnrichedContact { email: string[]; first_name: string; last_name: string; full_name: string; company: string; website: string; linkedin: string; phone: string; job: string; seniority: string; department: string; nb_employees: string; naf5_code: string; siren: string; siret: string; }

export class DropcontactApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DropcontactApiError'; this.statusCode = statusCode; }
}
