// SyncroMSP Connector — All-in-one MSP platform (RMM, PSA, ticketing)
import { SyncroMSPClient } from './client';
import type { SyncroMSPConfig, SMTicket, SMTicketList, SMCustomer, SMAsset, SMInvoice } from '../types';
export { SyncroMSPClient } from './client';

export class SyncroMSP {
  private readonly client: SyncroMSPClient;
  constructor(config: SyncroMSPConfig) { this.client = new SyncroMSPClient(config); }
  static fromEnv(): SyncroMSP {
    const subdomain = process.env.SYNCROMSP_SUBDOMAIN;
    const apiKey = process.env.SYNCROMSP_API_KEY;
    if (!subdomain || !apiKey) throw new Error('SYNCROMSP_SUBDOMAIN and SYNCROMSP_API_KEY are required');
    return new SyncroMSP({ subdomain, apiKey });
  }

  async listTickets(options?: { page?: number; status?: string }): Promise<SMTicketList> {
    return this.client.request<SMTicketList>('/tickets', { params: { page: options?.page, status: options?.status } });
  }
  async getTicket(ticketId: number): Promise<{ ticket: SMTicket }> { return this.client.request(`/tickets/${ticketId}`); }
  async createTicket(data: { subject: string; body?: string; customer_id: number; priority?: string; status?: string }): Promise<{ ticket: SMTicket }> {
    return this.client.request('/tickets', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateTicket(ticketId: number, data: { status?: string; priority?: string; subject?: string }): Promise<{ ticket: SMTicket }> {
    return this.client.request(`/tickets/${ticketId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  async listCustomers(options?: { page?: number }): Promise<{ customers: SMCustomer[] }> {
    return this.client.request('/customers', { params: { page: options?.page } });
  }
  async getCustomer(customerId: number): Promise<{ customer: SMCustomer }> { return this.client.request(`/customers/${customerId}`); }
  async createCustomer(data: { firstname: string; lastname: string; email?: string; business_name?: string }): Promise<{ customer: SMCustomer }> {
    return this.client.request('/customers', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listAssets(options?: { customer_id?: number }): Promise<{ assets: SMAsset[] }> {
    return this.client.request('/customer_assets', { params: { customer_id: options?.customer_id } });
  }

  async listInvoices(options?: { page?: number; customer_id?: number }): Promise<{ invoices: SMInvoice[] }> {
    return this.client.request('/invoices', { params: { page: options?.page, customer_id: options?.customer_id } });
  }

  getClient(): SyncroMSPClient { return this.client; }
}
