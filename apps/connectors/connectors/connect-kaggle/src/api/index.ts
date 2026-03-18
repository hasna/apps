// Kaggle Connector — Data science competitions, datasets, and notebooks
import { KaggleClient } from './client';
import type { KaggleConfig, KGDataset, KGCompetition, KGKernel, KGLeaderboardEntry } from '../types';
export { KaggleClient } from './client';

export class Kaggle {
  private readonly client: KaggleClient;
  constructor(config: KaggleConfig) { this.client = new KaggleClient(config); }
  static fromEnv(): Kaggle {
    const username = process.env.KAGGLE_USERNAME;
    const key = process.env.KAGGLE_KEY;
    if (!username || !key) throw new Error('KAGGLE_USERNAME and KAGGLE_KEY are required');
    return new Kaggle({ username, key });
  }

  async listDatasets(options?: { search?: string; page?: number; sortBy?: string }): Promise<KGDataset[]> {
    return this.client.request<KGDataset[]>('/datasets/list', { search: options?.search, page: options?.page, sortBy: options?.sortBy });
  }
  async getDataset(owner: string, dataset: string): Promise<KGDataset> {
    return this.client.request<KGDataset>(`/datasets/view/${owner}/${dataset}`);
  }

  async listCompetitions(options?: { search?: string; page?: number; category?: string }): Promise<KGCompetition[]> {
    return this.client.request<KGCompetition[]>('/competitions/list', { search: options?.search, page: options?.page, category: options?.category });
  }
  async getLeaderboard(competitionId: string): Promise<KGLeaderboardEntry[]> {
    return this.client.request<KGLeaderboardEntry[]>(`/competitions/${competitionId}/leaderboard/download`);
  }

  async listKernels(options?: { search?: string; page?: number; language?: string }): Promise<KGKernel[]> {
    return this.client.request<KGKernel[]>('/kernels/list', { search: options?.search, page: options?.page, language: options?.language });
  }

  getClient(): KaggleClient { return this.client; }
}
