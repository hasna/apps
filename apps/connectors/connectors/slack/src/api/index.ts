import type { SlackConfig } from '../types';
import { SlackClient } from './client';
import { ChannelsApi } from './channels';
import { MessagesApi } from './messages';
import { UsersApi } from './users';
import { BulkApi } from './bulk';

export { SlackClient } from './client';
export { ChannelsApi } from './channels';
export { MessagesApi } from './messages';
export { UsersApi } from './users';
export { BulkApi } from './bulk';

/**
 * Main Slack API class
 */
export class Slack {
  private readonly client: SlackClient;

  public readonly channels: ChannelsApi;
  public readonly messages: MessagesApi;
  public readonly users: UsersApi;
  public readonly bulk: BulkApi;

  constructor(config: SlackConfig) {
    this.client = new SlackClient(config);
    this.channels = new ChannelsApi(this.client);
    this.messages = new MessagesApi(this.client);
    this.users = new UsersApi(this.client);
    this.bulk = new BulkApi(this.client);
  }

  /**
   * Test authentication
   */
  async test() {
    return this.users.me();
  }

  /**
   * Send a message to a channel (convenience method)
   */
  async send(channel: string, text: string) {
    return this.messages.sendText(channel, text);
  }
}
