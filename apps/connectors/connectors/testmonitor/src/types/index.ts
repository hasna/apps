export interface TestMonitorConfig { domain: string; token: string; }

export interface TMProject { id: number; name: string; description: string; status: string; created_at: string; updated_at: string; }
export interface TMTestCase { id: number; project_id: number; name: string; description: string; preconditions: string; steps: string; expected_result: string; priority: string; type: string; folder_id: number | null; created_at: string; }
export interface TMTestRun { id: number; project_id: number; name: string; description: string; status: string; test_cases_count: number; passed_count: number; failed_count: number; created_at: string; }
export interface TMTestResult { id: number; test_run_id: number; test_case_id: number; status: 'passed' | 'failed' | 'blocked' | 'skipped' | 'not_run'; comment: string; tester: { id: number; name: string }; executed_at: string; }
export interface TMFolder { id: number; name: string; parent_id: number | null; project_id: number; }

export class TestMonitorApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TestMonitorApiError'; this.statusCode = statusCode; }
}
