export interface PusherConfig { appId: string; key: string; secret: string; cluster: string; }

export interface PusherChannel { name: string; occupied: boolean; user_count?: number; subscription_count?: number; }
export interface PusherChannelInfo { occupied: boolean; user_count: number; subscription_count: number; }
export interface PusherUser { id: string; }
export interface PusherTriggerResult { channels: Record<string, unknown>; }
export interface PusherBatchEvent { channel: string; name: string; data: string; socket_id?: string; }

export class PusherApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PusherApiError'; this.statusCode = statusCode; }
}
