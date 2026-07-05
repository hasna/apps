import { createHmac } from 'node:crypto';
import type {
  WebhookListIncomingOptions,
  WebhookListIncomingResult,
  WebhookPingOptions,
  WebhookPingResult,
  WebhookSendJsonOptions,
  WebhookSendOptions,
  WebhookSendResult,
  WebhooksConfig,
} from '../types';
import { validatePublicHttpUrl } from '../utils/url';

type FetchFn = typeof fetch;

export class WebhooksClient {
  private readonly defaultUrl?: string;
  private readonly signingSecret?: string;
  private readonly fetchFn: FetchFn;

  constructor(config: WebhooksConfig = {}, fetchFn: FetchFn = fetch) {
    this.defaultUrl = config.defaultUrl;
    this.signingSecret = config.signingSecret;
    this.fetchFn = fetchFn;
  }

  private resolveUrl(url?: string): string {
    const targetUrl = url ?? this.defaultUrl;
    if (!targetUrl) {
      throw new Error('Webhook URL is required. Pass url or set a default URL in config.');
    }
    return validatePublicHttpUrl(targetUrl, 'Webhook URL');
  }

  private buildSignedHeaders(
    payload: string,
    headers: Record<string, string> = {},
  ): Record<string, string> {
    const finalHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (this.signingSecret) {
      const signature = createHmac('sha256', this.signingSecret).update(payload).digest('hex');
      finalHeaders['X-Webhook-Signature'] = `sha256=${signature}`;
      finalHeaders['X-Webhook-Timestamp'] = String(Math.floor(Date.now() / 1000));
    }

    return finalHeaders;
  }

  private async post(
    url: string | undefined,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ response: Response; url: string }> {
    const targetUrl = this.resolveUrl(url);
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const finalHeaders = this.buildSignedHeaders(payload, headers);

    const response = await this.fetchFn(targetUrl, {
      method: 'POST',
      headers: finalHeaders,
      body: payload,
    });

    return { response, url: targetUrl };
  }

  async send(options: WebhookSendOptions): Promise<WebhookSendResult> {
    const { response, url } = await this.post(options.url, options.body, options.headers ?? {});
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      response: text.slice(0, 5000),
      url,
    };
  }

  async sendJson(options: WebhookSendJsonOptions): Promise<WebhookSendResult> {
    return this.send({
      url: options.url,
      body: options.payload,
    });
  }

  async ping(options: WebhookPingOptions = {}): Promise<WebhookPingResult> {
    const { response, url } = await this.post(options.url, {
      ping: 'webhook',
      timestamp: new Date().toISOString(),
    });
    return {
      ok: response.ok,
      status: response.status,
      url,
    };
  }

  async listIncoming(options: WebhookListIncomingOptions = {}): Promise<WebhookListIncomingResult> {
    return {
      message:
        'Incoming webhook delivery is not available in the open-source connector. Host your own receiver endpoint or use your platform webhook ingress.',
      limit: options.limit ?? 25,
      sinceMs: options.sinceMs,
      hint:
        'Configure an HTTPS endpoint that accepts POST requests, verify X-Webhook-Signature when using a signing secret, and process payloads in your application.',
      events: [],
    };
  }
}
