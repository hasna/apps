import type { TwilioConfig } from '../types';
import { TwilioClient } from './client';
import { MessagesApi } from './messages';
import { CallsApi } from './calls';
import { NumbersApi } from './numbers';
import { VerifyApi } from './verify';
import { ConversationsApi } from './conversations';
import { VideoApi } from './video';
import { LookupApi } from './lookup';
import { AccountsApi } from './accounts';

/**
 * Main Twilio connector class
 * Provides access to all Twilio API modules
 */
export class Twilio {
  private readonly client: TwilioClient;

  // API modules
  public readonly messages: MessagesApi;
  public readonly calls: CallsApi;
  public readonly numbers: NumbersApi;
  public readonly verify: VerifyApi;
  public readonly conversations: ConversationsApi;
  public readonly video: VideoApi;
  public readonly lookup: LookupApi;
  public readonly accounts: AccountsApi;

  constructor(config: TwilioConfig) {
    this.client = new TwilioClient(config);

    // Initialize API modules
    this.messages = new MessagesApi(this.client);
    this.calls = new CallsApi(this.client);
    this.numbers = new NumbersApi(this.client);
    this.verify = new VerifyApi(this.client);
    this.conversations = new ConversationsApi(this.client);
    this.video = new VideoApi(this.client);
    this.lookup = new LookupApi(this.client);
    this.accounts = new AccountsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN
   */
  static fromEnv(): Twilio {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid) {
      throw new Error('TWILIO_ACCOUNT_SID environment variable is required');
    }
    if (!authToken) {
      throw new Error('TWILIO_AUTH_TOKEN environment variable is required');
    }

    return new Twilio({ accountSid, authToken });
  }

  /**
   * Get a preview of the Account SID (for debugging)
   */
  getAccountSidPreview(): string {
    return this.client.getAccountSidPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): TwilioClient {
    return this.client;
  }

  /**
   * Get the Account SID
   */
  getAccountSid(): string {
    return this.client.getAccountSid();
  }
}

export { TwilioClient } from './client';
export { MessagesApi } from './messages';
export { CallsApi } from './calls';
export { NumbersApi } from './numbers';
export { VerifyApi } from './verify';
export { ConversationsApi } from './conversations';
export { VideoApi } from './video';
export { LookupApi } from './lookup';
export { AccountsApi } from './accounts';
