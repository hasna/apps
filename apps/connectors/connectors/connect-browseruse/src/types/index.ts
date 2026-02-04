/**
 * Browser Use API Types
 */

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  hasMore: boolean;
  nextCursor?: string;
}

export class BrowserUseApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'BrowserUseApiError';
  }
}

// ============================================
// Task Types
// ============================================

export type TaskStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'failed';

export interface TaskStep {
  id: string;
  type: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Task {
  id: string;
  task: string;
  status: TaskStatus;
  sessionId?: string;
  steps: TaskStep[];
  output?: unknown;
  error?: string;
  liveUrl?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Sensitive data configuration for secure credential handling.
 * The LLM only sees placeholder names (e.g., 'x_user', 'x_pass'),
 * actual values are injected directly into forms without LLM exposure.
 */
export type SensitiveData =
  | Record<string, string>  // Global: applies to all domains
  | Record<string, Record<string, string>>;  // Per-domain: 'https://*.example.com': { user: '...', pass: '...' }

export interface CreateTaskParams {
  task: string;
  sessionId?: string;
  schema?: Record<string, unknown>;
  save_browser_data?: boolean;
  /**
   * Sensitive data like credentials to handle securely.
   * Can be global (applies everywhere) or per-domain.
   * @example { 'x_user': 'email@example.com', 'x_pass': 'password123' }
   * @example { 'https://*.mysite.com': { 'user': 'admin', 'pass': 'secret' } }
   */
  sensitive_data?: SensitiveData;
  /** Disable vision to prevent LLM from seeing sensitive data in screenshots */
  use_vision?: boolean;
  /** Allowed domains to restrict agent navigation (security) */
  allowed_domains?: string[];
}

export interface UpdateTaskParams {
  action: 'stop' | 'pause' | 'resume' | 'stop-and-close-session';
}

export interface ListTasksParams {
  limit?: number;
  cursor?: string;
  sessionId?: string;
  status?: TaskStatus;
}

// ============================================
// Session Types
// ============================================

export type SessionStatus = 'active' | 'inactive' | 'closed';

export interface Session {
  id: string;
  status: SessionStatus;
  profileId?: string;
  liveUrl?: string;
  connectUrl?: string;
  proxyUrl?: string;
  keepAlive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionParams {
  task?: string;
  profileId?: string;
  proxyUrl?: string;
  keepAlive?: boolean;
  save_browser_data?: boolean;
}

export interface ListSessionsParams {
  limit?: number;
  cursor?: string;
  status?: SessionStatus;
}

export interface SessionPublicShare {
  id: string;
  sessionId: string;
  publicUrl: string;
  expiresAt: string;
}

// ============================================
// Profile Types
// ============================================

export interface Profile {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileParams {
  name: string;
  description?: string;
}

export interface UpdateProfileParams {
  name?: string;
  description?: string;
}

export interface ListProfilesParams {
  limit?: number;
  cursor?: string;
}

// ============================================
// Browser Session Types
// ============================================

export interface BrowserSession {
  id: string;
  status: 'active' | 'stopped';
  liveUrl?: string;
  connectUrl?: string;
  wsUrl?: string;
  createdAt: string;
  stoppedAt?: string;
}

export interface CreateBrowserSessionParams {
  profileId?: string;
  proxyUrl?: string;
}

export interface ListBrowserSessionsParams {
  limit?: number;
  cursor?: string;
}

// ============================================
// Skill Types
// ============================================

export type SkillStatus = 'draft' | 'generating' | 'ready' | 'failed';

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillSchema {
  parameters: SkillParameter[];
  output?: Record<string, unknown>;
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  status: SkillStatus;
  schema?: SkillSchema;
  isPublic: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillParams {
  name: string;
  description?: string;
  task: string;
  exampleInputs?: Record<string, unknown>[];
}

export interface UpdateSkillParams {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface ExecuteSkillParams {
  parameters: Record<string, unknown>;
  sessionId?: string;
}

export interface RefineSkillParams {
  feedback: string;
}

export interface SkillExecution {
  id: string;
  skillId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ListSkillsParams {
  limit?: number;
  cursor?: string;
  status?: SkillStatus;
}

export interface ListSkillExecutionsParams {
  limit?: number;
  cursor?: string;
}

// ============================================
// File Types
// ============================================

export interface PresignedUrl {
  url: string;
  expiresAt: string;
}

export interface UploadFileParams {
  fileName: string;
  contentType?: string;
}

// ============================================
// Billing Types
// ============================================

export interface AccountBilling {
  accountId: string;
  email: string;
  credits: number;
  plan: 'free' | 'payg' | 'business' | 'enterprise';
  createdAt: string;
}

// ============================================
// Marketplace Types
// ============================================

export interface MarketplaceSkill {
  id: string;
  name: string;
  description?: string;
  author: string;
  schema?: SkillSchema;
  downloads: number;
  rating?: number;
  createdAt: string;
}

export interface CloneSkillParams {
  name?: string;
}
