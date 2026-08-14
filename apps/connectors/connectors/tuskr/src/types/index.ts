export interface TuskrConfig { token: string; }

export interface TKProject { id: string; name: string; description: string; key: string; status: string; created_at: string; }
export interface TKTestCase { id: string; project_id: string; title: string; description: string; preconditions: string; steps: { step: string; expected_result: string }[]; priority: string; type: string; folder_id: string | null; created_at: string; }
export interface TKTestRun { id: string; project_id: string; name: string; description: string; status: string; total: number; passed: number; failed: number; blocked: number; skipped: number; created_at: string; }
export interface TKTestResult { id: string; test_run_id: string; test_case_id: string; status: 'passed' | 'failed' | 'blocked' | 'skipped' | 'untested'; comment: string; tester: string; executed_at: string; }
export interface TKFolder { id: string; name: string; parent_id: string | null; project_id: string; }

export class TuskrApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TuskrApiError'; this.statusCode = statusCode; }
}
