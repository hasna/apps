import { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  initialDashboardState,
  reduceDashboardState,
  loadDashboardData,
  clampSelectedIndex,
  executeDashboardTaskAction,
  KEYBOARD_HELP,
  type DashboardState,
  type DashboardData,
} from "../../lib/tui-dashboard.js";

interface DashboardProps {
  projectId?: string;
  refreshMs?: number;
  readOnly?: boolean;
  agentId?: string;
}

export function Dashboard({ projectId, refreshMs = 2000, readOnly = false, agentId = "tui" }: DashboardProps) {
  const { exit } = useApp();
  const [state, setState] = useState<DashboardState>(() => initialDashboardState({ projectId, readOnly }));
  const [data, setData] = useState<DashboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    try {
      const loaded = loadDashboardData(state);
      setData(loaded);
      setState((s) => clampSelectedIndex(s, loaded));
    } catch {
      /* db unavailable */
    }
  }, [state]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(refresh, refreshMs);
    return () => clearInterval(timer);
  }, [refresh, refreshMs]);

  useInput((input, key) => {
    if (input === "q" || input === "Q") exit();
    if (input === "r") refresh();
    if (key.tab && key.shift) setState((s) => reduceDashboardState(s, { type: "panel_prev" }));
    else if (key.tab) setState((s) => reduceDashboardState(s, { type: "panel_next" }));
    if (input === "f") {
      const filters = ["all", "pending", "in_progress", "blocked", "ready"] as const;
      setState((s) => {
        const next = filters[(filters.indexOf(s.filter) + 1) % filters.length]!;
        return reduceDashboardState(s, { type: "set_filter", filter: next });
      });
    }
    if (key.upArrow || input === "k") setState((s) => reduceDashboardState(s, { type: "nav_up" }));
    if (key.downArrow || input === "j") setState((s) => reduceDashboardState(s, { type: "nav_down" }));

    if (input === "c") {
      const { result, error } = executeDashboardTaskAction(state, "claim", { agentId });
      setMessage(error ?? result);
      refresh();
    }
    if (input === "s") {
      const { result, error } = executeDashboardTaskAction(state, "start", { agentId });
      setMessage(error ?? result);
      refresh();
    }
    if (input === "d") {
      const { result, error } = executeDashboardTaskAction(state, "done", { agentId });
      setMessage(error ?? result);
      refresh();
    }
    if (input === "m") {
      const { result, error } = executeDashboardTaskAction(state, "comment", { agentId, comment: "TUI dashboard note" });
      setMessage(error ?? result);
      refresh();
    }
  });

  if (!data) {
    return <Text dimColor>Loading dashboard...</Text>;
  }

  const list = state.panel === "blockers" ? data.blocked
    : state.panel === "plans" ? data.plans
    : state.panel === "agents" ? data.agents
    : data.tasks;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan"> todos dashboard </Text>
        <Text dimColor>| panel:{state.panel} filter:{state.filter}</Text>
        {state.readOnly && <Text color="yellow"> [READ-ONLY]</Text>}
        <Text dimColor> | q quit</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="yellow">{data.counts.pending} pending</Text>
        <Text dimColor> | </Text>
        <Text color="blue">{data.counts.in_progress} active</Text>
        <Text dimColor> | </Text>
        <Text color="green">{data.counts.completed} done</Text>
        <Text dimColor> | </Text>
        <Text color="red">{data.blocked.length} blocked</Text>
        <Text dimColor> | </Text>
        <Text>{data.runs_active} runs</Text>
      </Box>

      {state.panel === "overview" && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Active work:</Text>
          {data.in_progress_titles.slice(0, 6).map((t) => (
            <Text key={t}>  ▶ {t}</Text>
          ))}
          <Text bold>Ready ({data.ready.length}):</Text>
          {data.ready.slice(0, 4).map((t) => (
            <Text key={t.id}>  ○ {t.short_id || t.id.slice(0, 8)} {t.title}</Text>
          ))}
        </Box>
      )}

      {state.panel !== "overview" && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{state.panel} ({list.length})</Text>
          {list.slice(0, 12).map((item, i) => {
            const selected = i === state.selectedIndex;
            const label = "title" in item ? `${(item as { short_id?: string; id: string; title: string }).short_id || item.id.slice(0, 8)} ${(item as { title: string }).title}`
              : "name" in item ? `${(item as { name: string }).name} (${(item as { status?: string }).status ?? ""})`
              : String(item);
            return (
              <Text key={item.id} inverse={selected}>{selected ? "> " : "  "}{label}</Text>
            );
          })}
        </Box>
      )}

      {message && <Text color="magenta">{message}</Text>}

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{KEYBOARD_HELP.slice(0, 4).join(" | ")}</Text>
      </Box>
    </Box>
  );
}
