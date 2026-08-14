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

const ready = await todos(["ready"]);
const task = ready[0];

if (!task) {
  console.log(JSON.stringify({ claimed: null, reason: "No ready tasks" }, null, 2));
  process.exit(0);
}

await todos(["start", task.id]);
const contextPack = await todos(["context-pack", task.id]);

console.log(JSON.stringify({
  claimed: task.id,
  title: task.title,
  suggestedLoop: [
    "todos comment <task-id> \"Started implementation\"",
    "todos record-verification <task-id> \"bun test\" --status passed",
    "todos done <task-id>",
  ],
  contextPack,
}, null, 2));
