import { ZohoSurveyClient } from './client';
import type {
  SendInvitationPayload,
  ZohoSurveyCollector,
  ZohoSurveyConfig,
  ZohoSurveyDistribution,
  ZohoSurveyPortal,
  ZohoSurveyResponse,
  ZohoSurveySummary,
} from '../types';

export { ZohoSurveyClient, DEFAULT_BASE_URL } from './client';

export class ZohoSurvey {
  private readonly client: ZohoSurveyClient;

  constructor(config: ZohoSurveyConfig) {
    this.client = new ZohoSurveyClient(config);
  }

  static fromEnv(): ZohoSurvey {
    const token = process.env.ZOHO_SURVEY_TOKEN;
    const portalId = process.env.ZOHO_SURVEY_PORTAL_ID;
    const departmentId = process.env.ZOHO_SURVEY_DEPARTMENT_ID;
    if (!token || !portalId || !departmentId) {
      throw new Error('ZOHO_SURVEY_TOKEN, ZOHO_SURVEY_PORTAL_ID, and ZOHO_SURVEY_DEPARTMENT_ID are required');
    }
    return new ZohoSurvey({
      token,
      portalId,
      departmentId,
      baseUrl: process.env.ZOHO_SURVEY_BASE_URL,
    });
  }

  async listPortals(): Promise<ZohoSurveyPortal[]> {
    const result = await this.client.request<ZohoSurveyPortal[] | { portals?: ZohoSurveyPortal[] }>('/portals');
    return Array.isArray(result) ? result : result.portals ?? [];
  }

  async listSurveys(options?: {
    filterby?: string;
    offset?: number;
    range?: number;
  }): Promise<ZohoSurveySummary[]> {
    const result = await this.client.request<ZohoSurveySummary[] | { surveys?: ZohoSurveySummary[] }>(
      `${this.client.surveyBasePath()}/surveys`,
      {
        params: {
          filterby: options?.filterby ?? 'published',
          offset: options?.offset,
          range: options?.range,
        },
      },
    );
    return Array.isArray(result) ? result : result.surveys ?? [];
  }

  async getSurvey(surveyId: string): Promise<ZohoSurveySummary> {
    return this.client.request<ZohoSurveySummary>(`${this.client.surveyBasePath()}/surveys/${surveyId}`);
  }

  async listResponses(
    surveyId: string,
    options?: { offset?: number; range?: number },
  ): Promise<ZohoSurveyResponse[]> {
    const result = await this.client.request<ZohoSurveyResponse[] | { responses?: ZohoSurveyResponse[] }>(
      `${this.client.surveyBasePath()}/surveys/${surveyId}/responses`,
      {
        params: {
          offset: options?.offset,
          range: options?.range,
        },
      },
    );
    return Array.isArray(result) ? result : result.responses ?? [];
  }

  async getResponse(surveyId: string, responseId: string): Promise<ZohoSurveyResponse> {
    return this.client.request<ZohoSurveyResponse>(
      `${this.client.surveyBasePath()}/surveys/${surveyId}/responses/${responseId}`,
    );
  }

  async listCollectors(surveyId: string): Promise<ZohoSurveyCollector[]> {
    const result = await this.client.request<ZohoSurveyCollector[] | { collectors?: ZohoSurveyCollector[] }>(
      `${this.client.surveyBasePath()}/surveys/${surveyId}/collectors/metainfo`,
      {
        params: {
          status: 'open',
        },
      },
    );
    return Array.isArray(result) ? result : result.collectors ?? [];
  }

  async listTriggerDistributions(surveyId: string, collectorId: string): Promise<ZohoSurveyDistribution[]> {
    const result = await this.client.request<ZohoSurveyDistribution[] | { distributions?: ZohoSurveyDistribution[] }>(
      `${this.client.surveyBasePath()}/surveys/${surveyId}/collectors/${collectorId}/distributions/email/metainfo`,
      {
        params: {
          type: 'trigger',
        },
      },
    );
    return Array.isArray(result) ? result : result.distributions ?? [];
  }

  async triggerInvitation(
    surveyId: string,
    collectorId: string,
    distributionId: string,
    payload: SendInvitationPayload,
  ): Promise<unknown> {
    return this.client.request(
      `${this.client.surveyBasePath()}/surveys/${surveyId}/collectors/${collectorId}/distributions/${distributionId}/email/sendinvitation`,
      {
        method: 'POST',
        body: payload,
      },
    );
  }

  getClient(): ZohoSurveyClient {
    return this.client;
  }
}
