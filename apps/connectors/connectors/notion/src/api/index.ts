import type { NotionConfig } from '../types';
import { NotionClient } from './client';
import { DatabasesApi } from './databases';
import { PagesApi } from './pages';
import { BlocksApi } from './blocks';
import { UsersApi } from './users';
import { SearchApi } from './search';
import { CommentsApi } from './comments';
import { ExportApi } from './export';
import { BulkApi } from './bulk';

export class Notion {
  private readonly client: NotionClient;

  // API modules
  public readonly databases: DatabasesApi;
  public readonly pages: PagesApi;
  public readonly blocks: BlocksApi;
  public readonly users: UsersApi;
  public readonly search: SearchApi;
  public readonly comments: CommentsApi;
  public readonly export: ExportApi;
  public readonly bulk: BulkApi;

  constructor(config?: NotionConfig) {
    this.client = new NotionClient(config);
    this.databases = new DatabasesApi(this.client);
    this.pages = new PagesApi(this.client);
    this.blocks = new BlocksApi(this.client);
    this.users = new UsersApi(this.client);
    this.search = new SearchApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.export = new ExportApi(this.client);
    this.bulk = new BulkApi(this.client);
  }

  /**
   * Create a Notion client - tokens are loaded automatically from config
   */
  static create(): Notion {
    return new Notion();
  }

  /**
   * Create a Notion client from environment variables
   * Looks for NOTION_ACCESS_TOKEN or NOTION_API_KEY
   */
  static fromEnv(): Notion {
    const accessToken = process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_API_KEY;
    if (!accessToken) {
      throw new Error('NOTION_ACCESS_TOKEN or NOTION_API_KEY environment variable is required');
    }
    return new Notion({ accessToken });
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): NotionClient {
    return this.client;
  }
}

export { NotionClient } from './client';
export { DatabasesApi } from './databases';
export { PagesApi } from './pages';
export { BlocksApi } from './blocks';
export { UsersApi } from './users';
export { SearchApi } from './search';
export { CommentsApi } from './comments';
export { ExportApi } from './export';
export { BulkApi, FilterParser } from './bulk';
