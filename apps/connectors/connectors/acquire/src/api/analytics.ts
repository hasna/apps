import type { ConnectorClient } from './client';
import type { AnalyticsParams } from '../types';

export class AnalyticsApi {
  constructor(private readonly client: ConnectorClient) {}

  async callsOverview(params: AnalyticsParams): Promise<unknown> {
    return this.client.get<unknown>('/analytics/voip/calls-overview', params as unknown as Record<string, string>);
  }

  async smsMetrics(params: AnalyticsParams): Promise<unknown> {
    return this.client.get<unknown>('/analytics/voip/sms-metrics', params as unknown as Record<string, string>);
  }

  async callAnalysis(params: AnalyticsParams): Promise<unknown> {
    return this.client.get<unknown>('/analytics/voip/call-analysis', params as unknown as Record<string, string>);
  }
}
