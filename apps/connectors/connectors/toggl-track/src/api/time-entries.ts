import type { TogglTrackClient } from './client';
import type {
  CreateTimeEntryParams,
  ListTimeEntriesOptions,
  TogglTimeEntry,
  UpdateTimeEntryParams,
} from '../types';

export class TimeEntriesApi {
  constructor(private readonly client: TogglTrackClient) {}

  list(options: ListTimeEntriesOptions = {}): Promise<TogglTimeEntry[]> {
    return this.client.get<TogglTimeEntry[]>('/me/time_entries', {
      start_date: options.startDate,
      end_date: options.endDate,
      before: options.before,
      since: options.since,
      meta: options.meta,
    });
  }

  getCurrent(): Promise<TogglTimeEntry | null> {
    return this.client.get<TogglTimeEntry | null>('/me/time_entries/current');
  }

  get(workspaceId: number, timeEntryId: number): Promise<TogglTimeEntry> {
    return this.client.get<TogglTimeEntry>(
      `/workspaces/${workspaceId}/time_entries/${timeEntryId}`,
    );
  }

  create(workspaceId: number, params: CreateTimeEntryParams): Promise<TogglTimeEntry> {
    return this.client.post<TogglTimeEntry>(`/workspaces/${workspaceId}/time_entries`, {
      ...params,
      workspace_id: workspaceId,
    });
  }

  update(
    workspaceId: number,
    timeEntryId: number,
    params: UpdateTimeEntryParams,
  ): Promise<TogglTimeEntry> {
    return this.client.put<TogglTimeEntry>(
      `/workspaces/${workspaceId}/time_entries/${timeEntryId}`,
      params,
    );
  }

  delete(workspaceId: number, timeEntryId: number): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/time_entries/${timeEntryId}`);
  }

  stop(workspaceId: number, timeEntryId: number): Promise<TogglTimeEntry> {
    return this.client.patch<TogglTimeEntry>(
      `/workspaces/${workspaceId}/time_entries/${timeEntryId}/stop`,
    );
  }
}
