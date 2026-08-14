import type { WakatimeClient } from './client';
import type { UpdateCustomRulesOptions, UserScopedOptions } from '../types';

export class CustomRulesApi {
  constructor(private readonly client: WakatimeClient) {}

  async get(options: UserScopedOptions = {}): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/custom_rules`);
  }

  async update(options: UpdateCustomRulesOptions): Promise<unknown> {
    return this.client.put(`${this.client.userPath(options.user)}/custom_rules`, {
      rules: options.rules,
    });
  }
}
