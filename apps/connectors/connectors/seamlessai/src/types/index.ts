export interface SeamlessAIConfig { apiKey: string; }

export interface SAContact { id: string; first_name: string; last_name: string; email: string; phone: string; mobile_phone: string; title: string; company: string; industry: string; linkedin_url: string; city: string; state: string; country: string; }
export interface SAContactList { data: SAContact[]; total: number; page: number; per_page: number; }
export interface SACompany { id: string; name: string; domain: string; industry: string; employee_count: number; revenue: string; city: string; state: string; country: string; linkedin_url: string; description: string; }
export interface SACompanyList { data: SACompany[]; total: number; page: number; per_page: number; }
export interface SASearchParams { query?: string; title?: string; company?: string; industry?: string; location?: string; page?: number; per_page?: number; }

export class SeamlessAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SeamlessAIApiError'; this.statusCode = statusCode; }
}
