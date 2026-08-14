import type { GmailClient } from './client';
import type { GmailProfile } from '../types';

export interface SendAsAddress {
  sendAsEmail: string;
  displayName?: string;
  replyToAddress?: string;
  signature?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  treatAsAlias?: boolean;
  verificationStatus?: string;
}

export class ProfileApi {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * Get the current user's Gmail profile
   */
  async get(): Promise<GmailProfile> {
    return this.client.get<GmailProfile>(
      `/users/${this.client.getUserId()}/profile`
    );
  }

  /**
   * List all send-as addresses (including signatures)
   */
  async listSendAs(): Promise<{ sendAs: SendAsAddress[] }> {
    return this.client.get<{ sendAs: SendAsAddress[] }>(
      `/users/${this.client.getUserId()}/settings/sendAs`
    );
  }

  /**
   * Get a specific send-as address
   */
  async getSendAs(sendAsEmail: string): Promise<SendAsAddress> {
    return this.client.get<SendAsAddress>(
      `/users/${this.client.getUserId()}/settings/sendAs/${sendAsEmail}`
    );
  }

  /**
   * Get the primary send-as address (with signature)
   */
  async getPrimarySendAs(): Promise<SendAsAddress | undefined> {
    const { sendAs } = await this.listSendAs();
    return sendAs.find(s => s.isPrimary || s.isDefault);
  }

  /**
   * Get the user's Gmail signature
   */
  async getSignature(): Promise<string | undefined> {
    const primary = await this.getPrimarySendAs();
    return primary?.signature;
  }

  /**
   * Get the user's display name from Gmail settings
   */
  async getDisplayName(): Promise<string | undefined> {
    const primary = await this.getPrimarySendAs();
    return primary?.displayName;
  }
}
