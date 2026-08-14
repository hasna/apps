import type { ConnectorClient } from './client';
import type { Survey, SurveyListParams, SurveyResponsesParams } from '../types';

export class SurveysApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: SurveyListParams): Promise<unknown> {
    return this.client.get('/surveys', params);
  }

  async get(id: string | number): Promise<Survey> {
    return this.client.get<Survey>(`/surveys/${encodeURIComponent(String(id))}`);
  }

  async responses(id: string | number, params?: SurveyResponsesParams): Promise<unknown> {
    return this.client.get(`/surveys/${encodeURIComponent(String(id))}/responses`, params);
  }
}
