export interface HubPlannerConfig { apiKey: string; baseUrl?: string; }

export interface HPResource { _id: string; firstName: string; lastName: string; email: string; role: string; resourceRates?: Array<{ internalRate: number; externalRate: number }>; }
export interface HPProject { _id: string; name: string; description?: string; status: 'STATUS_ACTIVE' | 'STATUS_DONE' | 'STATUS_ARCHIVED'; startDate?: string; endDate?: string; }
export interface HPBooking { _id: string; project: string; resource: string; start: string; end: string; duration: number; type: 'TIME_OFF' | 'BOOKING'; note?: string; }
export interface HPEvent { _id: string; title: string; start: string; end: string; resource?: string; project?: string; }

export class HubPlannerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HubPlannerApiError'; this.statusCode = statusCode; }
}
