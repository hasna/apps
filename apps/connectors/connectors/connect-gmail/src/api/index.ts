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
import { refreshTokens } from '../utils/auth';

/** Tokens passed to Gmail.createWithTokens() */
export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  /** Unix timestamp (ms) when accessToken expires. If omitted, token is always refreshed. */
  expiresAt?: number;
}

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

  constructor(client?: GmailClient) {
    this.client = client ?? new GmailClient();
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
   * Create a Gmail client — tokens are loaded automatically from config
   */
  static create(): Gmail {
    return new Gmail();
  }

  /**
   * Create a Gmail client from environment variables.
   *
   * Supports two modes:
   * - Full OAuth: GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET
   *   (optionally GMAIL_ACCESS_TOKEN + GMAIL_TOKEN_EXPIRES_AT to skip initial refresh)
   * - Static token: GMAIL_ACCESS_TOKEN only (no auto-refresh)
   */
  static fromEnv(): Gmail {
    const accessToken = process.env.GMAIL_ACCESS_TOKEN;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const expiresAt = process.env.GMAIL_TOKEN_EXPIRES_AT
      ? parseInt(process.env.GMAIL_TOKEN_EXPIRES_AT, 10)
      : undefined;

    if (refreshToken && clientId && clientSecret) {
      return Gmail.createWithTokens({
        accessToken: accessToken ?? '',
        refreshToken,
        clientId,
        clientSecret,
        // Force immediate refresh if no access token was provided
        expiresAt: accessToken ? expiresAt : 0,
      });
    }

    if (accessToken) {
      // Static token only — no auto-refresh
      const client = new GmailClient({ tokenProvider: async () => accessToken });
      return new Gmail(client);
    }

    throw new Error(
      'Missing Gmail env vars. Provide GMAIL_ACCESS_TOKEN, ' +
      'or GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET',
    );
  }

  /**
   * Create a Gmail client using explicit tokens instead of file-based auth.
   * Automatically refreshes the access token when expired and notifies via onRefresh.
   *
   * @param tokens - Initial token set (accessToken, refreshToken, clientId, clientSecret, expiresAt?)
   * @param onRefresh - Called whenever tokens are refreshed so callers can persist the new tokens
   */
  static createWithTokens(
    tokens: GmailTokens,
    onRefresh?: (newTokens: GmailTokens) => void,
  ): Gmail {
    // Mutable state for the closure — updated on each refresh
    let current = { ...tokens };

    const tokenProvider = async (): Promise<string> => {
      const isExpired =
        current.expiresAt === undefined ||
        Date.now() >= current.expiresAt - 5 * 60 * 1000;

      if (isExpired) {
        const refreshed = await refreshTokens(
          current.clientId,
          current.clientSecret,
          current.refreshToken,
        );

        current = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          clientId: current.clientId,
          clientSecret: current.clientSecret,
          expiresAt: refreshed.expiresAt,
        };

        onRefresh?.(current);
      }

      return current.accessToken;
    };

    const client = new GmailClient({ tokenProvider });
    return new Gmail(client);
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
