import { GmailClient } from './client';
import { MessagesApi } from './messages';
import { LabelsApi } from './labels';
import { ThreadsApi } from './threads';
import { ProfileApi } from './profile';
import { DraftsApi } from './drafts';
import { FiltersApi } from './filters';
import { AttachmentsApi } from './attachments';
import { ExportApi } from './export';
import { BulkApi } from './bulk';

export class Gmail {
  private readonly client: GmailClient;

  // API modules
  public readonly messages: MessagesApi;
  public readonly labels: LabelsApi;
  public readonly threads: ThreadsApi;
  public readonly profile: ProfileApi;
  public readonly drafts: DraftsApi;
  public readonly filters: FiltersApi;
  public readonly attachments: AttachmentsApi;
  public readonly export: ExportApi;
  public readonly bulk: BulkApi;

  constructor() {
    this.client = new GmailClient();
    this.messages = new MessagesApi(this.client);
    this.labels = new LabelsApi(this.client);
    this.threads = new ThreadsApi(this.client);
    this.profile = new ProfileApi(this.client);
    this.drafts = new DraftsApi(this.client);
    this.filters = new FiltersApi(this.client);
    this.attachments = new AttachmentsApi(this.client);
    this.export = new ExportApi(this.client);
    this.bulk = new BulkApi(this.client);
  }

  /**
   * Create a Gmail client - tokens are loaded automatically from config
   */
  static create(): Gmail {
    return new Gmail();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GmailClient {
    return this.client;
  }
}

export { GmailClient } from './client';
export { MessagesApi } from './messages';
export { LabelsApi } from './labels';
export { ThreadsApi } from './threads';
export { ProfileApi } from './profile';
export { DraftsApi } from './drafts';
export { FiltersApi } from './filters';
export { AttachmentsApi } from './attachments';
export { ExportApi } from './export';
export { BulkApi } from './bulk';
