import type { ConnectorClient } from './client';
import type { StreakReminder, ReminderCreateParams } from '../types';

export class RemindersApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(boxKey: string): Promise<StreakReminder[]> {
    return this.client.get<StreakReminder[]>(
      `/boxes/${encodeURIComponent(boxKey)}/reminders`,
    );
  }

  async create(boxKey: string, data: ReminderCreateParams): Promise<StreakReminder> {
    return this.client.put<StreakReminder>(
      `/boxes/${encodeURIComponent(boxKey)}/reminders`,
      data,
    );
  }
}
