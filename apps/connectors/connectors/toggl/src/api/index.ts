// Toggl Track Connector
// Workspaces, projects, clients, tags, tasks, and time entries

import { TogglClient } from './client';
import type {
  TogglConfig,
  User,
  Workspace,
  Project,
  Client,
  Tag,
  Task,
  TimeEntry,
  Organization,
  WorkspaceUser,
  Group,
  CreateProjectInput,
  UpdateProjectInput,
  CreateClientInput,
  UpdateClientInput,
  CreateTaskInput,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  ListProjectsOptions,
  ListClientsOptions,
  ListTasksOptions,
  ListTimeEntriesOptions,
} from '../types';

export { TogglClient } from './client';

export class Toggl {
  private client: TogglClient;

  constructor(config: TogglConfig) {
    this.client = new TogglClient(config);
  }

  // Me
  async getCurrentUser(): Promise<User> {
    return this.client.get<User>('/me');
  }

  async listMyWorkspaces(): Promise<Workspace[]> {
    return this.client.get<Workspace[]>('/me/workspaces');
  }

  async listMyProjects(includeArchived?: boolean): Promise<Project[]> {
    return this.client.get<Project[]>('/me/projects', {
      include_archived: includeArchived,
    });
  }

  async listMyClients(): Promise<Client[]> {
    return this.client.get<Client[]>('/me/clients');
  }

  async listOrganizations(): Promise<Organization[]> {
    return this.client.get<Organization[]>('/me/organizations');
  }

  async getMeFeatures(): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>('/me/features');
  }

  // Workspaces
  async getWorkspace(workspaceId: number): Promise<Workspace> {
    return this.client.get<Workspace>(`/workspaces/${workspaceId}`);
  }

  async listWorkspaceUsers(workspaceId: number): Promise<WorkspaceUser[]> {
    return this.client.get<WorkspaceUser[]>(`/workspaces/${workspaceId}/users`);
  }

  async listGroups(workspaceId: number): Promise<Group[]> {
    return this.client.get<Group[]>(`/workspaces/${workspaceId}/groups`);
  }

  // Projects
  async listProjects(workspaceId: number, options: ListProjectsOptions = {}): Promise<Project[]> {
    return this.client.get<Project[]>(`/workspaces/${workspaceId}/projects`, {
      active: typeof options.active === 'boolean' ? String(options.active) : options.active,
      since: options.sinceDate,
      billable: options.billable,
      user_ids: options.userIds?.map(String),
      client_ids: options.clientIds?.map(String),
      group_ids: options.groupIds?.map(String),
      statuses: options.statuses,
      name: options.name,
      sort_field: options.sortField,
      sort_order: options.sortOrder,
      per_page: options.perPage,
      page: options.page,
    });
  }

  async getProject(workspaceId: number, projectId: number): Promise<Project> {
    return this.client.get<Project>(`/workspaces/${workspaceId}/projects/${projectId}`);
  }

  async createProject(workspaceId: number, input: CreateProjectInput): Promise<Project> {
    return this.client.post<Project>(`/workspaces/${workspaceId}/projects`, input);
  }

  async updateProject(workspaceId: number, projectId: number, input: UpdateProjectInput): Promise<Project> {
    return this.client.put<Project>(`/workspaces/${workspaceId}/projects/${projectId}`, input);
  }

  async deleteProject(workspaceId: number, projectId: number): Promise<void> {
    await this.client.delete(`/workspaces/${workspaceId}/projects/${projectId}`);
  }

  async listProjectUsers(workspaceId: number, projectId: number): Promise<WorkspaceUser[]> {
    return this.client.get<WorkspaceUser[]>(`/workspaces/${workspaceId}/projects/${projectId}/users`);
  }

  // Clients
  async listClients(workspaceId: number, options: ListClientsOptions = {}): Promise<Client[]> {
    return this.client.get<Client[]>(`/workspaces/${workspaceId}/clients`, {
      status: options.status,
      name: options.name,
    });
  }

  async createClient(workspaceId: number, input: CreateClientInput): Promise<Client> {
    return this.client.post<Client>(`/workspaces/${workspaceId}/clients`, input);
  }

  async updateClient(workspaceId: number, clientId: number, input: UpdateClientInput): Promise<Client> {
    return this.client.put<Client>(`/workspaces/${workspaceId}/clients/${clientId}`, input);
  }

  async deleteClient(workspaceId: number, clientId: number): Promise<void> {
    await this.client.delete(`/workspaces/${workspaceId}/clients/${clientId}`);
  }

  // Tags
  async listTags(workspaceId: number): Promise<Tag[]> {
    return this.client.get<Tag[]>(`/workspaces/${workspaceId}/tags`);
  }

  async createTag(workspaceId: number, name: string): Promise<Tag> {
    return this.client.post<Tag>(`/workspaces/${workspaceId}/tags`, { name });
  }

  async deleteTag(workspaceId: number, tagId: number): Promise<void> {
    await this.client.delete(`/workspaces/${workspaceId}/tags/${tagId}`);
  }

  // Tasks
  async listTasks(workspaceId: number, options: ListTasksOptions = {}): Promise<Task[]> {
    const path = options.projectId
      ? `/workspaces/${workspaceId}/projects/${options.projectId}/tasks`
      : `/workspaces/${workspaceId}/tasks`;

    return this.client.get<Task[]>(path, {
      per_page: options.perPage,
      page: options.page,
      active: options.active,
    });
  }

  async createTask(workspaceId: number, projectId: number, input: CreateTaskInput): Promise<Task> {
    return this.client.post<Task>(`/workspaces/${workspaceId}/projects/${projectId}/tasks`, input);
  }

  // Time entries
  async listTimeEntries(options: ListTimeEntriesOptions = {}): Promise<TimeEntry[]> {
    return this.client.get<TimeEntry[]>('/me/time_entries', {
      start_date: options.startDate,
      end_date: options.endDate,
      before: options.before,
      since: options.since,
      meta: options.meta,
    });
  }

  async getCurrentTimeEntry(): Promise<TimeEntry | null> {
    return this.client.get<TimeEntry | null>('/me/time_entries/current');
  }

  async getTimeEntry(workspaceId: number, timeEntryId: number): Promise<TimeEntry> {
    return this.client.get<TimeEntry>(`/workspaces/${workspaceId}/time_entries/${timeEntryId}`);
  }

  async createTimeEntry(workspaceId: number, input: CreateTimeEntryInput): Promise<TimeEntry> {
    return this.client.post<TimeEntry>(`/workspaces/${workspaceId}/time_entries`, {
      ...input,
      workspace_id: workspaceId,
    });
  }

  async updateTimeEntry(workspaceId: number, timeEntryId: number, input: UpdateTimeEntryInput): Promise<TimeEntry> {
    return this.client.put<TimeEntry>(`/workspaces/${workspaceId}/time_entries/${timeEntryId}`, input);
  }

  async deleteTimeEntry(workspaceId: number, timeEntryId: number): Promise<void> {
    await this.client.delete(`/workspaces/${workspaceId}/time_entries/${timeEntryId}`);
  }

  async stopTimeEntry(workspaceId: number, timeEntryId: number): Promise<TimeEntry> {
    return this.client.patch<TimeEntry>(`/workspaces/${workspaceId}/time_entries/${timeEntryId}/stop`);
  }

  getClient(): TogglClient {
    return this.client;
  }
}
