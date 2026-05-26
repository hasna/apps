import type { DiscordClient } from './client';
import type {
  DiscordGuild,
  DiscordChannel,
  DiscordMember,
  DiscordRole,
  DiscordBan,
  DiscordInvite,
  DiscordWebhook,
  DiscordEmoji,
  VoiceRegion,
  AuditLog,
  Snowflake,
  CreateGuildChannelOptions,
  CreateGuildRoleOptions,
  ModifyGuildMemberOptions,
  CreateBanOptions,
} from '../types';

export class GuildsApi {
  constructor(private readonly client: DiscordClient) {}

  // ==================== Guild ====================

  /**
   * Get a guild by ID
   */
  async get(guildId: Snowflake, withCounts?: boolean): Promise<DiscordGuild> {
    return this.client.get<DiscordGuild>(`/guilds/${guildId}`, {
      with_counts: withCounts,
    });
  }

  /**
   * Get guild preview
   */
  async getPreview(guildId: Snowflake) {
    return this.client.get(`/guilds/${guildId}/preview`);
  }

  /**
   * Modify a guild
   */
  async modify(
    guildId: Snowflake,
    options: {
      name?: string;
      verification_level?: number | null;
      default_message_notifications?: number | null;
      explicit_content_filter?: number | null;
      afk_channel_id?: Snowflake | null;
      afk_timeout?: number;
      icon?: string | null;
      owner_id?: Snowflake;
      splash?: string | null;
      banner?: string | null;
      system_channel_id?: Snowflake | null;
      rules_channel_id?: Snowflake | null;
      public_updates_channel_id?: Snowflake | null;
      preferred_locale?: string | null;
      description?: string | null;
      premium_progress_bar_enabled?: boolean;
    },
    reason?: string
  ): Promise<DiscordGuild> {
    return this.client.patch<DiscordGuild>(`/guilds/${guildId}`, options, reason);
  }

  /**
   * Delete a guild (must be owner)
   */
  async delete(guildId: Snowflake): Promise<void> {
    return this.client.delete(`/guilds/${guildId}`);
  }

  // ==================== Channels ====================

  /**
   * Get guild channels
   */
  async getChannels(guildId: Snowflake): Promise<DiscordChannel[]> {
    return this.client.get<DiscordChannel[]>(`/guilds/${guildId}/channels`);
  }

  /**
   * Create a guild channel
   */
  async createChannel(
    guildId: Snowflake,
    options: CreateGuildChannelOptions,
    reason?: string
  ): Promise<DiscordChannel> {
    return this.client.post<DiscordChannel>(`/guilds/${guildId}/channels`, options, reason);
  }

  /**
   * Modify channel positions
   */
  async modifyChannelPositions(
    guildId: Snowflake,
    positions: Array<{
      id: Snowflake;
      position?: number | null;
      lock_permissions?: boolean | null;
      parent_id?: Snowflake | null;
    }>
  ): Promise<void> {
    return this.client.patch(`/guilds/${guildId}/channels`, positions as unknown as Record<string, unknown>);
  }

  /**
   * Get active threads in guild
   */
  async getActiveThreads(guildId: Snowflake) {
    return this.client.get(`/guilds/${guildId}/threads/active`);
  }

  // ==================== Members ====================

  /**
   * Get guild member
   */
  async getMember(guildId: Snowflake, userId: Snowflake): Promise<DiscordMember> {
    return this.client.get<DiscordMember>(`/guilds/${guildId}/members/${userId}`);
  }

  /**
   * List guild members
   */
  async listMembers(
    guildId: Snowflake,
    options?: {
      limit?: number;
      after?: Snowflake;
    }
  ): Promise<DiscordMember[]> {
    return this.client.get<DiscordMember[]>(`/guilds/${guildId}/members`, options);
  }

  /**
   * Search guild members
   */
  async searchMembers(
    guildId: Snowflake,
    options: { query: string; limit?: number }
  ): Promise<DiscordMember[]> {
    return this.client.get<DiscordMember[]>(`/guilds/${guildId}/members/search`, options);
  }

