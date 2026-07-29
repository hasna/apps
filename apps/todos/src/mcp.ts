export const TODOS_MCP_TOOLS = [
  "create_task",
  "list_tasks",
  "get_task",
  "update_task",
  "delete_task",
  "start_task",
  "complete_task",
  "get_status",
  "claim_next_task",
] as const;

export type TodosMcpTool = typeof TODOS_MCP_TOOLS[number];

export function getMcpToolNames(): TodosMcpTool[] {
  return [...TODOS_MCP_TOOLS];
}
