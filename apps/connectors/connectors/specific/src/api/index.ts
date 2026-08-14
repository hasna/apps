import type {
  SpecificConfig,
  Workspace,
  Survey,
  Conversation,
  Company,
  User,
  CompanyInput,
  UserInput,
  WebhookSubscription,
} from '../types';
import { SpecificClient } from './client';
import * as ops from './operations';

/**
 * Main Specific connector class.
 *
 * Wraps the Specific public GraphQL API with typed helper methods for the
 * most common resources (workspace, surveys, conversations, companies, users)
 * plus webhook subscription management.
 */
export class Specific {
  private readonly client: SpecificClient;

  constructor(config: SpecificConfig) {
    this.client = new SpecificClient(config);
  }

  /**
   * Create a client from environment variables.
   * Looks for SPECIFIC_API_KEY (and optional SPECIFIC_BASE_URL).
   */
  static fromEnv(): Specific {
    const apiKey = process.env.SPECIFIC_API_KEY;
    const baseUrl = process.env.SPECIFIC_BASE_URL;

    if (!apiKey) {
      throw new Error('SPECIFIC_API_KEY environment variable is required');
    }
    return new Specific({ apiKey, baseUrl });
  }

  // ============================================
  // Queries
  // ============================================

  /** Get the workspace associated with the API key. */
  async myWorkspace(): Promise<Workspace> {
    const data = await this.client.request<{ myWorkspace: Workspace }>(ops.MY_WORKSPACE);
    return data.myWorkspace;
  }

  /** List surveys in the workspace. */
  async surveys(): Promise<Survey[]> {
    const data = await this.client.request<{ surveys: Survey[] }>(ops.SURVEYS);
    return data.surveys;
  }

  /** Get a single survey by ID. */
  async survey(id: string): Promise<Survey> {
    const data = await this.client.request<{ survey: Survey }>(ops.SURVEY, { id });
    return data.survey;
  }

  /** List conversations, optionally filtered by survey. */
  async conversations(surveyId?: string): Promise<Conversation[]> {
    const data = await this.client.request<{ conversations: Conversation[] }>(
      ops.CONVERSATIONS,
      { surveyId },
    );
    return data.conversations;
  }

  /** List companies in the workspace. */
  async companies(): Promise<Company[]> {
    const data = await this.client.request<{ companies: Company[] }>(ops.COMPANIES);
    return data.companies;
  }

  /** List users in the workspace. */
  async users(): Promise<User[]> {
    const data = await this.client.request<{ users: User[] }>(ops.USERS);
    return data.users;
  }

  // ============================================
  // Mutations
  // ============================================

  /** Create or update a user by external identifier. */
  async createOrUpdateUser(input: UserInput): Promise<User> {
    const data = await this.client.request<{ createOrUpdateUser: User }>(
      ops.CREATE_OR_UPDATE_USER,
      { input },
    );
    return data.createOrUpdateUser;
  }

  /** Create or update a company by external identifier. */
  async createOrUpdateCompany(input: CompanyInput): Promise<Company> {
    const data = await this.client.request<{ createOrUpdateCompany: Company }>(
      ops.CREATE_OR_UPDATE_COMPANY,
      { input },
    );
    return data.createOrUpdateCompany;
  }

  /** Subscribe a webhook to an event. */
  async subscribeWebhook(url: string, event: string): Promise<WebhookSubscription> {
    const data = await this.client.request<{ subscribeWebhook: WebhookSubscription }>(
      ops.SUBSCRIBE_WEBHOOK,
      { url, event },
    );
    return data.subscribeWebhook;
  }

  /** Unsubscribe a previously registered webhook. */
  async unsubscribeWebhook(id: string): Promise<boolean> {
    const data = await this.client.request<{ unsubscribeWebhook: boolean }>(
      ops.UNSUBSCRIBE_WEBHOOK,
      { id },
    );
    return data.unsubscribeWebhook;
  }

  /**
   * Get a preview of the API key (for debugging).
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct GraphQL access.
   */
  getClient(): SpecificClient {
    return this.client;
  }
}

export { SpecificClient } from './client';
