export interface StatusContext {
  provider: "claude" | "codex" | "opencode";
  cwd: string;
  projectDir?: string;
  model?: { id?: string; displayName?: string };
  cost?: {
    totalCostUsd?: number;
    totalDurationMs?: number;
    totalLinesAdded?: number;
    totalLinesRemoved?: number;
  };
  transcriptPath?: string;
  sessionId?: string;
  /** Thread title the user set with `/rename`; absent until they do. */
  sessionName?: string;
  version?: string;
  outputStyle?: string;
  /** Reasoning effort level, on models that expose one. */
  effort?: string;
  /** Whether extended thinking is on. */
  thinking?: boolean;
  /** Rate-limit windows, present only once the host reports limit data. */
  rateLimits?: {
    fiveHour?: { usedPercentage?: number };
    sevenDay?: { usedPercentage?: number };
  };
}

/** ANSI hints a segment can ask the renderer for. */
export type SegmentColor =
  | "cyan"
  | "magenta"
  | "blue"
  | "green"
  | "yellow"
  | "red"
  | "bold"
  | "dim";

export interface Segment {
  id: string;
  description: string;
  defaultEnabled: boolean;
  /**
   * Colour applied by the renderer when colours are on. A function lets a
   * segment escalate with its value (e.g. a limit gauge turning red).
   */
  color?: SegmentColor | ((ctx: StatusContext) => SegmentColor | null);
  render(ctx: StatusContext): Promise<string | null> | string | null;
}
