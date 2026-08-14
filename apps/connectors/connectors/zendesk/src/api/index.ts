import type { ZendeskConfig } from '../types';
import { ZendeskClient } from './client';
import { TicketsApi } from './tickets';
import { UsersApi } from './users';
import { OrganizationsApi } from './organizations';
import { GroupsApi } from './groups';
import { TicketFieldsApi } from './ticket-fields';
import { ViewsApi } from './views';
import { TriggersApi } from './triggers';
import { AutomationsApi } from './automations';
import { SlaPoliciesApi } from './slas';
import { WebhooksApi } from './webhooks';
import { MacrosApi } from './macros';
import { BrandsApi } from './brands';
import { BulkApi } from './bulk';

export class Zendesk {
  private readonly client: ZendeskClient;

  // Core APIs
  public readonly tickets: TicketsApi;
  public readonly users: UsersApi;
  public readonly organizations: OrganizationsApi;
  public readonly groups: GroupsApi;

  // Configuration APIs
  public readonly ticketFields: TicketFieldsApi;
  public readonly brands: BrandsApi;

  // Business Rules APIs
  public readonly views: ViewsApi;
  public readonly triggers: TriggersApi;
  public readonly automations: AutomationsApi;
  public readonly slaPolicies: SlaPoliciesApi;
  public readonly macros: MacrosApi;

  // Integration APIs
  public readonly webhooks: WebhooksApi;

  // Bulk Operations API
  public readonly bulk: BulkApi;

  constructor(config: ZendeskConfig) {
    this.client = new ZendeskClient(config);

    // Core APIs
    this.tickets = new TicketsApi(this.client);
    this.users = new UsersApi(this.client);
    this.organizations = new OrganizationsApi(this.client);
    this.groups = new GroupsApi(this.client);

    // Configuration APIs
    this.ticketFields = new TicketFieldsApi(this.client);
    this.brands = new BrandsApi(this.client);

    // Business Rules APIs
    this.views = new ViewsApi(this.client);
    this.triggers = new TriggersApi(this.client);
    this.automations = new AutomationsApi(this.client);
    this.slaPolicies = new SlaPoliciesApi(this.client);
    this.macros = new MacrosApi(this.client);

    // Integration APIs
    this.webhooks = new WebhooksApi(this.client);

    // Bulk Operations API
    this.bulk = new BulkApi(this.client, this.tickets, this.users, this.ticketFields);
  }

  /**
   * Create a Zendesk client from environment variables
   * Looks for ZENDESK_EMAIL and ZENDESK_API_TOKEN
   */
  static fromEnv(): Zendesk {
    const email = process.env.ZENDESK_EMAIL;
    const apiToken = process.env.ZENDESK_API_TOKEN;
    const baseUrl = process.env.ZENDESK_BASE_URL;

    if (!email || !apiToken) {
      throw new Error('ZENDESK_EMAIL and ZENDESK_API_TOKEN environment variables are required');
    }

    return new Zendesk({ email, apiToken, baseUrl });
  }

  /**
   * Get a preview of the API token (for debugging)
   */
  getApiTokenPreview(): string {
    return this.client.getApiTokenPreview();
  }

  /**
   * Get the email address used for authentication
   */
  getEmail(): string {
    return this.client.getEmail();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ZendeskClient {
    return this.client;
  }
}

export { ZendeskClient } from './client';
export { TicketsApi } from './tickets';
export { UsersApi } from './users';
export { OrganizationsApi } from './organizations';
export { GroupsApi } from './groups';
export { TicketFieldsApi } from './ticket-fields';
export { ViewsApi } from './views';
export { TriggersApi } from './triggers';
export { AutomationsApi } from './automations';
export { SlaPoliciesApi } from './slas';
export { WebhooksApi } from './webhooks';
export { MacrosApi } from './macros';
export { BrandsApi } from './brands';
export { BulkApi, FilterParser } from './bulk';
export type {
  BulkUpdateOptions,
  BulkUpdateResult,
  BulkPreviewResult,
  BulkSchema,
  BulkResourceType,
  ParsedFilter,
  ParsedUpdate,
  FieldSchema,
} from './bulk';
