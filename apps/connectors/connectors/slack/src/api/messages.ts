import type { SlackClient } from './client';
import type {
  SlackMessage,
  ConversationsHistoryResponse,
  ConversationsHistoryOptions,
  ChatPostMessageResponse,
  ChatPostMessageOptions,
} from '../types';

/**
 * Messages API
 */
export class MessagesApi {
  constructor(private readonly client: SlackClient) {}

  /**
   * Get message history for a channel
   */
  async history(options: ConversationsHistoryOptions): Promise<SlackMessage[]> {
    const response = await this.client.get<ConversationsHistoryResponse>(
      'conversations.history',
      {
        channel: options.channel,
        limit: options.limit || 100,
        cursor: options.cursor,
        oldest: options.oldest,
        latest: options.latest,
        inclusive: options.inclusive,
      }
    );

    return response.messages;
  }

  /**
   * Send a message to a channel
   */
  async send(options: ChatPostMessageOptions): Promise<ChatPostMessageResponse> {
    return this.client.post<ChatPostMessageResponse>('chat.postMessage', {
      channel: options.channel,
      text: options.text,
      blocks: options.blocks,
      attachments: options.attachments,
      thread_ts: options.thread_ts,
      reply_broadcast: options.reply_broadcast,
      unfurl_links: options.unfurl_links,
      unfurl_media: options.unfurl_media,
      mrkdwn: options.mrkdwn ?? true,
    });
  }

  /**
   * Send a simple text message
   */
  async sendText(channel: string, text: string): Promise<ChatPostMessageResponse> {
    return this.send({ channel, text });
  }

  /**
   * Reply in a thread
   */
  async reply(channel: string, threadTs: string, text: string): Promise<ChatPostMessageResponse> {
    return this.send({ channel, text, thread_ts: threadTs });
  }

  /**
   * Update a message
   */
  async update(channel: string, ts: string, text: string): Promise<SlackMessage> {
    const response = await this.client.post<{ ok: boolean; message: SlackMessage }>(
      'chat.update',
      { channel, ts, text }
    );
    return response.message;
  }

  /**
   * Delete a message
   */
  async delete(channel: string, ts: string): Promise<void> {
    await this.client.post('chat.delete', { channel, ts });
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
    await this.client.post('reactions.add', {
      channel,
      timestamp,
      name: emoji.replace(/:/g, ''),
    });
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
    await this.client.post('reactions.remove', {
      channel,
      timestamp,
      name: emoji.replace(/:/g, ''),
    });
  }

  /**
   * Get thread replies
   */
  async thread(channel: string, ts: string, limit = 100): Promise<SlackMessage[]> {
    const response = await this.client.get<{ ok: boolean; messages: SlackMessage[] }>(
      'conversations.replies',
      { channel, ts, limit }
    );
    return response.messages;
  }

  /**
   * Search messages
   */
  async search(query: string, count = 20): Promise<SlackMessage[]> {
    const response = await this.client.get<{
      ok: boolean;
      messages: { matches: SlackMessage[] };
    }>('search.messages', { query, count });
    return response.messages.matches;
  }
}
