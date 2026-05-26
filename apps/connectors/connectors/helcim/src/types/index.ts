export interface HelcimConfig { apiToken: string; baseUrl?: string; }

export interface HelcimTransaction {
  transactionId: number; type: string; status: string; amount: number; currency: string;
  dateCreated: string; cardNumber: string | null; cardholderName: string | null;
  invoiceNumber: string | null; customerId: number | null;
}

export interface HelcimCustomer {
  customerId: number; customerCode: string; contactName: string; businessName: string | null;
  email: string | null; phone: string | null; billingAddress?: { street1: string; city: string; province: string; country: string; postalCode: string };
}

export interface HelcimInvoice {
  invoiceId: number; invoiceNumber: string; tipAmount: number; depositAmount: number;
  notes: string | null; status: string; currency: string; totalAmount: number;
  customerId: number | null; dateCreated: string;
  lineItems?: Array<{ description: string; quantity: number; price: number; total: number }>;
}

export class HelcimApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HelcimApiError'; this.statusCode = statusCode; }
}
