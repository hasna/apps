import type { TinkerClient } from './client';
import type {
  ModelInput,
  SamplingParams,
  SampleResponse,
  ComputeLogprobsResponse,
  CreateSamplingClientResponse,
  SamplingClientInfo,
} from '../types';

/**
 * Tinker Sampling API
 * Handles inference/sampling operations for trained models
 */
export class SamplingApi {
  constructor(private readonly client: TinkerClient) {}

  /**
   * Create a new sampling client from a saved model path
   */
  async createSamplingClient(modelPath: string): Promise<CreateSamplingClientResponse> {
    return this.client.post<CreateSamplingClientResponse>('/v1/sampling/clients', {
      model_path: modelPath,
    });
  }

  /**
   * List all sampling clients
   */
  async listSamplingClients(): Promise<{ clients: SamplingClientInfo[] }> {
    return this.client.get<{ clients: SamplingClientInfo[] }>('/v1/sampling/clients');
  }

  /**
   * Get sampling client information
   */
  async getSamplingClientInfo(clientId: string): Promise<SamplingClientInfo> {
    return this.client.get<SamplingClientInfo>(`/v1/sampling/clients/${clientId}`);
  }

  /**
   * Delete a sampling client
   */
  async deleteSamplingClient(clientId: string): Promise<void> {
    await this.client.delete(`/v1/sampling/clients/${clientId}`);
  }

  /**
   * Generate samples from the model
   */
  async sample(
    clientId: string,
    prompt: ModelInput,
    samplingParams: SamplingParams,
    options?: {
      numSamples?: number;
      includePromptLogprobs?: boolean;
      topkPromptLogprobs?: number;
    }
  ): Promise<SampleResponse> {
    return this.client.post<SampleResponse>(`/v1/sampling/clients/${clientId}/sample`, {
      prompt: this.serializeModelInput(prompt),
      sampling_params: {
        max_tokens: samplingParams.maxTokens,
        temperature: samplingParams.temperature ?? 1.0,
        top_p: samplingParams.topP,
        top_k: samplingParams.topK,
        stop: samplingParams.stop,
        presence_penalty: samplingParams.presencePenalty,
        frequency_penalty: samplingParams.frequencyPenalty,
        seed: samplingParams.seed,
      },
      num_samples: options?.numSamples ?? 1,
      include_prompt_logprobs: options?.includePromptLogprobs,
      topk_prompt_logprobs: options?.topkPromptLogprobs,
    });
  }

  /**
   * Compute log probabilities for a prompt
   */
  async computeLogprobs(
    clientId: string,
    prompt: ModelInput
  ): Promise<ComputeLogprobsResponse> {
    return this.client.post<ComputeLogprobsResponse>(`/v1/sampling/clients/${clientId}/logprobs`, {
      prompt: this.serializeModelInput(prompt),
    });
  }

  /**
   * Simple text completion using a sampling client
   */
  async complete(
    clientId: string,
    text: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
    }
  ): Promise<string> {
    // For simple text completion, we need to encode the text
    // This is a simplified version - in practice, you'd want to use
    // the tokenizer from the training client
    const prompt: ModelInput = {
      chunks: [{ type: 'text', tokens: [] }], // Placeholder - actual implementation would encode
    };

    const response = await this.sample(
      clientId,
      prompt,
      {
        maxTokens: options?.maxTokens ?? 256,
        temperature: options?.temperature ?? 0.7,
        stop: options?.stop,
      }
    );

    return response.outputs[0]?.text || '';
  }

  /**
   * Generate multiple samples with different temperatures
   */
  async sampleWithVariations(
    clientId: string,
    prompt: ModelInput,
    temperatures: number[],
    maxTokens: number = 256
  ): Promise<SampleResponse[]> {
    const results: SampleResponse[] = [];

    for (const temperature of temperatures) {
      const response = await this.sample(
        clientId,
        prompt,
        {
          maxTokens,
          temperature,
        }
      );
      results.push(response);
    }

    return results;
  }

  /**
   * Serialize a ModelInput for API transmission
   */
  private serializeModelInput(input: ModelInput): Record<string, unknown> {
    return {
      chunks: input.chunks.map(chunk => {
        if (chunk.type === 'text') {
          return { type: 'text', tokens: chunk.tokens };
        } else {
          return { type: 'image', data: chunk.data, format: chunk.format };
        }
      }),
    };
  }
}
