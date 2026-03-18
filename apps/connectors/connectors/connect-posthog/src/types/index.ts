export interface PostHogConfig { apiKey: string; host?: string; projectId?: string; }

export interface PHEvent { uuid: string; event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string; created_at: string; }
export interface PHPerson { id: string; uuid: string; distinct_ids: string[]; properties: Record<string, unknown>; created_at: string; }
export interface PHFeatureFlag { id: number; key: string; name: string; is_simple_flag: boolean; active: boolean; rollout_percentage: number | null; filters: Record<string, unknown>; }
export interface PHInsight { id: number; name: string; description: string; result: unknown; created_at: string; }
export interface PHCohort { id: number; name: string; count: number; created_at: string; }

export class PostHogApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PostHogApiError'; this.statusCode = statusCode; }
}
