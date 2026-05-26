import type { UserAccount, UserBalance } from '../types';
import type { StabilityClient } from './client';

/**
 * User/Account API
 * Get account information and balance
 */
export class UserApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Get current user account information
   */
  async getAccount(): Promise<UserAccount> {
    return this.client.get<UserAccount>('/user/account', undefined, 'v1');
  }

  /**
   * Get current user credit balance
   */
  async getBalance(): Promise<UserBalance> {
    return this.client.get<UserBalance>('/user/balance', undefined, 'v1');
  }
}
