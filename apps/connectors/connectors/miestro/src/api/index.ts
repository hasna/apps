// Miestro Connector — Online course and membership platform
import { MiestroClient } from './client';
import type { MiestroConfig, MiCourse, MiLesson, MiMember, MiMemberList, MiMembership } from '../types';
export { MiestroClient } from './client';

export class Miestro {
  private readonly client: MiestroClient;
  constructor(config: MiestroConfig) { this.client = new MiestroClient(config); }
  static fromEnv(): Miestro {
    const apiKey = process.env.MIESTRO_API_KEY;
    if (!apiKey) throw new Error('MIESTRO_API_KEY is required');
    return new Miestro({ apiKey });
  }

  async listCourses(): Promise<MiCourse[]> { return this.client.request<MiCourse[]>('/courses'); }
  async getCourse(courseId: number): Promise<MiCourse> { return this.client.request<MiCourse>(`/courses/${courseId}`); }

  async listLessons(courseId: number): Promise<MiLesson[]> { return this.client.request<MiLesson[]>(`/courses/${courseId}/lessons`); }
  async getLesson(courseId: number, lessonId: number): Promise<MiLesson> { return this.client.request<MiLesson>(`/courses/${courseId}/lessons/${lessonId}`); }

  async listMembers(options?: { page?: number; per_page?: number; status?: string }): Promise<MiMemberList> {
    return this.client.request<MiMemberList>('/members', { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getMember(memberId: number): Promise<MiMember> { return this.client.request<MiMember>(`/members/${memberId}`); }
  async createMember(data: { email: string; first_name?: string; last_name?: string; password?: string }): Promise<MiMember> {
    return this.client.request<MiMember>('/members', { method: 'POST', body: data as Record<string, unknown> });
  }
  async enrollMember(memberId: number, courseId: number): Promise<void> {
    await this.client.request(`/members/${memberId}/enroll`, { method: 'POST', body: { course_id: courseId } });
  }
  async unenrollMember(memberId: number, courseId: number): Promise<void> {
    await this.client.request(`/members/${memberId}/unenroll`, { method: 'POST', body: { course_id: courseId } });
  }

  async listMemberships(): Promise<MiMembership[]> { return this.client.request<MiMembership[]>('/memberships'); }

  getClient(): MiestroClient { return this.client; }
}
