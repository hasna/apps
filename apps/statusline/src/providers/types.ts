export interface StatusContext {
  provider: "claude";
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
  version?: string;
  outputStyle?: string;
}

export interface Segment {
  id: string;
  description: string;
  defaultEnabled: boolean;
  render(ctx: StatusContext): Promise<string | null> | string | null;
}
