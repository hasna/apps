// Launch27 Connector — Online booking and scheduling for service businesses
import { Launch27Client } from './client';
import type { Launch27Config, L27Service, L27Booking, L27Customer, L27TimeSlot } from '../types';
export { Launch27Client } from './client';

export class Launch27 {
  private readonly client: Launch27Client;
  constructor(config: Launch27Config) { this.client = new Launch27Client(config); }
  static fromEnv(): Launch27 {
    const apiKey = process.env.LAUNCH27_API_KEY;
    if (!apiKey) throw new Error('LAUNCH27_API_KEY environment variable is required');
    return new Launch27({ apiKey });
  }

  async listServices(): Promise<L27Service[]> { const r = await this.client.request<{ data: L27Service[] }>('/services'); return r.data ?? []; }
  async getService(id: number): Promise<L27Service> { return this.client.request<L27Service>(`/services/${id}`); }

  async listBookings(options?: { status?: string; from?: string; to?: string; page?: number }): Promise<L27Booking[]> {
    const r = await this.client.request<{ data: L27Booking[] }>('/bookings', { params: options as Record<string, string | number | undefined> });
    return r.data ?? [];
  }
  async getBooking(id: number): Promise<L27Booking> { return this.client.request<L27Booking>(`/bookings/${id}`); }
  async createBooking(data: { service_id: number; customer: { name: string; email: string; phone?: string }; start_time: string; notes?: string }): Promise<L27Booking> {
    return this.client.request<L27Booking>('/bookings', { method: 'POST', body: data as Record<string, unknown> });
  }
  async cancelBooking(id: number): Promise<void> { await this.client.request(`/bookings/${id}/cancel`, { method: 'POST' }); }

  async getAvailability(serviceId: number, date: string): Promise<L27TimeSlot[]> {
    const r = await this.client.request<{ data: L27TimeSlot[] }>(`/services/${serviceId}/availability`, { params: { date } });
    return r.data ?? [];
  }

  async listCustomers(options?: { page?: number; search?: string }): Promise<L27Customer[]> {
    const r = await this.client.request<{ data: L27Customer[] }>('/customers', { params: options as Record<string, string | number | undefined> });
    return r.data ?? [];
  }
  async getCustomer(id: number): Promise<L27Customer> { return this.client.request<L27Customer>(`/customers/${id}`); }

  getClient(): Launch27Client { return this.client; }
}
