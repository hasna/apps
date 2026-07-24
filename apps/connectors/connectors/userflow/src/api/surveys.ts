import type { UserflowClient } from './client';
import type { CursorListParams } from '../types';
import { encodeResourceId } from './helpers';

export class SurveysApi {
  constructor(private readonly client: UserflowClient) {}

  async listSurveyResponses(
    params: CursorListParams & {
      flow_id?: string;
      created_after?: string;
      created_before?: string;
    } = {},
  ): Promise<unknown> {
    return this.client.get('/v2/survey_responses', params);
  }

  async getSurveyResponse(id: string): Promise<unknown> {
    return this.client.get(`/v2/survey_responses/${encodeResourceId(id)}`);
  }
}
