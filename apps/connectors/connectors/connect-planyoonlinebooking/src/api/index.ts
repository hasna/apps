// Planyo Online Booking Connector — Online booking and reservation management
import { PlanyoClient } from './client';
import type { PlanyoConfig, PLResource, PLReservation, PLAvailability, PLSite } from '../types';
export { PlanyoClient } from './client';

export class PlanyoOnlineBooking {
  private readonly client: PlanyoClient;
  constructor(config: PlanyoConfig) { this.client = new PlanyoClient(config); }
  static fromEnv(): PlanyoOnlineBooking {
    const apiKey = process.env.PLANYO_API_KEY;
    if (!apiKey) throw new Error('PLANYO_API_KEY is required');
    return new PlanyoOnlineBooking({ apiKey });
  }

  async listResources(options?: { site_id?: number }): Promise<{ resources: PLResource[] }> {
    return this.client.request('list_resources', { site_id: options?.site_id });
  }
  async getResource(resourceId: number): Promise<PLResource> {
    return this.client.request<PLResource>('get_resource_info', { resource_id: resourceId });
  }

  async listReservations(options?: { resource_id?: number; start_time?: string; end_time?: string }): Promise<PLReservationList> {
    return this.client.request<PLReservationList>('list_reservations', { resource_id: options?.resource_id, start_time: options?.start_time, end_time: options?.end_time });
  }
  async getReservation(reservationId: number): Promise<PLReservation> {
    return this.client.request<PLReservation>('get_reservation_info', { reservation_id: reservationId });
  }
  async createReservation(data: { resource_id: number; start_time: string; end_time: string; first_name: string; last_name: string; email: string }): Promise<{ reservation_id: number }> {
    return this.client.request('make_reservation', data as Record<string, string | number>);
  }
  async cancelReservation(reservationId: number): Promise<void> {
    await this.client.request('cancel_reservation', { reservation_id: reservationId });
  }

  async checkAvailability(resourceId: number, startDate: string, endDate: string): Promise<PLAvailability[]> {
    return this.client.request<PLAvailability[]>('is_resource_available', { resource_id: resourceId, start_date: startDate, end_date: endDate });
  }

  async getSite(): Promise<PLSite> { return this.client.request<PLSite>('get_site_info'); }

  getClient(): PlanyoClient { return this.client; }
}
