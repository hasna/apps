import type { AuthenticateParams, AuthenticateResponse } from '../types';
import type { ConnectorClient } from './client';

export class AuthApi {
  constructor(private readonly client: ConnectorClient) {}

  async authenticate(options: AuthenticateParams): Promise<AuthenticateResponse> {
    if (!options.username?.trim()) {
      throw new Error('username is required');
    }
    if (!options.password?.trim()) {
      throw new Error('password is required');
    }

    return this.client.post<AuthenticateResponse>(
      '/oauth2/token',
      {
        grant_type: 'password',
        client_id: options.clientId ?? 'sugar',
        client_secret: options.clientSecret ?? '',
        username: options.username.trim(),
        password: options.password,
        platform: 'api',
      },
      undefined,
      { skipAuth: true }
    );
  }

  async logout(): Promise<unknown> {
    return this.client.post('/oauth2/logout');
  }
}
