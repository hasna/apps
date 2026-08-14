export interface DayScheduleConfig { apiKey: string; }

export interface DSBooking { id: string; event_type_id: string; start_time: string; end_time: string; status: string; invitee: { name: string; email: string; timezone: string }; location: string | null; created_at: string; }
export interface DSBookingList { bookings: DSBooking[]; total: number; page: number; per_page: number; }
export interface DSEventType { id: string; name: string; description: string; duration: number; color: string; booking_url: string; active: boolean; }
export interface DSAvailability { date: string; slots: { start_time: string; end_time: string }[]; }
export interface DSTeamMember { id: string; name: string; email: string; role: string; timezone: string; }

export class DayScheduleApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DayScheduleApiError'; this.statusCode = statusCode; }
}
