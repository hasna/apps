import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { exec } from "child_process";
import { promisify } from "util";
import { translateToCommand, checkPermissions } from "./ai.js";
import {
  loadHistory,
  appendHistory,
  loadConfig,
  saveConfig,
  type HistoryEntry,
  type Permissions,
} from "./history.js";
import Onboarding from "./Onboarding.js";

const execAsync = promisify(exec);

type Phase =
  | { type: "input"; value: string; histIdx: number }
  | { type: "thinking"; nl: string }
  | { type: "confirm"; nl: string; command: string }
  | { type: "running"; nl: string; command: string }
  | { type: "error"; message: string };

interface ScrollEntry {
  nl: string;
  cmd: string;
  output: string;
  error?: boolean;
}

export default function App() {
  const { exit } = useApp();
  const [config, setConfig] = useState(() => loadConfig());
  const [nlHistory] = useState<string[]>(() =>
    loadHistory().map((h) => h.nl).filter(Boolean)
  );
  const [sessionNl, setSessionNl] = useState<string[]>([]);
  const [scroll, setScroll] = useState<ScrollEntry[]>([]);
  const [phase, setPhase] = useState<Phase>({ type: "input", value: "", histIdx: -1 });

  const allNl = [...nlHistory, ...sessionNl];

  const finishOnboarding = (perms: Permissions) => {
    const next = { onboarded: true, permissions: perms };
    setConfig(next);
    saveConfig(next);
  };

  const pushScroll = (entry: ScrollEntry) => setScroll((s) => [...s, entry]);

  useInput(
    useCallback(
      async (input: string, key: any) => {
        if (phase.type === "input") {
          if (key.ctrl && input === "c") { exit(); return; }

          if (key.upArrow) {
            const nextIdx = Math.min(phase.histIdx + 1, allNl.length - 1);
            const val = allNl[allNl.length - 1 - nextIdx] ?? "";
            setPhase({ type: "input", value: val, histIdx: nextIdx });
            return;
          }
          if (key.downArrow) {
            const nextIdx = Math.max(phase.histIdx - 1, -1);
            const val = nextIdx === -1 ? "" : allNl[allNl.length - 1 - nextIdx] ?? "";
            setPhase({ type: "input", value: val, histIdx: nextIdx });
            return;
          }
          if (key.return) {
            const nl = phase.value.trim();
            if (!nl) return;
            setSessionNl((h) => [...h, nl]);
            setPhase({ type: "thinking", nl });
            try {
              const command = await translateToCommand(nl, config.permissions);
              // Local permission guard on the returned command
              const blocked = checkPermissions(command, config.permissions);
              if (blocked) {
                pushScroll({ nl, cmd: command, output: `blocked: ${blocked}`, error: true });
                setPhase({ type: "input", value: "", histIdx: -1 });
                return;
              }
              setPhase({ type: "confirm", nl, command });
            } catch (e: any) {
              setPhase({ type: "error", message: e.message });
            }
            return;
          }
          if (key.backspace || key.delete) {
            setPhase({ ...phase, value: phase.value.slice(0, -1), histIdx: -1 });
            return;
          }
          if (input && !key.ctrl && !key.meta) {
            setPhase({ ...phase, value: phase.value + input, histIdx: -1 });
          }
          return;
        }

        if (phase.type === "confirm") {
          if (key.ctrl && input === "c") { exit(); return; }
          if (input === "y" || input === "Y" || key.return) {
            const { nl, command } = phase;
            setPhase({ type: "running", nl, command });
            try {
              const { stdout, stderr } = await execAsync(command, { shell: "/bin/zsh" });
              const output = (stdout + stderr).trim();
              pushScroll({ nl, cmd: command, output });
              appendHistory({ nl, cmd: command, output, ts: Date.now() });
              setPhase({ type: "input", value: "", histIdx: -1 });
            } catch (e: any) {
              const output = ((e.stdout ?? "") + (e.stderr ?? "")).trim() || e.message;
              pushScroll({ nl, cmd: command, output, error: true });
              appendHistory({ nl, cmd: command, output, ts: Date.now(), error: true });
              setPhase({ type: "input", value: "", histIdx: -1 });
            }
            return;
          }
          if (input === "n" || input === "N" || key.escape) {
            setPhase({ type: "input", value: "", histIdx: -1 });
            return;
          }
          if (input === "e" || input === "E") {
            setPhase({ type: "input", value: phase.command, histIdx: -1 });
            return;
          }
          return;
        }

        if (phase.type === "error") {
          if (key.ctrl && input === "c") { exit(); return; }
          setPhase({ type: "input", value: "", histIdx: -1 });
          return;
        }
      },
      [phase, allNl, config, exit]
    )
  );

  if (!config.onboarded) {
    return <Onboarding onDone={finishOnboarding} />;
  }

  return (
    <Box flexDirection="column">
      {scroll.map((entry, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Box gap={1}>
            <Text dimColor>›</Text>
            <Text dimColor>{entry.nl}</Text>
          </Box>
          <Box gap={1}>
            <Text dimColor>$</Text>
            <Text>{entry.cmd}</Text>
          </Box>
          {entry.output && (
            <Text color={entry.error ? "red" : undefined}>{entry.output}</Text>
          )}
        </Box>
      ))}

      {phase.type === "input" && (
        <Box gap={1}>
          <Text dimColor>›</Text>
          <Text>{phase.value}</Text>
          <Text inverse> </Text>
        </Box>
      )}

      {phase.type === "thinking" && (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text dimColor>›</Text>
            <Text dimColor>{phase.nl}</Text>
          </Box>
          <Text dimColor>  translating…</Text>
        </Box>
      )}

      {phase.type === "confirm" && (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text dimColor>›</Text>
            <Text dimColor>{phase.nl}</Text>
          </Box>
          <Box gap={1}>
            <Text dimColor>$</Text>
            <Text>{phase.command}</Text>
          </Box>
          <Text dimColor>  [enter] run  [n] cancel  [e] edit</Text>
        </Box>
      )}

      {phase.type === "running" && (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text dimColor>$</Text>
            <Text>{phase.command}</Text>
          </Box>
          <Text dimColor>  running…</Text>
        </Box>
      )}

      {phase.type === "error" && (
        <Box flexDirection="column">
          <Text color="red">  {phase.message}</Text>
          <Text dimColor>  press any key</Text>
        </Box>
      )}
    </Box>
  );
}
