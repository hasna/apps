/** Supported AI providers for computer use */
export type Provider = "anthropic" | "openai";

/** Provider failure classes that can trigger a configured fallback provider. */
export type ProviderFallbackReason = "error" | "rate_limit" | "unsupported";

/** Provider fallback policy for a single run or persisted config. */
export interface ProviderFallbackConfig {
  /** Whether provider fallback is enabled. */
  enabled: boolean;
  /** Fallback provider. If omitted, the alternate built-in provider is used. */
  provider?: Provider;
  /** Optional fallback model override. */
  model?: string;
  /** Failure classes that are allowed to trigger fallback. */
  fallbackOn: ProviderFallbackReason[];
}

/** Mouse button types */
export type MouseButton = "left" | "right" | "middle";

/** A screen coordinate */
export interface Point {
  x: number;
  y: number;
}

/** Screen dimensions */
export interface ScreenSize {
  width: number;
  height: number;
}

export type CoordinateSpaceKind =
  | "native_display"
  | "screenshot"
  | "scaled_screenshot"
  | "browser_viewport";

export interface ScreenBounds extends ScreenSize {
  x: number;
  y: number;
  displayNumber?: number;
  scaleFactor?: number;
}

export interface CoordinateSpace {
  kind: CoordinateSpaceKind;
  size: ScreenSize;
  origin?: Point;
  displayNumber?: number;
  scaleFactor?: number;
  label?: string;
}

/** A captured screenshot */
export interface Screenshot {
  /** Base64-encoded PNG image data */
  base64: string;
  /** Screen dimensions at time of capture */
  size: ScreenSize;
  /** Timestamp of capture */
  timestamp: number;
  /** Coordinate space used by image-local points in this screenshot */
  coordinateSpace?: CoordinateSpace;
}

/** Actions the driver can execute on the OS */
export type DriverAction =
  | { type: "screenshot" }
  | { type: "click"; point: Point; button?: MouseButton; count?: number }
  | { type: "type"; text: string }
  | { type: "key"; keys: string }
  | { type: "scroll"; point: Point; deltaX: number; deltaY: number }
  | { type: "mouse_move"; point: Point }
  | { type: "drag"; from: Point; to: Point }
  | { type: "wait"; ms: number }
  | { type: "open_url"; url: string }
  | { type: "open_app"; name: string };

/** Result of executing a driver action */
export interface ActionResult {
  success: boolean;
  screenshot?: Screenshot;
  error?: string;
  duration_ms: number;
}

export interface DriverExecutionContext {
  signal?: AbortSignal;
}

/** The computer driver interface — OS-level screen + input control */
export interface ComputerDriver {
  /** Get current screen size */
  getScreenSize(): Promise<ScreenSize>;
  /** Capture a screenshot */
  screenshot(): Promise<Screenshot>;
  /** Execute an action */
  execute(action: DriverAction, context?: DriverExecutionContext): Promise<ActionResult>;
  /** Clean up resources */
  dispose(): Promise<void>;
}

/** What the AI model returns after analyzing a screenshot */
export interface ModelResponse {
  /** The action to execute, or null if task is complete */
  action: DriverAction | null;
  /** The model's reasoning about what it sees */
  reasoning: string;
  /** Whether the model considers the task complete */
  done: boolean;
  /** Token usage for this step */
  usage?: { input: number; output: number };
  /** Provider-reported safety checks that must be approved before executing the suggested action. */
  pendingSafetyChecks?: ProviderSafetyCheck[];
}

export interface ProviderSafetyCheck {
  provider: Provider;
  id: string;
  code?: string;
  message?: string;
}

/** AI provider interface — sends screenshots, gets actions back */
export interface ComputerProvider {
  readonly name: Provider;
  /** Analyze a screenshot and task, return next action */
  analyze(params: {
    task: string;
    screenshot: Screenshot;
    history: ModelResponse[];
    systemPrompt?: string;
  }): Promise<ModelResponse>;
}

