import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { exec } from "child_process";
import { promisify } from "util";
import { translateToCommand, explainCommand, checkPermissions } from "./ai.js";
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

const execAsync = promisify(exec);

// ── types ────────────────────────────────────────────────────────────────────

type Phase =
  | { type: "input"; value: string; cursor: number; histIdx: number; raw: boolean }
  | { type: "thinking"; nl: string; raw: boolean }
  | { type: "confirm"; nl: string; command: string; raw: boolean }
  | { type: "explain"; nl: string; command: string; explanation: string }
  | { type: "running"; nl: string; command: string }
  | { type: "error"; message: string };

interface ScrollEntry {
  nl: string;
  cmd: string;
  output: string;
  error?: boolean;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function insertAt(str: string, pos: number, ch: string) {
  return str.slice(0, pos) + ch + str.slice(pos);
}
function deleteAt(str: string, pos: number) {
  if (pos <= 0) return str;
  return str.slice(0, pos - 1) + str.slice(pos);
}

// ── component ────────────────────────────────────────────────────────────────

export default function App() {
  const { exit } = useApp();
  const [config, setConfig] = useState(() => loadConfig());
  const [nlHistory] = useState<string[]>(() =>
    loadHistory()
      .map((h) => h.nl)
      .filter(Boolean)
  );
  const [sessionNl, setSessionNl] = useState<string[]>([]);
  const [scroll, setScroll] = useState<ScrollEntry[]>([]);
  const [phase, setPhase] = useState<Phase>({
    type: "input",
    value: "",
    cursor: 0,
    histIdx: -1,
    raw: false,
  });

  const allNl = [...nlHistory, ...sessionNl];

  const finishOnboarding = (perms: Permissions) => {
    const next = { onboarded: true, permissions: perms };
    setConfig(next);
    saveConfig(next);
  };

  const pushScroll = (entry: ScrollEntry) => setScroll((s) => [...s, entry]);

  const inputPhase = (overrides: Partial<Extract<Phase, { type: "input" }>> = {}) =>
    setPhase({ type: "input", value: "", cursor: 0, histIdx: -1, raw: false, ...overrides });

  useInput(
    useCallback(
      async (input: string, key: any) => {
        // ── input ─────────────────────────────────────────────────────────
        if (phase.type === "input") {
          if (key.ctrl && input === "c") { exit(); return; }

          // toggle raw mode
          if (key.ctrl && input === "r") {
            setPhase({ ...phase, raw: !phase.raw, value: "", cursor: 0 });
            return;
          }

          // history navigation
          if (key.upArrow) {
            const nextIdx = Math.min(phase.histIdx + 1, allNl.length - 1);
            const val = allNl[allNl.length - 1 - nextIdx] ?? "";
            setPhase({ ...phase, value: val, cursor: val.length, histIdx: nextIdx });
            return;
          }
          if (key.downArrow) {
            const nextIdx = Math.max(phase.histIdx - 1, -1);
            const val = nextIdx === -1 ? "" : allNl[allNl.length - 1 - nextIdx] ?? "";
            setPhase({ ...phase, value: val, cursor: val.length, histIdx: nextIdx });
            return;
          }

          // cursor movement
          if (key.leftArrow) {
            setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) });
            return;
          }
          if (key.rightArrow) {
            setPhase({ ...phase, cursor: Math.min(phase.value.length, phase.cursor + 1) });
            return;
          }

          // submit
          if (key.return) {
            const nl = phase.value.trim();
            if (!nl) return;
            setSessionNl((h) => [...h, nl]);

            if (phase.raw) {
              // raw mode — run directly
              setPhase({ type: "running", nl, command: nl });
              try {
                const { stdout, stderr } = await execAsync(nl, { shell: "/bin/zsh" });
                const output = (stdout + stderr).trim();
                pushScroll({ nl, cmd: nl, output });
                appendHistory({ nl, cmd: nl, output, ts: Date.now() });
              } catch (e: any) {
                const output = ((e.stdout ?? "") + (e.stderr ?? "")).trim() || e.message;
                pushScroll({ nl, cmd: nl, output, error: true });
                appendHistory({ nl, cmd: nl, output, ts: Date.now(), error: true });
              }
              inputPhase({ raw: true });
              return;
            }

            setPhase({ type: "thinking", nl, raw: false });
            try {
              const command = await translateToCommand(nl, config.permissions);
              const blocked = checkPermissions(command, config.permissions);
              if (blocked) {
                pushScroll({ nl, cmd: command, output: `blocked: ${blocked}`, error: true });
                inputPhase();
                return;
              }
              setPhase({ type: "confirm", nl, command, raw: false });
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

          // explain
          if (input === "?") {
            const { nl, command } = phase;
            setPhase({ type: "thinking", nl, raw: false });
            try {
              const explanation = await explainCommand(command);
              setPhase({ type: "explain", nl, command, explanation });
            } catch {
              setPhase({ type: "confirm", nl, command, raw: false });
            }
            return;
          }

          if (input === "y" || input === "Y" || key.return) {
            const { nl, command } = phase;
            setPhase({ type: "running", nl, command });
            try {
              const { stdout, stderr } = await execAsync(command, { shell: "/bin/zsh" });
              const output = (stdout + stderr).trim();
              pushScroll({ nl, cmd: command, output });
              appendHistory({ nl, cmd: command, output, ts: Date.now() });
              inputPhase();
            } catch (e: any) {
              const output = ((e.stdout ?? "") + (e.stderr ?? "")).trim() || e.message;
              pushScroll({ nl, cmd: command, output, error: true });
              appendHistory({ nl, cmd: command, output, ts: Date.now(), error: true });
              inputPhase();
            }
            return;
          }
          if (input === "n" || input === "N" || key.escape) { inputPhase(); return; }
          if (input === "e" || input === "E") {
            setPhase({ type: "input", value: phase.command, cursor: phase.command.length, histIdx: -1, raw: false });
            return;
          }
          return;
        }

        // ── explain ───────────────────────────────────────────────────────
        if (phase.type === "explain") {
          if (key.ctrl && input === "c") { exit(); return; }
          // any key → back to confirm
          setPhase({ type: "confirm", nl: phase.nl, command: phase.command, raw: false });
          return;
        }

        // ── error ─────────────────────────────────────────────────────────
        if (phase.type === "error") {
          if (key.ctrl && input === "c") { exit(); return; }
          inputPhase();
          return;
        }
      },
      [phase, allNl, config, exit]
    )
  );

  // ── onboarding ─────────────────────────────────────────────────────────────
  if (!config.onboarded) {
    return <Onboarding onDone={finishOnboarding} />;
  }

  // ── render ─────────────────────────────────────────────────────────────────
  const isRaw = phase.type === "input" && phase.raw;

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
          {entry.output && (
            <Box paddingLeft={4}>
              <Text color={entry.error ? "red" : undefined}>{entry.output}</Text>
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

      {/* spinner states */}
      {phase.type === "thinking" && <Spinner label="translating" />}
      {phase.type === "running" && (
        <Box flexDirection="column" paddingLeft={2}>
          <Box gap={2}>
            <Text dimColor>$</Text>
            <Text dimColor>{phase.command}</Text>
          </Box>
          <Spinner label="running" />
        </Box>
      )}

      {/* error */}
      {phase.type === "error" && (
        <Box paddingLeft={2}>
          <Text color="red">{phase.message}</Text>
        </Box>
      )}

      {/* input line */}
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

      {/* status bar */}
      <StatusBar permissions={config.permissions} />

    </Box>
  );
}
