import { EventsClient, type EmitResult } from "@hasna/events";
export interface TmuxPaneProbeResult {
    target: string;
    exists: boolean;
    paneId?: string;
    checkedAt: string;
    exitCode?: number | null;
    error?: string;
    stderr?: string;
}
export interface TmuxWatchOptions {
    target: string;
    intervalMs?: number;
    maxChecks?: number;
    emitInitialMissing?: boolean;
    deliver?: boolean;
    tmuxCommand?: string;
    client?: Pick<EventsClient, "emit">;
    probe?: (target: string) => TmuxPaneProbeResult | Promise<TmuxPaneProbeResult>;
    sleep?: (ms: number) => Promise<void>;
    onProbe?: (probe: TmuxPaneProbeResult) => void;
}
export interface TmuxWatchResult {
    target: string;
    checks: number;
    status: "present" | "missing" | "died" | "stopped";
    lastProbe: TmuxPaneProbeResult;
    emitted?: EmitResult;
}
export interface TmuxPaneDiedHookPlan {
    tmuxCommand: string;
    args: string[];
    shellCommand: string;
    eventType: "stations.tmux.pane_died";
    deliver: boolean;
    trustedLocalMutation: boolean;
}
export declare function assertStationsCommandSafe(command: string): void;
export declare function buildTmuxPaneDiedHookPlan(options?: {
    tmuxCommand?: string;
    stationsCommand?: string;
    deliver?: boolean;
    approvalToken?: string;
    trustedLocalMutation?: boolean;
}): TmuxPaneDiedHookPlan;
export declare function probeTmuxPane(target: string, tmuxCommand?: string): TmuxPaneProbeResult;
export declare function watchTmuxPane(options: TmuxWatchOptions): Promise<TmuxWatchResult>;
