/**
 * `todos doctor` referential-integrity plumbing: how a REMOTE authority's counts
 * are obtained, the exit-code contract, and the shared renderer.
 *
 * Background — the defect this file exists to close: the remote doctor path
 * validated auth and route availability, printed three green check marks, and
 * returned a HARDCODED `ok: true`. Against the live authority that meant a dataset
 * with five figures of orphaned rows reported healthy and exited 0, so every other
 * defect in the same dataset stayed invisible. Two rules follow from that:
 *
 *  - the verdict is computed from the SAME condition rows that get printed;
 *  - a condition that could not be measured is UNVERIFIED, never clean.
 */
import chalk from "chalk";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { Project, TaskList } from "../types/index.js";
import {
  adoptRemoteIntegrityReport,
  buildIntegrityReport,
  INTEGRITY_CONDITIONS,
  measureIntegrityRows,
  measuredCondition,
  unverifiedCondition,
  type IntegrityCondition,
  type IntegrityReport,
  type IntegrityRowSets,
  type IntegritySummary,
} from "../lib/integrity.js";
import { cloudGetIntegrityReport, cloudScanTaskRows, type CloudTaskScan } from "./cloud-router.js";

/**
 * `todos doctor` exit-code contract (documented in README and CHANGELOG):
 *
 *   0 — CLEAN: every condition was measured and every count is zero.
 *   1 — FINDINGS: at least one orphan / dangling reference, or an error-severity
 *       schema check. Advisory warnings (stale in_progress tasks, project paths
 *       missing on this machine, duplicate indexes) do NOT trip this.
 *   2 — INCOMPLETE: no findings, but at least one condition could not be measured,
 *       so health was not established. Never reported as clean.
 *
 * Findings dominate: a run with both findings and unverified conditions exits 1
 * and says how many conditions were not checked.
 *
 * `--no-fail-on-findings` SUPPRESSES the gate: the process then exits 0 while the
 * findings are still printed. Two numbers therefore exist and must never be
 * conflated — the VERDICT the rows imply, and the EFFECTIVE status the process
 * returns. Printing one while returning the other would be this command's own
 * defect in miniature, so {@link DoctorVerdict} carries both and every renderer
 * and JSON field states which it is showing.
 */
export const DOCTOR_EXIT_CODES = { clean: 0, findings: 1, incomplete: 2 } as const;

export type DoctorExitCode = 0 | 1 | 2;

export function doctorExitCode(input: { errors: number; findings: number; incomplete: boolean }): DoctorExitCode {
  if (input.findings > 0 || input.errors > 0) return DOCTOR_EXIT_CODES.findings;
  if (input.incomplete) return DOCTOR_EXIT_CODES.incomplete;
  return DOCTOR_EXIT_CODES.clean;
}

export interface DoctorVerdict {
  /** What the reported rows imply, ignoring any suppression. */
  verdict: DoctorExitCode;
  /** What the process actually exits with — the number a caller can observe. */
  effective: DoctorExitCode;
  /** True when the findings gate is active (i.e. `--no-fail-on-findings` absent). */
  fail_on_findings: boolean;
  /** True when the gate was opted out of AND that changed the status. */
  suppressed: boolean;
}

/**
 * Resolve both numbers in one place so the human line, the JSON contract and
 * `process.exitCode` cannot disagree.
 */
export function resolveDoctorVerdict(
  verdict: DoctorExitCode,
  failOnFindings: boolean,
): DoctorVerdict {
  const effective: DoctorExitCode = failOnFindings ? verdict : DOCTOR_EXIT_CODES.clean;
  return {
    verdict,
    effective,
    fail_on_findings: failOnFindings,
    suppressed: effective !== verdict,
  };
}

export interface RemoteIntegrityOptions {
  /**
   * Projects already fetched for the route check — the registered-id denominator
   * for a dangling project reference.
   *
   * ASSUMPTION, shared with `todos lists` / `todos projects`: `GET /v1/projects`
   * and `GET /v1/task-lists` return the COMPLETE collection (neither route takes a
   * limit and neither response carries a `total`, so truncation is not detectable
   * from the envelope). If an authority ever paginates them, a truncated
   * denominator would over-report dangling references — prefer
   * `GET /v1/integrity`, which counts server-side and is immune to this.
   */
  projects: Project[];
  /** Task lists already fetched for the route check (same completeness assumption). */
  taskLists: TaskList[];
  /** Opt in to the paged `/v1/tasks` walk when the authority has no aggregate route. */
  scanTasks: boolean;
}

export interface RemoteIntegrityResult {
  integrity: IntegrityReport;
  scan: CloudTaskScan | null;
}

const NO_AGGREGATE_ROUTE =
  "authority exposes no GET /v1/integrity aggregate; re-run with --scan-tasks to derive this count from /v1/tasks";

