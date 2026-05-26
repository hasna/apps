export interface PractiTestConfig { email: string; apiToken: string; }

export interface PTProject { id: string; attributes: { name: string; description: string; created_at: string; updated_at: string }; }
export interface PTTestCase { id: string; attributes: { name: string; description: string; status: string; priority: string; custom_fields: Record<string, unknown>; created_at: string; updated_at: string }; }
export interface PTTestSet { id: string; attributes: { name: string; description: string; planned_execution: string; priority: string; created_at: string }; }
export interface PTInstance { id: string; attributes: { test_id: string; set_id: string; run_status: string; last_run: string; tester_id: string | null }; }
export interface PTRun { id: string; attributes: { instance_id: string; status: string; custom_fields: Record<string, unknown>; created_at: string; run_duration: string }; }
export interface PTIssue { id: string; attributes: { title: string; description: string; severity: string; status: string; author_id: string; created_at: string }; }

export class PractiTestApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PractiTestApiError'; this.statusCode = statusCode; }
}
