export interface HubPlannerConfig { apiKey: string; }

export interface HPResource { _id: string; firstName: string; lastName: string; email: string; role: string; status: string; department: string; created: string; updated: string; }
export interface HPProject { _id: string; name: string; status: string; budget: { type: string; hours: number }; start: string; end: string; clients: string[]; tags: string[]; created: string; }
export interface HPBooking { _id: string; resource: string; project: string; start: string; end: string; allDay: boolean; hours: number; status: string; note: string; created: string; }
export interface HPTimeEntry { _id: string; resource: string; project: string; date: string; hours: number; note: string; status: string; created: string; }
export interface HPEvent { _id: string; name: string; start: string; end: string; allDay: boolean; resources: string[]; }

export class HubPlannerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HubPlannerApiError'; this.statusCode = statusCode; }
}
