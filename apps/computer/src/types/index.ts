/** Supported AI providers for computer use */
export type Provider = "anthropic" | "openai";

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

/** A captured screenshot */
export interface Screenshot {
  /** Base64-encoded PNG image data */
  base64: string;
  /** Screen dimensions at time of capture */
  size: ScreenSize;
  /** Timestamp of capture */
  timestamp: number;
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

/** The computer driver interface — OS-level screen + input control */
export interface ComputerDriver {
  /** Get current screen size */
  getScreenSize(): Promise<ScreenSize>;
  /** Capture a screenshot */
  screenshot(): Promise<Screenshot>;
  /** Execute an action */
  execute(action: DriverAction): Promise<ActionResult>;
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

/** Session state */
export type SessionStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

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
  /** AI provider to use */
  provider?: Provider;
  /** Specific model to use (defaults to provider's best) */
  model?: string;
  /** Maximum number of steps before stopping */
  maxSteps?: number;
  /** Save screenshots to disk */
  saveScreenshots?: boolean;
  /** Screenshots directory */
  screenshotsDir?: string;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Max screenshot width before sending to AI model (default: 1280 WXGA) */
  screenshotMaxWidth?: number;
  /** Dry-run mode — model plans actions but they are not executed */
  dryRun?: boolean;
  /** Tags for this session */
  tags?: string[];
  /** Callback for each step */
  onStep?: (step: number, response: ModelResponse, result: ActionResult) => void;
  /** Callback when done */
  onDone?: (session: Session) => void;
  /** Whether to run headless */
  headless?: boolean;
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
