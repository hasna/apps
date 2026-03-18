export interface WebinarJamConfig { apiKey: string; }

export interface WJWebinar { webinar_id: string; name: string; description: string; schedule: { date: string; timezone: string; comment: string }[]; registration_url: string; }
export interface WJRegistrant { name: string; email: string; schedule: number; webinar_id: string; }
export interface WJRegistrantResult { user: { first_name: string; last_name: string; email: string; live_room_url: string; replay_room_url: string; thank_you_url: string }; }

export class WebinarJamApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'WebinarJamApiError'; this.statusCode = statusCode; }
}
