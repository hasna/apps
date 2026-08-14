export interface PaymoConfig { apiKey: string; }

export interface PMProject { id: number; name: string; description: string; client_id: number | null; active: boolean; budget_hours: number; price_per_hour: number; created_on: string; updated_on: string; }
export interface PMTask { id: number; name: string; project_id: number; tasklist_id: number; complete: boolean; due_date: string | null; estimated_hours: number; budget_hours: number; user_id: number | null; priority: number; created_on: string; }
export interface PMTimeEntry { id: number; task_id: number; user_id: number; start_time: string; end_time: string; duration: number; description: string; date: string; }
export interface PMClient { id: number; name: string; email: string; phone: string; address: string; city: string; }
export interface PMInvoice { id: number; number: string; client_id: number; status: string; total: number; currency: string; due_date: string; created_on: string; }
export interface PMUser { id: number; name: string; email: string; type: string; active: boolean; }

export class PaymoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PaymoApiError'; this.statusCode = statusCode; }
}
