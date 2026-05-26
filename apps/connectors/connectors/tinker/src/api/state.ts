import type { TinkerClient } from './client';
import type {
  SaveStateResponse,
  LoadStateResponse,
  GetCheckpointUrlResponse,
  ListStatesResponse,
  SavedState,
} from '../types';

/**
 * Tinker State Management API
 * Handles saving, loading, and managing model weights and optimizer states
 */
export class StateApi {
  constructor(private readonly client: TinkerClient) {}

  /**
   * Save model weights and optionally optimizer state
   */
  async saveState(
    clientId: string,
    name: string,
    options?: {
      ttlSeconds?: number;
      includeOptimizer?: boolean;
    }
  ): Promise<SaveStateResponse> {
    return this.client.post<SaveStateResponse>(`/v1/training/clients/${clientId}/save_state`, {
      name,
      ttl_seconds: options?.ttlSeconds,
      include_optimizer: options?.includeOptimizer ?? true,
    });
  }

  /**
   * Save weights and create a sampling client in one operation
   */
  async saveWeightsAndGetSamplingClient(
    clientId: string,
    name?: string,
    ttlSeconds?: number
  ): Promise<{
    savePath: string;
    samplingClientId: string;
  }> {
    const response = await this.client.post<{
      save_path: string;
      sampling_client_id: string;
    }>(`/v1/training/clients/${clientId}/save_weights_for_sampler`, {
      name,
      ttl_seconds: ttlSeconds,
    });

    return {
      savePath: response.save_path,
      samplingClientId: response.sampling_client_id,
    };
  }

  /**
   * Load model weights (resets optimizer state)
   */
  async loadState(clientId: string, path: string): Promise<LoadStateResponse> {
    return this.client.post<LoadStateResponse>(`/v1/training/clients/${clientId}/load_state`, {
      path,
      include_optimizer: false,
    });
  }

  /**
   * Load model weights and optimizer state
   */
  async loadStateWithOptimizer(clientId: string, path: string): Promise<LoadStateResponse> {
    return this.client.post<LoadStateResponse>(`/v1/training/clients/${clientId}/load_state`, {
      path,
      include_optimizer: true,
    });
  }

  /**
   * List all saved states
   */
  async listStates(options?: {
    prefix?: string;
    limit?: number;
  }): Promise<ListStatesResponse> {
    const params = new URLSearchParams();
    if (options?.prefix) {
      params.append('prefix', options.prefix);
    }
    if (options?.limit) {
      params.append('limit', String(options.limit));
    }

    const queryString = params.toString();
    const path = queryString ? `/v1/states?${queryString}` : '/v1/states';

    return this.client.get<ListStatesResponse>(path);
  }

  /**
   * Get a downloadable URL for a checkpoint
   */
  async getCheckpointUrl(path: string): Promise<GetCheckpointUrlResponse> {
    return this.client.post<GetCheckpointUrlResponse>('/v1/states/download', {
      path,
    });
  }

  /**
   * Download checkpoint archive to local file
   */
  async downloadCheckpoint(path: string, outputPath: string): Promise<void> {
    const { url } = await this.getCheckpointUrl(path);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download checkpoint: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await Bun.write(outputPath, arrayBuffer);
  }

  /**
   * Delete a saved state
   */
  async deleteState(path: string): Promise<void> {
    await this.client.delete(`/v1/states/${encodeURIComponent(path)}`);
  }

  /**
   * Get information about a saved state
   */
  async getStateInfo(path: string): Promise<SavedState> {
    return this.client.get<SavedState>(`/v1/states/${encodeURIComponent(path)}`);
  }

  /**
   * Extend the TTL of a saved state
   */
  async extendStateTTL(path: string, additionalSeconds: number): Promise<SavedState> {
    return this.client.post<SavedState>(`/v1/states/${encodeURIComponent(path)}/extend`, {
      additional_seconds: additionalSeconds,
    });
  }
}
