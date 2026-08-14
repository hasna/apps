import type { ConnectorClient } from './client';
import type { CheckParams, CheckResult, CheckBlockParams, CheckBlockResult } from '../types';

export class CheckApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Check an IP address for abuse reports.
   * Returns abuse confidence score, country, ISP, and optionally detailed reports.
   */
  async check(params: CheckParams): Promise<CheckResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      ipAddress: params.ipAddress,
    };

    if (params.maxAgeInDays !== undefined) {
      queryParams.maxAgeInDays = params.maxAgeInDays;
    }
    if (params.verbose !== undefined) {
      queryParams.verbose = params.verbose;
    }

    const response = await this.client.get<{ data: CheckResult }>('/check', queryParams);
    return response.data;
  }

  /**
   * Check a CIDR network block for reported addresses.
   */
  async checkBlock(params: CheckBlockParams): Promise<CheckBlockResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      network: params.network,
    };

    if (params.maxAgeInDays !== undefined) {
      queryParams.maxAgeInDays = params.maxAgeInDays;
    }

    const response = await this.client.get<{ data: CheckBlockResult }>('/check-block', queryParams);
    return response.data;
  }
}
