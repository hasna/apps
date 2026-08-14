// Vercel Connector Types

// ============================================
// Configuration
// ============================================

export interface VercelConfig {
  apiKey: string;
  teamId?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Pagination {
  count: number;
  next?: number;
  prev?: number;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  email: string;
  name?: string;
  username: string;
  avatar?: string;
  defaultTeamId?: string;
  version?: string;
  createdAt?: number;
  softBlock?: {
    blockedAt: number;
    reason: string;
  };
}

// ============================================
// Team Types
// ============================================

export interface Team {
  id: string;
  slug: string;
  name?: string;
  avatar?: string;
  createdAt: number;
  updatedAt?: number;
  creatorId?: string;
  membership?: {
    role: 'OWNER' | 'MEMBER' | 'DEVELOPER' | 'BILLING' | 'VIEWER';
    confirmed: boolean;
    createdAt: number;
    teamId: string;
  };
}

export interface TeamListResponse {
  teams: Team[];
  pagination: Pagination;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: string;
  name: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
  framework?: string;
  devCommand?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  rootDirectory?: string;
  directoryListing: boolean;
  nodeVersion?: string;
  publicSource?: boolean;
  autoExposeSystemEnvs?: boolean;
  sourceFilesOutsideRootDirectory?: boolean;
  serverlessFunctionRegion?: string;
  latestDeployments?: Deployment[];
  targets?: Record<string, {
    alias?: string[];
    aliasAssigned?: number;
    builds?: unknown[];
    createdAt?: number;
    createdIn?: string;
    creator?: { uid: string; email: string; username: string };
    deploymentHostname?: string;
    forced?: boolean;
    id?: string;
    meta?: Record<string, string>;
    plan?: string;
    private?: boolean;
    readyState?: string;
    target?: string;
    teamId?: string;
    type?: string;
    url?: string;
  }>;
  link?: {
    type: string;
    repo: string;
    repoId: number;
    org: string;
    productionBranch?: string;
    createdAt?: number;
    deployHooks?: Array<{
      id: string;
      name: string;
      ref: string;
      url: string;
    }>;
  };
}

export interface ProjectListResponse {
  projects: Project[];
  pagination: Pagination;
}

export interface ProjectCreateParams {
  name: string;
  framework?: string;
  buildCommand?: string;
  devCommand?: string;
  installCommand?: string;
  outputDirectory?: string;
  publicSource?: boolean;
  rootDirectory?: string;
  serverlessFunctionRegion?: string;
  gitRepository?: {
    type: 'github' | 'gitlab' | 'bitbucket';
    repo: string;
  };
}

// ============================================
// Deployment Types
// ============================================

export type DeploymentState = 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';

export interface Deployment {
  uid: string;
  id: string;
  name: string;
  url: string;
  state: DeploymentState;
  readyState: DeploymentState;
  type: 'LAMBDAS';
  createdAt: number;
  createdIn: string;
  buildingAt?: number;
  ready?: number;
  creator: {
    uid: string;
    email?: string;
    username?: string;
  };
  target?: 'production' | 'staging' | null;
  aliasAssigned?: boolean | number;
  aliasError?: { code: string; message: string };
  inspectorUrl?: string;
  meta?: Record<string, string>;
  projectId?: string;
  source?: string;
  version?: number;
}

export interface DeploymentListResponse {
  deployments: Deployment[];
  pagination: Pagination;
}

export interface DeploymentCreateParams {
  name: string;
  project?: string;
  target?: 'production' | 'staging';
  gitSource?: {
    type: 'github' | 'gitlab' | 'bitbucket';
    ref: string;
    repoId: string | number;
  };
  files?: Array<{
    file: string;
    sha?: string;
    size?: number;
    data?: string;
  }>;
}

// ============================================
// Domain Types
// ============================================

export interface Domain {
  name: string;
  apexName: string;
  projectId?: string;
  redirect?: string;
  redirectStatusCode?: 301 | 302 | 307 | 308;
  gitBranch?: string;
  updatedAt?: number;
  createdAt?: number;
  verified: boolean;
  verification?: Array<{
    type: string;
    domain: string;
    value: string;
    reason: string;
  }>;
}

export interface DomainListResponse {
  domains: Domain[];
  pagination: Pagination;
}

export interface DomainConfig {
  configuredBy?: 'CNAME' | 'A' | 'http';
  acceptedChallenges?: string[];
  misconfigured: boolean;
}

// ============================================
// Environment Variable Types
// ============================================

export type EnvTarget = 'production' | 'preview' | 'development';
export type EnvType = 'system' | 'secret' | 'encrypted' | 'plain';

export interface EnvironmentVariable {
  id?: string;
  key: string;
  value: string;
  type: EnvType;
  target: EnvTarget | EnvTarget[];
  configurationId?: string;
  gitBranch?: string;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
}

export interface EnvListResponse {
  envs: EnvironmentVariable[];
}

export interface EnvCreateParams {
  key: string;
  value: string;
  type?: EnvType;
  target: EnvTarget | EnvTarget[];
  gitBranch?: string;
}

// ============================================
// Log Types
// ============================================

export interface LogEntry {
  id: string;
  message: string;
  timestamp: number;
  type: 'command' | 'stdout' | 'stderr' | 'exit';
  pid?: number;
  serial?: string;
}

// ============================================
// Secret Types (Legacy)
// ============================================

export interface Secret {
  uid: string;
  name: string;
  created: number;
  createdAt?: number;
  userId?: string;
  teamId?: string;
}

export interface SecretListResponse {
  secrets: Secret[];
  pagination: Pagination;
}

// ============================================
// Alias Types
// ============================================

export interface Alias {
  uid: string;
  alias: string;
  created?: string;
  createdAt?: number;
  deployment?: {
    id: string;
    url: string;
  };
  deploymentId?: string;
  projectId?: string;
  redirect?: string;
  redirectStatusCode?: number;
}

export interface AliasListResponse {
  aliases: Alias[];
  pagination: Pagination;
}

// ============================================
// API Error Types
// ============================================

export interface VercelErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export interface VercelErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class VercelApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'VercelApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
