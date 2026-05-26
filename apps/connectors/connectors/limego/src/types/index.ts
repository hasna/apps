export interface LimeGoConfig { apiKey: string; }

export interface LGCompany { id: string; name: string; domain: string; industry: string; employee_count: number; revenue: string; city: string; state: string; country: string; linkedin_url: string; description: string; }
export interface LGCompanyList { companies: LGCompany[]; total: number; page: number; per_page: number; }
export interface LGContact { id: string; first_name: string; last_name: string; email: string; phone: string; title: string; company_id: string; company_name: string; linkedin_url: string; }
export interface LGContactList { contacts: LGContact[]; total: number; page: number; per_page: number; }
export interface LGSearchParams { query?: string; industry?: string; location?: string; employee_min?: number; employee_max?: number; title?: string; page?: number; per_page?: number; }

export class LimeGoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LimeGoApiError'; this.statusCode = statusCode; }
}