/**
 * Referential-integrity report for a remote authority, preferring the server-side
 * aggregate and degrading HONESTLY when it is absent.
 *
 *  1. `GET /v1/integrity` — one SQL COUNT per condition, computed by the backing
 *     engine. When present it is the SOLE source for every condition, so the
 *     verdict cannot mix numbers from two different reads of a moving dataset.
 *  2. Otherwise the two task-LIST conditions are derived from the task-list and
 *     project collections doctor already fetches (cheap, exact, and available on
 *     every authority — these are the rows the old code fetched and threw away).
 *  3. The task-level conditions need every task row, which `/v1/tasks` can only
 *     provide by paging (its filters cannot express `IS NULL`). With `--scan-tasks`
 *     they come from a complete read-only walk; without it — or if the walk could
 *     not complete — they are reported as NOT CHECKED.
 */
export async function buildRemoteIntegrityReport(
  client: HasnaStorageClient,
  options: RemoteIntegrityOptions,
): Promise<RemoteIntegrityResult> {
  const authority = await cloudGetIntegrityReport(client);
  // The authority's counts are adopted; its VERDICT is not. The summary is
  // recomputed from the rows it sent, and any condition this build knows about but
  // the authority did not report becomes UNVERIFIED rather than vanishing.
  if (authority) {
    return { integrity: adoptRemoteIntegrityReport(authority, new Date().toISOString()), scan: null };
  }

  const scan = options.scanTasks ? await cloudScanTaskRows(client) : null;
  const sets: IntegrityRowSets = {
    taskLists: options.taskLists,
    projectIds: new Set(options.projects.map((project) => project.id)),
    taskListIds: new Set(options.taskLists.map((list) => list.id)),
    // A partial walk is not a dataset: only a complete scan may feed the counts.
    ...(scan?.complete ? { tasks: scan.rows } : {}),
  };
  const conditions: IntegrityCondition[] = INTEGRITY_CONDITIONS.map((spec) => {
    const measurement = measureIntegrityRows(spec, sets);
    if (measurement === null) {
      const reason = spec.entity === "task"
        ? (scan ? `task scan incomplete: ${scan.reason ?? "unknown reason"}` : NO_AGGREGATE_ROUTE)
        : NO_AGGREGATE_ROUTE;
      return unverifiedCondition(spec, reason);
    }
    return measuredCondition(spec, measurement, spec.entity === "task" ? "remote-scan" : "remote-rows");
  });
  return { integrity: buildIntegrityReport(conditions, new Date().toISOString()), scan };
}

/**
 * Per-condition breakdown. EVERY condition is printed — including the zeroes —
 * because "we looked and it was clean" and "we never looked" must be visually
 * distinct, which is precisely what three unlabelled green check marks destroyed.
 */
export function printIntegrityReport(report: IntegrityReport): void {
  console.log(chalk.bold("\nReferential integrity"));
  console.log(chalk.dim(`  source: ${report.source} · report-only (never repaired by --apply)`));
  for (const condition of report.conditions) {
    if (!condition.verified) {
      console.log(`  ${chalk.yellow("?")} ${chalk.bold(condition.id)} ${chalk.yellow("NOT CHECKED")} — ${condition.unverified_reason}`);
      continue;
    }
    const count = condition.count ?? 0;
    if (count === 0) {
      console.log(`  ${chalk.green("✓")} ${chalk.bold(condition.id)} 0`);
      continue;
    }
    const icon = condition.severity === "error" ? chalk.red("x") : chalk.yellow("!");
    console.log(`  ${icon} ${chalk.bold(condition.id)} ${count}${condition.open_count ? ` (${condition.open_count} open)` : ""} — ${condition.impact}`);
  }
}

/**
 * Verdict line + exit-code meaning, derived from the printed summary.
 *
 * The parenthetical states the code the process ACTUALLY returns. When the gate
 * was opted out of, it says so and names the code the findings would otherwise
 * have produced — a printed `(exit 1)` next to a process that exits 0 is a
 * printed falsehood, which is the whole class of defect this command was fixed for.
 */
export function printDoctorVerdict(
  verdict: DoctorVerdict,
  summary: IntegritySummary,
  options: { hint?: string } = {},
): void {
  const exitText = verdict.suppressed
    ? `(exit ${verdict.effective} — findings gate suppressed by --no-fail-on-findings; the verdict is ${verdict.verdict})`
    : `(exit ${verdict.effective})`;
  if (verdict.verdict === DOCTOR_EXIT_CODES.clean) {
    console.log(chalk.green(`\n  Integrity clean: ${summary.findings} finding(s), all ${INTEGRITY_CONDITIONS.length} conditions checked. ${exitText}`));
  } else if (verdict.verdict === DOCTOR_EXIT_CODES.findings) {
    console.log(chalk[verdict.suppressed ? "yellow" : "red"](
      `\n  ${summary.findings} integrity condition(s) FAILED — ${summary.rows} row(s) affected ` +
      `(${summary.errors} error, ${summary.warnings} warning). ${exitText}`,
    ));
    if (summary.unverified > 0) console.log(chalk.yellow(`  ${summary.unverified} further condition(s) were NOT checked.`));
  } else {
    console.log(chalk.yellow(
      `\n  INCOMPLETE: no findings, but ${summary.unverified} of ${INTEGRITY_CONDITIONS.length} conditions were NOT checked, ` +
      `so this dataset has NOT been shown to be clean. ${exitText}`,
    ));
  }
  if (options.hint) console.log(chalk.dim(`  ${options.hint}`));
}
