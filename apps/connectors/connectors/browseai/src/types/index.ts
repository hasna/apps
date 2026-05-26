export interface BrowseAIConfig { apiKey: string; }

export interface BARobot { id: string; name: string; created_at: string; input_parameters: { name: string; type: string; required: boolean }[]; }
export interface BATask { id: string; robot_id: string; status: 'successful' | 'failed' | 'running' | 'queued'; started_at: string; finished_at: string | null; captured_data: Record<string, unknown>; input_parameters: Record<string, string>; }
export interface BATaskList { result: { robotTasks: BATask[] }; statusCode: number; totalCount: number; }

export class BrowseAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BrowseAIApiError'; this.statusCode = statusCode; }
}
