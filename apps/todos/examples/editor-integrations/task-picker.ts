#!/usr/bin/env bun

const proc = Bun.spawn(["todos", "--json", "ready"], {
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

if (exitCode !== 0) {
  process.stderr.write(stderr);
  process.exit(exitCode);
}

const tasks = JSON.parse(stdout) as Array<{
  id: string;
  short_id?: string | null;
  priority?: string;
  title: string;
  tags?: string[];
}>;

for (const task of tasks) {
  const id = task.short_id || task.id.slice(0, 8);
  const tags = task.tags?.length ? ` #${task.tags.join(" #")}` : "";
  console.log(`${id}\t${task.priority || "medium"}\t${task.title}${tags}`);
}
