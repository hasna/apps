import type { SolcastClient } from './client';
import type { RooftopPvQuery, RooftopPvResponse, RooftopSiteQuery } from '../types';

type QueryParams = Record<string, string | number | boolean | undefined>;

function rooftopParams(query: RooftopPvQuery): QueryParams {
  return {
    latitude: query.latitude,
    longitude: query.longitude,
    capacity: query.capacity,
    hours: query.hours,
    period: query.period,
    output_parameters: query.output_parameters,
    tilt: query.tilt,
    azimuth: query.azimuth,
    loss_factor: query.loss_factor,
    install_date: query.install_date,
    terrain_shading: query.terrain_shading,
    start: query.start,
    end: query.end,
  };
}

function siteParams(query: RooftopSiteQuery = {}): QueryParams {
  return {
    hours: query.hours,
    period: query.period,
    output_parameters: query.output_parameters,
    start: query.start,
    end: query.end,
  };
}

export class SolcastApi {
  constructor(private readonly client: SolcastClient) {}

  forecastRooftopPvPower(query: RooftopPvQuery): Promise<RooftopPvResponse> {
    return this.client.get<RooftopPvResponse>('/data/forecast/rooftop_pv_power', rooftopParams(query));
  }

  liveRooftopPvPower(query: RooftopPvQuery): Promise<RooftopPvResponse> {
    return this.client.get<RooftopPvResponse>('/data/live/rooftop_pv_power', rooftopParams(query));
  }

  historicRooftopPvPower(query: RooftopPvQuery): Promise<RooftopPvResponse> {
    return this.client.get<RooftopPvResponse>('/data/historic/rooftop_pv_power', rooftopParams(query));
  }

  rooftopSiteForecasts(siteId: string, query: RooftopSiteQuery = {}): Promise<RooftopPvResponse> {
    const encoded = encodeURIComponent(siteId);
    return this.client.get<RooftopPvResponse>(`/rooftop_sites/${encoded}/forecasts`, siteParams(query));
  }

  rooftopSiteEstimatedActuals(siteId: string, query: RooftopSiteQuery = {}): Promise<RooftopPvResponse> {
    const encoded = encodeURIComponent(siteId);
    return this.client.get<RooftopPvResponse>(`/rooftop_sites/${encoded}/estimated_actuals`, siteParams(query));
  }

  rawGet<T = unknown>(path: string, params?: QueryParams): Promise<T> {
    return this.client.get<T>(path, params);
  }
}
