export interface FloatConfig { token: string; }

export interface FLPerson { people_id: number; name: string; email: string; job_title: string; department: string; tags: string[]; active: boolean; created: string; modified: string; }
export interface FLProject { project_id: number; name: string; client: string; color: string; budget_total: number; budget_type: string; tags: string[]; active: boolean; created: string; modified: string; }
export interface FLTask { task_id: number; project_id: number; people_id: number; name: string; start_date: string; end_date: string; hours: number; status: string; repeat_state: number; created: string; modified: string; }
export interface FLTimeOff { timeoff_id: number; people_id: number; start_date: string; end_date: string; hours: number; timeoff_type_id: number; name: string; }
export interface FLClient { client_id: number; name: string; }
export interface FLDepartment { department_id: number; name: string; }

export class FloatApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FloatApiError'; this.statusCode = statusCode; }
}
