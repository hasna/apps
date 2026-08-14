export interface Launch27Config { apiKey: string; baseUrl?: string; }

export interface L27Service { id: number; name: string; description: string; duration: number; price: number; currency: string; active: boolean; }
export interface L27Booking { id: number; service_id: number; customer: { name: string; email: string; phone?: string }; start_time: string; end_time: string; status: 'pending' | 'confirmed' | 'completed' | 'cancelled'; notes?: string; created_at: string; }
export interface L27Customer { id: number; name: string; email: string; phone?: string; bookings_count: number; created_at: string; }
export interface L27TimeSlot { start: string; end: string; available: boolean; }

export class Launch27ApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'Launch27ApiError'; this.statusCode = statusCode; }
}
