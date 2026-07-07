import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { PipelinesApi } from './pipelines';
import { BoxesApi } from './boxes';
import { StagesApi } from './stages';
import { FieldsApi } from './fields';
import { TasksApi } from './tasks';
import { CommentsApi } from './comments';
import { ThreadsApi } from './threads';
import { RemindersApi } from './reminders';
import { FilesApi } from './files';
import { TeamsApi, UsersApi } from './users';
import { SearchApi } from './search';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly pipelines: PipelinesApi;
  public readonly boxes: BoxesApi;
  public readonly stages: StagesApi;
  public readonly fields: FieldsApi;
  public readonly tasks: TasksApi;
  public readonly comments: CommentsApi;
  public readonly threads: ThreadsApi;
  public readonly reminders: RemindersApi;
  public readonly files: FilesApi;
  public readonly teams: TeamsApi;
  public readonly users: UsersApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.pipelines = new PipelinesApi(this.client);
    this.boxes = new BoxesApi(this.client);
    this.stages = new StagesApi(this.client);
    this.fields = new FieldsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.threads = new ThreadsApi(this.client);
    this.reminders = new RemindersApi(this.client);
    this.files = new FilesApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.users = new UsersApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STREAK_API_KEY;
    if (!apiKey) {
      throw new Error('STREAK_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { PipelinesApi } from './pipelines';
export { BoxesApi } from './boxes';
export { StagesApi } from './stages';
export { FieldsApi } from './fields';
export { TasksApi } from './tasks';
export { CommentsApi } from './comments';
export { ThreadsApi } from './threads';
export { RemindersApi } from './reminders';
export { FilesApi } from './files';
export { TeamsApi, UsersApi } from './users';
export { SearchApi } from './search';
