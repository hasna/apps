export interface ZohoInventoryConfig {
  token: string;
  organizationId: string;
  baseUrl?: string;
}

export interface ZIContact {
  contact_id: string;
  contact_name: string;
  company_name: string;
  email: string;
  phone: string;
  contact_type: string;
  status: string;
}

export interface ZIItem {
  item_id: string;
  name: string;
  description: string;
  rate: number;
  unit: string;
  sku: string;
  status: string;
}

export interface ZISalesOrder {
  salesorder_id: string;
  salesorder_number: string;
  customer_name: string;
  status: string;
  total: number;
  date: string;
  currency_code: string;
}

export interface ZIPurchaseOrder {
  purchaseorder_id: string;
  purchaseorder_number: string;
  vendor_name: string;
  status: string;
  total: number;
  date: string;
  currency_code: string;
}

export interface ZIInvoice {
  invoice_id: string;
  invoice_number: string;
  customer_name: string;
  status: string;
  total: number;
  balance: number;
  date: string;
  due_date: string;
  currency_code: string;
}

export class ZohoInventoryApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;
  constructor(message: string, statusCode: number, code?: number) {
    super(message);
    this.name = 'ZohoInventoryApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
