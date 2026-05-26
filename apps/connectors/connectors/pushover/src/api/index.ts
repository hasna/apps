// Pushover Connector — Real-time push notifications
import { PushoverClient } from './client';
import type { PushoverConfig, PushoverMessage, PushoverSendResult, PushoverUser } from '../types';
export { PushoverClient } from './client';
export class Pushover {
  private readonly client: PushoverClient;
  constructor(config: PushoverConfig) { this.client = new PushoverClient(config); }
  static fromEnv(): Pushover {
    const token = process.env.PUSHOVER_TOKEN;
    const userKey = process.env.PUSHOVER_USER_KEY;
    if (!token || !userKey) throw new Error('PUSHOVER_TOKEN and PUSHOVER_USER_KEY are required');
    return new Pushover({ token, userKey });
  }
  /** Send a push notification */
  async send(message: string, options?: Omit<PushoverMessage, 'token' | 'user' | 'message'>): Promise<PushoverSendResult> {
    return this.client.post<PushoverSendResult>('/messages.json', { user: this.client.userKey, message, ...options });
  }
  /** Send a high-priority notification (requires retry + expiry for priority=2) */
  async sendAlert(message: string, title?: string, options?: { priority?: 1 | 2; retry?: number; expiry?: number }): Promise<PushoverSendResult> {
    return this.send(message, { title, priority: options?.priority ?? 1, retry: options?.priority === 2 ? (options?.retry ?? 60) : undefined, expire: options?.priority === 2 ? (options?.expiry ?? 3600) : undefined });
  }
  /** Verify a user/group key */
  async verifyUser(device?: string): Promise<PushoverUser> {
    return this.client.get<PushoverUser>('/users/validate.json', { user: this.client.userKey, ...(device ? { device } : {}) });
  }
  /** Check app/API limits */
  async getLimits(): Promise<{ limit: number; remaining: number; reset: number }> {
    const r = await this.client.get<PushoverUser>('/users/validate.json', { user: this.client.userKey });
    return r.app_limits;
  }
  getClient(): PushoverClient { return this.client; }
}
