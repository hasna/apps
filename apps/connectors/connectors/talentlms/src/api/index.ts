// TalentLMS Connector — Cloud-based learning management system
import { TalentLMSClient } from './client';
import type { TalentLMSConfig, TLMSUser, TLMSCourse, TLMSBranch, TLMSCategory, TLMSGroup } from '../types';
export { TalentLMSClient } from './client';

export class TalentLMS {
  private readonly client: TalentLMSClient;
  constructor(config: TalentLMSConfig) { this.client = new TalentLMSClient(config); }
  static fromEnv(): TalentLMS {
    const apiKey = process.env.TALENTLMS_API_KEY;
    const subdomain = process.env.TALENTLMS_SUBDOMAIN;
    if (!apiKey || !subdomain) throw new Error('TALENTLMS_API_KEY and TALENTLMS_SUBDOMAIN are required');
    return new TalentLMS({ apiKey, subdomain });
  }

  async listUsers(): Promise<TLMSUser[]> { return this.client.request<TLMSUser[]>('/users'); }
  async getUser(userId: string): Promise<TLMSUser> { return this.client.request<TLMSUser>(`/users/id:${userId}`); }
  async getUserByEmail(email: string): Promise<TLMSUser> { return this.client.request<TLMSUser>(`/users/email:${email}`); }

  async listCourses(): Promise<TLMSCourse[]> { return this.client.request<TLMSCourse[]>('/courses'); }
  async getCourse(courseId: string): Promise<TLMSCourse> { return this.client.request<TLMSCourse>(`/courses/id:${courseId}`); }

  async enrollUser(userId: string, courseId: string, role?: string): Promise<void> {
    await this.client.request('/addusertocourse', { method: 'POST', body: { user_id: userId, course_id: courseId, role: role || 'learner' } });
  }
  async unenrollUser(userId: string, courseId: string): Promise<void> {
    await this.client.request('/removeuserfromcourse', { method: 'POST', body: { user_id: userId, course_id: courseId } });
  }

  async getUserStatus(userId: string, courseId: string): Promise<Record<string, unknown>> {
    return this.client.request(`/getuserstatusincourse/user_id:${userId},course_id:${courseId}`);
  }

  async listBranches(): Promise<TLMSBranch[]> { return this.client.request<TLMSBranch[]>('/branches'); }
  async listCategories(): Promise<TLMSCategory[]> { return this.client.request<TLMSCategory[]>('/categories'); }
  async listGroups(): Promise<TLMSGroup[]> { return this.client.request<TLMSGroup[]>('/groups'); }

  getClient(): TalentLMSClient { return this.client; }
}
