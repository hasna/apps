import type { Engine } from '../types';
import type { StabilityClient } from './client';

/**
 * Engines API
 * List available generation engines/models
 */
export class EnginesApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * List all available engines
   */
  async list(): Promise<Engine[]> {
    const response = await this.client.get<Engine[]>('/engines/list', undefined, 'v1');
    return response;
  }

  /**
   * Get a specific engine by ID
   */
  async get(engineId: string): Promise<Engine | undefined> {
    const engines = await this.list();
    return engines.find(e => e.id === engineId);
  }

  /**
   * List engines filtered by type
   */
  async listByType(type: string): Promise<Engine[]> {
    const engines = await this.list();
    return engines.filter(e => e.type === type);
  }

  /**
   * Get available image generation engines
   */
  async listImageEngines(): Promise<Engine[]> {
    return this.listByType('PICTURE');
  }
}
