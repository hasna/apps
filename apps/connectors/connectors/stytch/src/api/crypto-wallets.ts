import type { StytchClient } from './client';

export class CryptoWalletsApi {
  constructor(private readonly client: StytchClient) {}

  async authenticateStart(body: {
    crypto_wallet_address: string;
    crypto_wallet_type: 'ethereum' | 'solana';
  }): Promise<Record<string, unknown>> {
    return this.client.post('/crypto_wallets/authenticate/start', body);
  }

  async authenticate(body: {
    crypto_wallet_address: string;
    crypto_wallet_type: 'ethereum' | 'solana';
    signature: string;
    session_duration_minutes?: number;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/crypto_wallets/authenticate', body);
  }
}
