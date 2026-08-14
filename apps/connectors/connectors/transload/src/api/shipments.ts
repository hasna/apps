import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type {
  ListParams,
  MeasurementResponse,
  ShipmentListResponse,
  ShipmentResponse,
} from '../types';

export class ShipmentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ShipmentListResponse> {
    return this.client.get<ShipmentListResponse>('/shipments', params);
  }

  async get(shipmentId: string): Promise<ShipmentResponse> {
    return this.client.get<ShipmentResponse>(`/shipments/${encodePathSegment(shipmentId)}`);
  }

  async getMeasurement(shipmentId: string): Promise<MeasurementResponse> {
    return this.client.get<MeasurementResponse>(
      `/shipments/${encodePathSegment(shipmentId)}/measurement`
    );
  }
}
