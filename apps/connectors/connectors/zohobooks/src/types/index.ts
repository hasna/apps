export interface ZohoBooksConfig { token: string; organizationId: string; baseUrl?: string; }

export interface ZBInvoice { invoice_id: string; invoice_number: string; customer_name: string; status: string; total: number; balance: number; date: string; due_date: string; currency_code: string; }
export interface ZBContact { contact_id: string; contact_name: string; company_name: string; email: string; phone: string; contact_type: string; status: string; outstanding_receivable_amount: number; }
export interface ZBItem { item_id: string; name: string; description: string; rate: number; unit: string; tax_id: string; sku: string; }
export interface ZBExpense { expense_id: string; description: string; amount: number; date: string; category_name: string; vendor_name: string; status: string; }
export interface ZBBankAccount { account_id: string; account_name: string; account_type: string; balance: number; currency_code: string; }
export interface ZBListResult<T> { code: number; message: string; [key: string]: unknown; }

export class ZohoBooksApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;
  constructor(message: string, statusCode: number, code?: number) { super(message); this.name = 'ZohoBooksApiError'; this.statusCode = statusCode; this.code = code; }
}
