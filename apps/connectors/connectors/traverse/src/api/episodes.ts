import type { Episode, JudgmentRequest, JudgmentResponse, ListResponse } from '../types';
import { TraverseClient } from './client';

export class EpisodesApi {
  constructor(private readonly client: TraverseClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<Episode>> {
    return this.client.get<ListResponse<Episode>>('/episodes', params);
  }

  get(episodeId: string): Promise<Episode> {
    return this.client.get<Episode>(`/episodes/${encodeURIComponent(episodeId)}`);
  }

  submitJudgment(episodeId: string, body: JudgmentRequest): Promise<JudgmentResponse> {
    return this.client.post<JudgmentResponse>(
      `/episodes/${encodeURIComponent(episodeId)}/judgments`,
      body,
    );
  }
}
