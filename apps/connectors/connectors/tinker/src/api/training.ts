import type { TinkerClient } from './client';
import type {
  LoRAConfig,
  AdamParams,
  Datum,
  LossFunction,
  ForwardBackwardResponse,
  OptimStepResponse,
  CreateTrainingClientResponse,
  TrainingClientInfo,
  ServerCapabilities,
} from '../types';

/**
 * Tinker Training API
 * Handles forward/backward passes, optimization steps, and training client management
 */
export class TrainingApi {
  constructor(private readonly client: TinkerClient) {}

  /**
   * Get server capabilities including supported models
   */
  async getServerCapabilities(): Promise<ServerCapabilities> {
    return this.client.get<ServerCapabilities>('/v1/capabilities');
  }

  /**
   * Create a new LoRA training client
   */
  async createLoRATrainingClient(options: {
    baseModel: string;
    rank?: number;
    alpha?: number;
    targetModules?: string[];
    dropout?: number;
  }): Promise<CreateTrainingClientResponse> {
    return this.client.post<CreateTrainingClientResponse>('/v1/training/clients', {
      base_model: options.baseModel,
      rank: options.rank || 32,
      alpha: options.alpha,
      target_modules: options.targetModules,
      dropout: options.dropout,
    });
  }

  /**
   * List all training clients
   */
  async listTrainingClients(): Promise<{ clients: TrainingClientInfo[] }> {
    return this.client.get<{ clients: TrainingClientInfo[] }>('/v1/training/clients');
  }

  /**
   * Get training client information
   */
  async getTrainingClientInfo(clientId: string): Promise<TrainingClientInfo> {
    return this.client.get<TrainingClientInfo>(`/v1/training/clients/${clientId}`);
  }

  /**
   * Delete a training client
   */
  async deleteTrainingClient(clientId: string): Promise<void> {
    await this.client.delete(`/v1/training/clients/${clientId}`);
  }

  /**
   * Perform forward pass only (compute loss without gradients)
   */
  async forward(
    clientId: string,
    data: Datum[],
    lossFn: LossFunction = 'cross_entropy',
    lossFnConfig?: Record<string, unknown>
  ): Promise<ForwardBackwardResponse> {
    return this.client.post<ForwardBackwardResponse>(`/v1/training/clients/${clientId}/forward`, {
      data: data.map(d => this.serializeDatum(d)),
      loss_fn: lossFn,
      loss_fn_config: lossFnConfig,
    });
  }

  /**
   * Perform forward and backward pass (compute loss and gradients)
   */
  async forwardBackward(
    clientId: string,
    data: Datum[],
    lossFn: LossFunction = 'cross_entropy',
    lossFnConfig?: Record<string, unknown>
  ): Promise<ForwardBackwardResponse> {
    return this.client.post<ForwardBackwardResponse>(`/v1/training/clients/${clientId}/forward_backward`, {
      data: data.map(d => this.serializeDatum(d)),
      loss_fn: lossFn,
      loss_fn_config: lossFnConfig,
    });
  }

  /**
   * Perform optimization step using AdamW optimizer
   */
  async optimStep(clientId: string, adamParams: AdamParams): Promise<OptimStepResponse> {
    return this.client.post<OptimStepResponse>(`/v1/training/clients/${clientId}/optim_step`, {
      adam_params: {
        learning_rate: adamParams.learningRate,
        beta1: adamParams.beta1,
        beta2: adamParams.beta2,
        epsilon: adamParams.epsilon,
        weight_decay: adamParams.weightDecay || 0.0,
      },
    });
  }

  /**
   * Zero out accumulated gradients
   */
  async zeroGrad(clientId: string): Promise<void> {
    await this.client.post(`/v1/training/clients/${clientId}/zero_grad`);
  }

  /**
   * Get current gradient statistics
   */
  async getGradientStats(clientId: string): Promise<{
    gradientNorm: number;
    numAccumulations: number;
  }> {
    return this.client.get(`/v1/training/clients/${clientId}/gradient_stats`);
  }

  /**
   * Serialize a Datum for API transmission
   */
  private serializeDatum(datum: Datum): Record<string, unknown> {
    return {
      model_input: {
        chunks: datum.modelInput.chunks.map(chunk => {
          if (chunk.type === 'text') {
            return { type: 'text', tokens: chunk.tokens };
          } else {
            return { type: 'image', data: chunk.data, format: chunk.format };
          }
        }),
      },
      loss_fn_inputs: {
        weights: datum.lossFnInputs.weights,
        target_tokens: datum.lossFnInputs.targetTokens,
      },
    };
  }
}
