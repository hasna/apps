// Harry Potter API Connector — Harry Potter universe data and characters
import { HarryPotterClient } from './client';
import type { HarryPotterConfig, HPCharacter, HPSpell } from '../types';
export { HarryPotterClient } from './client';

export class HarryPotterAPI {
  private readonly client: HarryPotterClient;
  constructor(config: HarryPotterConfig = {}) { this.client = new HarryPotterClient(config); }
  static fromEnv(): HarryPotterAPI { return new HarryPotterAPI(); }

  async getAllCharacters(): Promise<HPCharacter[]> { return this.client.request<HPCharacter[]>('/characters'); }
  async getStudents(): Promise<HPCharacter[]> { return this.client.request<HPCharacter[]>('/characters/students'); }
  async getStaff(): Promise<HPCharacter[]> { return this.client.request<HPCharacter[]>('/characters/staff'); }
  async getCharacter(characterId: string): Promise<HPCharacter[]> { return this.client.request<HPCharacter[]>(`/character/${characterId}`); }

  async getHouseMembers(house: string): Promise<HPCharacter[]> { return this.client.request<HPCharacter[]>(`/characters/house/${house}`); }

  async getAllSpells(): Promise<HPSpell[]> { return this.client.request<HPSpell[]>('/spells'); }

  getClient(): HarryPotterClient { return this.client; }
}
