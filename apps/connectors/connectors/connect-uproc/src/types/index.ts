export interface UProcConfig { apiKey: string; }

export interface UProcTool { id: string; name: string; description: string; category: string; input_params: { name: string; type: string; required: boolean }[]; output_params: { name: string; type: string }[]; credits_cost: number; }
export interface UProcResult { success: boolean; result: Record<string, unknown>; credits_used: number; credits_remaining: number; }
export interface UProcBatchJob { id: string; status: 'pending' | 'processing' | 'completed' | 'failed'; tool: string; total_rows: number; processed_rows: number; created_at: string; completed_at: string | null; }
export interface UProcCredits { total: number; used: number; remaining: number; }

export class UProcApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'UProcApiError'; this.statusCode = statusCode; }
}
