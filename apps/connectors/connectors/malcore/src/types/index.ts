export interface MalcoreConfig { apiKey: string; }

export interface MCAnalysis { id: string; status: 'pending' | 'processing' | 'completed' | 'failed'; sha256: string; file_name: string; file_size: number; file_type: string; score: number; verdict: 'clean' | 'suspicious' | 'malicious'; threats: MCThreat[]; created_at: string; completed_at: string | null; }
export interface MCThreat { name: string; category: string; severity: string; description: string; }
export interface MCUrlAnalysis { id: string; url: string; status: string; score: number; verdict: string; threats: MCThreat[]; screenshot_url: string | null; created_at: string; }
export interface MCQuota { scans_remaining: number; scans_total: number; reset_at: string; }

export class MalcoreApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MalcoreApiError'; this.statusCode = statusCode; }
}