export type VerifierEvidenceKind =
  | "screenshot"
  | "accessibility_tree"
  | "browser_snapshot"
  | "terminal_transcript"
  | "fleet_status"
  | "log"
  | "note";

export interface VerifierEvidence {
  kind: VerifierEvidenceKind;
  summary: string;
  artifactPath?: string;
  data?: unknown;
}

export type VerifierDecisionStatus = "done" | "needs_more_steps" | "blocked";

export interface VerifierDecision {
  status: VerifierDecisionStatus;
  confidence: number;
  reason: string;
  evidence: string[];
  nextStep?: string;
}

export interface GoalVerifierContext {
  task: string;
  runId?: string;
  stepId?: string;
  stepIndex?: number;
  criteria?: string[];
  evidence: VerifierEvidence[];
}

export type GoalVerifier = (context: GoalVerifierContext) => Promise<VerifierDecision> | VerifierDecision;

/** Session state */
export const SESSION_STATUSES = [
  "pending",
  "running",
  "waiting_on_approval",
  "paused",
  "cancelling",
  "cancelled",
  "failed",
  "completed",
  "max_steps_exceeded",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** A logged action within a session */
export interface ActionLog {
  id: number;
  session_id: string;
  step: number;
  action: DriverAction;
  reasoning: string;
  screenshot_path?: string;
  success: boolean;
  error?: string;
  duration_ms: number;
  tokens_in?: number;
  tokens_out?: number;
  created_at: string;
}

/** A computer use session */
export interface Session {
  id: string;
  task: string;
  provider: Provider;
  model: string;
  status: SessionStatus;
  steps: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_duration_ms: number;
  tags?: string[];
  error?: string;
  created_at: string;
  completed_at?: string;
}

/** Options for running a task */
export interface RunOptions {
  /** The natural language task to accomplish */
  task: string;
  /** Internal/resume path: continue an existing non-terminal session instead of creating a new one. */
  resumeSessionId?: string;
  /** AI provider to use */
  provider?: Provider;
  /** Specific model to use (defaults to provider's best) */
  model?: string;
  /** Fallback AI provider for model analysis failures, or false to disable fallback. */
  fallbackProvider?: Provider | false;
  /** Specific model to use for fallback provider. */
  fallbackModel?: string;
  /** Failure classes that are allowed to trigger fallback for this run. */
  fallbackOn?: ProviderFallbackReason[];
  /** Maximum number of steps before stopping */
  maxSteps?: number;
  /** Save screenshots to disk */
  saveScreenshots?: boolean;
  /** Screenshots directory */
  screenshotsDir?: string;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Optional verifier pass before accepting provider-reported completion. */
  verifier?: GoalVerifier;
  /** Task-specific criteria passed to the verifier. */
  verificationCriteria?: string[];
  /** Max screenshot width before sending to AI model (default: 1280 WXGA) */
  screenshotMaxWidth?: number;
  /** Dry-run mode — model plans actions but they are not executed */
  dryRun?: boolean;
  /** Tags for this session */
  tags?: string[];
  /** Display number to capture (1=main, 2=secondary, etc.) */
  displayNumber?: number;
  /** Callback for each step */
  onStep?: (step: number, response: ModelResponse, result: ActionResult) => void;
  /** Callback when done */
  onDone?: (session: Session) => void;
  /** Whether to run headless */
  headless?: boolean;
  /** Override driver, primarily for integration tests and embedded runtimes */
  driver?: ComputerDriver;
  /** Override AI provider, primarily for integration tests and embedded runtimes */
  computerProvider?: ComputerProvider;
  /** Override safety policy for this run */
  safety?: SafetyConfig;
}

/** Safety configuration */
export interface SafetyConfig {
  /** Apps that should never be interacted with */
  blockedApps?: string[];
  /** URLs/domains that should never be visited */
  blockedDomains?: string[];
  /** Whether to require confirmation before clicks */
  confirmClicks?: boolean;
  /** Maximum actions per minute */
  maxActionsPerMinute?: number;
  /** Whether to allow typing passwords */
  allowPasswordTyping?: boolean;
}
