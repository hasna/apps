import type { ListParams, PhoneNumber } from '../types';
import type { VapiClient } from './client';

function toQueryParams(params?: ListParams): Record<string, string | number | boolean | undefined> | undefined {
  if (!params) return undefined;
  return {
    limit: params.limit,
    createdAtGt: params.createdAtGt,
    createdAtLt: params.createdAtLt,
    updatedAtGt: params.updatedAtGt,
    updatedAtLt: params.updatedAtLt,
  };
}

export class PhoneNumbersApi {
  constructor(private readonly client: VapiClient) {}

  async list(params?: ListParams): Promise<PhoneNumber[]> {
    return this.client.get<PhoneNumber[]>('/phone-number', toQueryParams(params));
  }
}
