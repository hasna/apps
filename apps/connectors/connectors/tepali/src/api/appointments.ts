import type { ConnectorClient } from './client';
import type {
  Appointment,
  AppointmentListParams,
  AppointmentCreateParams,
  ListResponse,
} from '../types';

export class AppointmentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: AppointmentListParams): Promise<ListResponse<Appointment>> {
    return this.client.get<ListResponse<Appointment>>('/appointments', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: string): Promise<Appointment> {
    return this.client.get<Appointment>(`/appointments/${encodeURIComponent(id)}`);
  }

  async create(params: AppointmentCreateParams): Promise<Appointment> {
    return this.client.post<Appointment>('/appointments', params as unknown as Record<string, unknown>);
  }
}
