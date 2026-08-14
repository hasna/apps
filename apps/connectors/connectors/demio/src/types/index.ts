export interface DemioConfig { apiKey: string; apiSecret: string; }

export interface DemioEvent { id: number; name: string; description: string; registration_url: string; type: string; status: string; date_id: number | null; created_at: string; }
export interface DemioDate { date_id: number; event_id: number; datetime: string; timezone: string; status: string; duration: number; room_url: string; registration_count: number; attendance_count: number; }
export interface DemioRegistrant { id: number; name: string; email: string; status: string; join_link: string; registered_at: string; }
export interface DemioParticipant { id: number; name: string; email: string; attended_minutes: number; joined_at: string; left_at: string; }

export class DemioApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DemioApiError'; this.statusCode = statusCode; }
}
