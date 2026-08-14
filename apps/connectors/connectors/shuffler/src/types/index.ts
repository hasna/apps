export interface ShufflerConfig { apiKey: string; baseUrl?: string; }

export interface SHWorkflow { id: string; name: string; description: string; status: string; is_valid: boolean; actions: SHAction[]; triggers: SHTrigger[]; created_at: string; updated_at: string; }
export interface SHAction { id: string; app_name: string; app_action: string; label: string; position: { x: number; y: number }; parameters: Record<string, unknown>[]; }
export interface SHTrigger { id: string; app_name: string; trigger_type: string; status: string; }
export interface SHExecution { execution_id: string; workflow_id: string; status: string; started_at: string; completed_at: string | null; results: Record<string, unknown>[]; }
export interface SHApp { id: string; name: string; description: string; version: string; actions: { name: string; description: string; parameters: { name: string; required: boolean }[] }[]; }

export class ShufflerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ShufflerApiError'; this.statusCode = statusCode; }
}
