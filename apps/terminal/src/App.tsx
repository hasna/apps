import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { spawn, type ChildProcess } from "child_process";
import { translateToCommand, explainCommand, fixCommand, checkPermissions, isIrreversible } from "./ai.js";
import {
  loadHistory,
  appendHistory,
  loadConfig,
  saveConfig,
  type Permissions,
} from "./history.js";
import Onboarding from "./Onboarding.js";
import StatusBar from "./StatusBar.js";
import Spinner from "./Spinner.js";

// ── types ─────────────────────────────────────────────────────────────────────

type Phase =
  | { type: "input";   value: string; cursor: number; histIdx: number; raw: boolean }
  | { type: "thinking"; nl: string; raw: boolean }
  | { type: "confirm"; nl: string; command: string; raw: boolean; danger: boolean }
  | { type: "explain"; nl: string; command: string; explanation: string }
  | { type: "running"; nl: string; command: string }
  | { type: "autofix"; nl: string; command: string; errorOutput: string }
  | { type: "error";   message: string };

interface ScrollEntry {
  nl: string;
  cmd: string;
  lines: string[];
  truncated: boolean;
  expanded: boolean;
  error?: boolean;
}

const MAX_LINES = 20;

// ── helpers ───────────────────────────────────────────────────────────────────

function insertAt(s: string, pos: number, ch: string) { return s.slice(0, pos) + ch + s.slice(pos); }
function deleteAt(s: string, pos: number) { return pos <= 0 ? s : s.slice(0, pos - 1) + s.slice(pos); }

