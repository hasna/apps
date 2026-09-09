import {readCompletePlanTasks,readCompletePlanComments} from "../plan-read-api.js";
import type { Command } from "commander";
import type { Plan } from "../../types/index.js";
import { normalizeSlug } from "../../lib/slugs.js";
import { assertPlanApiEnvironment } from "../../lib/plan-client-boundary.js";
import {
  inspectSharedPlanArtifact,
  readSharedPlanArtifact,
  writeSharedPlanArtifact,
} from "../../lib/shared-plan-artifacts.js";
import {
  assertPlanReceipt,
  deleteSharedPlan,
  listSharedPlans,
} from "../../mcp/plan-api.js";
import {
  getTodosCloudClient,
  cloudResolveProjectRef,
  cloudResolvePlan,
  cloudCreatePlan,
  cloudUpdatePlan,
  cloudPlanPlanProjectLink,
  cloudApplyPlanProjectLink,
  cloudRollbackPlanProjectLink,
} from "../cloud-router.js";
import { handleError, outputRecord, formatTaskLine } from "../helpers.js";

export function registerPlanCommands(program: Command) {
  program
    .command("plans")
    .description("List and manage shared plans")
    .option("--add <name>", "Create a plan")
    .option("--slug <slug>", "Readable plan slug (with --add)")
    .option("-d, --description <text>", "Plan description (with --add)")
    .option(
      "--show <id-or-slug>",
      "Show plan details with all tasks and comments",
    )
    .option(
      "--artifact <id-or-slug>",
      "Inspect local Markdown against shared plan data; requires --artifact-root",
    )
    .option(
      "--write-artifacts",
      "Write Markdown for project-scoped plans; requires --artifact-root",
    )
    .option(
      "--artifact-root <directory>",
      "Explicit trusted local project root for Markdown; API paths are never used",
    )
    .option("--delete <id>", "Delete an empty plan")
    .option(
      "--force",
      "With --delete, detach linked tasks/lists and preserve their content and history",
    )
    .option("--complete <id>", "Mark a plan as completed")
    .option(
      "--link-project <id-or-slug>",
      "Plan or apply a guarded plan/project link",
    )
    .option(
      "--rollback-project-link <id-or-slug>",
      "Roll back an accepted plan/project link receipt",
    )
    .option(
      "--to-project <id-or-slug>",
      "Destination project for link or rollback",
    )
    .option("--apply", "Apply --link-project after its exact-revision plan")
    .option(
      "--idempotency-key <key>",
      "Stable key required with --link-project --apply",
    )
    .option(
      "--receipt <id>",
      "Accepted receipt required with --rollback-project-link",
    )
    .action(async (opts) => {
      let committedPlan: Plan | undefined;
      try {
        assertPlanApiEnvironment();
        const global = program.opts();
        const actions = [
          opts.add,
          opts.show,
          opts.artifact,
          opts.writeArtifacts,
          opts.delete,
          opts.complete,
          opts.linkProject,
          opts.rollbackProjectLink,
        ].filter((v) => v !== undefined && v !== false);
        if (actions.length > 1) throw new Error("Choose one plan action");
        if ((opts.artifact || opts.writeArtifacts) && !opts.artifactRoot)
          throw new Error(
            "--artifact-root is required; choose a trusted local project directory",
          );
        if (opts.force && !opts.delete)
          throw new Error("--force requires --delete");
        if (
          (opts.slug !== undefined || opts.description !== undefined) &&
          !opts.add
        )
          throw new Error("--slug and --description require --add");
        if (opts.apply && !opts.linkProject)
          throw new Error("--apply requires --link-project");
        if (opts.idempotencyKey && (!opts.linkProject || !opts.apply))
          throw new Error("--idempotency-key requires --link-project --apply");
        if (opts.receipt && !opts.rollbackProjectLink)
          throw new Error("--receipt requires --rollback-project-link");
        if (opts.toProject && !opts.linkProject && !opts.rollbackProjectLink)
          throw new Error("--to-project requires a link or rollback operation");
        for (const value of [
          opts.add,
          opts.show,
          opts.artifact,
          opts.delete,
          opts.complete,
          opts.linkProject,
          opts.rollbackProjectLink,
          opts.artifactRoot,
          opts.toProject,
          global.project,
        ])
          if (value !== undefined && !String(value).trim())
            throw new Error(
              "Plan names, selectors and local roots must not be blank",
            );
        const cloud = getTodosCloudClient();
        if (!cloud)
          throw new Error("Plan commands require the authenticated shared API");
        const projectId = global.project
          ? await cloudResolveProjectRef(cloud, global.project)
          : undefined;
        const resolve = async (ref: string) => {
          const plan = await cloudResolvePlan(cloud, ref, projectId);
          if (!plan) throw new Error(`Plan not found: ${ref}`);
          assertPlanReceipt(plan);
          return plan;
        };
        if (opts.linkProject || opts.rollbackProjectLink) {
          if (!opts.toProject)
            throw new Error(
              "--to-project is required for plan/project link operations",
            );
          if (opts.linkProject && opts.apply && !opts.idempotencyKey)
            throw new Error(
              "--idempotency-key is required with --link-project --apply",
            );
          if (opts.rollbackProjectLink && !opts.receipt)
            throw new Error(
              "--receipt is required with --rollback-project-link",
            );
          const plan = await resolve(
            opts.linkProject ?? opts.rollbackProjectLink,
          );
          const target = await cloudResolveProjectRef(cloud, opts.toProject);
          if (opts.linkProject) {
            const planned = await cloudPlanPlanProjectLink(
              cloud,
              plan.id,
              target,
            );
            const result = opts.apply
              ? await cloudApplyPlanProjectLink(cloud, plan.id, target, {
                  expected_plan_revision: planned.plan.updated_at,
                  expected_project_revision: planned.project.updated_at,
                  idempotency_key: opts.idempotencyKey,
                })
              : planned;
            outputRecord(result, Boolean(global.json));
            return;
          }
          outputRecord(
            await cloudRollbackPlanProjectLink(cloud, plan.id, target, {
              receipt_id: opts.receipt,
              expected_plan_revision: plan.updated_at,
            }),
            Boolean(global.json),
          );
          return;
        }
        if (opts.add) {
          const input = {
            name: opts.add.trim(),
            slug: normalizeSlug(opts.slug ?? opts.add),
            description: opts.description,
            project_id: projectId,
          };
          if (!input.slug)
            throw new Error("Plan slug must contain letters or digits");
          const plan = await cloudCreatePlan(cloud, input);
          assertPlanReceipt(plan, input);
          committedPlan = plan;
          const artifact = opts.artifactRoot
            ? writeSharedPlanArtifact(
                plan,
                await readCompletePlanTasks(cloud, plan.id, true),
                opts.artifactRoot,
              )
            : null;
          if (global.json) outputRecord(plan, true);
          else {
            console.log(
              `Plan created: ${plan.name} [${plan.status}] (${plan.id})`,
            );
            if (artifact) console.log(`Artifact: ${artifact.path}`);
          }
          return;
        }
        if (opts.delete) {
          const plan = await resolve(opts.delete);
          const receipt = await deleteSharedPlan(
            cloud,
            plan.id,
            opts.force === true,
          );
          outputRecord(receipt, Boolean(global.json));
          if (!receipt.deleted) process.exitCode = 1;
          return;
        }
        if (opts.complete) {
          const prior = await resolve(opts.complete);
          const plan = await cloudUpdatePlan(cloud, prior.id, {
            status: "completed",
          });
          assertPlanReceipt(plan, { status: "completed" }, prior.id);
          committedPlan = plan;
          const artifact = opts.artifactRoot
            ? writeSharedPlanArtifact(
                plan,
                await readCompletePlanTasks(cloud, plan.id, true),
                opts.artifactRoot,
              )
            : null;
          if (global.json) outputRecord(plan, true);
          else {
            console.log(`Plan completed: ${plan.name} (${plan.id})`);
            if (artifact) console.log(`Artifact: ${artifact.path}`);
          }
          return;
        }
        if (opts.show || opts.artifact) {
          const plan = await resolve(opts.show ?? opts.artifact);
          const tasks = await readCompletePlanTasks(
            cloud,
            plan.id,
            Boolean(opts.artifactRoot),
          );
          const artifact = opts.artifactRoot
            ? inspectSharedPlanArtifact(plan, tasks, opts.artifactRoot)
            : null;
          if (opts.artifact) {
            if (global.json) outputRecord({ plan, artifact }, true);
            else {
              console.log(`Plan Artifact: ${plan.id}`);
              if (!artifact)
                console.log(
                  "Plan is not project-scoped; no Markdown artifact path is available.",
                );
              else {
                console.log(
                  `Path: ${artifact.path}\nExists: ${artifact.exists}\nConflicts: ${artifact.conflicts.length}`,
                );
                if (artifact.parse_error)
                  console.log(`Parse: ${artifact.parse_error}`);
                for (const conflict of artifact.conflicts)
                  console.log(
                    `${conflict.field}: shared=${conflict.database ?? "null"} artifact=${conflict.artifact ?? "null"}`,
                  );
              }
            }
            return;
          }
          const comments = await readCompletePlanComments(cloud, plan.id);
          if (global.json)
            outputRecord(
              {
                plan,
                tasks,
                comments,
                artifact: opts.artifactRoot
                  ? readSharedPlanArtifact(plan, opts.artifactRoot)
                  : null,
              },
              true,
            );
          else {
            console.log(
              `Plan Details:\n${plan.name} [${plan.status}] (${plan.id})\nSlug: ${plan.slug ?? ""}`,
            );
            if (plan.description) console.log(plan.description);
            console.log(`Tasks (${tasks.length}):`);
            for (const task of tasks) console.log(formatTaskLine(task));
            console.log(`Comments (${comments.length}):`);
            for (const comment of comments)
              console.log(
                `${comment.created_at} ${comment.agent_id ?? ""} ${comment.content}`,
              );
          }
          return;
        }
        const plans = await listSharedPlans(cloud, projectId);
        if (opts.writeArtifacts) {
          const artifacts = [];
          for (const plan of plans) {
            if (!plan.project_id) continue;
            try {
              const artifact = writeSharedPlanArtifact(
                plan,
                await readCompletePlanTasks(cloud, plan.id, true),
                opts.artifactRoot,
              );
              if (artifact)
                artifacts.push({ plan_id: plan.id, path: artifact.path });
            } catch {
              outputRecord(
                {
                  complete: false,
                  count: artifacts.length,
                  artifacts,
                  failed_plan_id: plan.id,
                },
                Boolean(global.json),
              );
              console.error(
                "Markdown export stopped; previously reported artifacts remain written",
              );
              process.exitCode = 1;
              return;
            }
          }
          outputRecord(
            { count: artifacts.length, artifacts },
            Boolean(global.json),
          );
          return;
        }
        if (global.json) outputRecord(plans, true);
        else if (!plans.length) console.log("No plans found.");
        else
          for (const plan of plans)
            console.log(
              `${plan.id} ${plan.slug ?? ""} ${plan.name} [${plan.status}]`,
            );
      } catch (error) {
        if (committedPlan) {
          const message =
            "The shared plan action completed, but the local artifact did not complete; do not repeat the server action";
          outputRecord(
            {
              error: message,
              operation_committed: true,
              plan: committedPlan,
              artifact_status: "unconfirmed",
            },
            Boolean(program.opts().json),
          );
          console.error(message);
          process.exitCode = 1;
        } else handleError(error);
      }
    });
}