  /**
   * Modify guild member
   */
  async modifyMember(
    guildId: Snowflake,
    userId: Snowflake,
    options: ModifyGuildMemberOptions,
    reason?: string
  ): Promise<DiscordMember> {
    return this.client.patch<DiscordMember>(
      `/guilds/${guildId}/members/${userId}`,
      options,
      reason
    );
  }

  /**
   * Modify current member (bot's own nickname)
   */
  async modifyCurrentMember(
    guildId: Snowflake,
    options: { nick?: string | null },
    reason?: string
  ): Promise<DiscordMember> {
    return this.client.patch<DiscordMember>(
      `/guilds/${guildId}/members/@me`,
      options,
      reason
    );
  }

  /**
   * Add role to guild member
   */
  async addMemberRole(
    guildId: Snowflake,
    userId: Snowflake,
    roleId: Snowflake,
    reason?: string
  ): Promise<void> {
    return this.client.put(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {}, reason);
  }

  /**
   * Remove role from guild member
   */
  async removeMemberRole(
    guildId: Snowflake,
    userId: Snowflake,
    roleId: Snowflake,
    reason?: string
  ): Promise<void> {
    return this.client.delete(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, reason);
  }

  /**
   * Kick a member from guild
   */
  async removeMember(guildId: Snowflake, userId: Snowflake, reason?: string): Promise<void> {
    return this.client.delete(`/guilds/${guildId}/members/${userId}`, reason);
  }

  // ==================== Bans ====================

  /**
   * Get guild bans
   */
  async getBans(
    guildId: Snowflake,
    options?: {
      limit?: number;
      before?: Snowflake;
      after?: Snowflake;
    }
  ): Promise<DiscordBan[]> {
    return this.client.get<DiscordBan[]>(`/guilds/${guildId}/bans`, options);
  }

  /**
   * Get a guild ban
   */
  async getBan(guildId: Snowflake, userId: Snowflake): Promise<DiscordBan> {
    return this.client.get<DiscordBan>(`/guilds/${guildId}/bans/${userId}`);
  }

  /**
   * Create a guild ban
   */
  async createBan(
    guildId: Snowflake,
    userId: Snowflake,
    options?: CreateBanOptions,
    reason?: string
  ): Promise<void> {
    return this.client.put(`/guilds/${guildId}/bans/${userId}`, options || {}, reason);
  }

  /**
   * Remove a guild ban
   */
  async removeBan(guildId: Snowflake, userId: Snowflake, reason?: string): Promise<void> {
    return this.client.delete(`/guilds/${guildId}/bans/${userId}`, reason);
  }

  // ==================== Roles ====================

  /**
   * Get guild roles
   */
  async getRoles(guildId: Snowflake): Promise<DiscordRole[]> {
    return this.client.get<DiscordRole[]>(`/guilds/${guildId}/roles`);
  }

  /**
   * Create a guild role
   */
  async createRole(
    guildId: Snowflake,
    options?: CreateGuildRoleOptions,
    reason?: string
  ): Promise<DiscordRole> {
    return this.client.post<DiscordRole>(`/guilds/${guildId}/roles`, options || {}, reason);
  }

  /**
   * Modify role positions
   */
  async modifyRolePositions(
    guildId: Snowflake,
    positions: Array<{ id: Snowflake; position?: number | null }>,
    reason?: string
  ): Promise<DiscordRole[]> {
    return this.client.patch<DiscordRole[]>(
      `/guilds/${guildId}/roles`,
      positions as unknown as Record<string, unknown>,
      reason
    );
  }

  /**
   * Modify a guild role
   */
  async modifyRole(
    guildId: Snowflake,
    roleId: Snowflake,
    options: CreateGuildRoleOptions,
    reason?: string
  ): Promise<DiscordRole> {
    return this.client.patch<DiscordRole>(`/guilds/${guildId}/roles/${roleId}`, options, reason);
  }

