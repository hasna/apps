import type { ConnectorClient } from './client';
import type {
  BedAnalytics,
  Farm,
  HarvestRun,
  ListParams,
  ListResponse,
  RawRequestParams,
  Robot,
  Telemetry,
} from '../types';

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Synphony farm-robotics operations.
 *
 * Mirrors the public REST surface: farms, robots, telemetry, harvest runs and
 * bed analytics, plus a raw-request escape hatch for endpoints not yet wrapped.
 */
export class SynphonyApi {
  constructor(private readonly client: ConnectorClient) {}

  /** GET /farms — list farms. */
  async listFarms(params: ListParams = {}): Promise<ListResponse<Farm>> {
    return this.client.get<ListResponse<Farm>>('/farms', params);
  }

  /** GET /farms/{farmId} — fetch a single farm. */
  async getFarm(farmId: string): Promise<Farm> {
    return this.client.get<Farm>(`/farms/${encodeSegment(farmId)}`);
  }

  /** GET /robots — list robots. */
  async listRobots(params: ListParams = {}): Promise<ListResponse<Robot>> {
    return this.client.get<ListResponse<Robot>>('/robots', params);
  }

  /** GET /robots/{robotId} — fetch a single robot. */
  async getRobot(robotId: string): Promise<Robot> {
    return this.client.get<Robot>(`/robots/${encodeSegment(robotId)}`);
  }

  /** GET /robots/{robotId}/telemetry — fetch robot telemetry. */
  async getTelemetry(robotId: string, params: ListParams = {}): Promise<Telemetry> {
    return this.client.get<Telemetry>(`/robots/${encodeSegment(robotId)}/telemetry`, params);
  }

  /** GET /harvest-runs — list harvest runs. */
  async listHarvestRuns(params: ListParams = {}): Promise<ListResponse<HarvestRun>> {
    return this.client.get<ListResponse<HarvestRun>>('/harvest-runs', params);
  }

  /** GET /farms/{farmId}/bed-analytics — fetch bed analytics for a farm. */
  async getBedAnalytics(farmId: string, params: ListParams = {}): Promise<BedAnalytics> {
    return this.client.get<BedAnalytics>(`/farms/${encodeSegment(farmId)}/bed-analytics`, params);
  }

  /**
   * Escape hatch for arbitrary Synphony API calls not covered by a typed method.
   */
  async rawRequest<T = unknown>(params: RawRequestParams): Promise<T> {
    return this.client.request<T>(params.path, {
      method: params.method ?? 'GET',
      params: params.query,
      body: params.body,
      headers: params.headers,
    });
  }
}
