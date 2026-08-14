import type { SlackClient } from './client';
import type {
  SlackChannel,
  ConversationsListResponse,
  ConversationsListOptions,
} from '../types';

/**
 * Channels/Conversations API
 */
export class ChannelsApi {
  constructor(private readonly client: SlackClient) {}

  /**
   * List all conversations/channels
   */
  async list(options: Omit<ConversationsListOptions, 'channel'> = {}): Promise<SlackChannel[]> {
    const allChannels: SlackChannel[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.get<ConversationsListResponse>(
        'conversations.list',
        {
          types: options.types || 'public_channel,private_channel',
          exclude_archived: options.exclude_archived ?? true,
          limit: options.limit || 200,
          cursor,
        }
      );

      allChannels.push(...response.channels);
      cursor = response.response_metadata?.next_cursor;
    } while (cursor && allChannels.length < (options.limit || 1000));

    return allChannels;
  }

  /**
   * Get channel info by ID
   */
  async info(channelId: string): Promise<SlackChannel> {
    const response = await this.client.get<{ ok: boolean; channel: SlackChannel }>(
      'conversations.info',
      { channel: channelId }
    );
    return response.channel;
  }

  /**
   * Find a channel by name
   */
  async findByName(name: string): Promise<SlackChannel | undefined> {
    const channels = await this.list();
    const normalizedName = name.replace(/^#/, '');
    return channels.find(c => c.name === normalizedName || c.name_normalized === normalizedName);
  }

  /**
   * Join a channel
   */
  async join(channelId: string): Promise<SlackChannel> {
    const response = await this.client.post<{ ok: boolean; channel: SlackChannel }>(
      'conversations.join',
      { channel: channelId }
    );
    return response.channel;
  }

  /**
   * Leave a channel
   */
  async leave(channelId: string): Promise<void> {
    await this.client.post('conversations.leave', { channel: channelId });
  }

  /**
   * Create a new channel
   */
  async create(name: string, isPrivate = false): Promise<SlackChannel> {
    const response = await this.client.post<{ ok: boolean; channel: SlackChannel }>(
      'conversations.create',
      { name, is_private: isPrivate }
    );
    return response.channel;
  }

  /**
   * Archive a channel
   */
  async archive(channelId: string): Promise<void> {
    await this.client.post('conversations.archive', { channel: channelId });
  }

  /**
   * Unarchive a channel
   */
  async unarchive(channelId: string): Promise<void> {
    await this.client.post('conversations.unarchive', { channel: channelId });
  }

  /**
   * Get members of a channel
   */
  async members(channelId: string, limit = 200): Promise<string[]> {
    const response = await this.client.get<{ ok: boolean; members: string[] }>(
      'conversations.members',
      { channel: channelId, limit }
    );
    return response.members;
  }
}
