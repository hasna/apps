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

  /** Classify text into categories */
  async textClassification(
    model: string,
    text: string
  ): Promise<Array<{ label: string; score: number }>> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.client.getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text }),
    });
    if (!response.ok) throw new Error(`Text classification failed (${response.status}): ${await response.text()}`);
    const result = await response.json();
    return Array.isArray(result[0]) ? result[0] : result;
  }

  /** Summarize text */
  async summarization(
    model: string,
    text: string,
    options: { max_length?: number; min_length?: number } = {}
  ): Promise<string> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.client.getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text, parameters: options }),
    });
    if (!response.ok) throw new Error(`Summarization failed (${response.status}): ${await response.text()}`);
    const result = await response.json() as Array<{ summary_text: string }>;
    return result[0]?.summary_text ?? '';
  }

  /** Answer a question given a context */
  async questionAnswering(
    model: string,
    question: string,
    context: string
  ): Promise<{ answer: string; score: number; start: number; end: number }> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.client.getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { question, context } }),
    });
    if (!response.ok) throw new Error(`QA failed (${response.status}): ${await response.text()}`);
    return response.json();
  }

  /** Translate text */
  async translation(model: string, text: string): Promise<string> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.client.getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text }),
    });
    if (!response.ok) throw new Error(`Translation failed (${response.status}): ${await response.text()}`);
    const result = await response.json() as Array<{ translation_text: string }>;
    return result[0]?.translation_text ?? '';
  }

  /** Zero-shot classification — classify without training examples */
  async zeroShotClassification(
    model: string,
    text: string,
    candidateLabels: string[]
  ): Promise<{ sequence: string; labels: string[]; scores: number[] }> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.client.getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text, parameters: { candidate_labels: candidateLabels } }),
    });
    if (!response.ok) throw new Error(`Zero-shot classification failed (${response.status}): ${await response.text()}`);
    return response.json();
  }

  /** Extract text embeddings (feature extraction) */
  async featureExtraction(model: string, text: string | string[]): Promise<number[][]> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.client.getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: text }),
    });
    if (!response.ok) throw new Error(`Feature extraction failed (${response.status}): ${await response.text()}`);
    return response.json();
  }

  /** Generate an image from a text prompt */
  async textToImage(
    model: string,
    prompt: string,
    options: { negative_prompt?: string; width?: number; height?: number; num_inference_steps?: number } = {}
  ): Promise<ArrayBuffer> {
    const response = await fetch(`${INFERENCE_URL}/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.client.getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: options }),
    });
    if (!response.ok) throw new Error(`Text-to-image failed (${response.status}): ${await response.text()}`);
    return response.arrayBuffer();
  }
}
