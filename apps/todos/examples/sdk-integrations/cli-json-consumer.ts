#!/usr/bin/env bun

async function todos(args: string[]) {
  const proc = Bun.spawn(["todos", "--json", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `todos ${args.join(" ")} failed`);
  return JSON.parse(stdout);
}

const project = await todos(["projects", "--json"]);
const readyTasks = await todos(["ready"]);
const task = readyTasks[0];

if (!task) {
  console.log(JSON.stringify({ projectCount: project.length, readyTasks: [] }, null, 2));
  process.exit(0);
}

const contextPack = await todos(["context-pack", task.id, "--json"]);
const taskSnapshot = await todos(["snapshots", "--show", "tasks"]);

console.log(JSON.stringify({
  projectCount: project.length,
  nextTask: task,
  contextPack,
  taskSnapshot,
}, null, 2));
