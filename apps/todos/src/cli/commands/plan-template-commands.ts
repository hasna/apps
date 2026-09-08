import { registerTemplateCommands } from "./template-commands.js";
import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../../db/database.js";
import {
  createPlan,
  getPlan,
  listPlans,
  resolvePlanRefDetailed,
  updatePlan,
  deletePlan,
} from "../../db/plans.js";
import { listPlanComments } from "../../db/plan-comments.js";
import type { Plan, PlanComment } from "../../types/index.js";
import { inspectPlanArtifact, readPlanArtifact, writePlanArtifact } from "../../lib/plan-artifacts.js";
import {
  applyPlanProjectLink,
  planPlanProjectLink,
  rollbackPlanProjectLink,
} from "../../lib/plan-project-link.js";
import { createLocalSqliteTodosStorageAdapter } from "../../storage/local-sqlite.js";
import { formatTaskLine, autoProject, handleError, output, resolveExplicitProject } from "../helpers.js";
import {
  getTodosCloudClient,
  cloudCreatePlan,
  cloudDeletePlan,
  cloudListPlans,
  cloudListPlanComments,
  cloudListPlanTasks,
  cloudApplyPlanProjectLink,
  cloudPlanPlanProjectLink,
  cloudResolvePlan,
  cloudResolveProjectRef,
  cloudRollbackPlanProjectLink,
  cloudUpdatePlan,
} from "../cloud-router.js";

function resolvePlanCliRef(ref: string, projectId: string | undefined): string {
  const db = getDatabase();
  const resolved = resolvePlanRefDetailed(ref, db, projectId);
  if (resolved.id) return resolved.id;
  if (resolved.reason === "ambiguous") {
    console.error(chalk.red(`Ambiguous plan reference: ${ref}`));
    if (resolved.matches.length > 0) {
      console.error(chalk.dim(`Matches: ${resolved.matches.map((plan) => `${plan.slug ?? plan.name} (${plan.id.slice(0, 8)})`).join(", ")}`));
    }
  } else {
    console.error(chalk.red(`Could not resolve plan ID or slug: ${ref}`));
  }
  process.exit(1);
}

/** Render plan-row comments under `plans --show` (plan comment surface, task 04ee08fd). */
function printPlanComments(comments: PlanComment[]): void {
  if (comments.length > 0) {
    console.log(chalk.bold(`\n  Comments (${comments.length}):`));
    for (const comment of comments) {
      const who = comment.agent_id ? `${comment.agent_id} ` : "";
      console.log(`    ${chalk.dim(comment.created_at)} ${who}${comment.content}`);
    }
  } else {
    console.log(chalk.dim("\n  No comments on this plan."));
  }
}

