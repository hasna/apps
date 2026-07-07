export interface SolcastConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface RooftopPvQuery {
  latitude: number;
  longitude: number;
  capacity: number;
  hours?: number;
  period?: string;
  output_parameters?: string;
  tilt?: number;
  azimuth?: number;
  loss_factor?: number;
  install_date?: string;
  terrain_shading?: boolean;
  start?: string;
  end?: string;
  format?: string;
}

export interface RooftopSiteQuery {
  hours?: number;
  period?: string;
  output_parameters?: string;
  start?: string;
  end?: string;
  format?: string;
}

export interface PvForecastEntry {
  pv_power_rooftop: number;
  period_end: string;
  period: string;
}

export interface RooftopPvResponse {
  forecasts?: PvForecastEntry[];
  estimated_actuals?: PvForecastEntry[];
}

export class SolcastApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'SolcastApiError';
  }
}
