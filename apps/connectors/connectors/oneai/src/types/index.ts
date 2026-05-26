export interface OneAIConfig { apiKey: string; }

export interface OASkill { skill: string; params?: Record<string, unknown>; }
export interface OALabel { type: string; name: string; value: string; span_text: string; span: number[]; output_spans: { section: number; start: number; end: number }[]; }
export interface OAOutput { text: string; labels: OALabel[]; }
export interface OAPipelineResult { input_text: string; status: string; output: OAOutput[]; stats: { concurrency_wait_time: number; total_running_jobs: number; total_running_time_ms: number }; }

export class OneAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'OneAIApiError'; this.statusCode = statusCode; }
}
