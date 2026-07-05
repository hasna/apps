import type { WakatimeClient } from './client';
import type { UserScopedOptions } from '../types';

export class GoalsApi {
  constructor(private readonly client: WakatimeClient) {}

  async list(options: UserScopedOptions = {}): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/goals`);
  }
}
