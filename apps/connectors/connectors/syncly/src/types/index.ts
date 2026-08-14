export interface SynclyConfig { apiKey: string; }

export interface SYFeedback { id: string; content: string; source: string; sentiment: 'positive' | 'negative' | 'neutral'; category: string; tags: string[]; customer: { id: string; name: string; email: string } | null; created_at: string; }
export interface SYFeedbackList { feedback: SYFeedback[]; total: number; page: number; per_page: number; }
export interface SYInsight { id: string; title: string; description: string; feedback_count: number; sentiment_score: number; trend: string; created_at: string; }
export interface SYCategory { id: string; name: string; feedback_count: number; }
export interface SYIntegration { id: string; name: string; type: string; status: string; }

export class SynclyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SynclyApiError'; this.statusCode = statusCode; }
}
