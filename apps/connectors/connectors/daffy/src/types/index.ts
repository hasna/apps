export interface DaffyConfig { apiKey: string; }

export interface DFDonation { id: string; amount: number; currency: string; nonprofit: { ein: string; name: string }; status: string; created_at: string; }
export interface DFDonationList { donations: DFDonation[]; has_more: boolean; }
export interface DFNonprofit { ein: string; name: string; city: string; state: string; category: string; logo_url: string | null; }
export interface DFAccount { id: string; email: string; first_name: string; last_name: string; balance: number; currency: string; }
export interface DFContribution { id: string; amount: number; currency: string; status: string; method: string; created_at: string; }

export class DaffyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DaffyApiError'; this.statusCode = statusCode; }
}
