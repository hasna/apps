import type { MistralClient } from './client';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatOptions,
  MistralModel,
  Tool,
} from '../types';

/**
 * Chat Completions API
 */
export class ChatApi {
  constructor(private readonly client: MistralClient) {}

  /**
   * Create a chat completion
   */
  async create(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ChatCompletionResponse> {
    const request: ChatCompletionRequest = {
      model: options.model || 'mistral-small-latest',
      messages,
      stream: false,
    };

    if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.stop !== undefined) request.stop = options.stop;
    if (options.seed !== undefined) request.random_seed = options.seed;
    if (options.tools !== undefined) request.tools = options.tools;
    if (options.safePrompt !== undefined) request.safe_prompt = options.safePrompt;

    if (options.responseFormat === 'json') {
      request.response_format = { type: 'json_object' };
    }

    return this.client.post<ChatCompletionResponse>('/chat/completions', request);
  }

  /**
   * Simple ask method - send a single question and get an answer
   */
  async ask(
    question: string,
    options: ChatOptions = {}
  ): Promise<ChatCompletionResponse> {
    const messages: ChatMessage[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    messages.push({ role: 'user', content: question });

    return this.create(messages, options);
  }

  /**
   * Code generation task using Codestral
   */
  async code(
    prompt: string,
    options: Omit<ChatOptions, 'systemPrompt'> = {}
  ): Promise<ChatCompletionResponse> {
    return this.ask(prompt, {
      ...options,
      model: options.model || 'codestral-latest',
      systemPrompt: 'You are an expert programmer. Write clean, efficient, well-documented code. Only output code unless explanation is explicitly requested.',
    });
  }

  /**
   * JSON output mode
   */
  async json<T = unknown>(
    prompt: string,
    options: Omit<ChatOptions, 'responseFormat'> = {}
  ): Promise<T> {
    const response = await this.ask(prompt, {
      ...options,
      responseFormat: 'json',
      systemPrompt: options.systemPrompt || 'You are a helpful assistant that outputs JSON. Always respond with valid JSON only.',
    });

    const content = response.choices[0]?.message?.content;
    if (typeof content === 'string') {
      return JSON.parse(content) as T;
    }
    throw new Error('No content in response');
  }

  /**
   * Extract the text content from a response
   */
  getContent(response: ChatCompletionResponse): string {
    const content = response.choices[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('');
    }
    return '';
  }
}
