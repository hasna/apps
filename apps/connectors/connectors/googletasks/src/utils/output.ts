import chalk from 'chalk';
import type { OutputFormat, TaskList, Task } from '../types';

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

export function formatDueDate(dateString?: string): string {
  if (!dateString) return chalk.gray('No due date');
  const date = new Date(dateString);
  const now = new Date();
  const isOverdue = date < now;
  const formatted = date.toLocaleDateString();
  return isOverdue ? chalk.red(formatted) : chalk.cyan(formatted);
}

export function printTaskLists(lists: TaskList[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(lists, null, 2));
    return;
  }

  if (lists.length === 0) {
    info('No task lists found');
    return;
  }

  success(`Task Lists (${lists.length}):`);
  for (const list of lists) {
    console.log(`  ${chalk.bold(list.title)}`);
    console.log(`    ID: ${chalk.gray(list.id)}`);
    console.log(`    Updated: ${chalk.gray(formatDate(list.updated))}`);
    console.log();
  }
}

export function printTaskList(list: TaskList, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  success(`Task List: ${chalk.bold(list.title)}`);
  console.log(`  ID: ${chalk.gray(list.id)}`);
  console.log(`  Updated: ${chalk.gray(formatDate(list.updated))}`);
}

export function printTasks(tasks: Task[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  if (tasks.length === 0) {
    info('No tasks found');
    return;
  }

  success(`Tasks (${tasks.length}):`);
  for (const task of tasks) {
    const statusIcon = task.status === 'completed'
      ? chalk.green('✓')
      : chalk.yellow('○');
    const title = task.status === 'completed'
      ? chalk.strikethrough(chalk.gray(task.title))
      : task.title;

    console.log(`  ${statusIcon} ${title}`);
    console.log(`    ID: ${chalk.gray(task.id)}`);

    if (task.due) {
      console.log(`    Due: ${formatDueDate(task.due)}`);
    }

    if (task.notes) {
      const truncatedNotes = task.notes.length > 50
        ? task.notes.substring(0, 50) + '...'
        : task.notes;
      console.log(`    Notes: ${chalk.gray(truncatedNotes)}`);
    }

    console.log();
  }
}

export function printTask(task: Task, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  const statusIcon = task.status === 'completed'
    ? chalk.green('✓')
    : chalk.yellow('○');
  const statusText = task.status === 'completed'
    ? chalk.green('Completed')
    : chalk.yellow('Needs Action');

  success(`Task: ${task.title}`);
  console.log(`  ID: ${chalk.gray(task.id)}`);
  console.log(`  Status: ${statusIcon} ${statusText}`);

  if (task.due) {
    console.log(`  Due: ${formatDueDate(task.due)}`);
  }

  if (task.completed) {
    console.log(`  Completed: ${chalk.green(formatDate(task.completed))}`);
  }

  if (task.notes) {
    console.log(`  Notes: ${chalk.gray(task.notes)}`);
  }

  console.log(`  Updated: ${chalk.gray(formatDate(task.updated))}`);

  if (task.parent) {
    console.log(`  Parent: ${chalk.gray(task.parent)}`);
  }
}
