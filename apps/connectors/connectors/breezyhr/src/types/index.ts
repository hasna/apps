export interface BreezyHRConfig { token: string; }

export interface BreezyCompany { id: string; name: string; friendly_id: string; member_count: number; creation_date: string; }
export interface BreezyPosition { id: string; name: string; friendly_id: string; state: string; type: { id: string; name: string }; department: string; location: { name: string; city: string; state: string; country: string }; creation_date: string; updated_date: string; }
export interface BreezyCandidate { id: string; name: string; email_address: string; phone_number: string; stage: { id: string; name: string }; origin: string; creation_date: string; updated_date: string; resume?: { url: string }; }
export interface BreezyCandidateList { candidates: BreezyCandidate[]; }
export interface BreezyStage { id: string; name: string; type: string; }
export interface BreezyUser { id: string; name: string; email_address: string; }

export class BreezyHRApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BreezyHRApiError'; this.statusCode = statusCode; }
}
