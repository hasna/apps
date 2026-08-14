export interface LighthouseConfig { apiKey: string; }

export interface LHProperty { id: string; name: string; address: string; city: string; state: string; zip: string; country: string; type: string; units: number; status: string; created_at: string; }
export interface LHTenant { id: string; property_id: string; unit_id: string; first_name: string; last_name: string; email: string; phone: string; lease_start: string; lease_end: string; rent_amount: number; status: string; }
export interface LHTransaction { id: string; property_id: string; tenant_id: string | null; type: 'income' | 'expense'; category: string; amount: number; date: string; description: string; }
export interface LHTransactionList { transactions: LHTransaction[]; total: number; page: number; per_page: number; }
export interface LHUnit { id: string; property_id: string; name: string; bedrooms: number; bathrooms: number; rent_amount: number; status: 'occupied' | 'vacant'; }
export interface LHMaintenanceRequest { id: string; property_id: string; unit_id: string; tenant_id: string; title: string; description: string; priority: string; status: string; created_at: string; }

export class LighthouseApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LighthouseApiError'; this.statusCode = statusCode; }
}
