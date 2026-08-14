import type { ExaClient } from './client';
import type { CodeContextOptions, CodeContextResponse } from '../types';

/**
 * Context API - Code context search for programming queries
 */
export class ContextApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * Search for code context
   * Optimized for programming-related queries to find relevant documentation,
   * tutorials, examples, and technical content
   */
  async search(options: CodeContextOptions): Promise<CodeContextResponse> {
    const body: Record<string, unknown> = {
      query: options.query,
      tokensNum: options.tokensNum ?? 'dynamic',
    };

    return this.client.post<CodeContextResponse>('/context', body);
  }

  /**
   * Quick search with default options
   */
  async query(query: string): Promise<CodeContextResponse> {
    return this.search({ query });
  }

  /**
   * Search with a specific token limit
   */
  async queryWithTokens(query: string, tokensNum: number | 'dynamic'): Promise<CodeContextResponse> {
    return this.search({ query, tokensNum });
  }

  /**
   * Search for API documentation
   */
  async searchApiDocs(library: string, topic?: string): Promise<CodeContextResponse> {
    const query = topic ? `${library} ${topic} API documentation` : `${library} API documentation`;
    return this.search({ query });
  }

  /**
   * Search for code examples
   */
  async searchExamples(topic: string, language?: string): Promise<CodeContextResponse> {
    const query = language ? `${topic} ${language} code examples` : `${topic} code examples`;
    return this.search({ query });
  }

  /**
   * Search for tutorials
   */
  async searchTutorials(topic: string): Promise<CodeContextResponse> {
    return this.search({ query: `${topic} tutorial guide` });
  }

  /**
   * Search for best practices
   */
  async searchBestPractices(topic: string): Promise<CodeContextResponse> {
    return this.search({ query: `${topic} best practices guidelines` });
  }

  /**
   * Search for troubleshooting information
   */
  async searchTroubleshooting(issue: string): Promise<CodeContextResponse> {
    return this.search({ query: `${issue} solution fix troubleshoot` });
  }

  /**
   * Get context as a string (useful for LLM prompts)
   * Returns the formatted response from Exa's context API
   */
  async getContextString(query: string, options: { tokensNum?: number | 'dynamic' } = {}): Promise<string> {
    const { tokensNum } = options;
    const response = await this.search({ query, tokensNum });
    return response.response;
  }
}
