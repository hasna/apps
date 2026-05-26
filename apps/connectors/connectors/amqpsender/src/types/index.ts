export interface AMQPSenderConfig { url: string; exchange?: string; routingKey?: string; }

export interface AMQPPublishOptions { exchange?: string; routingKey?: string; persistent?: boolean; contentType?: string; headers?: Record<string, string>; expiration?: string; priority?: number; correlationId?: string; replyTo?: string; }
export interface AMQPPublishResult { delivered: boolean; exchange: string; routingKey: string; }
export interface AMQPExchange { name: string; type: 'direct' | 'fanout' | 'topic' | 'headers'; durable: boolean; autoDelete: boolean; }
export interface AMQPQueue { name: string; durable: boolean; exclusive: boolean; autoDelete: boolean; messageCount?: number; consumerCount?: number; }
export interface AMQPConnectionInfo { url: string; connected: boolean; vhost: string; }

export class AMQPSenderApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AMQPSenderApiError'; this.statusCode = statusCode; }
}
