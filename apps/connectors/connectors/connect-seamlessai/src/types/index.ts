export interface SeamlessAIConfig { apiKey: string; baseUrl?: string; }
export interface SAIContact { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; title: string | null; company: string | null; linkedin_url: string | null; location: string | null; }
export interface SAICompany { id: string; name: string; website: string | null; industry: string | null; employee_count: number | null; revenue: string | null; phone: string | null; location: string | null; linkedin_url: string | null; }
export interface SearchContactsOptions { first_name?: string; last_name?: string; company?: string; title?: string; location?: string; industry?: string; page?: number; per_page?: number; }
export interface SearchCompaniesOptions { name?: string; industry?: string; location?: string; employee_min?: number; employee_max?: number; page?: number; per_page?: number; }
export class SeamlessAIApiError extends Error { public readonly statusCode: number; constructor(message: string, statusCode: number) { super(message); this.name = 'SeamlessAIApiError'; this.statusCode = statusCode; } }
