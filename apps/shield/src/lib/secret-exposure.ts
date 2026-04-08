import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { gitHistoryScanner } from "../scanners/git-history.js";
import { scanFile, secretsScanner } from "../scanners/secrets.js";
import { SEVERITY_ORDER, Severity, type FindingInput } from "../types/index.js";

type RunnerOptions = {
  cwd?: string;
  encoding?: BufferEncoding;
  maxBuffer?: number;
};

export type CommandRunner = (command: string, args: string[], options?: RunnerOptions) => string;

export interface SecretExposureOptions {
  path: string;
  include_git_history?: boolean;
  include_processes?: boolean;
  include_tmux?: boolean;
  ignore_patterns?: string[];
}

export interface SecretExposureSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface SecretExposureResult {
  path: string;
  findings: FindingInput[];
  summary: SecretExposureSummary;
}

export interface TmuxPaneInfo {
  pane_id: string;
  target: string;
  session_name: string;
  window_name: string;
  pane_title: string;
  current_command: string;
}

const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;
const TMUX_PANE_FORMAT = [
  "#{pane_id}",
  "#{session_name}",
  "#{window_name}",
  "#{pane_title}",
  "#{pane_current_command}",
  "#{session_name}:#{window_index}.#{pane_index}",
].join("\t");

function defaultRunner(command: string, args: string[], options?: RunnerOptions): string {
  return execFileSync(command, args, {
    cwd: options?.cwd,
    encoding: options?.encoding ?? "utf-8",
    maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
  }) as string;
}

function dedupeFindings(findings: FindingInput[]): FindingInput[] {
  const seen = new Set<string>();
  const deduped: FindingInput[] = [];

  for (const finding of findings) {
    const key = [
      finding.rule_id,
      finding.scanner_type,
      finding.severity,
      finding.file,
      finding.line,
      finding.column ?? "",
      finding.message,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }

  return deduped.sort((a, b) => {
    const severityDelta = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDelta !== 0) return severityDelta;
    const fileDelta = a.file.localeCompare(b.file);
    if (fileDelta !== 0) return fileDelta;
    return a.line - b.line;
  });
}

export function filterSecretExposureBySeverity(
  findings: FindingInput[],
  threshold: Severity,
): FindingInput[] {
  const thresholdOrder = SEVERITY_ORDER[threshold];
  return findings.filter((finding) => SEVERITY_ORDER[finding.severity] <= thresholdOrder);
}

export function summarizeSecretExposure(findings: FindingInput[]): SecretExposureSummary {
  const summary: SecretExposureSummary = {
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const finding of findings) {
    summary[finding.severity]++;
  }

  return summary;
}

function annotateFindings(findings: FindingInput[], suffix: string): FindingInput[] {
  return findings.map((finding) => ({
    ...finding,
    message: `${finding.message} ${suffix}`,
  }));
}

function runCommand(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd?: string,
): string | null {
  try {
    return runner(command, args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: DEFAULT_MAX_BUFFER,
    }).trimEnd();
  } catch {
    return null;
  }
}

function getProcessSnapshot(runner: CommandRunner): string | null {
  if (process.platform === "win32") return null;

  const attempts = [
    ["eww", "-ax", "-o", "pid=,command="],
    ["eww", "-Ao", "pid=,command="],
  ];

  for (const args of attempts) {
    const output = runCommand(runner, "ps", args);
    if (output) return output;
  }

  return null;
}

export function scanRunningProcesses(runner: CommandRunner = defaultRunner): FindingInput[] {
  const output = getProcessSnapshot(runner);
  if (!output) return [];

  const findings: FindingInput[] = [];

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;

    const pid = match[1];
    const payload = match[2].trim();
    if (!payload) continue;

    findings.push(
      ...annotateFindings(
        scanFile(`process:${pid}`, payload),
        `in running process ${pid}`,
      ),
    );
  }

  return dedupeFindings(findings);
}

export function listTmuxPanes(runner: CommandRunner = defaultRunner): TmuxPaneInfo[] {
  const output = runCommand(runner, "tmux", ["list-panes", "-a", "-F", TMUX_PANE_FORMAT]);
  if (!output) return [];

  const panes: TmuxPaneInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [pane_id, session_name, window_name, pane_title, current_command, target] = line.split("\t");
    if (!pane_id || !target) continue;
    panes.push({
      pane_id,
      target,
      session_name: session_name || "",
      window_name: window_name || "",
      pane_title: pane_title || "",
      current_command: current_command || "",
    });
  }

  return panes;
}

export function scanTmuxPanes(runner: CommandRunner = defaultRunner): FindingInput[] {
  const panes = listTmuxPanes(runner);
  if (panes.length === 0) return [];

  const findings: FindingInput[] = [];

  for (const pane of panes) {
    const metadata = [
      `session=${pane.session_name}`,
      `window=${pane.window_name}`,
      `target=${pane.target}`,
      `title=${pane.pane_title}`,
      `command=${pane.current_command}`,
    ].join("\n");

    findings.push(
      ...annotateFindings(
        scanFile(`tmux:${pane.target}:meta`, metadata),
        `in tmux pane metadata ${pane.target}`,
      ),
    );

    const history = runCommand(
      runner,
      "tmux",
      ["capture-pane", "-p", "-S", "-200", "-t", pane.pane_id],
    );
    if (!history) continue;

    findings.push(
      ...annotateFindings(
        scanFile(`tmux:${pane.target}:history`, history),
        `in tmux pane history ${pane.target}`,
      ),
    );
  }

  return dedupeFindings(findings);
}

export async function scanSecretExposure(
  options: SecretExposureOptions,
  runner: CommandRunner = defaultRunner,
): Promise<SecretExposureResult> {
  const scanPath = resolve(options.path);
  if (!existsSync(scanPath)) {
    throw new Error(`Path does not exist: ${scanPath}`);
  }

  const findings: FindingInput[] = [];
  findings.push(
    ...(await secretsScanner.scan(scanPath, {
      ignore_patterns: options.ignore_patterns,
    })),
  );

  if (options.include_git_history ?? true) {
    findings.push(...(await gitHistoryScanner.scan(scanPath)));
  }

  if (options.include_processes ?? true) {
    findings.push(...scanRunningProcesses(runner));
  }

  if (options.include_tmux ?? true) {
    findings.push(...scanTmuxPanes(runner));
  }

  const deduped = dedupeFindings(findings);
  return {
    path: scanPath,
    findings: deduped,
    summary: summarizeSecretExposure(deduped),
  };
}
