import type { ConnectorClient } from './client';
import type { FundraisingPage, FundraisingPageCreateParams, DonationCreateParams, ListParams } from '../types';

export class FundraisingApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    if (params?.filter) queryParams.filter = params.filter;
    return this.client.get<unknown>('/fundraising_pages', queryParams);
  }

  async get(pageId: string): Promise<FundraisingPage> {
    return this.client.get<FundraisingPage>(`/fundraising_pages/${pageId}`);
  }

  async create(params: FundraisingPageCreateParams): Promise<FundraisingPage> {
    return this.client.post<FundraisingPage>('/fundraising_pages', params);
  }

  async update(pageId: string, params: Partial<FundraisingPageCreateParams>): Promise<FundraisingPage> {
    return this.client.put<FundraisingPage>(`/fundraising_pages/${pageId}`, params);
  }

  async listDonations(pageId: string, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>(`/fundraising_pages/${pageId}/donations`, queryParams);
  }

  async createDonation(pageId: string, params: DonationCreateParams): Promise<unknown> {
    return this.client.post<unknown>(`/fundraising_pages/${pageId}/donations`, params);
  }
}
