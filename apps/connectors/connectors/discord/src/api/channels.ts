import type { DiscordClient } from './client';
import type {
  DiscordChannel,
  DiscordMessage,
  DiscordInvite,
  DiscordWebhook,
  DiscordUser,
  Snowflake,
  GetMessagesOptions,
  CreateMessageOptions,
  EditMessageOptions,
  ModifyChannelOptions,
  CreateInviteOptions,
  CreateWebhookOptions,
} from '../types';

export class ChannelsApi {
  constructor(private readonly client: DiscordClient) {}

  // ==================== Channel ====================

  /**
   * Get a channel by ID
   */
  async get(channelId: Snowflake): Promise<DiscordChannel> {
    return this.client.get<DiscordChannel>(`/channels/${channelId}`);
  }

  /**
   * Modify a channel
   */
  async modify(
    channelId: Snowflake,
    options: ModifyChannelOptions,
    reason?: string
  ): Promise<DiscordChannel> {
    return this.client.patch<DiscordChannel>(`/channels/${channelId}`, options, reason);
  }

  /**
   * Delete a channel
   */
  async delete(channelId: Snowflake, reason?: string): Promise<DiscordChannel> {
    return this.client.delete<DiscordChannel>(`/channels/${channelId}`, reason);
  }

  // ==================== Messages ====================

  /**
   * Get channel messages
   */
  async getMessages(
    channelId: Snowflake,
    options?: GetMessagesOptions
  ): Promise<DiscordMessage[]> {
    return this.client.get<DiscordMessage[]>(`/channels/${channelId}/messages`, options);
  }

  /**
   * Get a single message
   */
  async getMessage(channelId: Snowflake, messageId: Snowflake): Promise<DiscordMessage> {
    return this.client.get<DiscordMessage>(`/channels/${channelId}/messages/${messageId}`);
  }

  /**
   * Create a message
   */
  async createMessage(
    channelId: Snowflake,
    options: CreateMessageOptions
  ): Promise<DiscordMessage> {
    return this.client.post<DiscordMessage>(`/channels/${channelId}/messages`, options);
  }

  /**
   * Send a simple text message
   */
  async send(channelId: Snowflake, content: string): Promise<DiscordMessage> {
    return this.createMessage(channelId, { content });
  }

  /**
   * Edit a message
   */
  async editMessage(
    channelId: Snowflake,
    messageId: Snowflake,
    options: EditMessageOptions
  ): Promise<DiscordMessage> {
    return this.client.patch<DiscordMessage>(
      `/channels/${channelId}/messages/${messageId}`,
      options
    );
  }

  /**
   * Delete a message
   */
  async deleteMessage(
    channelId: Snowflake,
    messageId: Snowflake,
    reason?: string
  ): Promise<void> {
    return this.client.delete(`/channels/${channelId}/messages/${messageId}`, reason);
  }

  /**
   * Bulk delete messages (2-100 messages, not older than 14 days)
   */
  async bulkDeleteMessages(
    channelId: Snowflake,
    messageIds: Snowflake[],
    reason?: string
  ): Promise<void> {
    return this.client.post(
      `/channels/${channelId}/messages/bulk-delete`,
      { messages: messageIds },
      reason
    );
  }

  /**
   * Crosspost a message to following channels
   */
  async crosspostMessage(
    channelId: Snowflake,
    messageId: Snowflake
  ): Promise<DiscordMessage> {
    return this.client.post<DiscordMessage>(
      `/channels/${channelId}/messages/${messageId}/crosspost`
    );
  }

  // ==================== Reactions ====================

  /**
   * Create reaction (emoji format: name:id for custom, urlencoded unicode for standard)
   */
  async createReaction(
    channelId: Snowflake,
    messageId: Snowflake,
    emoji: string
  ): Promise<void> {
    return this.client.put(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      {}
    );
  }

  /**
   * Delete own reaction
   */
  async deleteOwnReaction(
    channelId: Snowflake,
    messageId: Snowflake,
    emoji: string
  ): Promise<void> {
    return this.client.delete(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`
    );
  }

  /**
   * Delete user reaction
   */
  async deleteUserReaction(
    channelId: Snowflake,
    messageId: Snowflake,
    emoji: string,
    userId: Snowflake
  ): Promise<void> {
    return this.client.delete(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/${userId}`
    );
  }

  /**
   * Get reactions for a message
   */
  async getReactions(
    channelId: Snowflake,
    messageId: Snowflake,
    emoji: string,
    options?: { after?: Snowflake; limit?: number }
  ): Promise<DiscordUser[]> {
    return this.client.get<DiscordUser[]>(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      options
    );
  }

  /**
   * Delete all reactions
   */
  async deleteAllReactions(
    channelId: Snowflake,
    messageId: Snowflake
  ): Promise<void> {
    return this.client.delete(
      `/channels/${channelId}/messages/${messageId}/reactions`
    );
  }

  /**
   * Delete all reactions for emoji
   */
  async deleteAllReactionsForEmoji(
    channelId: Snowflake,
    messageId: Snowflake,
    emoji: string
  ): Promise<void> {
    return this.client.delete(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
    );
  }

  // ==================== Permissions ====================

  /**
   * Edit channel permissions
   */
  async editPermissions(
    channelId: Snowflake,
    overwriteId: Snowflake,
    options: { allow?: string; deny?: string; type: number },
    reason?: string
  ): Promise<void> {
    return this.client.put(
      `/channels/${channelId}/permissions/${overwriteId}`,
      options,
      reason
    );
  }

