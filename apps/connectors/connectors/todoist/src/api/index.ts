// Todoist Connector
// Projects, tasks, sections, labels, and comments management

import { TodoistClient } from './client';
import type {
  TodoistConfig,
  Project,
  Section,
  Task,
  Label,
  Comment,
  Collaborator,
  CreateProjectInput,
  UpdateProjectInput,
  CreateSectionInput,
  UpdateSectionInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateLabelInput,
  UpdateLabelInput,
  CreateCommentInput,
  UpdateCommentInput,
} from '../types';

export { TodoistClient } from './client';

export class Todoist {
  private client: TodoistClient;

  constructor(config: TodoistConfig) {
    this.client = new TodoistClient(config);
  }

  // ============================================
  // Project Operations
  // ============================================

  async listProjects(): Promise<Project[]> {
    return this.client.get<Project[]>('/projects');
  }

  async getProject(projectId: string): Promise<Project> {
    return this.client.get<Project>(`/projects/${projectId}`);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.client.post<Project>('/projects', input);
  }

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
    return this.client.post<Project>(`/projects/${projectId}`, input);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/projects/${projectId}`);
  }

  async getCollaborators(projectId: string): Promise<Collaborator[]> {
    return this.client.get<Collaborator[]>(`/projects/${projectId}/collaborators`);
  }

  // ============================================
  // Section Operations
  // ============================================

  async listSections(projectId?: string): Promise<Section[]> {
    return this.client.get<Section[]>('/sections', { project_id: projectId });
  }

  async getSection(sectionId: string): Promise<Section> {
    return this.client.get<Section>(`/sections/${sectionId}`);
  }

  async createSection(input: CreateSectionInput): Promise<Section> {
    return this.client.post<Section>('/sections', input);
  }

  async updateSection(sectionId: string, input: UpdateSectionInput): Promise<Section> {
    return this.client.post<Section>(`/sections/${sectionId}`, input);
  }

  async deleteSection(sectionId: string): Promise<void> {
    await this.client.delete(`/sections/${sectionId}`);
  }

  // ============================================
  // Task Operations
  // ============================================

  async listTasks(options?: {
    project_id?: string;
    section_id?: string;
    label?: string;
    filter?: string;
    lang?: string;
    ids?: string[];
  }): Promise<Task[]> {
    const params: Record<string, string | undefined> = {
      project_id: options?.project_id,
      section_id: options?.section_id,
      label: options?.label,
      filter: options?.filter,
      lang: options?.lang,
      ids: options?.ids?.join(','),
    };
    return this.client.get<Task[]>('/tasks', params);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.client.get<Task>(`/tasks/${taskId}`);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.client.post<Task>('/tasks', input);
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
    return this.client.post<Task>(`/tasks/${taskId}`, input);
  }

  async closeTask(taskId: string): Promise<void> {
    await this.client.post(`/tasks/${taskId}/close`);
  }

  async reopenTask(taskId: string): Promise<void> {
    await this.client.post(`/tasks/${taskId}/reopen`);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.client.delete(`/tasks/${taskId}`);
  }

  // ============================================
  // Label Operations
  // ============================================

  async listLabels(): Promise<Label[]> {
    return this.client.get<Label[]>('/labels');
  }

  async getLabel(labelId: string): Promise<Label> {
    return this.client.get<Label>(`/labels/${labelId}`);
  }

  async createLabel(input: CreateLabelInput): Promise<Label> {
    return this.client.post<Label>('/labels', input);
  }

  async updateLabel(labelId: string, input: UpdateLabelInput): Promise<Label> {
    return this.client.post<Label>(`/labels/${labelId}`, input);
  }

  async deleteLabel(labelId: string): Promise<void> {
    await this.client.delete(`/labels/${labelId}`);
  }

  // ============================================
  // Comment Operations
  // ============================================

  async listComments(options: { task_id?: string; project_id?: string }): Promise<Comment[]> {
    return this.client.get<Comment[]>('/comments', options);
  }

  async getComment(commentId: string): Promise<Comment> {
    return this.client.get<Comment>(`/comments/${commentId}`);
  }

  async createComment(input: CreateCommentInput): Promise<Comment> {
    return this.client.post<Comment>('/comments', input);
  }

  async updateComment(commentId: string, input: UpdateCommentInput): Promise<Comment> {
    return this.client.post<Comment>(`/comments/${commentId}`, input);
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.client.delete(`/comments/${commentId}`);
  }

  // ============================================
  // Utility Methods
  // ============================================

  getClient(): TodoistClient {
    return this.client;
  }
}
