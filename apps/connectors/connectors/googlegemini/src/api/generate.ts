import type { GeminiClient } from './client';
import type {
  GeminiModel,
  Content,
  GenerationConfig,
  SafetySetting,
  GenerateContentRequest,
  GenerateContentResponse,
  CountTokensRequest,
  CountTokensResponse,
} from '../types';

/**
 * Text Generation API
 */
export class GenerateApi {
  constructor(private client: GeminiClient) {}

  /**
   * Generate content from a prompt
   */
  async generateContent(
    model: GeminiModel,
    contents: Content[] | string,
    options?: {
      generationConfig?: GenerationConfig;
      safetySettings?: SafetySetting[];
      systemInstruction?: string;
    }
  ): Promise<GenerateContentResponse> {
    // Convert string to Content array
    const contentArray: Content[] =
      typeof contents === 'string'
        ? [{ parts: [{ text: contents }], role: 'user' }]
        : contents;

    const request: GenerateContentRequest = {
      contents: contentArray,
      generationConfig: options?.generationConfig,
      safetySettings: options?.safetySettings,
    };

    if (options?.systemInstruction) {
      request.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    return this.client.post<GenerateContentResponse>(
      `/models/${model}:generateContent`,
      request
    );
  }

  /**
   * Generate content with streaming
   */
  async *streamGenerateContent(
    model: GeminiModel,
    contents: Content[] | string,
    options?: {
      generationConfig?: GenerationConfig;
      safetySettings?: SafetySetting[];
      systemInstruction?: string;
    }
  ): AsyncGenerator<string, void, unknown> {
    const contentArray: Content[] =
      typeof contents === 'string'
        ? [{ parts: [{ text: contents }], role: 'user' }]
        : contents;

    const request: GenerateContentRequest = {
      contents: contentArray,
      generationConfig: options?.generationConfig,
      safetySettings: options?.safetySettings,
    };

    if (options?.systemInstruction) {
      request.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    yield* this.client.streamRequest(`/models/${model}:streamGenerateContent`, request);
  }

  /**
   * Count tokens in content
   */
  async countTokens(
    model: GeminiModel,
    contents: Content[] | string,
    generationConfig?: GenerationConfig
  ): Promise<CountTokensResponse> {
    const contentArray: Content[] =
      typeof contents === 'string'
        ? [{ parts: [{ text: contents }], role: 'user' }]
        : contents;

    const request: CountTokensRequest = {
      contents: contentArray,
      generationConfig,
    };

    return this.client.post<CountTokensResponse>(
      `/models/${model}:countTokens`,
      request
    );
  }

  /**
   * Simple text generation helper
   */
  async text(
    prompt: string,
    options?: {
      model?: GeminiModel;
      temperature?: number;
      maxTokens?: number;
      systemInstruction?: string;
    }
  ): Promise<string> {
    const model = options?.model || 'gemini-2.5-flash';
    const response = await this.generateContent(model, prompt, {
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
      },
      systemInstruction: options?.systemInstruction,
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /**
   * Chat-style generation with history
   */
  async chat(
    messages: { role: 'user' | 'model'; text: string }[],
    options?: {
      model?: GeminiModel;
      temperature?: number;
      maxTokens?: number;
      systemInstruction?: string;
    }
  ): Promise<string> {
    const model = options?.model || 'gemini-2.5-flash';
    const contents: Content[] = messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    const response = await this.generateContent(model, contents, {
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
      },
      systemInstruction: options?.systemInstruction,
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /**
   * JSON generation helper
   */
  async json<T = unknown>(
    prompt: string,
    options?: {
      model?: GeminiModel;
      temperature?: number;
      systemInstruction?: string;
    }
  ): Promise<T> {
    const model = options?.model || 'gemini-2.5-flash';
    const response = await this.generateContent(model, prompt, {
      generationConfig: {
        temperature: options?.temperature,
        responseMimeType: 'application/json',
      },
      systemInstruction: options?.systemInstruction,
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(text) as T;
  }
}
