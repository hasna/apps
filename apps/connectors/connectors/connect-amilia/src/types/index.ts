export interface AmiliaConfig { token: string; organizationId: string; }

export interface AmiliaActivity { id: number; name: string; description: string; category: string; subcategory: string; price: number; start_date: string; end_date: string; capacity: number; enrolled: number; status: string; }
export interface AmiliaActivityList { items: AmiliaActivity[]; total: number; page: number; }
export interface AmiliaPerson { id: number; first_name: string; last_name: string; email: string; phone: string; date_of_birth: string; gender: string; }
export interface AmiliaRegistration { id: number; person_id: number; activity_id: number; status: string; created_at: string; }
export interface AmiliaLocation { id: number; name: string; address: string; city: string; province: string; postal_code: string; }
export interface AmiliaCategory { id: number; name: string; subcategories: { id: number; name: string }[]; }

export class AmiliaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AmiliaApiError'; this.statusCode = statusCode; }
}
