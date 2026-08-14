import type { ZohoCliqConfig } from '../types';
import { ZohoCliqClient } from './client';
import { UsersApi } from './users';
import { BuddiesApi } from './buddies';
import { ChannelsApi } from './channels';
import { MessagesApi } from './messages';
import { ChatsApi } from './chats';
import { DepartmentsApi } from './departments';
import { BotsApi } from './bots';

export { ZohoCliqClient, resolveZohoCliqBaseUrl, ZOHO_CLIQ_DC_BASES } from './client';
export { UsersApi } from './users';
export { BuddiesApi } from './buddies';
export { ChannelsApi } from './channels';
export { MessagesApi } from './messages';
export { ChatsApi } from './chats';
export { DepartmentsApi } from './departments';
export { BotsApi } from './bots';

export class ZohoCliq {
  private readonly client: ZohoCliqClient;

  public readonly users: UsersApi;
  public readonly buddies: BuddiesApi;
  public readonly channels: ChannelsApi;
  public readonly messages: MessagesApi;
  public readonly chats: ChatsApi;
  public readonly departments: DepartmentsApi;
  public readonly bots: BotsApi;

  constructor(config: ZohoCliqConfig) {
    this.client = new ZohoCliqClient(config);
    this.users = new UsersApi(this.client);
    this.buddies = new BuddiesApi(this.client);
    this.channels = new ChannelsApi(this.client);
    this.messages = new MessagesApi(this.client);
    this.chats = new ChatsApi(this.client);
    this.departments = new DepartmentsApi(this.client);
    this.bots = new BotsApi(this.client);
  }

  static fromEnv(): ZohoCliq {
    const token = process.env.ZOHO_CLIQ_TOKEN;
    if (!token) {
      throw new Error('ZOHO_CLIQ_TOKEN is required');
    }

    return new ZohoCliq({
      token,
      dataCenter: process.env.ZOHO_CLIQ_DATA_CENTER ?? 'com',
      baseUrl: process.env.ZOHO_CLIQ_BASE_URL,
    });
  }

  async test() {
    return this.users.me();
  }

  getClient(): ZohoCliqClient {
    return this.client;
  }
}
