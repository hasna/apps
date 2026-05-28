import { Box, Text } from "ink";
import type { Task } from "../../types/index.js";

interface TaskListProps {
  tasks: Task[];
  selectedIndex: number;
}

const statusIcons: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  failed: "✗",
  cancelled: "—",
};

const statusColors: Record<string, string> = {
  pending: "yellow",
  in_progress: "blue",
  completed: "green",
  failed: "red",
  cancelled: "gray",
};

const priorityLabels: Record<string, string> = {
  critical: "!!!",
  high: "!! ",
  medium: "!  ",
  low: "   ",
};

const priorityColors: Record<string, string> = {
  critical: "red",
  high: "red",
  medium: "yellow",
  low: "gray",
};

export function TaskList({ tasks, selectedIndex }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <Box marginLeft={2}>
        <Text dimColor>No tasks. Press [a] to add one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {tasks.map((task, index) => {
        const isSelected = index === selectedIndex;
        const icon = statusIcons[task.status] || "?";
        const color = statusColors[task.status] || "white";
        const pLabel = priorityLabels[task.priority] || "   ";
        const pColor = priorityColors[task.priority] || "white";

        return (
          <Box key={task.id}>
            <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
              {isSelected ? "❯ " : "  "}
            </Text>
            <Text color={color}>{icon} </Text>
            <Text color={pColor}>{pLabel} </Text>
            <Text dimColor>{task.id.slice(0, 8)} </Text>
            <Text
              bold={isSelected}
              strikethrough={task.status === "completed" || task.status === "cancelled"}
            >
              {task.title}
            </Text>
            {task.assigned_to && (
              <Text color="cyan"> → {task.assigned_to}</Text>
            )}
            {task.locked_by && (
              <Text color="magenta"> 🔒{task.locked_by}</Text>
            )}
            {task.tags.length > 0 && (
              <Text dimColor> [{task.tags.join(",")}]</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
