// TalentLMS Connector — Cloud-based Learning Management System
import { TalentLMSClient } from './client';
import type { TalentLMSConfig, TLMSUser, TLMSCourse, TLMSBranch, TLMSEnrollment } from '../types';
export { TalentLMSClient } from './client';

export class TalentLMS {
  private readonly client: TalentLMSClient;
  constructor(config: TalentLMSConfig) { this.client = new TalentLMSClient(config); }

  static fromEnv(): TalentLMS {
    const apiKey = process.env.TALENTLMS_API_KEY;
    const domain = process.env.TALENTLMS_DOMAIN;
    if (!apiKey || !domain) throw new Error('TALENTLMS_API_KEY and TALENTLMS_DOMAIN are required');
    return new TalentLMS({ apiKey, domain });
  }

  // Users
  async listUsers(options?: { page?: number; perPage?: number }): Promise<TLMSUser[]> {
    return this.client.request<TLMSUser[]>('/users', { params: { page: options?.page, per_page: options?.perPage } });
  }
  async getUser(userId: number): Promise<TLMSUser> { return this.client.request<TLMSUser>(`/users/id:${userId}`); }
  async getUserByEmail(email: string): Promise<TLMSUser> { return this.client.request<TLMSUser>(`/users/email:${email}`); }
  async createUser(data: { first_name: string; last_name: string; email: string; login: string; password: string; user_type?: string }): Promise<TLMSUser> {
    return this.client.request<TLMSUser>('/users', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteUser(userId: number): Promise<void> { await this.client.request(`/users/id:${userId}`, { method: 'DELETE' }); }

  // Courses
  async listCourses(): Promise<TLMSCourse[]> { return this.client.request<TLMSCourse[]>('/courses'); }
  async getCourse(courseId: number): Promise<TLMSCourse> { return this.client.request<TLMSCourse>(`/courses/id:${courseId}`); }

  // Enrollments
  async enrollUser(userId: number, courseId: number): Promise<void> {
    await this.client.request('/addusertocourse', { method: 'POST', body: { user_id: userId, course_id: courseId } });
  }
  async removeUserFromCourse(userId: number, courseId: number): Promise<void> {
    await this.client.request('/removeuserfromcourse', { method: 'POST', body: { user_id: userId, course_id: courseId } });
  }
  async getUserEnrollments(userId: number): Promise<TLMSEnrollment[]> {
    const user = await this.client.request<TLMSUser & { courses?: TLMSEnrollment[] }>(`/users/id:${userId}`);
    return user.courses ?? [];
  }

  // Branches (teams/departments)
  async listBranches(): Promise<TLMSBranch[]> { return this.client.request<TLMSBranch[]>('/branches'); }
  async getBranch(branchId: number): Promise<TLMSBranch> { return this.client.request<TLMSBranch>(`/branches/id:${branchId}`); }

  getClient(): TalentLMSClient { return this.client; }
}
