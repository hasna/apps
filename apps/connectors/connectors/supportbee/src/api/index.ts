import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { TicketsApi } from './tickets';
import { RepliesApi } from './replies';
import { CommentsApi } from './comments';
import { LabelsApi } from './labels';
import { UsersApi } from './users';
import { SnippetsApi } from './snippets';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly tickets: TicketsApi;
  public readonly replies: RepliesApi;
  public readonly comments: CommentsApi;
  public readonly labels: LabelsApi;
  public readonly users: UsersApi;
  public readonly snippets: SnippetsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.tickets = new TicketsApi(this.client);
    this.replies = new RepliesApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.labels = new LabelsApi(this.client);
    this.users = new UsersApi(this.client);
    this.snippets = new SnippetsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.SUPPORTBEE_API_KEY || process.env.SUPPORTBEE_TOKEN;
    const baseUrl =
      process.env.SUPPORTBEE_BASE_URL ||
      (process.env.SUPPORTBEE_SUBDOMAIN
        ? `https://${process.env.SUPPORTBEE_SUBDOMAIN}.supportbee.com`
        : undefined);

    if (!apiKey) {
      throw new Error('SUPPORTBEE_API_KEY environment variable is required');
    }
    if (!baseUrl) {
      throw new Error(
        'SUPPORTBEE_BASE_URL (or SUPPORTBEE_SUBDOMAIN) environment variable is required ' +
          '(e.g. https://your-company.supportbee.com)'
      );
    }
    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { TicketsApi } from './tickets';
export { RepliesApi } from './replies';
export { CommentsApi } from './comments';
export { LabelsApi } from './labels';
export { UsersApi } from './users';
export { SnippetsApi } from './snippets';
