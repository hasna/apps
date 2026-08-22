import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { EventsClient, type EmitResult, type EventInput } from "@hasna/events";

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandBasename(command: string): string {
  const withoutArgs = command.trim().split(/\s+/, 1)[0] ?? "";
  return withoutArgs.split(/[\\/]/).filter(Boolean).at(-1) ?? withoutArgs;
}

export function assertStationsCommandSafe(command: string): void {
  const basename = commandBasename(command);
  if (basename === "events" || basename === "hasna-events") {
    throw new Error("tmux-hook-plan stations command must invoke the stations CLI, not dependency-owned @hasna/events bins.");
  }
}

export function buildTmuxPaneDiedHookPlan(options: {
  tmuxCommand?: string;
  stationsCommand?: string;
  deliver?: boolean;
  approvalToken?: string;
  trustedLocalMutation?: boolean;
} = {}): TmuxPaneDiedHookPlan {
  const tmuxCommand = options.tmuxCommand ?? process.env["HASNA_STATIONS_TMUX_BIN"] ?? "tmux";
  const stationsCommand = options.stationsCommand ?? "stations";
  assertStationsCommandSafe(stationsCommand);
  const deliver = options.deliver === true;
  const approvalToken = options.approvalToken?.trim();
  const trustedLocalMutation = approvalToken ? false : options.trustedLocalMutation === true;
  const emitArgs = [
    "events",
    "emit",
    "stations.tmux.pane_died",
    "--source",
    "stations",
    "--subject",
    "tmux:#{hook_pane}",
    "--severity",
    "warning",
    "--message",
    "tmux pane died: #{hook_pane}",
    "--data",
    "{\"target\":\"#{hook_pane}\",\"session\":\"#{session_name}\",\"window\":\"#{window_index}\"}",
  ];
  if (!deliver) emitArgs.push("--no-deliver");
  if (approvalToken) emitArgs.push("--approval-token", approvalToken);
  const command = [stationsCommand, ...emitArgs].map(shellQuote).join(" ");
  const runShell = trustedLocalMutation
    ? `HASNA_STATIONS_ALLOW_MUTATIONS=1 ${command}`
    : command;
  const args = ["set-hook", "-g", "pane-died", `run-shell ${shellQuote(runShell)}`];
  return {
    tmuxCommand,
    args,
    shellCommand: [tmuxCommand, ...args].map(shellQuote).join(" "),
    eventType: "stations.tmux.pane_died",
    deliver,
    trustedLocalMutation,
  };
}

export function probeTmuxPane(target: string, tmuxCommand = process.env["HASNA_STATIONS_TMUX_BIN"] || "tmux"): TmuxPaneProbeResult {
  const checkedAt = new Date().toISOString();
  const result = spawnSync(tmuxCommand, ["display-message", "-p", "-t", target, "#{pane_id}"], {
    encoding: "utf8",
    timeout: 5000,
  });
  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  const exists = result.status === 0 && Boolean(stdout);

  return {
    target,
    exists,
    paneId: exists ? stdout : undefined,
    checkedAt,
    exitCode: result.status,
    error: result.error?.message,
    stderr: stderr || undefined,
  };
}

export async function watchTmuxPane(options: TmuxWatchOptions): Promise<TmuxWatchResult> {
  const target = options.target.trim();
  if (!target) throw new Error("tmux pane target is required");

  const intervalMs = Math.max(0, options.intervalMs ?? 5000);
  const maxChecks = options.maxChecks ?? Number.POSITIVE_INFINITY;
  const client = options.client ?? new EventsClient();
  const probe = options.probe ?? ((paneTarget: string) => probeTmuxPane(paneTarget, options.tmuxCommand));
  const wait = options.sleep ?? sleep;
  let lastPresent: TmuxPaneProbeResult | undefined;
  let lastProbe: TmuxPaneProbeResult | undefined;

  for (let checks = 1; checks <= maxChecks; checks += 1) {
    const current = await probe(target);
    lastProbe = current;
    options.onProbe?.(current);

    if (current.exists) {
      lastPresent = current;
    } else if (lastPresent) {
      const emitted = await emitTmuxEvent(client, "stations.tmux.pane_died", current, lastPresent, options.deliver !== false);
      return { target, checks, status: "died", lastProbe: current, emitted };
    } else if (options.emitInitialMissing) {
      const emitted = await emitTmuxEvent(client, "stations.tmux.pane_missing", current, undefined, options.deliver !== false);
      return { target, checks, status: "missing", lastProbe: current, emitted };
    }

    if (checks < maxChecks) await wait(intervalMs);
  }

  if (!lastProbe) {
    lastProbe = {
      target,
      exists: false,
      checkedAt: new Date().toISOString(),
      error: "No probe executed",
    };
  }

  return {
    target,
    checks: Number.isFinite(maxChecks) ? maxChecks : 0,
    status: lastProbe.exists ? "present" : "stopped",
    lastProbe,
  };
}

async function emitTmuxEvent(
  client: Pick<EventsClient, "emit">,
  type: "stations.tmux.pane_died" | "stations.tmux.pane_missing",
  probe: TmuxPaneProbeResult,
  lastPresent: TmuxPaneProbeResult | undefined,
  deliver: boolean,
): Promise<EmitResult> {
  const input: EventInput = {
    source: "stations",
    type,
    subject: `tmux:${probe.target}`,
    severity: type === "stations.tmux.pane_died" ? "warning" : "notice",
    message: type === "stations.tmux.pane_died"
      ? `tmux pane disappeared: ${probe.target}`
      : `tmux pane is missing: ${probe.target}`,
    data: {
      target: probe.target,
      paneId: lastPresent?.paneId,
      lastSeenAt: lastPresent?.checkedAt,
      checkedAt: probe.checkedAt,
      exitCode: probe.exitCode,
      error: probe.error,
      stderr: probe.stderr,
    },
    metadata: {
      monitor: "tmux-pane",
      runtime: "stations",
    },
  };
  return client.emit(input, { deliver });
}
