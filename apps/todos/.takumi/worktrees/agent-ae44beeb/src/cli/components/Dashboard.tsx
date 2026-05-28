import { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { getDatabase } from "../../db/database.js";
import { listAgents } from "../../db/agents.js";
import { countTasks } from "../../db/tasks.js";
import { getRecap, type RecapSummary } from "../../db/audit.js";

interface DashboardProps {
  projectId?: string;
  refreshMs?: number;
}

function AgentStatus({ name, lastSeen, sessionId }: { name: string; lastSeen: string; sessionId: string | null }) {
  const ago = Math.round((Date.now() - new Date(lastSeen).getTime()) / 60000);
  const color = ago < 5 ? "green" : ago < 15 ? "yellow" : "red";
  const symbol = ago < 5 ? "●" : ago < 15 ? "◐" : "○";
  return (
    <Box>
      <Text color={color}>{symbol} </Text>
      <Text bold>{name}</Text>
      <Text dimColor> {ago}m ago</Text>
      {sessionId && <Text dimColor> [{sessionId.slice(0, 8)}]</Text>}
    </Box>
  );
}

export function Dashboard({ projectId, refreshMs = 2000 }: DashboardProps) {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  const [recap, setRecap] = useState<RecapSummary | null>(null);
  const [counts, setCounts] = useState({ pending: 0, in_progress: 0, completed: 0, failed: 0, total: 0 });
  const [agents, setAgents] = useState<any[]>([]);

  useInput((input) => {
    if (input === "q" || input === "Q") exit();
  });

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);

  useEffect(() => {
    try {
      const db = getDatabase();
      const filters = projectId ? { project_id: projectId } : {};
      const pending = countTasks({ ...filters, status: "pending" }, db);
      const in_progress = countTasks({ ...filters, status: "in_progress" }, db);
      const completed = countTasks({ ...filters, status: "completed" }, db);
      const failed = countTasks({ ...filters, status: "failed" }, db);
      setCounts({ pending, in_progress, completed, failed, total: pending + in_progress + completed + failed });
      setAgents(listAgents());
      setRecap(getRecap(1, projectId, db));
    } catch {}
  }, [tick, projectId]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan"> todos dashboard </Text>
        <Text dimColor>| refreshing every {refreshMs / 1000}s | press q to quit</Text>
      </Box>

      {/* Task counts */}
      <Box marginBottom={1}>
        <Text color="yellow">{counts.pending} pending</Text>
        <Text dimColor> | </Text>
        <Text color="blue">{counts.in_progress} active</Text>
        <Text dimColor> | </Text>
        <Text color="green">{counts.completed} done</Text>
        <Text dimColor> | </Text>
        <Text color="red">{counts.failed} failed</Text>
        <Text dimColor> | </Text>
        <Text>{counts.total} total</Text>
      </Box>

      {/* Agents */}
      {agents.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Agents ({agents.length}):</Text>
          {agents.map(a => (
            <AgentStatus key={a.id} name={a.name} lastSeen={a.last_seen_at} sessionId={a.session_id} />
          ))}
        </Box>
      )}

      {/* Active work */}
      {recap && recap.in_progress.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="blue">In Progress ({recap.in_progress.length}):</Text>
          {recap.in_progress.slice(0, 8).map(t => (
            <Box key={t.id}>
              <Text color="cyan">{t.short_id || t.id.slice(0, 8)} </Text>
              <Text>{t.title}</Text>
              {t.assigned_to && <Text dimColor> — {t.assigned_to}</Text>}
            </Box>
          ))}
        </Box>
      )}

      {/* Recent completions */}
      {recap && recap.completed.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">Completed (last 1h: {recap.completed.length}):</Text>
          {recap.completed.slice(0, 5).map(t => (
            <Box key={t.id}>
              <Text color="green">✓ </Text>
              <Text color="cyan">{t.short_id || t.id.slice(0, 8)} </Text>
              <Text>{t.title}</Text>
              {t.duration_minutes != null && <Text dimColor> ({t.duration_minutes}m)</Text>}
            </Box>
          ))}
        </Box>
      )}

      {/* Stale warning */}
      {recap && recap.stale.length > 0 && (
        <Box flexDirection="column">
          <Text bold color="red">Stale ({recap.stale.length}):</Text>
          {recap.stale.slice(0, 3).map(t => (
            <Box key={t.id}>
              <Text color="red">! </Text>
              <Text color="cyan">{t.short_id || t.id.slice(0, 8)} </Text>
              <Text>{t.title}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
