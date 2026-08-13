// Dynamic gatherer registry — maps source names to GatherTrainingDataFn implementations.
// Core gatherers are pre-registered. SDK gatherers from other repos call registerGatherer().

import type { GatherTrainingDataFn, TrainingDataProvider } from "./protocol.js";
import { gatherFromTodos } from "./todos.js";
import { gatherFromMementos } from "./mementos.js";
import { gatherFromConversations } from "./conversations.js";
import { gatherFromSessions } from "./sessions.js";
import { gatherFromStyles } from "./styles.js";
import { gatherFromResearcher } from "./researcher.js";
import { gatherFromTickets } from "./tickets.js";
import { gatherFromEconomy } from "./economy.js";
import { gatherFromRecordings } from "./recordings.js";
import { gatherFromAssistants } from "./assistants.js";

const registry = new Map<string, TrainingDataProvider>();

export function registerGatherer(provider: TrainingDataProvider): void {
  registry.set(provider.name, provider);
}

export function getRegisteredSources(): string[] {
  return Array.from(registry.keys()).sort();
}

export function getGatherer(name: string): GatherTrainingDataFn | undefined {
  return registry.get(name)?.gather;
}

export function getProvider(name: string): TrainingDataProvider | undefined {
  return registry.get(name);
}

export function getAllProviders(): TrainingDataProvider[] {
  return Array.from(registry.values());
}

// Pre-register built-in gatherers
registerGatherer({
  name: "todos",
  gather: gatherFromTodos,
  description: "Task management data from @hasna/todos",
  package: "@hasna/todos",
});

registerGatherer({
  name: "mementos",
  gather: gatherFromMementos,
  description: "Agent memory data from @hasna/mementos",
  package: "@hasna/mementos",
});

registerGatherer({
  name: "conversations",
  gather: gatherFromConversations,
  description: "Multi-agent conversation data from @hasna/conversations",
  package: "@hasna/conversations",
});

registerGatherer({
  name: "sessions",
  gather: gatherFromSessions,
  description: "Claude Code session transcripts from ~/.claude/projects",
  package: "@hasna/sessions",
});

registerGatherer({
  name: "styles",
  gather: gatherFromStyles,
  description: "Style preferences and profiles from @hasnaxyz/styles",
  package: "@hasnaxyz/styles",
});

registerGatherer({
  name: "researcher",
  gather: gatherFromResearcher,
  description: "Experiment results and research projects from @hasna/researcher",
  package: "@hasna/researcher",
});

registerGatherer({
  name: "tickets",
  gather: gatherFromTickets,
  description: "Bug reports and feature requests from @hasna/tickets",
  package: "@hasna/tickets",
});

registerGatherer({
  name: "economy",
  gather: gatherFromEconomy,
  description: "AI cost and usage data from @hasna/economy",
  package: "@hasna/economy",
});

registerGatherer({
  name: "recordings",
  gather: gatherFromRecordings,
  description: "Audio transcripts and recordings from @hasna/recordings",
  package: "@hasna/recordings",
});

registerGatherer({
  name: "assistants",
  gather: gatherFromAssistants,
  description: "Personal assistant session history from @hasna/assistants",
  package: "@hasna/assistants",
});
