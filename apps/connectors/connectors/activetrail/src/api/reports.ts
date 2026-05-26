import type { ConnectorClient } from './client';
import type { CampaignReport, ListParams } from '../types';

export class ReportsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>('/campaignreports', queryParams);
  }

  async get(campaignId: number): Promise<CampaignReport> {
    return this.client.get<CampaignReport>(`/campaignreports/${campaignId}`);
  }

  async getOpens(campaignId: number, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>(`/campaignreports/${campaignId}/opens`, queryParams);
  }

  async getClicks(campaignId: number, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>(`/campaignreports/${campaignId}/clickdetails`, queryParams);
  }

  async getBounces(campaignId: number, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>(`/campaignreports/${campaignId}/bounces`, queryParams);
  }

  async getUnsubscribed(campaignId: number, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>(`/campaignreports/${campaignId}/unsubscribed`, queryParams);
  }

  async getComplaints(campaignId: number, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>(`/campaignreports/${campaignId}/complaints`, queryParams);
  }
}
