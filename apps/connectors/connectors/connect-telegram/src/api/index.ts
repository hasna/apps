import type { TelegramConfig } from '../types';
import { TelegramClient } from './client';
import { MessagesApi } from './messages';
import { ChatsApi } from './chats';
import { UpdatesApi } from './updates';
import { InlineApi } from './inline';
import { BotApi } from './bot';

/**
 * Main Telegram Connector class
 * Provides access to Telegram Bot API services
 */
export class Telegram {
  private readonly client: TelegramClient;

  // Service APIs
  public readonly messages: MessagesApi;
  public readonly chats: ChatsApi;
  public readonly updates: UpdatesApi;
  public readonly inline: InlineApi;
  public readonly bot: BotApi;

  constructor(config: TelegramConfig) {
    this.client = new TelegramClient(config);
    this.messages = new MessagesApi(this.client);
    this.chats = new ChatsApi(this.client);
    this.updates = new UpdatesApi(this.client);
    this.inline = new InlineApi(this.client);
    this.bot = new BotApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for TELEGRAM_BOT_TOKEN
   */
  static fromEnv(): Telegram {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
    }

    return new Telegram({ botToken });
  }

  /**
   * Get a preview of the bot token (for debugging)
   */
  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): TelegramClient {
    return this.client;
  }
}

export { TelegramClient } from './client';
export { MessagesApi } from './messages';
export { ChatsApi } from './chats';
export { UpdatesApi } from './updates';
export { InlineApi } from './inline';
export { BotApi } from './bot';
