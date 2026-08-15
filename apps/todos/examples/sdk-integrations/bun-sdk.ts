#!/usr/bin/env bun

import { TodosClient } from "@hasna/todos/sdk";

const client = new TodosClient({ baseUrl: process.env.TODOS_URL ?? "http://localhost:19427" });

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