  /**
   * Delete a guild role
   */
  async deleteRole(guildId: Snowflake, roleId: Snowflake, reason?: string): Promise<void> {
    return this.client.delete(`/guilds/${guildId}/roles/${roleId}`, reason);
  }

  // ==================== Voice ====================

  /**
   * Get guild voice regions
   */
  async getVoiceRegions(guildId: Snowflake): Promise<VoiceRegion[]> {
    return this.client.get<VoiceRegion[]>(`/guilds/${guildId}/regions`);
  }

  // ==================== Invites ====================

  /**
   * Get guild invites
   */
  async getInvites(guildId: Snowflake): Promise<DiscordInvite[]> {
    return this.client.get<DiscordInvite[]>(`/guilds/${guildId}/invites`);
  }

  // ==================== Webhooks ====================

  /**
   * Get guild webhooks
   */
  async getWebhooks(guildId: Snowflake): Promise<DiscordWebhook[]> {
    return this.client.get<DiscordWebhook[]>(`/guilds/${guildId}/webhooks`);
  }

  // ==================== Emojis ====================

  /**
   * List guild emojis
   */
  async listEmojis(guildId: Snowflake): Promise<DiscordEmoji[]> {
    return this.client.get<DiscordEmoji[]>(`/guilds/${guildId}/emojis`);
  }

  /**
   * Get guild emoji
   */
  async getEmoji(guildId: Snowflake, emojiId: Snowflake): Promise<DiscordEmoji> {
    return this.client.get<DiscordEmoji>(`/guilds/${guildId}/emojis/${emojiId}`);
  }

  /**
   * Create guild emoji
   */
  async createEmoji(
    guildId: Snowflake,
    options: { name: string; image: string; roles?: Snowflake[] },
    reason?: string
  ): Promise<DiscordEmoji> {
    return this.client.post<DiscordEmoji>(`/guilds/${guildId}/emojis`, options, reason);
  }

  /**
   * Modify guild emoji
   */
  async modifyEmoji(
    guildId: Snowflake,
    emojiId: Snowflake,
    options: { name?: string; roles?: Snowflake[] | null },
    reason?: string
  ): Promise<DiscordEmoji> {
    return this.client.patch<DiscordEmoji>(`/guilds/${guildId}/emojis/${emojiId}`, options, reason);
  }

  /**
   * Delete guild emoji
   */
  async deleteEmoji(guildId: Snowflake, emojiId: Snowflake, reason?: string): Promise<void> {
    return this.client.delete(`/guilds/${guildId}/emojis/${emojiId}`, reason);
  }

  // ==================== Audit Log ====================

  /**
   * Get guild audit log
   */
  async getAuditLog(
    guildId: Snowflake,
    options?: {
      user_id?: Snowflake;
      action_type?: number;
      before?: Snowflake;
      after?: Snowflake;
      limit?: number;
    }
  ): Promise<AuditLog> {
    return this.client.get<AuditLog>(`/guilds/${guildId}/audit-logs`, options);
  }

  // ==================== Prune ====================

  /**
   * Get guild prune count
   */
  async getPruneCount(
    guildId: Snowflake,
    options?: { days?: number; include_roles?: string }
  ): Promise<{ pruned: number }> {
    return this.client.get(`/guilds/${guildId}/prune`, options);
  }

  /**
   * Begin guild prune
   */
  async beginPrune(
    guildId: Snowflake,
    options?: {
      days?: number;
      compute_prune_count?: boolean;
      include_roles?: Snowflake[];
    },
    reason?: string
  ): Promise<{ pruned: number | null }> {
    return this.client.post(`/guilds/${guildId}/prune`, options || {}, reason);
  }

  // ==================== Vanity URL ====================

  /**
   * Get guild vanity URL
   */
  async getVanityURL(guildId: Snowflake): Promise<{ code: string | null; uses: number }> {
    return this.client.get(`/guilds/${guildId}/vanity-url`);
  }
}
