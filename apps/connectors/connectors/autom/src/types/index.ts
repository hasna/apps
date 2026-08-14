export interface AutomConfig { apiKey: string; }

export interface AutomWorkflow { id: string; name: string; description: string; status: 'active' | 'inactive' | 'draft'; trigger: { type: string; config: Record<string, unknown> }; steps: AutomStep[]; created_at: string; updated_at: string; }
export interface AutomStep { id: string; type: string; name: string; config: Record<string, unknown>; position: number; }
export interface AutomExecution { id: string; workflow_id: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; started_at: string; finished_at: string | null; trigger_data: Record<string, unknown>; error?: string; }
export interface AutomExecutionList { executions: AutomExecution[]; total: number; page: number; }
export interface AutomWebhook { id: string; url: string; events: string[]; workflow_id: string; created_at: string; }

export class AutomApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AutomApiError'; this.statusCode = statusCode; }
}
