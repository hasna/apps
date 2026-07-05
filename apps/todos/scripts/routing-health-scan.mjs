#!/usr/bin/env bun
/**
 * routing-health-scan — deterministic OpenLoops command-loop target.
 *
 * Runs `todos doctor routing --json` over a bounded shard/scope, consumes ONLY
 * the JSON contract + exit code (no human-text scraping), and upserts a single
 * deduped routing-health task per scope (stable fingerprint) that surfaces the
 * finding counts. It never dispatches implementation agents and never applies a
 * repair — surfacing only. The paired remediation workflow owns safe fixes.
 *
 * Exit codes mirror the doctor for the loop: 0 clean, 1 findings, 2 error.
 *
 * Usage:
 *   bun scripts/routing-health-scan.mjs [--shard i/N] [--project <id>] [--tag <t>]
 *      [--status a,b] [--source-tags routing-health,from-kai] [--todos-bin todos]
 *      [--dry-run]
 */
import { spawnSync } from "node:child_process";

/**
 * Pure core: turn a routing-doctor result into a deduped upsert spec (or null
 * when the scope is clean). Deterministic — same result in ⇒ same spec out, and
 * the fingerprint is stable per scope so re-runs UPDATE rather than duplicate.
 * @param {object} doctor  Parsed `todos doctor routing --json` result.
 * @param {{ sourceTags?: string[] }} [opts]
 * @returns {{ fingerprint: string, title: string, tags: string[], metadata: object } | null}
 */
export function buildRoutingHealthUpsert(doctor, opts = {}) {
  const sourceTags = opts.sourceTags && opts.sourceTags.length > 0 ? opts.sourceTags : ["routing-health", "from-kai"];
  const s = doctor?.summary ?? {};
  if (!doctor || (s.findings_total ?? 0) === 0) return null;

  const scope = doctor.scope ?? {};
  const scopeKey = scope.shard
    ? `shard:${scope.shard.index}-${scope.shard.total}`
    : scope.project_id
      ? `project:${scope.project_id}`
      : scope.tag
        ? `tag:${scope.tag}`
        : "all";
  const fingerprint = `routing-health:${scopeKey}`;
  const cats = Object.entries(s.by_category ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const title = `Routing drift [${scopeKey}]: ${s.findings_total} findings (${s.safe_auto ?? 0} safe_auto · ${s.blockers ?? 0} blockers · ${s.unsupported ?? 0} unsupported)`;

  return {
    fingerprint,
    title,
    tags: Array.from(new Set(sourceTags)),
    metadata: {
      routing_health: {
        schema_version: doctor.schema_version ?? null,
        scope,
        summary: s,
        category_breakdown: cats,
        generated_at: doctor.generated_at ?? null,
      },
    },
  };
}

/** One concise line for the loop log. */
export function oneLineSummary(doctor) {
  const s = doctor?.summary ?? {};
  const scope = doctor?.scope ?? {};
  const scopeKey = scope.shard ? `${scope.shard.index}/${scope.shard.total}` : scope.project_id ? `project` : scope.tag ? `tag:${scope.tag}` : "all";
  if ((s.findings_total ?? 0) === 0) return `routing-health ${scopeKey}: clean (${s.inspected ?? 0} inspected)`;
  return `routing-health ${scopeKey}: ${s.findings_total} findings, ${s.safe_auto ?? 0} safe_auto, ${s.blockers ?? 0} blockers (${s.inspected ?? 0} inspected)`;
}

function parseArgs(argv) {
  const out = { sourceTags: ["routing-health", "from-kai"], todosBin: "todos", dryRun: false, doctorArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--todos-bin") out.todosBin = argv[++i];
    else if (a === "--source-tags") out.sourceTags = String(argv[++i]).split(",").map((t) => t.trim()).filter(Boolean);
    else if (a === "--shard") out.doctorArgs.push("--shard", argv[++i]);
    else if (a === "--project") out.doctorArgs.push("--project", argv[++i]);
    else if (a === "--tag") out.doctorArgs.push("--tag", argv[++i]);
    else if (a === "--status") out.doctorArgs.push("--status", argv[++i]);
    else if (a === "--no-verify-project-root") out.doctorArgs.push("--no-verify-project-root");
  }
  return out;
}

/**
 * Doctor JSON is large at fleet scale (measured 8.99 MB for ~8.4k tasks /
 * ~10.9k findings; one 1/6 shard is already ~789 KB). The runtime default
 * spawnSync maxBuffer is 1 MB, which fails deterministically with ENOBUFS on
 * the real corpus — so every child invocation pins an explicit 256 MB ceiling.
 */
export const SPAWN_MAX_BUFFER = 256 * 1024 * 1024;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const doctorRun = spawnSync(opts.todosBin, ["doctor", "routing", "--json", ...opts.doctorArgs], { encoding: "utf8", maxBuffer: SPAWN_MAX_BUFFER });
  // doctor exit: 0 clean, 1 findings, 2 usage. Anything else (spawn failure) is an error.
  if (doctorRun.error || doctorRun.status === null || doctorRun.status > 2) {
    console.error(`routing-health-scan: doctor invocation failed: ${doctorRun.error?.message ?? `exit ${doctorRun.status}`}`);
    process.exit(2);
  }
  let doctor;
  try {
    doctor = JSON.parse(doctorRun.stdout);
  } catch (e) {
    console.error(`routing-health-scan: could not parse doctor JSON: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }

  console.log(oneLineSummary(doctor));
  const spec = buildRoutingHealthUpsert(doctor, { sourceTags: opts.sourceTags });
  if (!spec) process.exit(0);

  if (opts.dryRun) {
    console.log(`routing-health-scan (dry-run): would upsert fingerprint=${spec.fingerprint} tags=${spec.tags.join(",")}`);
    process.exit(1);
  }

  const upsert = spawnSync(
    opts.todosBin,
    [
      "task", "upsert",
      "--fingerprint", spec.fingerprint,
      "--title", spec.title,
      "--tag", spec.tags.join(","),
      "--metadata-json", JSON.stringify(spec.metadata),
      "--json",
    ],
    { encoding: "utf8", maxBuffer: SPAWN_MAX_BUFFER },
  );
  if (upsert.status !== 0) {
    console.error(`routing-health-scan: task upsert failed: ${upsert.stderr || `exit ${upsert.status}`}`);
    process.exit(2);
  }
  console.log(`routing-health-scan: upserted ${spec.fingerprint}`);
  process.exit(1); // findings present ⇒ nonzero for the loop's SLO/exit semantics
}

if (import.meta.main) main();
