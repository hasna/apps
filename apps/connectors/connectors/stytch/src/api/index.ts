import { StytchClient } from './client';
import type { StytchConfig } from '../types';
import { UsersApi } from './users';
import { MagicLinksApi } from './magic-links';
import { PasswordsApi } from './passwords';
import { SessionsApi } from './sessions';
import { OtpApi } from './otp';
import { TotpApi } from './totp';
import { WebauthnApi } from './webauthn';
import { CryptoWalletsApi } from './crypto-wallets';
import { OAuthApi } from './oauth';

export { StytchClient } from './client';
export { UsersApi } from './users';
export { MagicLinksApi } from './magic-links';
export { PasswordsApi } from './passwords';
export { SessionsApi } from './sessions';
export { OtpApi } from './otp';
export { TotpApi } from './totp';
export { WebauthnApi } from './webauthn';
export { CryptoWalletsApi } from './crypto-wallets';
export { OAuthApi } from './oauth';

export class Stytch {
  readonly users: UsersApi;
  readonly magicLinks: MagicLinksApi;
  readonly passwords: PasswordsApi;
  readonly sessions: SessionsApi;
  readonly otp: OtpApi;
  readonly totp: TotpApi;
  readonly webauthn: WebauthnApi;
  readonly cryptoWallets: CryptoWalletsApi;
  readonly oauth: OAuthApi;
  private readonly client: StytchClient;

  constructor(config: StytchConfig) {
    this.client = new StytchClient(config);
    this.users = new UsersApi(this.client);
    this.magicLinks = new MagicLinksApi(this.client);
    this.passwords = new PasswordsApi(this.client);
    this.sessions = new SessionsApi(this.client);
    this.otp = new OtpApi(this.client);
    this.totp = new TotpApi(this.client);
    this.webauthn = new WebauthnApi(this.client);
    this.cryptoWallets = new CryptoWalletsApi(this.client);
    this.oauth = new OAuthApi(this.client);
  }

  static fromEnv(): Stytch {
    const projectId = process.env.STYTCH_PROJECT_ID;
    const secret = process.env.STYTCH_SECRET;
    if (!projectId || !secret) {
      throw new Error('STYTCH_PROJECT_ID and STYTCH_SECRET are required');
    }
    const environment = (process.env.STYTCH_ENVIRONMENT?.toLowerCase() === 'test' ? 'test' : 'live') as StytchConfig['environment'];
    return new Stytch({ projectId, secret, environment });
  }

  getClient(): StytchClient {
    return this.client;
  }
}
