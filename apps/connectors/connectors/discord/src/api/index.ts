import type { DiscordConfig } from '../types';
import { DiscordClient } from './client';
import { UsersApi } from './users';
import { GuildsApi } from './guilds';
import { ChannelsApi } from './channels';
import { WebhooksApi } from './webhooks';
import { InvitesApi } from './invites';
import { CommandsApi } from './commands';
import { GatewayApi } from './gateway';

/**
 * Main Discord API class
 * Provides access to all Discord API endpoints
 */
export class Discord {
  private readonly client: DiscordClient;

  // API modules
  public readonly users: UsersApi;
  public readonly guilds: GuildsApi;
  public readonly channels: ChannelsApi;
  public readonly webhooks: WebhooksApi;
  public readonly invites: InvitesApi;
  public readonly commands: CommandsApi;
  public readonly gateway: GatewayApi;

  constructor(config: DiscordConfig) {
    this.client = new DiscordClient(config);
    this.users = new UsersApi(this.client);
    this.guilds = new GuildsApi(this.client);
    this.channels = new ChannelsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.invites = new InvitesApi(this.client);
    this.commands = new CommandsApi(this.client);
    this.gateway = new GatewayApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for DISCORD_BOT_TOKEN or DISCORD_TOKEN, and optionally DISCORD_APPLICATION_ID
   */
  static fromEnv(): Discord {
    const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
    const applicationId = process.env.DISCORD_APPLICATION_ID;

    if (!botToken) {
      throw new Error('DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable is required');
    }

    return new Discord({ botToken, applicationId });
  }

  /**
   * Test authentication by getting the current user
   */
  async test() {
    return this.users.me();
  }

  /**
   * Send a message to a channel (convenience method)
   */
  async send(channelId: string, content: string) {
    return this.channels.send(channelId, content);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): DiscordClient {
    return this.client;
  }
}

export { DiscordClient } from './client';
export { UsersApi } from './users';
export { GuildsApi } from './guilds';
export { ChannelsApi } from './channels';
export { WebhooksApi } from './webhooks';
export { InvitesApi } from './invites';
export { CommandsApi } from './commands';
export { GatewayApi } from './gateway';
