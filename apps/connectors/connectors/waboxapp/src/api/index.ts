import type { WaboxappConfig } from '../types';
import { WaboxappClient } from './client';
import { MessagesApi } from './messages';
import { StatusApi } from './status';

export class Waboxapp {
  private readonly client: WaboxappClient;
  public readonly messages: MessagesApi;
  public readonly status: StatusApi;

  constructor(config: WaboxappConfig) {
    this.client = new WaboxappClient(config);
    this.messages = new MessagesApi(this.client);
    this.status = new StatusApi(this.client);
  }

  static fromEnv(): Waboxapp {
    const token = process.env.WABOXAPP_TOKEN;
    const uid = process.env.WABOXAPP_UID;
    const baseUrl = process.env.WABOXAPP_BASE_URL;

    if (!token) {
      throw new Error('WABOXAPP_TOKEN environment variable is required');
    }
    if (!uid) {
      throw new Error('WABOXAPP_UID environment variable is required');
    }

    return new Waboxapp({ token, uid, baseUrl });
  }

  getClient(): WaboxappClient {
    return this.client;
  }
}

export { WaboxappClient, DEFAULT_BASE_URL } from './client';
export { MessagesApi } from './messages';
export { StatusApi } from './status';