function runCommand(
  command: string,
  onLine: (line: string) => void,
  onDone: (code: number) => void,
  signal: AbortSignal
): ChildProcess {
  const proc = spawn("/bin/zsh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });

  const handleData = (data: Buffer) => {
    const text = data.toString();
    text.split("\n").forEach((line) => { if (line) onLine(line); });
  };

  proc.stdout?.on("data", handleData);
  proc.stderr?.on("data", handleData);
  proc.on("close", (code) => onDone(code ?? 0));

  signal.addEventListener("abort", () => { try { proc.kill("SIGTERM"); } catch {} });
  return proc;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function App() {
  const { exit } = useApp();
  const [config, setConfig] = useState(() => loadConfig());
  const [nlHistory] = useState<string[]>(() => loadHistory().map((h) => h.nl).filter(Boolean));
  const [sessionCmds, setSessionCmds] = useState<string[]>([]);
  const [sessionNl, setSessionNl] = useState<string[]>([]);
  const [scroll, setScroll] = useState<ScrollEntry[]>([]);
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>({
    type: "input", value: "", cursor: 0, histIdx: -1, raw: false,
  });

  const allNl = [...nlHistory, ...sessionNl];

  const finishOnboarding = (perms: Permissions) => {
    const next = { onboarded: true, permissions: perms };
    setConfig(next);
    saveConfig(next);
  };

  const inputPhase = (overrides: Partial<Extract<Phase, { type: "input" }>> = {}) => {
    setPhase({ type: "input", value: "", cursor: 0, histIdx: -1, raw: false, ...overrides });
    setStreamLines([]);
  };

  const pushScroll = (entry: Omit<ScrollEntry, "expanded">) =>
    setScroll((s) => [...s, { ...entry, expanded: false }]);

  const commitStream = (nl: string, cmd: string, lines: string[], error: boolean) => {
    const truncated = lines.length > MAX_LINES;
    pushScroll({ nl, cmd, lines: truncated ? lines.slice(0, MAX_LINES) : lines, truncated, error });
    appendHistory({ nl, cmd, output: lines.join("\n"), ts: Date.now(), error });
    setSessionCmds((c) => [...c.slice(-9), cmd]);
    setStreamLines([]);
  };

  const runPhase = async (nl: string, command: string, raw: boolean) => {
    setPhase({ type: "running", nl, command });
    setStreamLines([]);
    const abort = new AbortController();
    abortRef.current = abort;
    const lines: string[] = [];

    await new Promise<void>((resolve) => {
      runCommand(
        command,
        (line) => { lines.push(line); setStreamLines([...lines]); },
        (code) => {
          commitStream(nl, command, lines, code !== 0);
          abortRef.current = null;
          if (code !== 0 && !raw) {
            // offer auto-fix
            setPhase({ type: "autofix", nl, command, errorOutput: lines.join("\n") });
          } else {
            inputPhase({ raw });
          }
          resolve();
        },
        abort.signal
      );
    });
  };

  useInput(
    useCallback(
      async (input: string, key: any) => {

        // ── running: Ctrl+C kills process ─────────────────────────────────
        if (phase.type === "running") {
          if (key.ctrl && input === "c") {
            abortRef.current?.abort();
            inputPhase();
          }
          return;
        }

        // ── input ─────────────────────────────────────────────────────────
        if (phase.type === "input") {
          if (key.ctrl && input === "c") { exit(); return; }
          if (key.ctrl && input === "l") { setScroll([]); return; }
          if (key.ctrl && input === "r") {
            setPhase({ ...phase, raw: !phase.raw, value: "", cursor: 0 });
            return;
          }

          if (key.upArrow) {
            const idx = Math.min(phase.histIdx + 1, allNl.length - 1);
            const val = allNl[allNl.length - 1 - idx] ?? "";
            setPhase({ ...phase, value: val, cursor: val.length, histIdx: idx });
            return;
          }
          if (key.downArrow) {
            const idx = Math.max(phase.histIdx - 1, -1);
            const val = idx === -1 ? "" : allNl[allNl.length - 1 - idx] ?? "";
            setPhase({ ...phase, value: val, cursor: val.length, histIdx: idx });
            return;
          }
          if (key.leftArrow)  { setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) }); return; }
          if (key.rightArrow) { setPhase({ ...phase, cursor: Math.min(phase.value.length, phase.cursor + 1) }); return; }

          if (key.return) {
            const nl = phase.value.trim();
            if (!nl) return;
            setSessionNl((h) => [...h, nl]);

            if (phase.raw) {
              await runPhase(nl, nl, true);
              return;
            }

            setPhase({ type: "thinking", nl, raw: false });
            try {
              const command = await translateToCommand(nl, config.permissions, sessionCmds);
              const blocked = checkPermissions(command, config.permissions);
              if (blocked) {
                pushScroll({ nl, cmd: command, lines: [`blocked: ${blocked}`], truncated: false, error: true });
                inputPhase();
                return;
              }
              const danger = isIrreversible(command);
              setPhase({ type: "confirm", nl, command, raw: false, danger });
            } catch (e: any) {
              setPhase({ type: "error", message: e.message });
            }
            return;
          }

          if (key.backspace || key.delete) {
            const val = deleteAt(phase.value, phase.cursor);
            setPhase({ ...phase, value: val, cursor: Math.max(0, phase.cursor - 1), histIdx: -1 });
            return;
          }
          if (input && !key.ctrl && !key.meta) {
            const val = insertAt(phase.value, phase.cursor, input);
            setPhase({ ...phase, value: val, cursor: phase.cursor + 1, histIdx: -1 });
          }
          return;
        }

        // ── confirm ───────────────────────────────────────────────────────
        if (phase.type === "confirm") {
          if (key.ctrl && input === "c") { exit(); return; }

          if (input === "?") {
            const { nl, command } = phase;
            setPhase({ type: "thinking", nl, raw: false });
            try {
              const explanation = await explainCommand(command);
              setPhase({ type: "explain", nl, command, explanation });
            } catch {
              setPhase({ type: "confirm", nl, command, raw: false, danger: phase.danger });
            }
            return;
          }
          if (input === "y" || input === "Y" || key.return) {
            await runPhase(phase.nl, phase.command, false);
            return;
          }
          if (input === "n" || input === "N" || key.escape) { inputPhase(); return; }
          if (input === "e" || input === "E") {
            setPhase({ type: "input", value: phase.command, cursor: phase.command.length, histIdx: -1, raw: false });
            return;
          }
          return;
        }

        // ── explain → back to confirm ─────────────────────────────────────
        if (phase.type === "explain") {
          if (key.ctrl && input === "c") { exit(); return; }
          setPhase({ type: "confirm", nl: phase.nl, command: phase.command, raw: false, danger: isIrreversible(phase.command) });
          return;
        }

        // ── autofix ───────────────────────────────────────────────────────
        if (phase.type === "autofix") {
          if (key.ctrl && input === "c") { exit(); return; }
          if (input === "y" || input === "Y" || key.return) {
            const { nl, command, errorOutput } = phase;
            setPhase({ type: "thinking", nl, raw: false });
            try {
              const fixed = await fixCommand(nl, command, errorOutput, config.permissions, sessionCmds);
              const danger = isIrreversible(fixed);
              setPhase({ type: "confirm", nl, command: fixed, raw: false, danger });
            } catch (e: any) {
              setPhase({ type: "error", message: e.message });
            }
            return;
          }
          inputPhase();
          return;
        }

        // ── error ─────────────────────────────────────────────────────────
        if (phase.type === "error") {
          if (key.ctrl && input === "c") { exit(); return; }
          inputPhase();
          return;
        }
      },
      [phase, allNl, config, sessionCmds, exit]
    )
  );

  // ── expand toggle ──────────────────────────────────────────────────────────
  const toggleExpand = (i: number) =>
    setScroll((s) => s.map((e, idx) => idx === i ? { ...e, expanded: !e.expanded } : e));

  // ── onboarding ─────────────────────────────────────────────────────────────
  if (!config.onboarded) {
    return <Onboarding onDone={finishOnboarding} />;
  }

  const isRaw = phase.type === "input" && phase.raw;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">

      {/* scrollback */}
      {scroll.map((entry, i) => (
        <Box key={i} flexDirection="column" marginBottom={1} paddingLeft={2}>
          <Box gap={2}>
            <Text dimColor>›</Text>
            <Text dimColor>{entry.nl}</Text>
          </Box>
          {entry.nl !== entry.cmd && (
            <Box gap={2} paddingLeft={2}>
              <Text dimColor>$</Text>
              <Text dimColor>{entry.cmd}</Text>
            </Box>
          )}
          {entry.lines.length > 0 && (
            <Box flexDirection="column" paddingLeft={4}>
              {entry.lines.map((line, j) => (
                <Text key={j} color={entry.error ? "red" : undefined}>{line}</Text>
              ))}
              {entry.truncated && !entry.expanded && (
                <Text dimColor>… (space to expand)</Text>
              )}
            </Box>
          )}
        </Box>
      ))}

      {/* confirm */}
      {phase.type === "confirm" && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          <Box gap={2}>
            <Text dimColor>›</Text>
            <Text dimColor>{phase.nl}</Text>
          </Box>
          <Box gap={2} paddingLeft={2}>
            <Text dimColor>$</Text>
            <Text>{phase.command}</Text>
            {phase.danger && <Text color="red"> ⚠ irreversible</Text>}
          </Box>
          <Box paddingLeft={4}><Text dimColor>enter  n  e  ?</Text></Box>
        </Box>
      )}

      {/* explain */}
      {phase.type === "explain" && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          <Box gap={2} paddingLeft={2}>
            <Text dimColor>$</Text>
            <Text>{phase.command}</Text>
          </Box>
          <Box paddingLeft={4}>
            <Text dimColor>{phase.explanation}</Text>
          </Box>
          <Box paddingLeft={4}><Text dimColor>any key to continue</Text></Box>
        </Box>
      )}

      {/* autofix */}
      {phase.type === "autofix" && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          <Text dimColor>  command failed — retry with fix?  [enter / n]</Text>
        </Box>
      )}

      {/* spinners */}
      {phase.type === "thinking" && <Spinner label="translating" />}

      {/* running — live stream */}
      {phase.type === "running" && (
        <Box flexDirection="column" paddingLeft={2}>
          <Box gap={2}>
            <Text dimColor>$</Text>
            <Text dimColor>{phase.command}</Text>
          </Box>
          {streamLines.length > 0 && (
            <Box flexDirection="column" paddingLeft={2}>
              {streamLines.slice(-MAX_LINES).map((line, i) => (
                <Text key={i}>{line}</Text>
              ))}
            </Box>
          )}
          <Spinner label="ctrl+c to cancel" />
        </Box>
      )}

      {/* error */}
      {phase.type === "error" && (
        <Box paddingLeft={2}>
          <Text color="red">{phase.message}</Text>
        </Box>
      )}

      {/* input */}
      {phase.type === "input" && (
        <Box gap={2} paddingLeft={2}>
          <Text dimColor>{isRaw ? "$" : "›"}</Text>
          <Box>
            <Text>{phase.value.slice(0, phase.cursor)}</Text>
            <Text inverse>{phase.value[phase.cursor] ?? " "}</Text>
            <Text>{phase.value.slice(phase.cursor + 1)}</Text>
          </Box>
        </Box>
      )}

      <StatusBar permissions={config.permissions} />
    </Box>
  );
}
