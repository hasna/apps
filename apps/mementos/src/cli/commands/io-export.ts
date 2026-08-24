import type { Command } from "commander";
import { resolve } from "node:path";
import { getProject } from "../../db/projects.js";
import { listMemoriesBounded } from "../../db/memories.js";
import { redactMemoryForOutput } from "../../lib/redact.js";
import type { MemoryCategory, MemoryScope, MemoryFilter } from "../../types/index.js";
import {
  resolveAgentFilter,
  outputJson,
  makeHandleError,
  type GlobalOpts,
} from "../helpers.js";

export function registerExportCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("export")
    .description("Export memories as JSON")
    .option("--scope <scope>", "Scope filter")
    .option("-c, --category <cat>", "Category filter")
    .option("--agent <name>", "Agent filter")
    .option("--project <path>", "Project filter")
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const agentId = resolveAgentFilter((opts.agent as string | undefined) || globalOpts.agent);
        const projectPath =
          (opts.project as string | undefined) || globalOpts.project;
        let projectId: string | undefined;
        if (projectPath) {
          const project = getProject(resolve(projectPath));
          if (project) projectId = project.id;
        }

        const filter: MemoryFilter = {
          scope: opts.scope as MemoryScope | undefined,
          category: opts.category as MemoryCategory | undefined,
          agent_id: agentId,
          project_id: projectId,
        };

        // Export targets up to 10000 rows; the server caps single responses at
        // 1000, so the requested population is assembled by walking bounded
        // pages (BUG 2796806b).
        const memories = listMemoriesBounded(filter, 10000).rows;

        // Read-path redaction (todos e12c7659): `export` is a bulk read verb
        // whose stdout lands in the session transcript, so every raw Memory
        // field — key, value, summary, tags, when_to_use, metadata — would
        // reach it verbatim. Project the full population through
        // redactMemoryForOutput before the single JSON emit; coordination
        // metadata (id, scope, category, importance, status, timestamps,
        // attribution) survives.
        const sanitized = memories.map(redactMemoryForOutput);

        // Export always outputs JSON
        outputJson(sanitized);
      } catch (e) {
        handleError(e);
      }
    });
}
