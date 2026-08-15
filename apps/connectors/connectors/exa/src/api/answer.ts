import type { ExaClient } from './client';
import type { AnswerOptions, AnswerResponse, AnswerStreamEvent, AnswerModel } from '../types';

/**
 * Answer API - Generate answers with citations, supports streaming
 */
export class AnswerApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * Generate an answer to a question with citations
   */
  async ask(options: AnswerOptions): Promise<AnswerResponse> {
    const body: Record<string, unknown> = {
      query: options.query,
    };

    if (options.text !== undefined) {
      body.text = options.text;
    }
    if (options.model) {
      body.model = options.model;
    }

    return this.client.post<AnswerResponse>('/answer', body);
  }

  /**
   * Generate an answer with the default model
   */
  async askDefault(query: string): Promise<AnswerResponse> {
    return this.ask({ query });
  }

  /**
   * Generate an answer with the Exa Pro model
   */
  async askPro(query: string): Promise<AnswerResponse> {
    return this.ask({ query, model: 'exa-pro' });
  }

  /**
   * Generate an answer with source text included
   */
  async askWithText(query: string, model?: AnswerModel): Promise<AnswerResponse> {
    return this.ask({ query, text: true, model });
  }

  /**
   * Stream an answer (yields chunks as they arrive)
   */
  async *stream(query: string, model?: AnswerModel): AsyncGenerator<AnswerStreamEvent> {
    const body: Record<string, unknown> = {
      query,
      stream: true,
    };

    if (model) {
      body.model = model;
    }

    let buffer = '';

    for await (const chunk of this.client.requestStream('/answer', body)) {
      buffer += chunk;

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              yield { type: 'content', content: parsed.content };
            }
            if (parsed.citations) {
              yield { type: 'citations', citations: parsed.citations };
            }
            if (parsed.error) {
              yield { type: 'error', error: parsed.error };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      if (data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            yield { type: 'content', content: parsed.content };
          }
          if (parsed.citations) {
            yield { type: 'citations', citations: parsed.citations };
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    yield { type: 'done' };
  }

  /**
   * Stream an answer and collect the full response
   */
  async streamAndCollect(query: string, model?: AnswerModel): Promise<{
    answer: string;
    citations: AnswerResponse['citations'];
    chunks: string[];
  }> {
    let answer = '';
    let citations: AnswerResponse['citations'] = [];
    const chunks: string[] = [];

    for await (const event of this.stream(query, model)) {
      switch (event.type) {
        case 'content':
          if (event.content) {
            answer += event.content;
            chunks.push(event.content);
          }
          break;
        case 'citations':
          if (event.citations) {
            citations = event.citations;
          }
          break;
        case 'error':
          throw new Error(event.error || 'Stream error');
      }
    }

    return { answer, citations, chunks };
  }
}
