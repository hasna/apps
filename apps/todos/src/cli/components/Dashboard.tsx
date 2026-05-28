import { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { createTuiDashboardSnapshot, TUI_DASHBOARD_VIEWS, type TuiDashboardSnapshot, type TuiDashboardView } from "../../lib/tui-dashboard.js";

interface DashboardProps {
  projectId?: string;
  refreshMs?: number;
  readOnly?: boolean;
  agentId?: string;
}

export function Dashboard({ projectId, refreshMs = 2000 }: DashboardProps) {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  const [activeView, setActiveView] = useState<TuiDashboardView>("overview");
  const [snapshot, setSnapshot] = useState<TuiDashboardSnapshot | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typingSearch, setTypingSearch] = useState(false);

  useInput((input, key) => {
    if (input === "q" || input === "Q") {
      if (typingSearch) {
        setTypingSearch(false);
        return;
      }
      exit();
      return;
    }
    if (typingSearch) {
      if (key.return) {
        setSearchQuery(searchDraft);
        setActiveView("search");
        setTypingSearch(false);
      } else if (key.escape) {
        setTypingSearch(false);
      } else if (key.backspace || key.delete) {
        setSearchDraft(value => value.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setSearchDraft(value => value + input);
      }
      return;
    }
    if (input === "r" || input === "R") {
      setTick(t => t + 1);
    } else if (input === "/" ) {
      setTypingSearch(true);
      setActiveView("search");
    } else if (key.leftArrow || input === "h") {
      setActiveView(current => {
        const index = TUI_DASHBOARD_VIEWS.indexOf(current);
        return TUI_DASHBOARD_VIEWS[(index + TUI_DASHBOARD_VIEWS.length - 1) % TUI_DASHBOARD_VIEWS.length]!;
      });
    } else if (key.rightArrow || input === "l") {
      setActiveView(current => {
        const index = TUI_DASHBOARD_VIEWS.indexOf(current);
        return TUI_DASHBOARD_VIEWS[(index + 1) % TUI_DASHBOARD_VIEWS.length]!;
      });
    } else if (/^[1-8]$/.test(input)) {
      setActiveView(TUI_DASHBOARD_VIEWS[Number(input) - 1]!);
    } else if (input === "p") {
      setActiveView("projects");
    } else if (input === "t") {
      setActiveView("tasks");
    } else if (input === "n") {
      setActiveView("plans");
    } else if (input === "u") {
      setActiveView("runs");
    } else if (input === "d") {
      setActiveView("dependencies");
    } else if (input === "i") {
      setActiveView("inbox");
    } else if (input === "o") {
      setActiveView("overview");
    }
  });

  if (!data) {
    return <Text dimColor>Loading dashboard...</Text>;
  }

  useEffect(() => {
    try {
      setSnapshot(createTuiDashboardSnapshot({ project_id: projectId, active_view: activeView, search: searchQuery }));
    } catch {}
  }, [tick, projectId, activeView, searchQuery]);

  const counts = snapshot?.counts || { pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0, total: 0 };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan"> todos dashboard </Text>
        <Text dimColor>| local TUI | refresh {refreshMs / 1000}s | q quit | r refresh | h/l tabs | / search</Text>
      </Box>

      <Box marginBottom={1}>
        {TUI_DASHBOARD_VIEWS.map((view, index) => (
          <Text key={view} color={view === activeView ? "cyan" : undefined} bold={view === activeView}>
            {index + 1}:{view}{" "}
          </Text>
        ))}
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

      {typingSearch && (
        <Box marginBottom={1}>
          <Text dimColor>Search: </Text>
          <Text color="cyan">{searchDraft}▌</Text>
          <Text dimColor> [enter] run [esc] cancel</Text>
        </Box>
      )}

      {snapshot && <DashboardSection snapshot={snapshot} activeView={activeView} />}
    </Box>
  );
}

function DashboardSection({ snapshot, activeView }: { snapshot: TuiDashboardSnapshot; activeView: TuiDashboardView }) {
  if (activeView === "overview") {
    return (
      <Box flexDirection="column">
        <Text bold>Overview</Text>
        <Text dimColor>Use p projects, t tasks, n plans, u runs, d dependencies, i inbox, / search.</Text>
        <Text>Projects: {snapshot.projects.length} visible</Text>
        <Text>Plans: {snapshot.plans.length} visible</Text>
        <Text>Runs: {snapshot.runs.length} visible</Text>
        <Text>Inbox: {snapshot.inbox.length} recent</Text>
      </Box>
    );
  }
  if (activeView === "projects") {
    return <Rows title="Projects" rows={snapshot.projects.map(project => `${project.id.slice(0, 8)} ${project.name} (${project.open_tasks} open) ${project.path}`)} />;
  }
  if (activeView === "tasks") {
    return <Rows title="Tasks" rows={snapshot.tasks.map(task => `${task.id.slice(0, 8)} [${task.status}] ${task.priority} ${task.title}`)} />;
  }
  if (activeView === "plans") {
    return <Rows title="Plans" rows={snapshot.plans.map(plan => `${plan.id.slice(0, 8)} [${plan.status}] ${plan.name} (${plan.open_tasks} open)`)} />;
  }
  if (activeView === "runs") {
    return <Rows title="Runs" rows={snapshot.runs.map(run => `${run.id.slice(0, 8)} [${run.status}] ${run.title || run.task_id}`)} />;
  }
  if (activeView === "dependencies") {
    return <Rows title="Dependencies" rows={snapshot.dependencies.map(dep => `${dep.task_id.slice(0, 8)} waits on ${dep.depends_on.slice(0, 8)} [${dep.depends_on_status}]${dep.blocking ? " blocking" : ""}`)} />;
  }
  if (activeView === "inbox") {
    return <Rows title="Inbox" rows={snapshot.inbox.map(item => `${item.id.slice(0, 8)} [${item.status}] ${item.title}`)} />;
  }
  return <Rows title={`Search: ${snapshot.search.query || "(none)"}`} rows={snapshot.search.results.map(task => `${task.id.slice(0, 8)} [${task.status}] ${task.title}`)} empty="Press / to type a local search." />;
}

function Rows({ title, rows, empty = "No local records." }: { title: string; rows: string[]; empty?: string }) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {rows.length === 0 ? <Text dimColor>{empty}</Text> : rows.map(row => <Text key={row}>{row}</Text>)}
    </Box>
  );
}
