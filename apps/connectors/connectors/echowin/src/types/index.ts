export interface EchowinConfig { apiKey: string; }

export interface EWScenario { id: string; name: string; description: string; phone_number: string; greeting: string; status: string; created_at: string; }
export interface EWCall { id: string; scenario_id: string; caller_number: string; duration: number; status: string; transcript: string; summary: string; sentiment: string; created_at: string; }
export interface EWCallList { calls: EWCall[]; total: number; page: number; per_page: number; }
export interface EWPhoneNumber { id: string; number: string; country: string; status: string; scenario_id: string | null; }
export interface EWAnalytics { total_calls: number; avg_duration: number; sentiment_breakdown: { positive: number; negative: number; neutral: number }; }

export class EchowinApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'EchowinApiError'; this.statusCode = statusCode; }
}
