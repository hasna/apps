import type { TelegramClient } from './client';
import type { TelegramUpdate, TelegramWebhookInfo } from '../types';

export interface GetUpdatesOptions {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowedUpdates?: string[];
}

export interface SetWebhookOptions {
  url: string;
  certificate?: Uint8Array;
  ipAddress?: string;
  maxConnections?: number;
  allowedUpdates?: string[];
  dropPendingUpdates?: boolean;
  secretToken?: string;
}

export interface DeleteWebhookOptions {
  dropPendingUpdates?: boolean;
}

/**
 * Telegram Updates API
 */
export class UpdatesApi {
  constructor(private readonly client: TelegramClient) {}

  /**
   * Get updates using long polling
   */
  async getUpdates(options: GetUpdatesOptions = {}): Promise<TelegramUpdate[]> {
    return this.client.request<TelegramUpdate[]>('getUpdates', {
      params: {
        offset: options.offset,
        limit: options.limit,
        timeout: options.timeout,
        allowed_updates: options.allowedUpdates ? JSON.stringify(options.allowedUpdates) : undefined,
      },
    });
  }

  /**
   * Set webhook for receiving updates
   */
  async setWebhook(options: SetWebhookOptions): Promise<boolean> {
    if (options.certificate) {
      return this.client.uploadFile<boolean>(
        'setWebhook',
        'certificate',
        options.certificate,
        'certificate.pem',
        {
          url: options.url,
          ip_address: options.ipAddress,
          max_connections: options.maxConnections,
          allowed_updates: options.allowedUpdates ? JSON.stringify(options.allowedUpdates) : undefined,
          drop_pending_updates: options.dropPendingUpdates,
          secret_token: options.secretToken,
        }
      );
    }

    return this.client.request<boolean>('setWebhook', {
      params: {
        url: options.url,
        ip_address: options.ipAddress,
        max_connections: options.maxConnections,
        allowed_updates: options.allowedUpdates ? JSON.stringify(options.allowedUpdates) : undefined,
        drop_pending_updates: options.dropPendingUpdates,
        secret_token: options.secretToken,
      },
    });
  }

  /**
   * Delete webhook and switch to long polling
   */
  async deleteWebhook(options: DeleteWebhookOptions = {}): Promise<boolean> {
    return this.client.request<boolean>('deleteWebhook', {
      params: {
        drop_pending_updates: options.dropPendingUpdates,
      },
    });
  }

  /**
   * Get current webhook status
   */
  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return this.client.request<TelegramWebhookInfo>('getWebhookInfo', {
      method: 'GET',
    });
  }
}
