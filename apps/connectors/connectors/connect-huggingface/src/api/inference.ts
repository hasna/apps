import type { HuggingFaceClient } from './client';

const INFERENCE_URL = 'https://api-inference.huggingface.co/models';

export interface TextGenerationOptions {
  max_new_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  return_full_text?: boolean;
  stop?: string[];
}

export interface TextGenerationResult {
  generated_text: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResult {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
    index: number;
  }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class InferenceApi {
  constructor(private readonly client: HuggingFaceClient) {}

  /** Run text generation inference */
  async textGeneration(
    model: string,
    prompt: string,
    options: TextGenerationOptions = {}
  ): Promise<TextGenerationResult[]> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.client.getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: options.max_new_tokens ?? 256,
          temperature: options.temperature,
          top_p: options.top_p,
          top_k: options.top_k,
          repetition_penalty: options.repetition_penalty,
          return_full_text: options.return_full_text ?? false,
          stop: options.stop,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Inference failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  /** Chat completion via HF Inference API (for chat models) */
  async chat(
    model: string,
    messages: ChatMessage[],
    options: Omit<TextGenerationOptions, 'return_full_text'> = {}
  ): Promise<ChatCompletionResult> {
    const response = await fetch(`${INFERENCE_URL}/${model}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.client.getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_new_tokens ?? 256,
        temperature: options.temperature,
        top_p: options.top_p,
        stop: options.stop,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Chat inference failed (${response.status}): ${text}`);
    }

    return response.json();
  }
}
