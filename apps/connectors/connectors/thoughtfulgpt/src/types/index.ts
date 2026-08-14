export interface ThoughtfulGPTConfig { apiKey: string; }

export interface TGAutomation { id: string; name: string; description: string; type: string; status: string; created_at: string; updated_at: string; }
export interface TGRun { id: string; automation_id: string; status: 'pending' | 'running' | 'completed' | 'failed'; input: Record<string, unknown>; output: Record<string, unknown> | null; started_at: string; completed_at: string | null; error: string | null; }
export interface TGRunList { runs: TGRun[]; total: number; page: number; per_page: number; }
export interface TGAgent { id: string; name: string; type: string; capabilities: string[]; status: string; }

export class ThoughtfulGPTApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ThoughtfulGPTApiError'; this.statusCode = statusCode; }
}
