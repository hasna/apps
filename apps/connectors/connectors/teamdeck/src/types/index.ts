export interface TeamdeckConfig { apiKey: string; baseUrl?: string; }

export interface TDResource { id: number; name: string; email: string; role: string; availability: number; tags?: string[]; }
export interface TDProject { id: number; name: string; color: string; active: boolean; budget?: number; archived: boolean; }
export interface TDTimeEntry { id: number; resource_id: number; project_id: number; minutes: number; weekday: string; creator_resource_id: number; description?: string; }
export interface TDBooking { id: number; resource_id: number; project_id: number; start_date: string; end_date: string; hours_per_day: number; description?: string; }
export interface TDVacation { id: number; resource_id: number; start_date: string; end_date: string; minutes: number; approved: boolean; }

export class TeamdeckApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TeamdeckApiError'; this.statusCode = statusCode; }
}
