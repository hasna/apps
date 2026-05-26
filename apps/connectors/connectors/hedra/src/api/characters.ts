import type { HedraClient } from './client';
import type { HedraCharacter, HedraCharacterCreateParams } from '../types';

/**
 * Characters API - Manage Hedra characters for video generation
 */
export class CharactersApi {
  constructor(private readonly client: HedraClient) {}

  /**
   * List all characters
   */
  async list(): Promise<HedraCharacter[]> {
    return this.client.get<HedraCharacter[]>('/v1/characters');
  }

  /**
   * Get a single character by ID
   */
  async get(id: string): Promise<HedraCharacter> {
    return this.client.get<HedraCharacter>(`/v1/characters/${id}`);
  }

  /**
   * Create a new character
   */
  async create(params: HedraCharacterCreateParams): Promise<HedraCharacter> {
    return this.client.post<HedraCharacter>('/v1/characters', params);
  }

  /**
   * Update an existing character
   */
  async update(id: string, params: Partial<HedraCharacterCreateParams>): Promise<HedraCharacter> {
    return this.client.patch<HedraCharacter>(`/v1/characters/${id}`, params);
  }

  /**
   * Delete a character
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/v1/characters/${id}`);
  }
}
