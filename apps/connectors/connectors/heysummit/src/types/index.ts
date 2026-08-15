export interface HeySummitConfig { apiKey: string; }

export interface HSEvent { id: number; title: string; slug: string; description: string; start_date: string; end_date: string; timezone: string; status: string; url: string; attendee_count: number; }
export interface HSTalk { id: number; event_id: number; title: string; description: string; speaker: { id: number; name: string; email: string }; start_time: string; end_time: string; status: string; }
export interface HSSpeaker { id: number; name: string; email: string; bio: string; company: string; title: string; photo_url: string; }
export interface HSAttendee { id: number; event_id: number; email: string; first_name: string; last_name: string; registered_at: string; status: string; }
export interface HSAttendeeList { results: HSAttendee[]; count: number; next: string | null; }

export class HeySummitApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HeySummitApiError'; this.statusCode = statusCode; }
}
