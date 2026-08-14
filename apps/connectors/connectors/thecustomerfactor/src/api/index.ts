// The Customer Factor Connector — CRM and scheduling for service businesses
import { TheCustomerFactorClient } from './client';
import type { TheCustomerFactorConfig, TCFCustomer, TCFJob, TCFInvoice, TCFEstimate } from '../types';
export { TheCustomerFactorClient } from './client';

export class TheCustomerFactor {
  private readonly client: TheCustomerFactorClient;
  constructor(config: TheCustomerFactorConfig) { this.client = new TheCustomerFactorClient(config); }
  static fromEnv(): TheCustomerFactor {
    const apiKey = process.env.THECUSTOMERFACTOR_API_KEY;
    if (!apiKey) throw new Error('THECUSTOMERFACTOR_API_KEY is required');
    return new TheCustomerFactor({ apiKey });
  }

  async listCustomers(options?: { page?: number; search?: string }): Promise<{ customers: TCFCustomer[] }> {
    return this.client.request('/customers', { params: { page: options?.page, search: options?.search } });
  }
  async getCustomer(customerId: number): Promise<TCFCustomer> { return this.client.request<TCFCustomer>(`/customers/${customerId}`); }
  async createCustomer(data: { first_name: string; last_name: string; email?: string; phone?: string; address?: string; city?: string; state?: string; zip?: string }): Promise<TCFCustomer> {
    return this.client.request<TCFCustomer>('/customers', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listJobs(options?: { customer_id?: number; status?: string; page?: number }): Promise<{ jobs: TCFJob[] }> {
    return this.client.request('/jobs', { params: { customer_id: options?.customer_id, status: options?.status, page: options?.page } });
  }
  async getJob(jobId: number): Promise<TCFJob> { return this.client.request<TCFJob>(`/jobs/${jobId}`); }
  async createJob(data: { customer_id: number; description: string; scheduled_date: string; amount?: number; crew?: string }): Promise<TCFJob> {
    return this.client.request<TCFJob>('/jobs', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateJob(jobId: number, data: { status?: string; completed_date?: string; notes?: string }): Promise<TCFJob> {
    return this.client.request<TCFJob>(`/jobs/${jobId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  async listInvoices(options?: { customer_id?: number; status?: string }): Promise<{ invoices: TCFInvoice[] }> {
    return this.client.request('/invoices', { params: { customer_id: options?.customer_id, status: options?.status } });
  }

  async listEstimates(options?: { customer_id?: number }): Promise<{ estimates: TCFEstimate[] }> {
    return this.client.request('/estimates', { params: { customer_id: options?.customer_id } });
  }

  getClient(): TheCustomerFactorClient { return this.client; }
}
