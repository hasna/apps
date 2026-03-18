export interface TalentLMSConfig { apiKey: string; subdomain: string; }

export interface TLMSUser { id: string; login: string; first_name: string; last_name: string; email: string; user_type: string; status: string; created_on: string; last_updated_on: string; courses: { id: string; name: string; role: string; enrolled_on: string; completed_on: string | null; completion_status: string; completion_percentage: string }[]; }
export interface TLMSCourse { id: string; name: string; code: string; category_id: string; description: string; price: string; status: string; creation_date: string; last_update_on: string; users_count: number; }
export interface TLMSBranch { id: string; name: string; description: string; users_count: number; courses_count: number; }
export interface TLMSCategory { id: string; name: string; parent_category_id: string; courses: { id: string; name: string }[]; }
export interface TLMSGroup { id: string; name: string; description: string; key: string; users_count: number; courses: { id: string; name: string }[]; }

export class TalentLMSApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TalentLMSApiError'; this.statusCode = statusCode; }
}