  /**
   * Delete channel permission
   */
  async deletePermission(
    channelId: Snowflake,
    overwriteId: Snowflake,
    reason?: string
  ): Promise<void> {
    return this.client.delete(
      `/channels/${channelId}/permissions/${overwriteId}`,
      reason
    );
  }

  // ==================== Invites ====================

  /**
   * Get channel invites
   */
  async getInvites(channelId: Snowflake): Promise<DiscordInvite[]> {
    return this.client.get<DiscordInvite[]>(`/channels/${channelId}/invites`);
  }

  /**
   * Create channel invite
   */
  async createInvite(
    channelId: Snowflake,
    options?: CreateInviteOptions,
    reason?: string
  ): Promise<DiscordInvite> {
    return this.client.post<DiscordInvite>(
      `/channels/${channelId}/invites`,
      options || {},
      reason
    );
  }

  // ==================== Pins ====================

  /**
   * Get pinned messages
   */
  async getPinnedMessages(channelId: Snowflake): Promise<DiscordMessage[]> {
    return this.client.get<DiscordMessage[]>(`/channels/${channelId}/pins`);
  }

  /**
   * Pin a message
   */
  async pinMessage(
    channelId: Snowflake,
    messageId: Snowflake,
    reason?: string
  ): Promise<void> {
    return this.client.put(`/channels/${channelId}/pins/${messageId}`, {}, reason);
  }

  /**
   * Unpin a message
   */
  async unpinMessage(
    channelId: Snowflake,
    messageId: Snowflake,
    reason?: string
  ): Promise<void> {
    return this.client.delete(`/channels/${channelId}/pins/${messageId}`, reason);
  }

  // ==================== Typing ====================

  /**
   * Trigger typing indicator
   */
  async triggerTyping(channelId: Snowflake): Promise<void> {
    return this.client.post(`/channels/${channelId}/typing`);
  }

  // ==================== Webhooks ====================

  /**
   * Get channel webhooks
   */
  async getWebhooks(channelId: Snowflake): Promise<DiscordWebhook[]> {
    return this.client.get<DiscordWebhook[]>(`/channels/${channelId}/webhooks`);
  }

  /**
   * Create webhook
   */
  async createWebhook(
    channelId: Snowflake,
    options: CreateWebhookOptions,
    reason?: string
  ): Promise<DiscordWebhook> {
    return this.client.post<DiscordWebhook>(
      `/channels/${channelId}/webhooks`,
      options,
      reason
    );
  }

  // ==================== Threads ====================

  /**
   * Start thread from message
   */
  async startThreadFromMessage(
    channelId: Snowflake,
    messageId: Snowflake,
    options: {
      name: string;
      auto_archive_duration?: number;
      rate_limit_per_user?: number;
    },
    reason?: string
  ): Promise<DiscordChannel> {
    return this.client.post<DiscordChannel>(
      `/channels/${channelId}/messages/${messageId}/threads`,
      options,
      reason
    );
  }

  /**
   * Start thread without message
   */
  async startThread(
    channelId: Snowflake,
    options: {
      name: string;
      auto_archive_duration?: number;
      type?: number;
      invitable?: boolean;
      rate_limit_per_user?: number;
    },
    reason?: string
  ): Promise<DiscordChannel> {
    return this.client.post<DiscordChannel>(
      `/channels/${channelId}/threads`,
      options,
      reason
    );
  }

  /**
   * Join thread
   */
  async joinThread(channelId: Snowflake): Promise<void> {
    return this.client.put(`/channels/${channelId}/thread-members/@me`, {});
  }

  /**
   * Leave thread
   */
  async leaveThread(channelId: Snowflake): Promise<void> {
    return this.client.delete(`/channels/${channelId}/thread-members/@me`);
  }

  /**
   * Add thread member
   */
  async addThreadMember(channelId: Snowflake, userId: Snowflake): Promise<void> {
    return this.client.put(`/channels/${channelId}/thread-members/${userId}`, {});
  }

  /**
   * Remove thread member
   */
  async removeThreadMember(channelId: Snowflake, userId: Snowflake): Promise<void> {
    return this.client.delete(`/channels/${channelId}/thread-members/${userId}`);
  }

  /**
   * List thread members
   */
  async listThreadMembers(
    channelId: Snowflake,
    options?: { with_member?: boolean; after?: Snowflake; limit?: number }
  ) {
    return this.client.get(`/channels/${channelId}/thread-members`, options);
  }

  /**
   * List public archived threads
   */
  async listPublicArchivedThreads(
    channelId: Snowflake,
    options?: { before?: string; limit?: number }
  ) {
    return this.client.get(`/channels/${channelId}/threads/archived/public`, options);
  }

  /**
   * List private archived threads
   */
  async listPrivateArchivedThreads(
    channelId: Snowflake,
    options?: { before?: string; limit?: number }
  ) {
    return this.client.get(`/channels/${channelId}/threads/archived/private`, options);
  }

  /**
   * List joined private archived threads
   */
  async listJoinedPrivateArchivedThreads(
    channelId: Snowflake,
    options?: { before?: Snowflake; limit?: number }
  ) {
    return this.client.get(
      `/channels/${channelId}/users/@me/threads/archived/private`,
      options
    );
  }
}
