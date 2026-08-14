import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CredentialsApi } from './credentials';
import { GroupsApi } from './groups';
import { DesignsApi } from './designs';
import { EvidenceApi } from './evidence';
import { SsoApi } from './sso';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly credentials: CredentialsApi;
  public readonly groups: GroupsApi;
  public readonly designs: DesignsApi;
  public readonly evidence: EvidenceApi;
  public readonly sso: SsoApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.credentials = new CredentialsApi(this.client);
    this.groups = new GroupsApi(this.client);
    this.designs = new DesignsApi(this.client);
    this.evidence = new EvidenceApi(this.client);
    this.sso = new SsoApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACCREDIBLE_API_KEY;

    if (!apiKey) {
      throw new Error('ACCREDIBLE_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { CredentialsApi } from './credentials';
export { GroupsApi } from './groups';
export { DesignsApi } from './designs';
export { EvidenceApi } from './evidence';
export { SsoApi } from './sso';
