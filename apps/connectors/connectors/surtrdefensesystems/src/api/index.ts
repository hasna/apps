import { SurtrClient, type RequestOptions } from './client';
import type {
  SurtrConfig,
  Paginated,
  Sensor,
  ListSensorsOptions,
  Threat,
  ListThreatsOptions,
  SituationPicture,
  Engagement,
  ListEngagementsOptions,
  EngagementRecommendationInput,
  EngagementRecommendation,
} from '../types';

export { SurtrClient } from './client';
export { DEFAULT_BASE_URL } from './client';

export class Surtr {
  private client: SurtrClient;

  constructor(config: SurtrConfig) {
    this.client = new SurtrClient(config);
  }

  // ============================================
  // Sensors
  // ============================================

  async listSensors(options: ListSensorsOptions = {}): Promise<Paginated<Sensor>> {
    return this.client.get<Paginated<Sensor>>('/sensors', {
      status: options.status,
      type: options.type,
      site_id: options.site_id,
      limit: options.limit,
      cursor: options.cursor,
    });
  }

  async getSensor(sensorId: string): Promise<Sensor> {
    return this.client.get<Sensor>(`/sensors/${encodeURIComponent(sensorId)}`);
  }

  // ============================================
  // Threats
  // ============================================

  async listThreats(options: ListThreatsOptions = {}): Promise<Paginated<Threat>> {
    return this.client.get<Paginated<Threat>>('/threats', {
      state: options.state,
      severity: options.severity,
      classification: options.classification,
      since: options.since,
      limit: options.limit,
      cursor: options.cursor,
    });
  }

  async getThreat(threatId: string): Promise<Threat> {
    return this.client.get<Threat>(`/threats/${encodeURIComponent(threatId)}`);
  }

  // ============================================
  // Situation Picture
  // ============================================

  async getSituationPicture(): Promise<SituationPicture> {
    return this.client.get<SituationPicture>('/situation');
  }

  // ============================================
  // Engagements
  // ============================================

  async listEngagements(options: ListEngagementsOptions = {}): Promise<Paginated<Engagement>> {
    return this.client.get<Paginated<Engagement>>('/engagements', {
      status: options.status,
      threat_id: options.threat_id,
      limit: options.limit,
      cursor: options.cursor,
    });
  }

  async createEngagementRecommendation(input: EngagementRecommendationInput): Promise<EngagementRecommendation> {
    return this.client.post<EngagementRecommendation>('/engagements/recommendations', input as unknown as Record<string, unknown>);
  }

  // ============================================
  // Raw Request (arbitrary path escape hatch)
  // ============================================

  async rawRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, options);
  }
}
