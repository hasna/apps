import { AsanaClient } from './client';
import type {
  AsanaConfig,
  AsanaResponse,
  AsanaListResponse,
  Workspace,
  User,
  Team,
  Project,
  CreateProjectInput,
  Section,
  CreateSectionInput,
  Task,
  CreateTaskInput,
  Tag,
  CreateTagInput,
  Story,
  CreateStoryInput,
  Attachment,
} from '../types';

export { AsanaClient } from './client';

export class Asana {
  private client: AsanaClient;

  constructor(config: AsanaConfig) {
    this.client = new AsanaClient(config);
  }

  // ============================================
  // Workspaces
  // ============================================

  async listWorkspaces(): Promise<Workspace[]> {
    const response = await this.client.get<AsanaListResponse<Workspace>>('/workspaces');
    return response.data;
  }

  async getWorkspace(gid: string): Promise<Workspace> {
    const response = await this.client.get<AsanaResponse<Workspace>>(`/workspaces/${gid}`);
    return response.data;
  }

  // ============================================
  // Users
  // ============================================

  async getMe(): Promise<User> {
    const response = await this.client.get<AsanaResponse<User>>('/users/me');
    return response.data;
  }

  async getUser(gid: string): Promise<User> {
    const response = await this.client.get<AsanaResponse<User>>(`/users/${gid}`);
    return response.data;
  }

  async listUsersInWorkspace(workspaceGid: string): Promise<User[]> {
    const response = await this.client.get<AsanaListResponse<User>>(`/workspaces/${workspaceGid}/users`);
    return response.data;
  }

  // ============================================
  // Teams
  // ============================================

  async listTeamsInWorkspace(workspaceGid: string): Promise<Team[]> {
    const response = await this.client.get<AsanaListResponse<Team>>(`/organizations/${workspaceGid}/teams`);
    return response.data;
  }

  async getTeam(gid: string): Promise<Team> {
    const response = await this.client.get<AsanaResponse<Team>>(`/teams/${gid}`);
    return response.data;
  }

  async listTeamsForUser(userGid: string, organizationGid: string): Promise<Team[]> {
    const response = await this.client.get<AsanaListResponse<Team>>(`/users/${userGid}/teams`, {
      organization: organizationGid,
    });
    return response.data;
  }

  // ============================================
  // Projects
  // ============================================

  async listProjects(options: { workspace?: string; team?: string; archived?: boolean; limit?: number } = {}): Promise<Project[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 100,
      archived: options.archived,
    };

    let path = '/projects';
    if (options.workspace) {
      path = `/workspaces/${options.workspace}/projects`;
    } else if (options.team) {
      path = `/teams/${options.team}/projects`;
    }

