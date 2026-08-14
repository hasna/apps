import type { WakatimeClient } from './client';
import type { LeadersOptions, UserScopedOptions } from '../types';

export class LeadersApi {
  constructor(private readonly client: WakatimeClient) {}

  async get(options: LeadersOptions = {}): Promise<unknown> {
    return this.client.get('/leaders', {
      language: options.language,
      page: options.page,
      country_code: options.countryCode,
    });
  }

  async listPrivateLeaderboards(options: UserScopedOptions = {}): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/private_leaderboards`);
  }
}
