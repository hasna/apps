import type { VectorShiftConfig } from '../types';
import { VectorShiftApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.vectorshift.ai/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export interface ServerSentEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export class VectorShiftClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: VectorShiftConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      let errorMessage = String(data || response.statusText);
      if (typeof data === 'object' && data !== null) {
        const errorObj = data as { error?: string | { message?: string }; message?: string; status?: string };
        if (typeof errorObj.error === 'string') {
          errorMessage = errorObj.error;
        } else if (typeof errorObj.error === 'object' && errorObj.error?.message) {
          errorMessage = errorObj.error.message;
        } else {
          errorMessage = errorObj.message || JSON.stringify(data);
        }
      }
      throw new VectorShiftApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async *requestStream(path: string, options: Omit<RequestOptions, 'method'> = {}): AsyncGenerator<ServerSentEvent> {
    const { params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'text/event-stream',
      ...headers,
    };

    if (body) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = text || response.statusText;
      try {
        const parsed = JSON.parse(text) as { error?: string | { message?: string }; message?: string };
        if (typeof parsed.error === 'string') {
          errorMessage = parsed.error;
        } else if (typeof parsed.error === 'object' && parsed.error?.message) {
          errorMessage = parsed.error.message;
        } else if (parsed.message) {
          errorMessage = parsed.message;
        }
      } catch { /* use response text */ }
      throw new VectorShiftApiError(errorMessage, response.status);
    }

    if (!response.body) {
      throw new VectorShiftApiError('No response body for streaming request', 500);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parsed = drainSseBuffer(buffer);
        buffer = parsed.remaining;
        for (const event of parsed.events) {
          if (event.event === 'error') {
            throw new VectorShiftApiError(event.data || 'Streaming request failed', response.status);
          }
          if (event.data.trim() === '[DONE]') return;
          yield event;
        }
      }

      buffer += decoder.decode();
      const parsed = drainSseBuffer(buffer, true);
      for (const event of parsed.events) {
        if (event.event === 'error') {
          throw new VectorShiftApiError(event.data || 'Streaming request failed', response.status);
        }
        if (event.data.trim() === '[DONE]') return;
        yield event;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

function drainSseBuffer(buffer: string, flush = false): { events: ServerSentEvent[]; remaining: string } {
  const events: ServerSentEvent[] = [];
  let remaining = buffer;

  while (true) {
    const lfIndex = remaining.indexOf('\n\n');
    const crlfIndex = remaining.indexOf('\r\n\r\n');

    let delimiterIndex = -1;
    let delimiterLength = 0;
    if (lfIndex !== -1 && (crlfIndex === -1 || lfIndex < crlfIndex)) {
      delimiterIndex = lfIndex;
      delimiterLength = 2;
    } else if (crlfIndex !== -1) {
      delimiterIndex = crlfIndex;
      delimiterLength = 4;
    }

    if (delimiterIndex === -1) break;

    const block = remaining.slice(0, delimiterIndex);
    remaining = remaining.slice(delimiterIndex + delimiterLength);
    const event = parseSseBlock(block);
    if (event) events.push(event);
  }

  if (flush && remaining.trim()) {
    const event = parseSseBlock(remaining);
    if (event) events.push(event);
    remaining = '';
  }

  return { events, remaining };
}

function parseSseBlock(block: string): ServerSentEvent | undefined {
  const event: ServerSentEvent = { data: '' };
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const separator = rawLine.indexOf(':');
    const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
    let value = separator === -1 ? '' : rawLine.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') {
      dataLines.push(value);
    } else if (field === 'event') {
      event.event = value;
    } else if (field === 'id') {
      event.id = value;
    } else if (field === 'retry') {
      const retry = Number(value);
      if (Number.isFinite(retry)) event.retry = retry;
    }
  }

  if (dataLines.length === 0 && !event.event) return undefined;
  event.data = dataLines.join('\n');
  return event;
}
