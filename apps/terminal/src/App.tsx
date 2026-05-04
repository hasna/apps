import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { spawn } from "child_process";
import { getShell } from "./shell.js";
import { translateToCommand, explainCommand, fixCommand, checkPermissions, isIrreversible, type SessionEntry } from "./ai.js";
import { loadHistory, appendHistory, loadConfig, saveConfig, type Permissions } from "./history.js";
import { loadCache } from "./cache.js";
import Onboarding from "./Onboarding.js";
import StatusBar from "./StatusBar.js";
import Spinner from "./Spinner.js";
import Browse from "./Browse.js";
import FuzzyPicker from "./FuzzyPicker.js";
import { createSession, endSession, logInteraction, updateInteraction } from "./sessions-db.js";
import { smartDisplay } from "./smart-display.js";
import { processOutput, shouldProcess } from "./output-processor.js";

loadCache();

// ── types ─────────────────────────────────────────────────────────────────────

type Phase =
  | { type: "input";   value: string; cursor: number; histIdx: number; raw: boolean }
  | { type: "thinking"; nl: string; partial: string }
  | { type: "confirm"; nl: string; command: string; danger: boolean }
  | { type: "explain"; nl: string; command: string; explanation: string }
  | { type: "running"; nl: string; command: string }
  | { type: "autofix"; nl: string; command: string; errorOutput: string }
  | { type: "error";   message: string }
  | { type: "browse";  cwd: string }
  | { type: "fuzzy" };

interface ScrollEntry {
  nl: string;
  cmd: string;
  lines: string[];
  truncated: boolean;
  expanded: boolean;
  error?: boolean;
  filePaths?: string[];   // detected file paths for navigable output
}

interface TabState {
  id: number;
  cwd: string;
  scroll: ScrollEntry[];
  sessionEntries: SessionEntry[];
  sessionNl: string[];
  phase: Phase;
  streamLines: string[];
}

const MAX_LINES = 20;

// ── helpers ───────────────────────────────────────────────────────────────────

function insertAt(s: string, pos: number, ch: string) { return s.slice(0, pos) + ch + s.slice(pos); }
function deleteAt(s: string, pos: number) { return pos <= 0 ? s : s.slice(0, pos - 1) + s.slice(pos); }

