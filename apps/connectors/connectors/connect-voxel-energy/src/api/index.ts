import type {
  VoxelEnergyConfig,
  SiteListResponse,
  Site,
  PowerProfile,
  SiteCapacity,
  ReservationListResponse,
  Reservation,
  CreateReservationRequest,
  RawRequestOptions,
} from '../types';
import { VoxelEnergyClient, encodePathSegment } from './client';

export class VoxelEnergy {
  private readonly client: VoxelEnergyClient;

  constructor(config: VoxelEnergyConfig) {
    this.client = new VoxelEnergyClient(config);
  }

  static fromEnv(): VoxelEnergy {
    const apiKey = process.env.VOXEL_ENERGY_API_KEY;
    if (!apiKey) {
      throw new Error('VOXEL_ENERGY_API_KEY environment variable is required');
    }
    return new VoxelEnergy({
      apiKey,
      baseUrl: process.env.VOXEL_ENERGY_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listSites(params?: Record<string, string | number | boolean | undefined>): Promise<SiteListResponse> {
    return this.client.get<SiteListResponse>('/sites', params);
  }

  async getSite(siteId: string): Promise<Site> {
    return this.client.get<Site>(`/sites/${encodePathSegment(siteId)}`);
  }

  async getSitePowerProfile(siteId: string): Promise<PowerProfile> {
    return this.client.get<PowerProfile>(`/sites/${encodePathSegment(siteId)}/power-profile`);
  }

  async getSiteCapacity(siteId: string): Promise<SiteCapacity> {
    return this.client.get<SiteCapacity>(`/sites/${encodePathSegment(siteId)}/capacity`);
  }

  async listReservations(params?: Record<string, string | number | boolean | undefined>): Promise<ReservationListResponse> {
    return this.client.get<ReservationListResponse>('/reservations', params);
  }

  async createReservation(body: CreateReservationRequest): Promise<Reservation> {
    return this.client.post<Reservation>('/reservations', body);
  }

  async getReservation(reservationId: string): Promise<Reservation> {
    return this.client.get<Reservation>(`/reservations/${encodePathSegment(reservationId)}`);
  }

  async rawRequest<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, options);
  }

  getClient(): VoxelEnergyClient {
    return this.client;
  }
}

export { VoxelEnergyClient, encodePathSegment, DEFAULT_BASE_URL } from './client';
