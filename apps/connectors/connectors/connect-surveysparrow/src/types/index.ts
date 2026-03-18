export interface SurveySparrowConfig { apiKey: string; baseUrl?: string; }

export interface SSSurvey { id: number; name: string; status: 'Live' | 'Draft' | 'Closed'; type: string; created_at: string; updated_at: string; question_count: number; response_count: number; }
export interface SSContact { id: number; full_name: string; email: string; phone?: string; created_at: string; variables?: Record<string, string>; }
export interface SSSubmission { id: number; survey_id: number; contact?: SSContact; submitted_at: string; answers: Array<{ question_id: number; answer: unknown; question_text: string }>; }
export interface SSChannel { id: number; survey_id: number; name: string; type: string; link: string; active: boolean; }

export class SurveySparrowApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SurveySparrowApiError'; this.statusCode = statusCode; }
}
