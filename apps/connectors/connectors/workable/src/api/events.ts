import type { ConnectorClient } from './client';
import type {
  CustomAttribute,
  Department,
  DisqualificationReason,
  Event,
  ScheduleEventParams,
  WorkableListResponse,
} from '../types';

export class MetadataApi {
  constructor(private readonly client: ConnectorClient) {}

  async listDisqualificationReasons(): Promise<WorkableListResponse<DisqualificationReason>> {
    return this.client.get<WorkableListResponse<DisqualificationReason>>('/disqualification_reasons');
  }

  async listDepartments(): Promise<WorkableListResponse<Department>> {
    return this.client.get<WorkableListResponse<Department>>('/departments');
  }

  async listCustomAttributes(): Promise<WorkableListResponse<CustomAttribute>> {
    return this.client.get<WorkableListResponse<CustomAttribute>>('/custom_attributes');
  }
}

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(candidateId: string): Promise<WorkableListResponse<Event>> {
    return this.client.get<WorkableListResponse<Event>>(
      `/candidates/${encodeURIComponent(candidateId)}/events`,
    );
  }

  async schedule(params: ScheduleEventParams): Promise<Event> {
    return this.client.post<Event>(
      `/candidates/${encodeURIComponent(params.candidateId)}/events`,
      {
        type: params.type,
        start_at: params.startAt,
        duration: params.durationMinutes,
        description: params.description,
        attendees: params.attendees,
        agenda: params.agenda,
      },
    );
  }
}
