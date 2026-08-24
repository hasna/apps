/**
 * ./sdk — the generated-style client surface of @hasna/messages.
 *
 * Talks to messages-serve over HTTP (HASNA_MESSAGES_API_URL +
 * HASNA_MESSAGES_API_KEY). The client never opens Postgres directly.
 */
import type { Message, SendResult, ThreadSummary } from "../types";

export interface MessagesClientOptions {
  /** Base URL of messages-serve, e.g. https://messages.example.com */
  baseUrl: string;
  /** API key, sent as the `x-api-key` header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

export class MessagesClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MessagesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? `messages API ${res.status}`);
    }
    return data;
  }

  async send(from: string, to: string, content: string, replyTo?: string): Promise<SendResult> {
    return this.request<SendResult>("POST", "/v1/messages", {
      from,
      to,
      content,
      reply_to: replyTo ?? null,
    });
  }

  async threads(agent: string): Promise<ThreadSummary[]> {
    const data = await this.request<{ threads: ThreadSummary[] }>(
      "GET",
      `/v1/threads?agent=${encodeURIComponent(agent)}`,
    );
    return data.threads;
  }

  async threadMessages(threadId: string, limit?: number): Promise<Message[]> {
    const q = limit ? `?limit=${limit}` : "";
    const data = await this.request<{ messages: Message[] }>(
      "GET",
      `/v1/threads/${encodeURIComponent(threadId)}/messages${q}`,
    );
    return data.messages;
  }

  async markRead(threadId: string, agent: string): Promise<void> {
    await this.request("POST", `/v1/threads/${encodeURIComponent(threadId)}/read`, { agent });
  }
}