/** Detect if output lines look like file paths */
function extractFilePaths(lines: string[]): string[] {
  return lines.filter(l => /^\.?\//.test(l.trim()) || /\.(ts|tsx|js|json|md|py|sh|go|rs|txt|yaml|yml|env)$/.test(l.trim()));
}

/** Ghost text: find the best NL match that starts with the current input */
function ghostText(input: string, history: string[]): string {
  if (!input.trim()) return "";
  const lower = input.toLowerCase();
  const match = [...history].reverse().find(h => h.toLowerCase().startsWith(lower) && h.length > input.length);
  return match ? match.slice(input.length) : "";
}

/** Detect cd and change process cwd */
function maybeCd(command: string): string | null {
  const m = command.match(/^\s*cd\s+(.+)\s*$/);
  if (!m) return null;
  let target = m[1].trim().replace(/^['"]|['"]$/g, "");
  if (target.startsWith("~")) target = target.replace("~", process.env.HOME ?? "");
  return target;
}

function newTab(id: number, cwd: string): TabState {
  return {
    id, cwd,
    scroll: [], sessionEntries: [], sessionNl: [],
    phase: { type: "input", value: "", cursor: 0, histIdx: -1, raw: false },
    streamLines: [],
  };
}

function runCommand(
  command: string, cwd: string,
  onLine: (l: string) => void,
  onDone: (code: number) => void,
  signal: AbortSignal
) {
  const proc = spawn(getShell(), ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const handle = (d: Buffer) => d.toString().split("\n").forEach(l => { if (l) onLine(l); });
  proc.stdout?.on("data", handle);
  proc.stderr?.on("data", handle);
  proc.on("close", code => onDone(code ?? 0));
  signal.addEventListener("abort", () => { try { proc.kill("SIGTERM"); } catch {} });
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { exit } = useApp();
  const [config, setConfig] = useState(() => loadConfig());
  const [nlHistory] = useState<string[]>(() => loadHistory().map(h => h.nl).filter(Boolean));
  const [tabs, setTabs] = useState<TabState[]>([newTab(1, process.cwd())]);
  const [activeTab, setActiveTab] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  let nextTabId = useRef(2);
  const sessionIdRef = useRef<string>("");
  const interactionIdRef = useRef<number>(0);

  const tab = tabs[activeTab];
  const allNl = [...nlHistory, ...tab.sessionNl];

  // ── tab helpers ─────────────────────────────────────────────────────────────

  const updateTab = (updater: (t: TabState) => TabState) =>
    setTabs(ts => ts.map((t, i) => i === activeTab ? updater(t) : t));

  const setPhase = (phase: Phase) => updateTab(t => ({ ...t, phase }));
  const setStreamLines = (lines: string[]) => updateTab(t => ({ ...t, streamLines: lines }));

  const inputPhase = (overrides: Partial<Extract<Phase, { type: "input" }>> = {}) => {
    updateTab(t => ({
      ...t,
      streamLines: [],
      phase: { type: "input", value: "", cursor: 0, histIdx: -1, raw: false, ...overrides },
    }));
  };

  const pushScroll = (entry: Omit<ScrollEntry, "expanded">) =>
    updateTab(t => ({ ...t, scroll: [...t.scroll, { ...entry, expanded: false }] }));

  const commitStream = async (nl: string, cmd: string, lines: string[], error: boolean) => {
    const filePaths = !error ? extractFilePaths(lines) : [];
    // Smart display: first try pattern-based compression, then AI if still large
    let displayLines = !error && lines.length > 5 ? smartDisplay(lines) : lines;

    // AI-powered processing for large outputs (no hardcoded patterns)
    if (!error && shouldProcess(lines.join("\n"))) {
      try {
        const processed = await processOutput(cmd, lines.join("\n"));
        if (processed.aiProcessed && processed.tokensSaved > 50) {
          displayLines = processed.summary.split("\n");
        }
      } catch { /* fallback to smartDisplay result */ }
    }

    const truncated = displayLines.length > MAX_LINES;
    // Build short output summary for session context (first 10 lines of ORIGINAL output)
    const shortOutput = lines.slice(0, 10).join("\n") + (lines.length > 10 ? `\n... (${lines.length} lines total)` : "");
    const entry: SessionEntry = { nl, cmd, output: shortOutput, error: error || undefined };
    updateTab(t => ({
      ...t,
      streamLines: [],
      sessionEntries: [...t.sessionEntries.slice(-9), entry],
      scroll: [...t.scroll, {
        nl, cmd,
        lines: truncated ? displayLines.slice(0, MAX_LINES) : displayLines,
        truncated, expanded: false,
        error: error || undefined,
        filePaths: filePaths.length ? filePaths : undefined,
      }],
    }));
    appendHistory({ nl, cmd, output: lines.join("\n"), ts: Date.now(), error });
    // Log to SQLite session
    if (interactionIdRef.current) {
      updateInteraction(interactionIdRef.current, { output: shortOutput, exitCode: error ? 1 : 0 });
    }
  };

  // ── run command ─────────────────────────────────────────────────────────────

  const runPhase = async (nl: string, command: string, raw: boolean) => {
    setPhase({ type: "running", nl, command });
    updateTab(t => ({ ...t, streamLines: [] }));
    const abort = new AbortController();
    abortRef.current = abort;
    const lines: string[] = [];
    const cwd = tabs[activeTab].cwd;

    await new Promise<void>(resolve => {
      runCommand(command, cwd,
        line => { lines.push(line); setStreamLines([...lines]); },
        code => {
          // handle cd — update tab cwd
          const cdTarget = maybeCd(command);
          if (cdTarget) {
            try {
              const { resolve: resolvePath } = require("path");
              const newCwd = require("path").resolve(cwd, cdTarget);
              process.chdir(newCwd);
              updateTab(t => ({ ...t, cwd: newCwd }));
            } catch {}
          }
          commitStream(nl, command, lines, code !== 0).then(() => {
            abortRef.current = null;
            if (code !== 0 && !raw) {
              setPhase({ type: "autofix", nl, command, errorOutput: lines.join("\n") });
            } else {
              inputPhase({ raw });
            }
            resolve();
          });
        },
        abort.signal
      );
    });
  };

  // ── translate + run ─────────────────────────────────────────────────────────

  const translateAndRun = async (nl: string, raw: boolean) => {
    updateTab(t => ({ ...t, sessionNl: [...t.sessionNl, nl] }));

    // Lazy session creation — only when user actually types something
    if (!sessionIdRef.current) {
      sessionIdRef.current = createSession(process.cwd());
    }
    // Log interaction start
    const startTime = Date.now();
    interactionIdRef.current = logInteraction(sessionIdRef.current, { nl });

    if (raw) { await runPhase(nl, nl, true); return; }

    const sessionEntries = tabs[activeTab].sessionEntries;
    setPhase({ type: "thinking", nl, partial: "" });
    try {
      const command = await translateToCommand(nl, config.permissions, sessionEntries, partial =>
        setPhase({ type: "thinking", nl, partial })
      );
      // Update interaction with generated command
      updateInteraction(interactionIdRef.current, { command });
      const blocked = checkPermissions(command, config.permissions);
      if (blocked) {
        pushScroll({ nl, cmd: command, lines: [`blocked: ${blocked}`], truncated: false, error: true });
        inputPhase();
        return;
      }
      const danger = isIrreversible(command);
      if (!config.confirm && !danger) { await runPhase(nl, command, false); return; }
      setPhase({ type: "confirm", nl, command, danger });
    } catch (e: any) {
      setPhase({ type: "error", message: e.message });
    }
  };

  // ── input handler ───────────────────────────────────────────────────────────

  useInput(useCallback(async (input: string, key: any) => {
    const phase = tabs[activeTab].phase;

    // ── global: ctrl+c always exits ─────────────────────────────────────────
    if (key.ctrl && input === "c" && phase.type !== "running") { exit(); return; }

    // ── running: ctrl+c cancels ──────────────────────────────────────────────
    if (phase.type === "running") {
      if (key.ctrl && input === "c") { abortRef.current?.abort(); inputPhase(); }
      return;
    }

    // ── browse ───────────────────────────────────────────────────────────────
    if (phase.type === "browse") return; // handled by Browse component

    // ── fuzzy ────────────────────────────────────────────────────────────────
    if (phase.type === "fuzzy") return; // handled by FuzzyPicker component

    // ── input ────────────────────────────────────────────────────────────────
    if (phase.type === "input") {
      // global shortcuts
      if (key.ctrl && input === "l") { updateTab(t => ({ ...t, scroll: [] })); return; }
      if (key.ctrl && input === "b") { setPhase({ type: "browse", cwd: tab.cwd }); return; }
      if (key.ctrl && input === "r") { setPhase({ type: "fuzzy" }); return; }

      // tab management
      if (key.ctrl && input === "t") {
        const id = nextTabId.current++;
        setTabs(ts => [...ts, newTab(id, tab.cwd)]);
        setActiveTab(tabs.length); // new tab index
        return;
      }
      if (key.ctrl && input === "w") {
        if (tabs.length > 1) {
          setTabs(ts => ts.filter((_, i) => i !== activeTab));
          setActiveTab(i => Math.min(i, tabs.length - 2));
        }
        return;
      }
      if (key.tab) {
        setActiveTab(i => (i + 1) % tabs.length);
        return;
      }

      // history nav
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

      // cursor movement
      if (key.leftArrow)  { setPhase({ ...phase, cursor: Math.max(0, phase.cursor - 1) }); return; }
      if (key.rightArrow) {
        // right arrow at end → accept ghost text
        const ghost = ghostText(phase.value, allNl);
        if (phase.cursor === phase.value.length && ghost) {
          const full = phase.value + ghost;
          setPhase({ ...phase, value: full, cursor: full.length });
        } else {
          setPhase({ ...phase, cursor: Math.min(phase.value.length, phase.cursor + 1) });
        }
        return;
      }
      if (key.tab) {
        // tab → accept ghost text
        const ghost = ghostText(phase.value, allNl);
        if (ghost) {
          const full = phase.value + ghost;
          setPhase({ ...phase, value: full, cursor: full.length });
          return;
        }
      }

      if (key.return) {
        const nl = phase.value.trim();
        if (!nl) return;
        await translateAndRun(nl, phase.raw);
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

    // ── confirm ──────────────────────────────────────────────────────────────
    if (phase.type === "confirm") {
      if (input === "?") {
        const { nl, command } = phase;
        setPhase({ type: "thinking", nl, partial: "" });
        try {
          const explanation = await explainCommand(command);
          setPhase({ type: "explain", nl, command, explanation });
        } catch { setPhase({ type: "confirm", nl, command, danger: phase.danger }); }
        return;
      }
      if (input === "y" || input === "Y" || key.return) { await runPhase(phase.nl, phase.command, false); return; }
      if (input === "n" || input === "N" || key.escape)  { inputPhase(); return; }
      if (input === "e" || input === "E") {
        setPhase({ type: "input", value: phase.command, cursor: phase.command.length, histIdx: -1, raw: false });
        return;
      }
      return;
    }

    // ── explain ──────────────────────────────────────────────────────────────
    if (phase.type === "explain") {
      setPhase({ type: "confirm", nl: phase.nl, command: phase.command, danger: isIrreversible(phase.command) });
      return;
    }

    // ── autofix ──────────────────────────────────────────────────────────────
    if (phase.type === "autofix") {
      if (input === "y" || input === "Y" || key.return) {
        const { nl, command, errorOutput } = phase;
        setPhase({ type: "thinking", nl, partial: "" });
        try {
          const fixed = await fixCommand(nl, command, errorOutput, config.permissions, tab.sessionEntries);
          const danger = isIrreversible(fixed);
          if (!config.confirm && !danger) { await runPhase(nl, fixed, false); return; }
          setPhase({ type: "confirm", nl, command: fixed, danger });
        } catch (e: any) { setPhase({ type: "error", message: e.message }); }
        return;
      }
      inputPhase();
      return;
    }

    // ── error ────────────────────────────────────────────────────────────────
    if (phase.type === "error") { inputPhase(); return; }

  }, [tabs, activeTab, allNl, config, exit]));

  // ── onboarding ───────────────────────────────────────────────────────────────
  if (!config.onboarded) {
    return <Onboarding onDone={(perms: Permissions) => {
      const next = { onboarded: true, confirm: false, permissions: perms };
      setConfig(next);
      saveConfig(next);
    }} />;
  }

  const phase = tab.phase;
  const isRaw = phase.type === "input" && phase.raw;
  const ghost = phase.type === "input" ? ghostText(phase.value, allNl) : "";

  // ── browse overlay ────────────────────────────────────────────────────────
  if (phase.type === "browse") {
    return (
      <Box flexDirection="column">
        {tabs.length > 1 && <TabBar tabs={tabs} active={activeTab} />}
        <Browse
          cwd={phase.cwd}
          onCd={path => setPhase({ type: "browse", cwd: path })}
          onSelect={path => {
            // fill input with the path
            setPhase({ type: "input", value: path, cursor: path.length, histIdx: -1, raw: false });
          }}
          onExit={() => inputPhase()}
        />
        <StatusBar permissions={config.permissions} />
      </Box>
    );
  }

  // ── fuzzy overlay ──────────────────────────────────────────────────────────
  if (phase.type === "fuzzy") {
    return (
      <Box flexDirection="column">
        {tabs.length > 1 && <TabBar tabs={tabs} active={activeTab} />}
        <FuzzyPicker
          history={allNl}
          onSelect={nl => {
            setPhase({ type: "input", value: nl, cursor: nl.length, histIdx: -1, raw: false });
          }}
          onExit={() => inputPhase()}
        />
        <StatusBar permissions={config.permissions} />
      </Box>
    );
  }

  // ── main render ───────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">

      {/* tab bar — only shown when >1 tab */}
      {tabs.length > 1 && <TabBar tabs={tabs} active={activeTab} />}

      {/* scrollback */}
      {tab.scroll.map((entry, i) => (
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
              {(entry.expanded ? entry.lines : entry.lines).map((line, j) => (
                <Text key={j} color={entry.error ? "red" : undefined}>{line}</Text>
              ))}
              {entry.truncated && !entry.expanded && (
                <Text dimColor>  … more lines</Text>
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
            {phase.danger && <Text color="red">  ⚠ irreversible</Text>}
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
          <Box paddingLeft={4}><Text dimColor>{phase.explanation}</Text></Box>
          <Box paddingLeft={4}><Text dimColor>any key →</Text></Box>
        </Box>
      )}

      {/* autofix */}
      {phase.type === "autofix" && (
        <Box paddingLeft={2}>
          <Text dimColor>failed — retry with fix?  [enter / n]</Text>
        </Box>
      )}

      {/* thinking */}
      {phase.type === "thinking" && (
        phase.partial ? (
          <Box flexDirection="column" paddingLeft={2}>
            <Box gap={2}><Text dimColor>›</Text><Text dimColor>{phase.nl}</Text></Box>
            <Box gap={2} paddingLeft={2}><Text dimColor>$</Text><Text dimColor>{phase.partial}</Text></Box>
          </Box>
        ) : <Spinner label="translating" />
      )}

      {/* running */}
      {phase.type === "running" && (
        <Box flexDirection="column" paddingLeft={2}>
          <Box gap={2}><Text dimColor>$</Text><Text dimColor>{phase.command}</Text></Box>
          <Box flexDirection="column" paddingLeft={2}>
            {tab.streamLines.slice(-MAX_LINES).map((l, i) => <Text key={i}>{l}</Text>)}
          </Box>
          <Spinner label="ctrl+c to cancel" />
        </Box>
      )}

      {/* error */}
      {phase.type === "error" && (
        <Box paddingLeft={2}><Text color="red">{phase.message}</Text></Box>
      )}

      {/* input with ghost text */}
      {phase.type === "input" && (
        <Box gap={2} paddingLeft={2}>
          <Text dimColor>{isRaw ? "$" : "›"}</Text>
          <Box>
            <Text>{phase.value.slice(0, phase.cursor)}</Text>
            <Text inverse>{phase.value[phase.cursor] ?? " "}</Text>
            <Text>{phase.value.slice(phase.cursor + 1)}</Text>
            {ghost && phase.cursor === phase.value.length && (
              <Text dimColor>{ghost}</Text>
            )}
          </Box>
        </Box>
      )}

      <StatusBar permissions={config.permissions} cwd={tab.cwd} />
    </Box>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────────

function TabBar({ tabs, active }: { tabs: TabState[]; active: number }) {
  return (
    <Box gap={1} paddingLeft={2} marginBottom={1}>
      {tabs.map((t, i) => {
        const label = ` ${i + 1} `;
        const cwd = t.cwd.split("/").pop() || t.cwd;
        return (
          <Box key={t.id}>
            {i === active
              ? <Text inverse>{label}{cwd}</Text>
              : <Text dimColor>{label}{cwd}</Text>
            }
          </Box>
        );
      })}
      <Text dimColor>  ctrl+t new  tab switch  ctrl+w close</Text>
    </Box>
  );
}
