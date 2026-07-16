import type { Task } from "../types/index.js";
import { redactValue } from "../lib/redaction.js";

export function redactBroadTask<T extends Task>(task: T): T {
  return redactValue(task);
}

export function redactBroadTasks<T extends Task>(tasks: T[]): T[] {
  return tasks.map(redactBroadTask);
}

export function redactBroadOutput<T>(value: T): T {
  return redactValue(value);
}
