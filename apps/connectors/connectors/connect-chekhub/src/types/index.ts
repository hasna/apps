export interface ChekhubConfig { token: string; }

export interface CHWorkOrder { id: string; title: string; description: string; status: string; priority: string; assignee: { id: string; name: string } | null; location: { id: string; name: string; address: string } | null; due_date: string | null; created_at: string; updated_at: string; completed_at: string | null; }
export interface CHWorkOrderList { work_orders: CHWorkOrder[]; total: number; page: number; per_page: number; }
export interface CHAsset { id: string; name: string; serial_number: string; model: string; manufacturer: string; location_id: string; status: string; last_service_date: string | null; }
export interface CHLocation { id: string; name: string; address: string; city: string; state: string; zip: string; country: string; }
export interface CHTechnician { id: string; name: string; email: string; phone: string; skills: string[]; status: string; }
export interface CHChecklist { id: string; name: string; items: { id: string; description: string; completed: boolean }[]; }

export class ChekhubApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ChekhubApiError'; this.statusCode = statusCode; }
}