    const response = await this.client.get<AsanaListResponse<Project>>(path, params);
    return response.data;
  }

  async getProject(gid: string): Promise<Project> {
    const response = await this.client.get<AsanaResponse<Project>>(`/projects/${gid}`);
    return response.data;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const response = await this.client.post<AsanaResponse<Project>>('/projects', { data: input });
    return response.data;
  }

  async updateProject(gid: string, input: Partial<CreateProjectInput>): Promise<Project> {
    const response = await this.client.put<AsanaResponse<Project>>(`/projects/${gid}`, { data: input });
    return response.data;
  }

  async deleteProject(gid: string): Promise<void> {
    await this.client.delete(`/projects/${gid}`);
  }

  // ============================================
  // Sections
  // ============================================

  async listSections(projectGid: string): Promise<Section[]> {
    const response = await this.client.get<AsanaListResponse<Section>>(`/projects/${projectGid}/sections`);
    return response.data;
  }

  async getSection(gid: string): Promise<Section> {
    const response = await this.client.get<AsanaResponse<Section>>(`/sections/${gid}`);
    return response.data;
  }

  async createSection(projectGid: string, input: CreateSectionInput): Promise<Section> {
    const response = await this.client.post<AsanaResponse<Section>>(`/projects/${projectGid}/sections`, { data: input });
    return response.data;
  }

  async updateSection(gid: string, name: string): Promise<Section> {
    const response = await this.client.put<AsanaResponse<Section>>(`/sections/${gid}`, { data: { name } });
    return response.data;
  }

  async deleteSection(gid: string): Promise<void> {
    await this.client.delete(`/sections/${gid}`);
  }

  // ============================================
  // Tasks
  // ============================================

  async listTasks(options: { project?: string; section?: string; assignee?: string; workspace?: string; completed_since?: string; limit?: number } = {}): Promise<Task[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 100,
      completed_since: options.completed_since,
    };

    let path = '/tasks';
    if (options.project) {
      path = `/projects/${options.project}/tasks`;
    } else if (options.section) {
      path = `/sections/${options.section}/tasks`;
    } else if (options.assignee && options.workspace) {
      params.assignee = options.assignee;
      params.workspace = options.workspace;
    }

    const response = await this.client.get<AsanaListResponse<Task>>(path, params);
    return response.data;
  }

  async getTask(gid: string): Promise<Task> {
    const response = await this.client.get<AsanaResponse<Task>>(`/tasks/${gid}`);
    return response.data;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const response = await this.client.post<AsanaResponse<Task>>('/tasks', { data: input });
    return response.data;
  }

  async updateTask(gid: string, input: Partial<CreateTaskInput>): Promise<Task> {
    const response = await this.client.put<AsanaResponse<Task>>(`/tasks/${gid}`, { data: input });
    return response.data;
  }

  async deleteTask(gid: string): Promise<void> {
    await this.client.delete(`/tasks/${gid}`);
  }

  async getSubtasks(taskGid: string): Promise<Task[]> {
    const response = await this.client.get<AsanaListResponse<Task>>(`/tasks/${taskGid}/subtasks`);
    return response.data;
  }

  async createSubtask(taskGid: string, input: CreateTaskInput): Promise<Task> {
    const response = await this.client.post<AsanaResponse<Task>>(`/tasks/${taskGid}/subtasks`, { data: input });
    return response.data;
  }

  async addTaskToProject(taskGid: string, projectGid: string, sectionGid?: string): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/addProject`, {
      data: {
        project: projectGid,
        section: sectionGid,
      },
    });
  }

  async removeTaskFromProject(taskGid: string, projectGid: string): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/removeProject`, {
      data: { project: projectGid },
    });
  }

  async setTaskDependencies(taskGid: string, dependsOn: string[]): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/addDependencies`, {
      data: { dependencies: dependsOn },
    });
  }

  // ============================================
  // Tags
  // ============================================

  async listTags(workspaceGid: string): Promise<Tag[]> {
    const response = await this.client.get<AsanaListResponse<Tag>>(`/workspaces/${workspaceGid}/tags`);
    return response.data;
  }

  async getTag(gid: string): Promise<Tag> {
    const response = await this.client.get<AsanaResponse<Tag>>(`/tags/${gid}`);
    return response.data;
  }

  async createTag(input: CreateTagInput): Promise<Tag> {
    const response = await this.client.post<AsanaResponse<Tag>>('/tags', { data: input });
    return response.data;
  }

  async addTagToTask(taskGid: string, tagGid: string): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/addTag`, { data: { tag: tagGid } });
  }

  async removeTagFromTask(taskGid: string, tagGid: string): Promise<void> {
    await this.client.post(`/tasks/${taskGid}/removeTag`, { data: { tag: tagGid } });
  }

  // ============================================
  // Stories (Comments)
  // ============================================

  async listStories(taskGid: string): Promise<Story[]> {
    const response = await this.client.get<AsanaListResponse<Story>>(`/tasks/${taskGid}/stories`);
    return response.data;
  }

  async getStory(gid: string): Promise<Story> {
    const response = await this.client.get<AsanaResponse<Story>>(`/stories/${gid}`);
    return response.data;
  }

  async createStory(taskGid: string, input: CreateStoryInput): Promise<Story> {
    const response = await this.client.post<AsanaResponse<Story>>(`/tasks/${taskGid}/stories`, { data: input });
    return response.data;
  }

  async updateStory(gid: string, text: string): Promise<Story> {
    const response = await this.client.put<AsanaResponse<Story>>(`/stories/${gid}`, { data: { text } });
    return response.data;
  }

  async deleteStory(gid: string): Promise<void> {
    await this.client.delete(`/stories/${gid}`);
  }

  // ============================================
  // Attachments
  // ============================================

  async listAttachments(taskGid: string): Promise<Attachment[]> {
    const response = await this.client.get<AsanaListResponse<Attachment>>(`/tasks/${taskGid}/attachments`);
    return response.data;
  }

  async getAttachment(gid: string): Promise<Attachment> {
    const response = await this.client.get<AsanaResponse<Attachment>>(`/attachments/${gid}`);
    return response.data;
  }

  async deleteAttachment(gid: string): Promise<void> {
    await this.client.delete(`/attachments/${gid}`);
  }

  // ============================================
  // Search
  // ============================================

  async searchTasks(workspaceGid: string, options: {
    text?: string;
    'projects.any'?: string;
    'assignee.any'?: string;
    completed?: boolean;
    is_subtask?: boolean;
    sort_by?: 'due_date' | 'created_at' | 'completed_at' | 'likes' | 'modified_at';
    sort_ascending?: boolean;
  } = {}): Promise<Task[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      ...options,
    };
    const response = await this.client.get<AsanaListResponse<Task>>(`/workspaces/${workspaceGid}/tasks/search`, params);
    return response.data;
  }
}
