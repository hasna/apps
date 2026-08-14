export interface TeamupConfig { apiKey: string; calendarKey: string; }

export interface TUEvent { id: string; subcalendar_id: number; subject: string; notes: string; start_dt: string; end_dt: string; all_day: boolean; location: string; who: string; rrule: string | null; custom: Record<string, string>; }
export interface TUSubCalendar { id: number; name: string; active: boolean; color: number; overlap: boolean; readonly: boolean; }
export interface TUEventList { events: TUEvent[]; timestamp: number; }

export class TeamupApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TeamupApiError'; this.statusCode = statusCode; }
}
