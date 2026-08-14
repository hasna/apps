import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import {
  registerProject,
  getProject,
  listProjects,
  applyProjectUpdate,
  previewProjectUpdate,
  rollbackProjectUpdate,
} from "../../db/projects.js";
import { listMemories, touchMemory } from "../../db/memories.js";
import {
  resolveVisibleMachineId,
  visibleToMachineFilter,
} from "../../lib/machine-visibility.js";
import type {
  Memory,
  MemoryCategory,
} from "../../types/index.js";
import {
  MEMENTOS_PROJECT_RESOURCE_KINDS,
  getMementosProjectResourceExact,
  readAllMementosProjectResources,
  readMementosProjectResourcePage,
  resolveMementosProjectAuthorityIdentity,
  type MementosProjectResourceKind,
} from "../../project-registration/index.js";
import {
  DEFAULT_COMPACT_LIMIT,
  outputJson,
  makeHandleError,
  cursorOrOffset,
  positiveIntOrDefault,
  printPageHint,
  truncateText,
  type GlobalOpts,
} from "../helpers.js";

export function registerProjectCommands(program: Command): void {
  const handleError = makeHandleError(program);

  // ============================================================================
  // projects
  // ============================================================================

  program
    .command("projects")
    .description("Manage projects")
    .option("--add", "Add a new project")
    .option("--update <id>", "Update a project by its exact stable ID")
    .option("--name <name>", "Project name")
    .option("--path <path>", "Project path")
    .option("--description <text>", "Project description")
    .option("--memory-prefix <prefix>", "Project memory prefix")
    .option("--expected-revision <revision>", "Exact updated_at revision required for compare-and-swap")
    .option("--idempotency-key <key>", "Caller-owned key for one guarded mutation")
    .option("--operation-id <id>", "Operation identifier (defaults to the idempotency key)")
    .option("--step-id <id>", "Step identifier (defaults to mementos_project_update)")
    .option("--dry-run", "Validate and preview the guarded update without writing")
    .option("--rollback-receipt <id>", "Restore the exact before snapshot from an accepted update receipt")
    .option("--limit <n>", "Max results (compact default: 20)", parseInt)
    .option("--cursor <n>", "Cursor offset for the next page", parseInt)
    .option("--offset <n>", "Offset for pagination", parseInt)
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();

        if (opts.add && opts.update) {
          console.error(chalk.red("--add and --update cannot be used together"));
          process.exit(1);
        }

        if (opts.add) {
          const name = opts.name as string | undefined;
          const path = opts.path as string | undefined;
          if (!name || !path) {
            console.error(
              chalk.red("--name and --path are required when adding a project")
            );
            process.exit(1);
          }
          const project = registerProject(
            name,
            resolve(path),
            opts.description as string | undefined
          );

          if (globalOpts.json) {
            outputJson(project);
          } else {
            console.log(chalk.green("Project registered:"));
            console.log(`  ${chalk.bold("ID:")}     ${project.id}`);
            console.log(
              `  ${chalk.bold("Name:")}   ${project.name}`
            );
            console.log(
              `  ${chalk.bold("Path:")}   ${project.path}`
            );
          }
          return;
        }

        if (opts.update) {
          const updates: {
            name?: string;
            path?: string;
            description?: string;
            memory_prefix?: string;
          } = {};
          if (opts.name !== undefined) updates.name = opts.name as string;
          if (opts.path !== undefined) updates.path = resolve(opts.path as string);
          if (opts.description !== undefined) {
            updates.description = opts.description as string;
          }
          if (opts.memoryPrefix !== undefined) {
            updates.memory_prefix = opts.memoryPrefix as string;
          }
          const rollbackReceipt = opts.rollbackReceipt as string | undefined;
          if (Object.keys(updates).length === 0 && !rollbackReceipt) {
            console.error(
              chalk.red(
                "At least one of --name, --path, --description, or --memory-prefix is required when updating"
              )
            );
            process.exit(1);
          }
          if (Object.keys(updates).length > 0 && rollbackReceipt) {
            console.error(chalk.red("Project fields and --rollback-receipt cannot be used together"));
            process.exit(1);
          }
          if (opts.dryRun && rollbackReceipt) {
            console.error(chalk.red("Dry-run project rollback is not supported"));
            process.exit(1);
          }
          const expectedRevision = opts.expectedRevision as string | undefined;
          const idempotencyKey = opts.idempotencyKey as string | undefined;
          if (!expectedRevision || !idempotencyKey) {
            console.error(chalk.red(
              "--expected-revision and --idempotency-key are required for every project update",
            ));
            process.exit(1);
          }
          const common = {
            ...resolveMementosProjectAuthorityIdentity(),
            operation_id: (opts.operationId as string | undefined) ?? idempotencyKey,
            step_id: (opts.stepId as string | undefined)
              ?? (rollbackReceipt ? "mementos_project_rollback" : "mementos_project_update"),
            idempotency_key: idempotencyKey,
            expected_revision: expectedRevision,
          };
          const result = rollbackReceipt
            ? rollbackProjectUpdate(opts.update as string, {
              ...common,
              accepted_receipt_id: rollbackReceipt,
            })
            : opts.dryRun
              ? previewProjectUpdate(opts.update as string, { ...common, updates })
              : applyProjectUpdate(opts.update as string, { ...common, updates });

          if (globalOpts.json) {
            outputJson(result);
          } else {
            console.log(chalk.green(result.dry_run ? "Project update preview:" : "Project updated:"));
            console.log(`  ${chalk.bold("ID:")}       ${result.project.id}`);
            console.log(`  ${chalk.bold("Name:")}     ${result.project.name}`);
            console.log(`  ${chalk.bold("Path:")}     ${result.project.path}`);
            console.log(`  ${chalk.bold("Revision:")} ${result.project.updated_at}`);
            if (result.receipt) {
              console.log(`  ${chalk.bold("Receipt:")}  ${result.receipt.receipt_id}`);
            }
          }
          return;
        }

        // List projects
        const allProjects = listProjects();
        const limit = positiveIntOrDefault(opts.limit, DEFAULT_COMPACT_LIMIT);
        const offset = cursorOrOffset(opts.cursor, opts.offset) ?? 0;
        const explicitPagination =
          opts.limit !== undefined ||
          opts.cursor !== undefined ||
          opts.offset !== undefined;
        const projects = globalOpts.json
          ? (explicitPagination
            ? allProjects.slice(offset, offset + limit)
            : allProjects)
          : allProjects.slice(offset, offset + limit + 1);
        const hasMore = !globalOpts.json && projects.length > limit;
        const displayProjects = hasMore ? projects.slice(0, limit) : projects;

        if (globalOpts.json) {
          outputJson(projects);
          return;
        }

        if (displayProjects.length === 0) {
          console.log(chalk.yellow("No projects registered."));
          return;
        }

        console.log(
          chalk.bold(
            `${displayProjects.length}${hasMore ? "+" : ""} project${displayProjects.length === 1 ? "" : "s"}:`
          )
        );
        for (const p of displayProjects) {
          const description = p.description ? chalk.dim(` - ${truncateText(p.description, 72)}`) : "";
          console.log(
            `  ${chalk.dim(p.id.slice(0, 8))} ${chalk.bold(p.name)} ${chalk.gray(truncateText(p.path, 80))}${description}`
          );
        }
        printPageHint({
          shown: displayProjects.length,
          limit,
          offset,
          hasMore,
          command: "mementos projects",
          detailHint: "use --json for full objects",
        });
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command("project-resources <project-id>")
    .description("Enumerate the complete project-owned Mementos resource population")
    .option("--limit <n>", "Bounded page size (1-1000)", parseInt)
    .option("--cursor <cursor>", "Opaque revision-bound continuation cursor")
    .option(
      "--kinds <kinds>",
      "Comma-separated resource kinds: project,knowledge,memory,session",
    )
    .option("--all", "Traverse every page and verify complete unique coverage")
    .option("--resource-kind <kind>", "Read one exact resource kind")
    .option("--resource-id <id>", "Read one exact stable resource ID")
    .action((projectId: string, opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const resourceKind = opts.resourceKind as string | undefined;
        const resourceId = opts.resourceId as string | undefined;
        if (Boolean(resourceKind) !== Boolean(resourceId)) {
          throw new Error("--resource-kind and --resource-id must be provided together");
        }
        const resourceKinds = opts.kinds === undefined
          ? undefined
          : String(opts.kinds)
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean) as MementosProjectResourceKind[];
        if (resourceKinds) {
          for (const kind of resourceKinds) {
            if (!MEMENTOS_PROJECT_RESOURCE_KINDS.includes(kind)) {
              throw new Error(`Unsupported project resource kind: ${kind}`);
            }
          }
        }

        const result = resourceKind && resourceId
          ? getMementosProjectResourceExact(
            projectId,
            resourceKind as MementosProjectResourceKind,
            resourceId,
          )
          : opts.all
            ? readAllMementosProjectResources(projectId, {
              page_size: opts.limit as number | undefined,
              resource_kinds: resourceKinds,
            })
            : readMementosProjectResourcePage(projectId, {
              limit: opts.limit as number | undefined,
              cursor: opts.cursor as string | undefined,
              resource_kinds: resourceKinds,
            });

        if (globalOpts.json) {
          outputJson(result);
          return;
        }
        if ("resource" in result) {
          console.log(chalk.green("Project resource:"));
          console.log(`  ${chalk.bold("Project:")}    ${result.project_id}`);
          console.log(`  ${chalk.bold("Kind:")}       ${result.resource.resource_kind}`);
          console.log(`  ${chalk.bold("Stable ID:")}  ${result.resource.stable_id}`);
          console.log(`  ${chalk.bold("Revision:")}   ${result.resource.revision}`);
          return;
        }
        console.log(chalk.bold(
          `${result.count} of ${result.total} project resource${result.total === 1 ? "" : "s"}:`,
        ));
        for (const resource of result.resources) {
          console.log(
            `  ${chalk.dim(resource.resource_kind.padEnd(9))} ${resource.stable_id}`,
          );
        }
        console.log(
          `  ${chalk.bold("Complete:")} ${result.complete}  `
          + `${chalk.bold("Has more:")} ${result.has_more}`,
        );
        if (result.next_cursor) {
          console.log(
            chalk.dim(`Next: mementos project-resources ${projectId} --cursor ${result.next_cursor}`),
          );
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // inject
  // ============================================================================

  program
    .command("inject")
    .description(
      "Output injection context for agent system prompts"
    )
    .option("--agent <name>", "Agent ID for scope filtering")
    .option("--project <path>", "Project path for scope filtering")
    .option("--session <id>", "Session ID for scope filtering")
    .option("--machine <id>", "Machine ID for machine-local memory visibility")
    .option(
      "--max-tokens <n>",
      "Max approximate token budget",
      parseInt
    )
    .option(
      "--categories <cats>",
      "Comma-separated categories to include"
    )
    .option("--format <fmt>", "Output format: xml (default), compact, markdown, json")
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const maxTokens =
          (opts.maxTokens as number | undefined) || 500;
        const minImportance = 3;
        const categoriesRaw =
          (opts.categories as string | undefined) ||
          "preference,fact,knowledge";
        const categories = categoriesRaw
          .split(",")
          .map((c: string) => c.trim()) as MemoryCategory[];

        const agentId =
          (opts.agent as string | undefined) || globalOpts.agent;
        const projectPath =
          (opts.project as string | undefined) || globalOpts.project;
        const sessionId =
          (opts.session as string | undefined) || globalOpts.session;
        const visibleMachineId = resolveVisibleMachineId(opts.machine as string | undefined);

        let projectId: string | undefined;
        if (projectPath) {
          const project = getProject(resolve(projectPath));
          if (project) projectId = project.id;
        }

        // Collect memories from all visible scopes
        const allMemories: Memory[] = [];

        // Global memories
        const globalMems = listMemories({
          scope: "global",
          category: categories,
          min_importance: minImportance,
          status: "active",
          project_id: projectId,
          ...visibleToMachineFilter(visibleMachineId),
          limit: 50,
        });
        allMemories.push(...globalMems);

        // Shared memories (project-scoped)
        if (projectId) {
          const sharedMems = listMemories({
            scope: "shared",
            category: categories,
            min_importance: minImportance,
            status: "active",
            project_id: projectId,
            ...visibleToMachineFilter(visibleMachineId),
            limit: 50,
          });
          allMemories.push(...sharedMems);
        }

        // Private memories (agent-scoped)
        if (agentId) {
          const privateMems = listMemories({
            scope: "private",
            category: categories,
            min_importance: minImportance,
            status: "active",
            agent_id: agentId,
            session_id: sessionId,
            ...visibleToMachineFilter(visibleMachineId),
            limit: 50,
          });
          allMemories.push(...privateMems);
        }

        // Deduplicate by ID
        const seen = new Set<string>();
        const unique = allMemories.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });

        // Sort by importance DESC, then recency
        unique.sort((a, b) => {
          if (b.importance !== a.importance)
            return b.importance - a.importance;
          return (
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime()
          );
        });

        // Build context within token budget (~4 chars per token estimate)
        const charBudget = maxTokens * 4;
        const lines: string[] = [];
        let totalChars = 0;

        const fmt = (opts.format as string | undefined) || "xml";

        for (const m of unique) {
          let line: string;
          if (fmt === "compact") {
            line = `${m.key}: ${m.value}`;
          } else if (fmt === "json") {
            line = JSON.stringify({ key: m.key, value: m.value, scope: m.scope, category: m.category, importance: m.importance });
          } else {
            line = `- [${m.scope}/${m.category}] ${m.key}: ${m.value}`;
          }
          if (totalChars + line.length > charBudget) break;
          lines.push(line);
          totalChars += line.length;
          touchMemory(m.id);
        }

        if (lines.length === 0) {
          if (globalOpts.json) {
            outputJson({ context: "", count: 0 });
          } else {
            console.log(
              chalk.yellow(
                "No relevant memories found for injection."
              )
            );
          }
          return;
        }

        let context: string;
        if (fmt === "compact") {
          context = lines.join("\n");
        } else if (fmt === "json") {
          context = `[${lines.join(",")}]`;
        } else if (fmt === "markdown") {
          context = `## Agent Memories\n\n${lines.join("\n")}`;
        } else {
          context = `<agent-memories>\n${lines.join("\n")}\n</agent-memories>`;
        }

        if (globalOpts.json) {
          outputJson({ context, count: lines.length });
        } else {
          console.log(context);
        }
      } catch (e) {
        handleError(e);
      }
    });
}
