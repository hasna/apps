import type { TogglTrackConfig } from '../types';
import { TogglTrackClient } from './client';
import { MeApi } from './me';
import { WorkspacesApi } from './workspaces';
import { ProjectsApi } from './projects';
import { ClientsApi } from './clients';
import { TagsApi } from './tags';
import { TasksApi } from './tasks';
import { TimeEntriesApi } from './time-entries';
import { UsersApi } from './users';

export class TogglTrack {
  private readonly client: TogglTrackClient;

  public readonly me: MeApi;
  public readonly workspaces: WorkspacesApi;
  public readonly projects: ProjectsApi;
  public readonly clients: ClientsApi;
  public readonly tags: TagsApi;
  public readonly tasks: TasksApi;
  public readonly timeEntries: TimeEntriesApi;
  public readonly users: UsersApi;

  constructor(config: TogglTrackConfig) {
    this.client = new TogglTrackClient(config);
    this.me = new MeApi(this.client);
    this.workspaces = new WorkspacesApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.clients = new ClientsApi(this.client);
    this.tags = new TagsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.timeEntries = new TimeEntriesApi(this.client);
    this.users = new UsersApi(this.client);
  }

  static fromEnv(): TogglTrack {
    const apiToken = process.env.TOGGL_TRACK_API_TOKEN;
    if (!apiToken) {
      throw new Error('TOGGL_TRACK_API_TOKEN environment variable is required');
    }
    return new TogglTrack({
      apiToken,
      baseUrl: process.env.TOGGL_TRACK_BASE_URL,
    });
  }

  getApiTokenPreview(): string {
    return this.client.getApiTokenPreview();
  }

  getClient(): TogglTrackClient {
    return this.client;
  }
}

export { TogglTrackClient } from './client';
export { MeApi } from './me';
export { WorkspacesApi } from './workspaces';
export { ProjectsApi } from './projects';
export { ClientsApi } from './clients';
export { TagsApi } from './tags';
export { TasksApi } from './tasks';
export { TimeEntriesApi } from './time-entries';
export { UsersApi } from './users';
