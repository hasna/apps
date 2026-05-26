export interface MiestroConfig { apiKey: string; }

export interface MiCourse { id: number; title: string; description: string; price: number; currency: string; status: string; enrollment_count: number; created_at: string; updated_at: string; }
export interface MiLesson { id: number; course_id: number; title: string; description: string; content_type: string; position: number; duration: number; is_free: boolean; }
export interface MiMember { id: number; email: string; first_name: string; last_name: string; status: string; created_at: string; courses: { id: number; title: string; progress: number }[]; }
export interface MiMemberList { members: MiMember[]; total: number; page: number; per_page: number; }
export interface MiMembership { id: number; name: string; price: number; currency: string; interval: string; member_count: number; }

export class MiestroApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MiestroApiError'; this.statusCode = statusCode; }
}
