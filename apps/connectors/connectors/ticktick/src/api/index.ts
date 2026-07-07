import { TickTickClient } from './client';
import type {
  TickTickConfig,
  Project,
  ProjectWithData,
  Task,
  CreateProjectInput,
  UpdateProjectInput,
  CreateTaskInput,
  UpdateTaskInput,
} from '../types';

export { TickTickClient } from './client';

export class TickTick {
  private client: TickTickClient;

  constructor(config: TickTickConfig) {
    this.client = new TickTickClient(config);
  }

  async listProjects(): Promise<Project[]> {
    return this.client.get<Project[]>('/project');
  }

  async getProject(projectId: string): Promise<Project> {
    return this.client.get<Project>(`/project/${encodeURIComponent(projectId)}`);
  }

  async getProjectWithData(projectId: string): Promise<ProjectWithData> {
    return this.client.get<ProjectWithData>(`/project/${encodeURIComponent(projectId)}/data`);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.client.post<Project>('/project', input as unknown as Record<string, unknown>);
  }

  async updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
    return this.client.post<Project>(`/project/${encodeURIComponent(projectId)}`, input as unknown as Record<string, unknown>);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/project/${encodeURIComponent(projectId)}`);
  }

  async getTask(projectId: string, taskId: string): Promise<Task> {
    return this.client.get<Task>(
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
    );
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    if (!input.projectId) {
      throw new Error('projectId is required to create a TickTick task');
    }
    return this.client.post<Task>('/task', input as unknown as Record<string, unknown>);
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
    if (!input.projectId) {
      throw new Error('projectId is required to update a TickTick task');
    }
    return this.client.post<Task>(`/task/${encodeURIComponent(taskId)}`, {
      id: taskId,
      ...input,
    });
  }

  async completeTask(projectId: string, taskId: string): Promise<void> {
    await this.client.post(
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
      {},
    );
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.client.delete(
      `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
    );
  }

  getClient(): TickTickClient {
    return this.client;
  }
}
