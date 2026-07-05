import type { XAIGrokClient } from './client';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';

export class ChatApi {
  constructor(private readonly client: XAIGrokClient) {}

  create(body: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.client.post<ChatCompletionResponse>('/chat/completions', { ...body, stream: false });
  }

  stream(body: ChatCompletionRequest): Promise<string> {
    return this.client.request<string>('/chat/completions', {
      method: 'POST',
      body: { ...body, stream: true },
      responseType: 'text',
    });
  }
}
