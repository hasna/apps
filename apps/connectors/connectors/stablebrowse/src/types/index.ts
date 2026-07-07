/**
 * StableBrowse API Types
 *
 * Rebuilt from the public StableBrowse API reference:
 * https://docs.stablebrowse.com/api-reference/introduction
 */

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export class StableBrowseApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'StableBrowseApiError';
  }
}

// ============================================
// Task Types
// ============================================

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StepSummary {
  n: number;
  type: string;
  msg: string;
  success: boolean;
}

/**
 * Body for POST /tasks
 */
export interface SubmitTaskParams {
  /** Opaque end-user identifier (<= 256 chars). */
  endUserId: string;
  /** Natural-language instruction for the agent. Non-empty after trimming. */
  task: string;
  /** Continue an existing conversation/session instead of starting a new one. */
  sessionId?: string;
  /** URL the agent should open before acting. */
  startUrl?: string;
  /** JSON schema describing the structured output to return. */
  schema?: Record<string, unknown>;
  /** Cap on the number of agent steps. */
  maxSteps?: number;
  /** Include the raw HTML of the final page in the task result. */
  include_html_dump?: boolean;
}

/**
 * Response from POST /tasks and POST /design/extract (submission acknowledgement).
 */
export interface SubmitTaskResponse {
  taskId: string;
  sessionId: string;
  status: TaskStatus;
  createdAt: string;
}

/**
 * Response from GET /tasks/{taskId}
 */
export interface Task {
  taskId: string;
  sessionId: string;
  endUserId: string;
  task: string;
  status: TaskStatus;
  result?: string | Record<string, unknown>;
  structured_content?: Record<string, unknown>;
  html_dump?: string;
  totalSteps?: number;
  durationMs?: number;
  visitedUrls?: string[];
  stepSummaries?: StepSummary[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListTasksParams {
  /** How many sessions to return (default 50, max 100). */
  limit?: number;
}

/**
 * A conversation session summary as returned by GET /tasks (grouped by session).
 */
export interface SessionSummary {
  sessionId: string;
  firstTask: Task;
  turnCount: number;
  latestStatus: TaskStatus;
  latestCreatedAt: string;
  latestUpdatedAt: string;
}

export interface ListTasksResponse {
  sessions: SessionSummary[];
}

// ============================================
// Session Types
// ============================================

export interface SessionTask {
  taskId: string;
  status: TaskStatus;
  task: string;
  createdAt: string;
}

/**
 * Response from GET /sessions/{sessionId}
 */
export interface Session {
  sessionId: string;
  tasks: SessionTask[];
}

// ============================================
// End-User Credential Types
// ============================================

/**
 * Body for PUT /end-users/{endUserId}/credentials.
 * All fields are optional; the call is an idempotent upsert.
 */
export interface SetCredentialsParams {
  twitterAuthToken?: string;
  twitterCt0?: string;
  redditSession?: string;
  tiktokSessionId?: string;
  tiktokCsrfToken?: string;
  instagramSessionId?: string;
  instagramCsrfToken?: string;
  instagramDsUserId?: string;
}

export interface SetCredentialsResponse {
  ok: boolean;
}

/**
 * Response from GET /end-users/{endUserId}/credentials.
 * Only reports whether credentials are configured; never returns secrets.
 */
export interface CredentialsStatus {
  endUserId: string;
  platforms: Record<string, boolean>;
}

// ============================================
// Design Extraction Types
// ============================================

export type Extractor = 'images' | 'fonts' | 'colors' | 'icons' | 'tokens' | 'logo';

/**
 * Body for POST /design/extract (and /design/extract/{extractor}).
 */
export interface DesignExtractParams {
  /** HTTP(S) URL to extract design assets from. */
  url: string;
  /** Opaque end-user identifier (<= 256 chars). */
  endUserId: string;
  /** Subset of extractors to run. Omit to run all six. */
  extractors?: Extractor[];
  /** Route through the residential proxy pool for rate-limited/geo-blocked sites. */
  enableIpRotation?: boolean;
}

/**
 * Response from POST /design/extract (submission acknowledgement).
 */
export interface DesignExtractResponse {
  taskId: string;
  sessionId: string;
  status: TaskStatus;
  extractors: Extractor[];
  enableIpRotation: boolean;
  createdAt: string;
}
