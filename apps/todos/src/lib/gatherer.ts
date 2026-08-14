// Training data gatherer for @hasna/todos
// Used by open-brains to collect fine-tuning examples from task data

import type { Task } from "../types/index.js";
import { listTasks } from "../db/tasks.js";

type GatherTrainingDataFn = (options?: {
  limit?: number;
  since?: Date;
}) => Promise<{
  source: string;
  examples: Array<{
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  }>;
  count: number;
}>;

const SYSTEM_PROMPT =
  "You are a task management assistant that creates, updates, and tracks tasks and projects.";

function taskToCreateExample(task: Task): {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
} {
  const userMsg = `Create a task: ${task.title}${task.description ? `\n\nDescription: ${task.description}` : ""}`;
  const taskDetails = {
    id: task.short_id ?? task.id,
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    tags: task.tags,
    created_at: task.created_at,
  };
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
      {
        role: "assistant",
        content: `Created task: ${JSON.stringify(taskDetails, null, 2)}`,
      },
    ],
  };
}

function taskToStatusUpdateExample(
  task: Task
): {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
} | null {
  if (!task.completed_at && task.status === "pending") return null;
  const id = task.short_id ?? task.id;
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Mark task ${id} as ${task.status}` },
      {
        role: "assistant",
        content: `Task ${id} has been updated to status: ${task.status}. ${task.completed_at ? `Completed at: ${task.completed_at}` : ""}`.trim(),
      },
    ],
  };
}

function taskToSearchExample(
  tasks: Task[],
  query: string
): {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
} {
  const matched = tasks
    .filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 5);
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Search tasks for: "${query}"` },
      {
        role: "assistant",
        content:
          matched.length > 0
            ? `Found ${matched.length} task(s):\n${matched
                .map(
                  (t) =>
                    `- [${t.short_id ?? t.id}] ${t.title} (${t.status})`
                )
                .join("\n")}`
            : `No tasks found matching "${query}".`,
      },
    ],
  };
}

export const gatherTrainingData: GatherTrainingDataFn = async (
  options = {}
) => {
  const allTasks = listTasks({});

  // Apply since filter
  const filtered = options.since
    ? allTasks.filter(
        (t) => new Date(t.created_at) >= options.since!
      )
    : allTasks;

  // Sort by created_at desc
  const sorted = filtered
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const fetchSet = options.limit
    ? sorted.slice(0, options.limit * 2)
    : sorted;

  const examples: Array<{
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
  }> = [];

  for (const task of fetchSet) {
    examples.push(taskToCreateExample(task));
    const statusEx = taskToStatusUpdateExample(task);
    if (statusEx) examples.push(statusEx);
  }

  // Search examples from common terms
  const searchTerms = ["urgent", "fix", "implement", "create", "update", "review"];
  for (const term of searchTerms) {
    examples.push(taskToSearchExample(sorted, term));
  }

  const finalExamples = options.limit
    ? examples.slice(0, options.limit)
    : examples;

  return {
    source: "todos",
    examples: finalExamples,
    count: finalExamples.length,
  };
};
