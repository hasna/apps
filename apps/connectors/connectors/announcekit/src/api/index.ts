// AnnounceKit Connector — In-app changelog and announcements
import { AnnounceKitClient } from './client';
import type { AnnounceKitConfig, AKProject, AKPost, AKLabel, AKFeedback, AKWidget } from '../types';
export { AnnounceKitClient } from './client';

export class AnnounceKit {
  private readonly client: AnnounceKitClient;
  constructor(config: AnnounceKitConfig) { this.client = new AnnounceKitClient(config); }
  static fromEnv(): AnnounceKit {
    const token = process.env.ANNOUNCEKIT_TOKEN;
    if (!token) throw new Error('ANNOUNCEKIT_TOKEN is required');
    return new AnnounceKit({ token });
  }

  async listProjects(): Promise<AKProject[]> { return this.client.request<AKProject[]>('/projects'); }
  async getProject(projectId: string): Promise<AKProject> { return this.client.request<AKProject>(`/projects/${projectId}`); }

  async listPosts(projectId: string): Promise<AKPost[]> { return this.client.request<AKPost[]>(`/projects/${projectId}/posts`); }
  async getPost(projectId: string, postId: string): Promise<AKPost> { return this.client.request<AKPost>(`/projects/${projectId}/posts/${postId}`); }
  async createPost(projectId: string, data: { title: string; body: string; visible?: boolean; is_draft?: boolean; labels?: string[] }): Promise<AKPost> {
    return this.client.request<AKPost>(`/projects/${projectId}/posts`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async updatePost(projectId: string, postId: string, data: { title?: string; body?: string; visible?: boolean; is_draft?: boolean }): Promise<AKPost> {
    return this.client.request<AKPost>(`/projects/${projectId}/posts/${postId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deletePost(projectId: string, postId: string): Promise<void> { await this.client.request(`/projects/${projectId}/posts/${postId}`, { method: 'DELETE' }); }

  async listLabels(projectId: string): Promise<AKLabel[]> { return this.client.request<AKLabel[]>(`/projects/${projectId}/labels`); }
  async createLabel(projectId: string, data: { name: string; color: string }): Promise<AKLabel> {
    return this.client.request<AKLabel>(`/projects/${projectId}/labels`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listFeedback(projectId: string, postId: string): Promise<AKFeedback[]> { return this.client.request<AKFeedback[]>(`/projects/${projectId}/posts/${postId}/feedback`); }

  async listWidgets(projectId: string): Promise<AKWidget[]> { return this.client.request<AKWidget[]>(`/projects/${projectId}/widgets`); }

  getClient(): AnnounceKitClient { return this.client; }
}
