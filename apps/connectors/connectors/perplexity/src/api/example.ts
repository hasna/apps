import type { PerplexityClient } from './client';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  PerplexityModel,
} from '../types';

export interface ChatOptions {
  model?: PerplexityModel;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  searchDomainFilter?: string[];
  returnImages?: boolean;
  returnRelatedQuestions?: boolean;
  searchRecencyFilter?: 'month' | 'week' | 'day' | 'hour';
  systemPrompt?: string;
}

/**
 * Chat Completions API
 */
export class ChatApi {
  constructor(private readonly client: PerplexityClient) {}

  /**
   * Create a chat completion
   */
  async create(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ChatCompletionResponse> {
    const request: ChatCompletionRequest = {
      model: options.model || 'sonar',
      messages,
      stream: false,
    };

    if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens;
    if (options.temperature !== undefined) request.temperature = options.temperature;
    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.topK !== undefined) request.top_k = options.topK;
    if (options.presencePenalty !== undefined) request.presence_penalty = options.presencePenalty;
    if (options.frequencyPenalty !== undefined) request.frequency_penalty = options.frequencyPenalty;
    if (options.searchDomainFilter !== undefined) request.search_domain_filter = options.searchDomainFilter;
    if (options.returnImages !== undefined) request.return_images = options.returnImages;
    if (options.returnRelatedQuestions !== undefined) request.return_related_questions = options.returnRelatedQuestions;
    if (options.searchRecencyFilter !== undefined) request.search_recency_filter = options.searchRecencyFilter;

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
   * Search the web and get an answer grounded in search results
   */
  async search(
    query: string,
    options: Omit<ChatOptions, 'systemPrompt'> & { recency?: 'month' | 'week' | 'day' | 'hour' } = {}
  ): Promise<ChatCompletionResponse> {
    const { recency, ...restOptions } = options;

    return this.ask(query, {
      ...restOptions,
      searchRecencyFilter: recency,
      systemPrompt: 'You are a helpful search assistant. Provide accurate, well-researched answers based on the most recent and relevant information available.',
    });
  }

  /**
   * Deep research on a topic
   */
  async research(
    topic: string,
    options: Omit<ChatOptions, 'model' | 'systemPrompt'> = {}
  ): Promise<ChatCompletionResponse> {
    return this.ask(topic, {
      ...options,
      model: 'sonar-deep-research',
      systemPrompt: 'You are a research assistant. Provide comprehensive, well-cited analysis on the given topic.',
    });
  }

  /**
   * Reasoning task
   */
  async reason(
    prompt: string,
    options: Omit<ChatOptions, 'model' | 'systemPrompt'> = {}
  ): Promise<ChatCompletionResponse> {
    return this.ask(prompt, {
      ...options,
      model: 'sonar-reasoning-pro',
      systemPrompt: 'You are a logical reasoning assistant. Think through problems step by step and provide well-reasoned answers.',
    });
  }
}
