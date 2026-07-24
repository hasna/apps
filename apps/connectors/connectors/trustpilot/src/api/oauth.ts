import type { ConnectorConfig } from '../types';
import type { AuthLinkResult, GenerateAuthLinkOptions } from '../types';

export class OAuthApi {
  constructor(private readonly apiKey?: string) {}

  generateAuthLink(options: GenerateAuthLinkOptions): AuthLinkResult {
    if (!this.apiKey) {
      throw new Error('Trustpilot API key is required to generate an auth link');
    }

    const params = new URLSearchParams({
      client_id: this.apiKey,
      redirect_uri: options.redirectUri,
      response_type: 'code',
    });

    if (options.state) {
      params.set('state', options.state);
    }

    return {
      url: `https://authenticate.trustpilot.com/?${params.toString()}`,
    };
  }

  static fromConfig(config: ConnectorConfig): OAuthApi {
    return new OAuthApi(config.apiKey);
  }
}
