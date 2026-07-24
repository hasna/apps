// Stainless API Types
//
// Modeled on the public Stainless REST API (https://api.stainless.com, /v0).
// See https://www.stainless.com/docs/api for the reference documentation.

// ============================================
// Configuration
// ============================================

export type StainlessEnvironment = 'production' | 'staging';

export const ENVIRONMENTS: Record<StainlessEnvironment, string> = {
  production: 'https://api.stainless.com',
  staging: 'https://staging.stainless.com',
};

export interface StainlessConfig {
  apiKey: string;
  /** Base URL override. Takes precedence over `environment`. */
  baseUrl?: string;
  /** Named environment (defaults to `production`). Ignored when `baseUrl` is set. */
  environment?: StainlessEnvironment;
  /** Default project name applied to project-scoped requests. */
  project?: string;
}

// ============================================
// Targets (SDK languages Stainless can generate)
// ============================================

export type Target =
  | 'node'
  | 'typescript'
  | 'python'
  | 'go'
  | 'java'
  | 'kotlin'
  | 'ruby'
  | 'terraform'
  | 'cli'
  | 'php'
  | 'csharp'
  | 'sql'
  | 'openapi';

export const TARGETS: Target[] = [
  'node',
  'typescript',
  'python',
  'go',
  'java',
  'kotlin',
  'ruby',
  'terraform',
  'cli',
  'php',
  'csharp',
  'sql',
  'openapi',
];

// ============================================
// Pagination
// ============================================

export interface Page<T> {
  data: T[];
  has_more: boolean;
  next_cursor?: string;
}

export interface PageParams {
  cursor?: string;
  limit?: number;
}

// ============================================
// Builds
// ============================================

export type BuildTargetStatus = 'not_started' | 'codegen' | 'postgen' | 'completed';

export interface BuildTarget {
  object: 'build_target';
  status: BuildTargetStatus;
  install_url: string | null;
  commit: Record<string, unknown>;
}

export interface Build {
  id: string;
  object: 'build';
  org: string;
  project: string;
  config_commit: string;
  created_at: string;
  updated_at: string;
  targets: Partial<Record<Target, BuildTarget>>;
  documented_spec: Record<string, unknown> | null;
}

export interface BuildCreateParams {
  /** Project name (falls back to the configured default project). */
  project?: string;
  /**
   * What to build: a branch name, commit SHA, merge command ("base..head"),
   * or an object of file contents.
   */
  revision: string | Record<string, unknown>;
  /** Allow empty commits (no changes). Defaults to false. */
  allow_empty?: boolean;
  /** The project branch to use for the build. */
  branch?: string;
  /** Commit message to use when creating a new commit. */
  commit_message?: string;
  /** Restrict the build to specific targets. */
  targets?: Target[];
}

export interface BuildListParams extends PageParams {
  project?: string;
  branch?: string;
  /** Maximum number of builds to return (default 10, max 100). */
  limit?: number;
  revision?: string;
}

export interface BuildCompareParams {
  base: {
    revision: string | Record<string, unknown>;
    branch?: string;
    commit_message?: string;
  };
  head: {
    revision: string | Record<string, unknown>;
    branch?: string;
    commit_message?: string;
  };
  project?: string;
  targets?: Target[];
}

export interface BuildDiagnostic {
  code: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

// ============================================
// Projects
// ============================================

export interface Project {
  object: 'project';
  org: string;
  slug: string;
  display_name: string | null;
  config_repo: string;
  targets: Target[];
}

export interface ProjectCreateParams {
  org: string;
  slug: string;
  display_name: string;
  targets: Target[];
  revision: Record<string, unknown>;
}

export interface ProjectUpdateParams {
  display_name?: string | null;
}

export interface ProjectListParams extends PageParams {
  org?: string;
  limit?: number;
}

// ============================================
// Branches
// ============================================

export interface ProjectBranch {
  object: 'project_branch';
  project: string;
  name: string;
  config_commit: string;
  [key: string]: unknown;
}

export interface BranchCreateParams {
  branch: string;
  /** Existing branch or commit to branch from. */
  branch_from: string;
  force?: boolean;
}

// ============================================
// Orgs
// ============================================

export interface Org {
  object: 'org';
  slug: string;
  display_name: string | null;
  enable_ai_commit_messages: boolean;
}

export interface OrgListResponse {
  data: Org[];
  has_more: boolean;
  next_cursor?: string;
}

// ============================================
// User
// ============================================

export interface UserGitHub {
  username: string;
}

export interface User {
  id: string;
  object: 'user';
  name: string | null;
  email: string | null;
  github: UserGitHub | null;
}

// ============================================
// Common
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  type?: string;
  message?: string;
}

export class StainlessApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: ApiErrorDetail;

  constructor(message: string, statusCode: number, error?: ApiErrorDetail) {
    super(message);
    this.name = 'StainlessApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
