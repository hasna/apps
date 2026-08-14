export interface VoxelEnergyConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface Site {
  id: string;
  name?: string;
  region?: string;
  status?: string;
  [key: string]: unknown;
}

export interface SiteListResponse {
  sites?: Site[];
  [key: string]: unknown;
}

export interface PowerProfile {
  siteId?: string;
  profile?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SiteCapacity {
  siteId?: string;
  available?: number;
  total?: number;
  [key: string]: unknown;
}

export interface Reservation {
  id: string;
  siteId?: string;
  status?: string;
  gpuCount?: number;
  [key: string]: unknown;
}

export interface ReservationListResponse {
  reservations?: Reservation[];
  [key: string]: unknown;
}

export interface CreateReservationRequest {
  siteId: string;
  gpuCount?: number;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class VoxelEnergyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'VoxelEnergyApiError';
  }
}
