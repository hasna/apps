export interface BugBugConfig { apiKey: string; }

export interface BBTest { id: string; name: string; suite_id: string; status: string; steps: BBStep[]; created_at: string; updated_at: string; }
export interface BBStep { id: string; type: string; action: string; selector?: string; value?: string; }
export interface BBSuite { id: string; name: string; tests: string[]; created_at: string; }
export interface BBRun { id: string; test_id: string; suite_id?: string; status: 'passed' | 'failed' | 'running' | 'queued'; started_at: string; finished_at: string | null; duration: number | null; browser: string; results: BBStepResult[]; }
export interface BBStepResult { step_id: string; status: 'passed' | 'failed' | 'skipped'; duration: number; error?: string; screenshot_url?: string; }
export interface BBProject { id: string; name: string; url: string; created_at: string; }

export class BugBugApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BugBugApiError'; this.statusCode = statusCode; }
}
