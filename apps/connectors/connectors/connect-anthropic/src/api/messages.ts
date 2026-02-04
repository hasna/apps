import type { AnthropicClient } from './client';
import type {
  MessagesRequest,
  MessagesResponse,
  Message,
  ChatOptions,
  AnthropicModel,
  DEFAULT_MODEL,
} from '../types';

/**
 * Messages API for Anthropic Claude models
 */
export class MessagesApi {
  constructor(private readonly client: AnthropicClient) {}

  /**
   * Create a message completion
   */
  async create(
    messages: Message[],
    options: ChatOptions = {}
  ): Promise<MessagesResponse> {
    const request: MessagesRequest = {
      model: options.model || 'claude-sonnet-4-20250514',
      messages,
      max_tokens: options.maxTokens || 4096,
      stream: false,
    };

    if (options.systemPrompt !== undefined) request.system = options.systemPrompt;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.topK !== undefined) request.top_k = options.topK;
    if (options.stopSequences !== undefined) request.stop_sequences = options.stopSequences;

    return this.client.post<MessagesResponse>('/messages', request);
  }

  /**
   * Simple ask method - send a single question and get an answer
   */
  async ask(
    question: string,
    options: ChatOptions = {}
  ): Promise<MessagesResponse> {
    const messages: Message[] = [
      { role: 'user', content: question }
    ];

    return this.create(messages, options);
  }

  /**
   * Code generation task
   */
  async code(
    prompt: string,
    options: Omit<ChatOptions, 'systemPrompt'> = {}
  ): Promise<MessagesResponse> {
    return this.ask(prompt, {
      ...options,
      model: options.model || 'claude-sonnet-4-20250514',
      systemPrompt: 'You are an expert programmer. Write clean, efficient, well-documented code. Only output code unless explanation is explicitly requested.',
    });
  }

  /**
   * JSON output mode
   */
  async json<T = unknown>(
    prompt: string,
    options: Omit<ChatOptions, 'systemPrompt'> = {}
  ): Promise<T> {
    const response = await this.ask(prompt, {
      ...options,
      systemPrompt: 'You are a helpful assistant that outputs JSON. Always respond with valid JSON only, no markdown code blocks or other formatting.',
    });

    const content = this.getContent(response);
    // Try to extract JSON from the response even if it has some wrapping
    let jsonStr = content.trim();
    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    return JSON.parse(jsonStr.trim()) as T;
  }

  /**
   * Extract the text content from a response
   */
  getContent(response: MessagesResponse): string {
    const textBlocks = response.content.filter(block => block.type === 'text');
    return textBlocks.map(block => (block as { type: 'text'; text: string }).text).join('');
  }

  /**
   * Get the total tokens used in a response
   */
  getTotalTokens(response: MessagesResponse): number {
    return response.usage.input_tokens + response.usage.output_tokens;
  }
}
