import type { WakatimeClient } from './client';
import type { AllTimeOptions, UserScopedOptions } from '../types';

export class UsersApi {
  constructor(private readonly client: WakatimeClient) {}

  async getCurrentUser(): Promise<unknown> {
    return this.client.get(`${this.client.userPath('current')}`);
  }

  async getAllTimeSinceToday(options: AllTimeOptions = {}): Promise<unknown> {
    const user = this.client.userPath(options.user);
    return this.client.get(`${user}/all_time_since_today`, {
      project: options.project,
    });
  }

  async listMachineNames(options: UserScopedOptions = {}): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/machine_names`);
  }
}
