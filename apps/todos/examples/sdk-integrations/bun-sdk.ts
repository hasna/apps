#!/usr/bin/env bun

import { TodosClient } from "@hasna/todos/sdk";

// No baseUrl: the client resolves its authority and credential through the one
// @hasna/contracts chain, per call. Export HASNA_TODOS_API_KEY (or use the
// Keychain / ~/.hasna/todos/config/credentials) to run this against the fleet;
// export HASNA_TODOS_LOCAL=1 with nothing else set to run it against a local
// `todos serve`, which announces itself on stderr.
const client = new TodosClient();

const project = await client.projects.create({
  name: "Agent Demo",
  description: "Local SDK project fixture",
});

const task = await client.tasks.create({
  title: "Run the agent on the plan",
  description: "Use the local queue and record verification when the run is done.",
  priority: "high",
  project_id: project.id,
  tags: ["agent", "plan"],
});

const plan = await client.plans.create({
  title: "Agent demo plan",
  description: "Create project, add todos, run the agent, and record evidence.",
  project_id: project.id,
});

console.log(JSON.stringify({ project, task, plan }, null, 2));
