import type { DiscordClient } from './client';
import type { DiscordUser, DiscordChannel, PartialGuild, Snowflake } from '../types';

export class UsersApi {
  constructor(private readonly client: DiscordClient) {}

  /**
   * Get the current user
   */
  async me(): Promise<DiscordUser> {
    return this.client.get<DiscordUser>('/users/@me');
  }

  /**
   * Get a user by ID
   */
  async get(userId: Snowflake): Promise<DiscordUser> {
    return this.client.get<DiscordUser>(`/users/${userId}`);
  }

  /**
   * Modify the current user
   */
  async modify(options: {
    username?: string;
    avatar?: string | null;
    banner?: string | null;
  }): Promise<DiscordUser> {
    return this.client.patch<DiscordUser>('/users/@me', options);
  }

  /**
   * Get current user's guilds
   */
  async getGuilds(options?: {
    before?: Snowflake;
    after?: Snowflake;
    limit?: number;
    with_counts?: boolean;
  }): Promise<PartialGuild[]> {
    return this.client.get<PartialGuild[]>('/users/@me/guilds', options);
  }

  /**
   * Leave a guild
   */
  async leaveGuild(guildId: Snowflake): Promise<void> {
    return this.client.delete(`/users/@me/guilds/${guildId}`);
  }

  /**
   * Create a DM channel
   */
  async createDM(recipientId: Snowflake): Promise<DiscordChannel> {
    return this.client.post<DiscordChannel>('/users/@me/channels', {
      recipient_id: recipientId,
    });
  }

  /**
   * Get current user's connections
   */
  async getConnections() {
    return this.client.get('/users/@me/connections');
  }
}
