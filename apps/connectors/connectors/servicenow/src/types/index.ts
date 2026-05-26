export interface ServiceNowConfig { instance: string; username: string; password: string; }

export interface SNRecord { sys_id: string; [key: string]: unknown; }
export interface SNRecordList { result: SNRecord[]; }
export interface SNSingleRecord { result: SNRecord; }
export interface SNIncident { sys_id: string; number: string; short_description: string; description: string; state: string; priority: string; urgency: string; impact: string; assigned_to: { value: string; display_value: string }; caller_id: { value: string; display_value: string }; category: string; opened_at: string; resolved_at: string | null; closed_at: string | null; }
export interface SNUser { sys_id: string; user_name: string; first_name: string; last_name: string; email: string; active: string; department: { value: string; display_value: string }; }
export interface SNAttachment { sys_id: string; file_name: string; content_type: string; size_bytes: string; table_name: string; table_sys_id: string; }

export class ServiceNowApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ServiceNowApiError'; this.statusCode = statusCode; }
}
