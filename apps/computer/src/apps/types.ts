// App driver types — deterministic orchestration of desktop apps.
//
// An AppDriver knows how to open and arrange a specific desktop application
// (windows, tabs, panes, commands) without any AI in the loop. Drivers are
// registered in src/apps/registry.ts and surfaced via `computer open <app>`
// and `computer apps`.

/** A pane grid: R rows x C cols. Panes are addressed row-major. */
export interface PaneGrid {
  rows: number;
  cols: number;
}

/** Declarative description of how to open/arrange an app. */
export interface AppOpenSpec {
  /** Split the window into rows x cols panes (single tab). */
  grid?: PaneGrid;
  /** Multiple tabs in one window, each with its own grid. Overrides `grid`. */
  tabs?: PaneGrid[];
  /** Commands per pane, row-major across tabs in order. */
  run?: string[];
  /** Fill every pane with the single `run` command. */
  all?: boolean;
  /** Working directory — every pane cds here before running its command. */
  dir?: string;
  /** Maximize the new window (not native fullscreen). */
  max?: boolean;
}

/** Whether a driver can run on this machine, and why not if it can't. */
export interface AppAvailability {
  available: boolean;
  /** Human-readable reason when unavailable. */
  reason?: string;
}

/** Result of an open() call. */
export interface AppOpenResult {
  ok: boolean;
  message: string;
  /** Total panes created (when applicable). */
  panes?: number;
  /** Tabs created (when applicable). */
  tabs?: number;
}

/** A deterministic driver for one desktop application. */
export interface AppDriver {
  /** Registry key, e.g. "ghostty". Lowercase. */
  name: string;
  /** One-line human description. */
  description: string;
  /** Check availability on this machine. */
  available(): AppAvailability;
  /** Open/orchestrate the app according to spec. */
  open(spec: AppOpenSpec): Promise<AppOpenResult>;
}
