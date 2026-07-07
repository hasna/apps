// ZeroTier Central API Types

export interface ZeroTierConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OrgRole =
  | 'ROLE_OWNER'
  | 'ROLE_ADMIN'
  | 'ROLE_AUDITOR'
  | 'ROLE_USER'
  | 'ROLE_BILLING';

export interface ZeroTierStatus {
  apiVersion?: number;
  centralVersion?: string;
  clock?: number;
  user?: ZeroTierUser;
}

export interface ZeroTierUser {
  id?: string;
  email?: string;
  displayName?: string;
  locale?: string;
}

export interface ZeroTierOrganization {
  id: string;
  displayName?: string;
  description?: string;
  creationTime?: number;
  billingType?: string;
}

export interface ZeroTierNetwork {
  id: string;
  config?: Record<string, unknown>;
  description?: string;
  rulesSource?: string;
  permissions?: Record<string, unknown>;
  ownerId?: string;
  onlineMemberCount?: number;
  authorizedMemberCount?: number;
  totalMemberCount?: number;
  capabilitiesByName?: Record<string, unknown>;
  tagsByName?: Record<string, unknown>;
  remoteTraceTarget?: string | null;
  remoteTraceLevel?: number;
}

export interface ZeroTierMember {
  id: string;
  nodeId: string;
  networkId?: string;
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
  lastOnline?: number;
  physicalAddress?: string;
  clientVersion?: string;
  protocolVersion?: number;
}

export interface ZeroTierOrgUser {
  id: string;
  email?: string;
  displayName?: string;
  role?: OrgRole;
}

export interface ZeroTierInvite {
  id: string;
  email?: string;
  role?: OrgRole;
  creationTime?: number;
}

export interface ZeroTierAuditLogEntry {
  id?: string;
  timestamp?: number;
  actor?: string;
  action?: string;
  target?: string;
  details?: Record<string, unknown>;
}

export interface CreateNetworkOptions {
  name: string;
  description?: string;
  private?: boolean;
  v4AssignMode?: { zt: boolean };
  v6AssignMode?: { zt: boolean; rfc4193: boolean; '6plane': boolean };
  routes?: Array<{ target: string; via?: string }>;
  ipAssignmentPools?: Array<{ ipRangeStart: string; ipRangeEnd: string }>;
  rules?: Array<Record<string, unknown>>;
  mtu?: number;
  multicastLimit?: number;
  enableBroadcast?: boolean;
}

export interface AuthorizeMemberOptions {
  name?: string;
  description?: string;
  ipAssignments?: string[];
  tags?: number[][];
  capabilities?: number[];
  noAutoAssignIps?: boolean;
}

export interface AuditLogOptions {
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export class ZeroTierApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'ZeroTierApiError';
  }
}
