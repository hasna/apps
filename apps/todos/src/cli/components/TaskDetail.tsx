import { Box, Text } from "ink";
import type { TaskWithRelations } from "../../types/index.js";

interface TaskDetailProps {
  task: TaskWithRelations;
}

const statusColors: Record<string, string> = {
  pending: "yellow",
  in_progress: "blue",
  completed: "green",
  failed: "red",
  cancelled: "gray",
};

export function TaskDetail({ task }: TaskDetailProps) {
  const sColor = statusColors[task.status] || "white";

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box marginBottom={1}>
        <Text dimColor>[esc] back  [e] edit  [d] done  [s] start  [c] comment</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>{"ID:       "}</Text>
          <Text>{task.id}</Text>
        </Box>
        <Box>
          <Text dimColor>{"Title:    "}</Text>
          <Text bold>{task.title}</Text>
        </Box>
        <Box>
          <Text dimColor>{"Status:   "}</Text>
          <Text color={sColor}>{task.status}</Text>
        </Box>
        <Box>
          <Text dimColor>{"Priority: "}</Text>
          <Text>{task.priority}</Text>
        </Box>
        {task.description && (
          <Box>
            <Text dimColor>{"Desc:     "}</Text>
            <Text>{task.description}</Text>
          </Box>
        )}
        {task.agent_id && (
          <Box>
            <Text dimColor>{"Agent:    "}</Text>
            <Text color="cyan">{task.agent_id}</Text>
          </Box>
        )}
        {task.session_id && (
          <Box>
            <Text dimColor>{"Session:  "}</Text>
            <Text>{task.session_id}</Text>
          </Box>
        )}
        {task.assigned_to && (
          <Box>
            <Text dimColor>{"Assigned: "}</Text>
            <Text color="cyan">{task.assigned_to}</Text>
          </Box>
        )}
        {task.project_id && (
          <Box>
            <Text dimColor>{"Project:  "}</Text>
            <Text>{task.project_id}</Text>
          </Box>
        )}
        {task.working_dir && (
          <Box>
            <Text dimColor>{"Work Dir: "}</Text>
            <Text>{task.working_dir}</Text>
          </Box>
        )}
        {task.locked_by && (
          <Box>
            <Text dimColor>{"Locked:   "}</Text>
            <Text color="magenta">{task.locked_by} (at {task.locked_at})</Text>
          </Box>
        )}
        {task.tags.length > 0 && (
          <Box>
            <Text dimColor>{"Tags:     "}</Text>
            <Text>{task.tags.join(", ")}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>{"Version:  "}</Text>
          <Text>{task.version}</Text>
        </Box>
        <Box>
          <Text dimColor>{"Created:  "}</Text>
          <Text>{task.created_at}</Text>
        </Box>
        {task.completed_at && (
          <Box>
            <Text dimColor>{"Done:     "}</Text>
            <Text>{task.completed_at}</Text>
          </Box>
        )}
      </Box>

      {task.subtasks.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Subtasks ({task.subtasks.length}):</Text>
          {task.subtasks.map((st) => (
            <Box key={st.id} marginLeft={2}>
              <Text color={statusColors[st.status] || "white"}>
                {st.status === "completed" ? "●" : "○"}{" "}
              </Text>
              <Text dimColor>{st.id.slice(0, 8)} </Text>
              <Text>{st.title}</Text>
            </Box>
          ))}
        </Box>
      )}

      {task.dependencies.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Depends on ({task.dependencies.length}):</Text>
          {task.dependencies.map((dep) => (
            <Box key={dep.id} marginLeft={2}>
              <Text dimColor>{dep.id.slice(0, 8)} </Text>
              <Text color={statusColors[dep.status] || "white"}>[{dep.status}] </Text>
              <Text>{dep.title}</Text>
            </Box>
          ))}
        </Box>
      )}

      {task.blocked_by.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Blocks ({task.blocked_by.length}):</Text>
          {task.blocked_by.map((b) => (
            <Box key={b.id} marginLeft={2}>
              <Text dimColor>{b.id.slice(0, 8)} </Text>
              <Text color={statusColors[b.status] || "white"}>[{b.status}] </Text>
              <Text>{b.title}</Text>
            </Box>
          ))}
        </Box>
      )}

      {task.comments.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Comments ({task.comments.length}):</Text>
          {task.comments.map((c) => (
            <Box key={c.id} marginLeft={2} flexDirection="column">
              <Box>
                {c.agent_id && <Text color="cyan">[{c.agent_id}] </Text>}
                <Text dimColor>{c.created_at}</Text>
              </Box>
              <Box marginLeft={2}>
                <Text>{c.content}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
