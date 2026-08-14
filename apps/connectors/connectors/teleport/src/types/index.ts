export interface TeleportConfig {
  baseUrl: string;
  token: string;
}

export interface TeleportResourceMetadata {
  name: string;
  [key: string]: unknown;
}

export interface TeleportUser {
  metadata: TeleportResourceMetadata;
  spec: Record<string, unknown>;
}

export interface TeleportRole {
  metadata: TeleportResourceMetadata;
  spec: Record<string, unknown>;
}

export interface TeleportResourceId {
  kind: string;
  name: string;
  cluster?: string;
}

export interface TeleportAccessRequest {
  id?: string;
  user?: string;
  roles?: string[];
  state?: 'PENDING' | 'APPROVED' | 'DENIED' | 'PROMOTED';
  [key: string]: unknown;
}

export interface TeleportAuthConnector {
  kind: 'saml' | 'oidc' | 'github';
  metadata: TeleportResourceMetadata;
  spec: Record<string, unknown>;
}

export class TeleportApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TeleportApiError';
    this.statusCode = statusCode;
  }
}
