export interface PlanyoConfig { apiKey: string; }

export interface PLResource { id: number; name: string; description: string; quantity: number; unit_price: number; currency: string; }
export interface PLReservation { id: number; resource_id: number; start_time: string; end_time: string; first_name: string; last_name: string; email: string; phone: string; status: string; total_price: number; created: string; }
export interface PLReservationList { results: PLReservation[]; total: number; }
export interface PLAvailability { date: string; available: boolean; quantity_available: number; }
export interface PLSite { id: number; name: string; description: string; timezone: string; currency: string; }

export class PlanyoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PlanyoApiError'; this.statusCode = statusCode; }
}
