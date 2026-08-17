#!/usr/bin/env bun
/**
 * Slug-prefix normalization runner (hosted authority).
 *
 * Renames every project whose slug carries the legacy auto-added `todos-`
 * prefix to the unprefixed slug, per docs/slug-prefix-normalization.md.
 *
 * - DRY-RUN by default: enumerates, computes the plan, prints it, mutates
 *   nothing, exits 0.
 * - `--apply` performs the renames through the installed `todos` CLI
 *   (`project-rename`), which is atomic and collision-checked server-side.
 * - Collision safety: a prefixed slug whose unprefixed twin already exists is
 *   renamed ONLY when an explicit resolution row is present (keyed by
 *   prefixed slug) — the 19 measured collisions are pre-seeded with their
 *   section-4 resolutions. No resolution row => the rename is skipped and
 *   reported, never guessed.
 * - Read-only enumeration uses `todos projects --json`; no hosted data is
 *   mutated in dry-run mode.
 *
 * Usage:
 *   bun run scripts/normalize-slug-prefixes.ts            # dry run
 *   bun run scripts/normalize-slug-prefixes.ts --apply    # gated apply
 */
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const PREFIX = "todos-";

// Collision resolutions, keyed by the PREFIXED slug (see docs/slug-prefix-
// normalization.md section 4). `merged`/`archived` rows are operator-
// confirmed during the apply run; the script only guarantees the rename
// decision is explicit, never guessed.
const COLLISION_RESOLUTIONS: Record<string, string> = {
  "todos-platform-codewith": "archive-keep -> rename to platform-codewith-archived",
  "todos-iapp-digital": "merge into iapp-digital (case-variant duplicate)",
  "todos-iapp-leads": "merge into iapp-leads (case-variant duplicate)",
  "todos-iapp-sms": "merge into iapp-sms (case-variant duplicate)",
  "todos-loops": "merge into loops (mac/station duplicate)",
  "todos-open-bridge": "merge into open-bridge (mac/station duplicate)",
  "todos-open-changelog": "merge into open-changelog (mac/station duplicate)",
  "todos-open-computer": "merge into open-computer (mac/station duplicate)",
  "todos-open-deployment": "merge into open-deployment (mac/station duplicate)",
  "todos-open-gateway": "merge into open-gateway (mac/station duplicate)",
  "todos-open-identities": "merge into open-identities (mac/station duplicate)",
  "todos-open-logs": "merge into open-logs (mac/station duplicate)",
  "todos-open-researcher": "merge into open-researcher (mac/station duplicate)",
  "todos-open-signatures": "confirm holder, then merge/archive loser",
  "todos-open-testers": "merge into open-testers (mac/station duplicate)",
  "todos-platform-pawk": "merge into platform-pawk (duplicate row)",
  "todos-platform-mailery": "merge into platform-mailery (duplicate row)",
  "todos-platform-mcps": "merge into platform-mcps (duplicate row)",
  "todos-platform-p2w": "merge into platform-p2w (mac/station duplicate)",
};

interface Project {
  id: string;
  task_list_id: string;
  name: string;
}

function runCli(args: string[], json = true): { ok: boolean; data: unknown; raw: string } {
  const res = spawnSync("todos", json ? [...args, "--json"] : args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    return { ok: false, data: null, raw: `${res.status}: ${res.stderr ?? res.stdout ?? ""}` };
  }
  try {
    return { ok: true, data: json ? JSON.parse(res.stdout) : res.stdout, raw: res.stdout };
  } catch {
    return { ok: false, data: null, raw: res.stdout };
  }
}

function main(): void {
  const listed = runCli(["projects"]);
  if (!listed.ok) {
    console.error(`normalize: could not enumerate projects: ${listed.raw}`);
    process.exit(1);
  }
  const projects = (listed.data as Project[]) ?? [];
  const bySlug = new Map(projects.map((p) => [p.task_list_id, p]));
  const prefixed = projects.filter((p) => p.task_list_id.startsWith(PREFIX));
  const renames: { from: string; to: string; id: string; collision: boolean }[] = [];
  const collisions: { from: string; to: string; resolution: string }[] = [];
  const skipped: { from: string; reason: string }[] = [];
  let empty = 0;

  for (const p of prefixed) {
    const candidate = p.task_list_id.slice(PREFIX.length);
    if (!candidate) {
      empty++;
      skipped.push({ from: p.task_list_id, reason: "empty after prefix strip" });
      continue;
    }
    const holder = bySlug.get(candidate);
    const collision = Boolean(holder && holder.id !== p.id);
    if (collision) {
      const resolution = COLLISION_RESOLUTIONS[p.task_list_id];
      if (!resolution) {
        skipped.push({ from: p.task_list_id, reason: `collision with ${candidate} and no resolution row` });
        continue;
      }
      // Collision rows are NOT renamed by this script; they follow the
      // merge/archive procedure in docs/slug-prefix-normalization.md §4
      // (operator-confirmed, data-preserving).
      collisions.push({ from: p.task_list_id, to: candidate, resolution });
      continue;
    }
    renames.push({ from: p.task_list_id, to: candidate, id: p.id, collision: false });
  }

  console.log(`normalize: ${projects.length} projects | ${prefixed.length} prefixed | ${renames.length} planned | ${collisions.length} manual-collision | ${skipped.length} skipped`);
  for (const r of renames) {
    console.log(`  ${r.from} -> ${r.to}  (${r.id})`);
  }
  for (const c of collisions) {
    console.log(`  MANUAL ${c.from}: unprefixed ${c.to} already exists — ${c.resolution}`);
  }
  for (const s of skipped) console.log(`  SKIP ${s.from}: ${s.reason}`);
  if (empty) console.log(`  NOTE: ${empty} slug(s) empty after strip (never renamed)`);

  if (!APPLY) {
    console.log("normalize: DRY RUN — no mutations performed. Re-run with --apply after review.");
    process.exit(0);
  }

  let applied = 0;
  let failed = 0;
  for (const r of renames) {
    const res = runCli(["project-rename", r.from, r.to]);
    if (!res.ok) {
      failed++;
      console.error(`  FAIL ${r.from} -> ${r.to}: ${res.raw}`);
      continue;
    }
    applied++;
    console.log(`  OK   ${r.from} -> ${r.to}`);
  }
  console.log(`normalize: apply finished — ${applied} renamed, ${failed} failed, ${collisions.length} manual-collision, ${skipped.length} skipped`);
  if (failed > 0 || skipped.length > 0) process.exit(1);
}

main();
