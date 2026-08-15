import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

function encodeEmail(email: string): string {
  return encodeURIComponent(email);
}

/** @see https://docs.statsig.com/console-api/users */
export class UsersApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/users');
  }

  getByEmail(email: string): Promise<unknown> {
    return this.client.get(`/users/email/${encodeEmail(email)}`);
  }

  invite(body: JsonRecord): Promise<unknown> {
    return this.client.post('/users', body);
  }
}