export function registerPlanTemplateCommands(program: Command) {
  // plans
  program
    .command("plans")
    .description("List and manage plans")
    .option("--add <name>", "Create a plan")
    .option("--slug <slug>", "Readable plan slug (with --add)")
    .option("-d, --description <text>", "Plan description (with --add)")
    .option("--show <id-or-slug>", "Show plan details with its tasks")
    .option("--artifact <id-or-slug>", "Show local Markdown artifact diagnostics for a plan")
    .option("--write-artifacts", "Write local Markdown artifacts for all project-scoped plans in scope")
    .option("--delete <id>", "Delete a plan")
    .option("--complete <id>", "Mark a plan as completed")
    .option("--link-project <id-or-slug>", "Plan or apply a guarded plan/project link")
    .option("--rollback-project-link <id-or-slug>", "Roll back an accepted plan/project link receipt")
    .option("--to-project <id-or-slug>", "Destination project for --link-project or --rollback-project-link")
    .option("--apply", "Apply --link-project after its exact-revision plan")
    .option("--idempotency-key <key>", "Stable idempotency key required with --link-project --apply")
    .option("--receipt <id>", "Accepted receipt required with --rollback-project-link")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      const projectId = cloud
        ? (globalOpts.project ? await cloudResolveProjectRef(cloud, globalOpts.project) : undefined)
        : autoProject(globalOpts);

      if (opts.linkProject && opts.rollbackProjectLink) {
        handleError(new Error("Choose either --link-project or --rollback-project-link, not both."));
      }

      if (opts.linkProject || opts.rollbackProjectLink) {
        if (!opts.toProject) {
          handleError(new Error("--to-project is required for plan/project link operations."));
        }
        if (opts.apply && !opts.linkProject) {
          handleError(new Error("--apply is valid only with --link-project."));
        }
        const planRef = opts.linkProject ?? opts.rollbackProjectLink;
        const plan = cloud
          ? await cloudResolvePlan(cloud, planRef)
          : getPlan(resolvePlanCliRef(planRef, undefined));
        if (!plan) {
          handleError(new Error(`Plan not found: ${planRef}`));
        }
        const targetProjectId = cloud
          ? await cloudResolveProjectRef(cloud, opts.toProject)
          : resolveExplicitProject(opts.toProject).id;

        if (opts.linkProject) {
          const planned = cloud
            ? await cloudPlanPlanProjectLink(cloud, plan.id, targetProjectId)
            : await planPlanProjectLink(
                createLocalSqliteTodosStorageAdapter({ db: getDatabase() }),
                plan.id,
                targetProjectId,
              );
          if (!opts.apply) {
            if (globalOpts.json) output(planned, true);
            else console.log(chalk.cyan(`${planned.action}: ${planned.tasks.length} task(s) → ${planned.project.name}`));
            return;
          }
          if (!opts.idempotencyKey) {
            handleError(new Error("--idempotency-key is required with --link-project --apply."));
          }
          const result = cloud
            ? await cloudApplyPlanProjectLink(cloud, plan.id, targetProjectId, {
                expected_plan_revision: planned.plan.updated_at,
                expected_project_revision: planned.project.updated_at,
                idempotency_key: opts.idempotencyKey,
              })
            : await applyPlanProjectLink(
                createLocalSqliteTodosStorageAdapter({ db: getDatabase() }),
                plan.id,
                targetProjectId,
                {
                  expected_plan_revision: planned.plan.updated_at,
                  expected_project_revision: planned.project.updated_at,
                  idempotency_key: opts.idempotencyKey,
                },
              );
          if (globalOpts.json) output(result, true);
          else console.log(chalk.green(`${result.action}: ${result.tasks.length} task(s) → ${result.project.name}; receipt ${result.receipt?.receipt_id}`));
          return;
        }

        if (!opts.receipt) {
          handleError(new Error("--receipt is required with --rollback-project-link."));
        }
        const result = cloud
          ? await cloudRollbackPlanProjectLink(cloud, plan.id, targetProjectId, {
              receipt_id: opts.receipt,
              expected_plan_revision: plan.updated_at,
            })
          : await rollbackPlanProjectLink(
              createLocalSqliteTodosStorageAdapter({ db: getDatabase() }),
              plan.id,
              targetProjectId,
              { receipt_id: opts.receipt, expected_plan_revision: plan.updated_at },
            );
        if (globalOpts.json) output(result, true);
        else console.log(chalk.green(`rolled_back: ${result.tasks.length} task(s); receipt ${result.rollback_receipt_id}`));
        return;
      }

      if (opts.add) {
        let plan: Plan;
        try {
          const input = {
            name: opts.add,
            slug: opts.slug,
            description: opts.description,
            project_id: projectId,
          };
          plan = cloud ? await cloudCreatePlan(cloud, input) : createPlan(input);
        } catch (error) {
          handleError(error);
        }
        const artifact = cloud ? null : writePlanArtifact(plan);

        if (globalOpts.json) {
          output(plan, true);
        } else {
          console.log(chalk.green("Plan created:"));
          console.log(`${chalk.dim(plan.id.slice(0, 8))} ${chalk.bold(plan.name)} ${chalk.cyan(`[${plan.status}]`)}`);
          console.log(`${chalk.dim("Slug:")} ${plan.slug}`);
          if (artifact) console.log(`${chalk.dim("Artifact:")} ${artifact.path}`);
        }
        return;
      }

      if (opts.artifact) {
        const db = getDatabase();
        const resolvedId = resolvePlanCliRef(opts.artifact, projectId);
        const plan = getPlan(resolvedId);
        if (!plan) {
          handleError(new Error(`Plan not found: ${opts.artifact}`));
        }
        const inspection = inspectPlanArtifact(plan, db);
        if (!inspection) {
          const result = { plan_id: plan.id, artifact: null, reason: "plan is not project-scoped" };
          if (globalOpts.json) output(result, true);
          else console.log(chalk.dim("Plan is not project-scoped; no local Markdown artifact path is available."));
          return;
        }
        if (globalOpts.json) {
          output({ plan, artifact: inspection }, true);
          return;
        }
        console.log(chalk.bold("Plan Artifact:\n"));
        console.log(`  ${chalk.dim("Plan:")}      ${plan.id}`);
        console.log(`  ${chalk.dim("Path:")}      ${inspection.path}`);
        console.log(`  ${chalk.dim("Exists:")}    ${inspection.exists ? "yes" : "no"}`);
        if (inspection.parse_error) console.log(`  ${chalk.dim("Parse:")}     ${chalk.red(inspection.parse_error)}`);
        console.log(`  ${chalk.dim("Conflicts:")} ${inspection.conflicts.length}`);
        for (const conflict of inspection.conflicts) {
          console.log(`    ${conflict.field}: db=${conflict.database ?? "null"} artifact=${conflict.artifact ?? "null"}`);
        }
        return;
      }

      if (opts.writeArtifacts) {
        const plans = listPlans(projectId);
        const written = plans
          .map((plan) => ({ plan, artifact: writePlanArtifact(plan) }))
          .filter((entry) => entry.artifact);
        const result = {
          count: written.length,
          artifacts: written.map((entry) => ({
            plan_id: entry.plan.id,
            path: entry.artifact!.path,
          })),
        };
        if (globalOpts.json) {
          output(result, true);
        } else {
          console.log(chalk.green(`Wrote ${written.length} plan artifact(s).`));
          for (const artifact of result.artifacts) console.log(`${chalk.dim(artifact.plan_id.slice(0, 8))} ${artifact.path}`);
        }
        return;
      }

      if (opts.show) {
        // http authority routing: resolve the plan and its tasks from the SHARED
        // dataset. The local path resolved the ref against this machine's sqlite
        // (which does not carry cloud plans), so it could not open a plan its own
        // cloud `plans` list had just returned.
        if (cloud) {
          const plan = await cloudResolvePlan(cloud, opts.show, projectId);
          if (!plan) {
            handleError(new Error(`Plan not found: ${opts.show}`));
          }
          const tasks = await cloudListPlanTasks(cloud, plan.id);
          const comments = await cloudListPlanComments(cloud, plan.id);
          if (globalOpts.json) {
            output({ plan, tasks, comments, artifact: null }, true);
            return;
          }
          console.log(chalk.bold("Plan Details:\n"));
          console.log(`  ${chalk.dim("ID:")}       ${plan.id}`);
          if (plan.slug) console.log(`  ${chalk.dim("Slug:")}     ${plan.slug}`);
          console.log(`  ${chalk.dim("Name:")}     ${plan.name}`);
          console.log(`  ${chalk.dim("Status:")}   ${chalk.cyan(plan.status)}`);
          if (plan.description) console.log(`  ${chalk.dim("Desc:")}     ${plan.description}`);
          if (plan.project_id) console.log(`  ${chalk.dim("Project:")}  ${plan.project_id}`);
          console.log(`  ${chalk.dim("Created:")}  ${plan.created_at}`);
          if (tasks.length > 0) {
            console.log(chalk.bold(`\n  Tasks (${tasks.length}):`));
            for (const t of tasks) console.log(`    ${formatTaskLine(t)}`);
          } else {
            console.log(chalk.dim("\n  No tasks in this plan."));
          }
          printPlanComments(comments);
          return;
        }
        const db = getDatabase();
        const resolvedId = resolvePlanCliRef(opts.show, projectId);
        const plan = getPlan(resolvedId);
        if (!plan) {
          handleError(new Error(`Plan not found: ${opts.show}`));
        }
        const { listTasks } = require("../../db/tasks.js") as any;
        const tasks = listTasks({ plan_id: resolvedId });
        const comments = listPlanComments(resolvedId, db);
        const artifact = readPlanArtifact(plan, db);

        if (globalOpts.json) {
          output({
            plan,
            tasks,
            comments,
            artifact: artifact
              ? {
                  path: artifact.path,
                  metadata: artifact.metadata,
                  task_references: artifact.task_references,
                  body: artifact.body,
                }
              : null,
          }, true);
          return;
        }

        console.log(chalk.bold("Plan Details:\n"));
        console.log(`  ${chalk.dim("ID:")}       ${plan.id}`);
        if (plan.slug) console.log(`  ${chalk.dim("Slug:")}     ${plan.slug}`);
        console.log(`  ${chalk.dim("Name:")}     ${plan.name}`);
        console.log(`  ${chalk.dim("Status:")}   ${chalk.cyan(plan.status)}`);
        if (plan.description) console.log(`  ${chalk.dim("Desc:")}     ${plan.description}`);
        if (plan.project_id) console.log(`  ${chalk.dim("Project:")}  ${plan.project_id}`);
        if (artifact) console.log(`  ${chalk.dim("Artifact:")} ${artifact.path}`);
        console.log(`  ${chalk.dim("Created:")}  ${plan.created_at}`);

        if (tasks.length > 0) {
          console.log(chalk.bold(`\n  Tasks (${tasks.length}):`));
          for (const t of tasks) {
            console.log(`    ${formatTaskLine(t)}`);
          }
        } else {
          console.log(chalk.dim("\n  No tasks in this plan."));
        }
        printPlanComments(comments);
        return;
      }

      if (opts.delete) {
        const cloudPlan = cloud ? await cloudResolvePlan(cloud, opts.delete, projectId) : null;
        if (cloud && !cloudPlan) {
          handleError(new Error(`Plan not found: ${opts.delete}`));
        }
        const resolvedId = cloudPlan?.id ?? resolvePlanCliRef(opts.delete, projectId);
        const deleted = cloud ? await cloudDeletePlan(cloud, resolvedId) : deletePlan(resolvedId);
        if (globalOpts.json) {
          output({ deleted }, true);
          if (!deleted) process.exitCode = 1;
        } else if (deleted) {
          console.log(chalk.green("Plan deleted."));
        } else {
          handleError(new Error("Plan not found."));
        }
        return;
      }

      if (opts.complete) {
        const cloudPlan = cloud ? await cloudResolvePlan(cloud, opts.complete, projectId) : null;
        if (cloud && !cloudPlan) {
          handleError(new Error(`Plan not found: ${opts.complete}`));
        }
        const resolvedId = cloudPlan?.id ?? resolvePlanCliRef(opts.complete, projectId);
        try {
          const plan = cloud
            ? await cloudUpdatePlan(cloud, resolvedId, { status: "completed" })
            : updatePlan(resolvedId, { status: "completed" });
          const artifact = cloud ? null : writePlanArtifact(plan);
          if (globalOpts.json) {
            output(plan, true);
          } else {
            console.log(chalk.green("Plan completed:"));
            console.log(`${chalk.dim(plan.id.slice(0, 8))} ${chalk.bold(plan.name)} ${chalk.cyan(`[${plan.status}]`)}`);
            if (artifact) console.log(`${chalk.dim("Artifact:")} ${artifact.path}`);
          }
        } catch (e) {
          handleError(e);
        }
        return;
      }

      // Default: list plans
      const plans = cloud ? await cloudListPlans(cloud, projectId) : listPlans(projectId);

      if (globalOpts.json) {
        output(plans, true);
        return;
      }

      if (plans.length === 0) {
        console.log(chalk.dim("No plans found."));
        return;
      }

      console.log(chalk.bold(`${plans.length} plan(s):\n`));
      for (const p of plans) {
        const desc = p.description ? chalk.dim(` - ${p.description}`) : "";
        const slug = p.slug ? chalk.dim(` ${p.slug}`) : "";
        console.log(`${chalk.dim(p.id.slice(0, 8))}${slug} ${chalk.bold(p.name)} ${chalk.cyan(`[${p.status}]`)}${desc}`);
      }
    });

  registerTemplateCommands(program);
}
