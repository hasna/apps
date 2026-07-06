import type { Command } from "commander";
import { runMigrations } from "../../server/migrations.js";

/**
 * `domains db migrate` — apply cloud Postgres migrations against the owner DSN.
 * Used by the one-shot ECS migration task (migrate-before-service-update).
 */
export function registerDbCommands(program: Command): void {
  const db = program.command("db").description("Cloud database migrations (Postgres / RDS)");

  db.command("migrate")
    .description("Apply all pending migrations to the cloud Postgres (owner DSN)")
    .option("--dry-run", "Report the plan without applying", false)
    .option("--json", "Output JSON", false)
    .action(async (opts: { dryRun?: boolean; json?: boolean }) => {
      try {
        const result = await runMigrations({ dryRun: Boolean(opts.dryRun) });
        const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
        const applied = result.applied.map((a) => a.id);
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, dryRun: result.dryRun, pending, applied }, null, 2));
        } else if (result.dryRun) {
          console.log(`Dry run — ${pending.length} pending migration(s):`);
          for (const id of pending) console.log(`  • ${id}`);
          if (pending.length === 0) console.log("  (schema up to date)");
        } else {
          console.log(`✓ migrations applied — ${applied.length} total, ${pending.length} were pending`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (opts.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
        else console.error(`✗ migration failed: ${msg}`);
        process.exitCode = 1;
      }
    });

  db.command("status")
    .description("Show pending/applied migrations without changing anything")
    .option("--json", "Output JSON", false)
    .action(async (opts: { json?: boolean }) => {
      try {
        const result = await runMigrations({ dryRun: true });
        const pending = result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
        const applied = result.applied.map((a) => a.id);
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, pending, applied }, null, 2));
        } else {
          console.log(`Applied: ${applied.length}   Pending: ${pending.length}`);
          for (const id of pending) console.log(`  pending: ${id}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (opts.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
        else console.error(`✗ ${msg}`);
        process.exitCode = 1;
      }
    });
}
