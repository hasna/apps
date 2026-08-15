/**
 * Audience / consent / suppression commands (distribution apps plan).
 *
 *   contacts audience create <slug> --name <name> --predicates <json> [--match all|any] [--policy <policy>]
 *   contacts audience list
 *   contacts audience show <id>
 *   contacts audience delete <id>
 *   contacts audience resolve <id> --channel email|telegram|sms [--json]
 *   contacts consent set <contactId> --channel <channel> --status opt_in|opt_out|unknown [--source <source>]
 *   contacts consent show <contactId>
 *   contacts suppression add <address> --channel <channel> [--contact <id>] [--reason <reason>]
 *   contacts suppression remove <address> --channel <channel>
 *   contacts suppression list [--channel <channel>] [--unsynced]
 *   contacts suppression sync [--dry-run]
 */
import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../../store/index.js";
import { toAudienceContract } from "../../lib/audience-contract.js";
import type { AudienceChannel, AudiencePredicate, ConsentPolicy, ConsentStatus } from "../../types/index.js";
import { AUDIENCE_CHANNELS, CONSENT_POLICIES, CONSENT_STATUSES } from "../../types/index.js";
import { renderTable } from "../utils.js";

function fail(message: string): never {
  console.error(chalk.red(`\n${message}\n`));
  process.exit(1);
}

function parseChannel(value: string | undefined): AudienceChannel {
  if (!value || !(AUDIENCE_CHANNELS as readonly string[]).includes(value)) {
    fail(`--channel must be one of: ${AUDIENCE_CHANNELS.join("|")}`);
  }
  return value as AudienceChannel;
}

function parsePredicates(raw: string): AudiencePredicate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("--predicates must be valid JSON, e.g. '[{\"kind\":\"tag\",\"value\":\"beta\"}]'");
  }
  if (!Array.isArray(parsed)) fail("--predicates must be a JSON array of predicate objects");
  return parsed as AudiencePredicate[];
}

export function registerAudienceCommands(program: Command): void {

// ─── contacts audience ────────────────────────────────────────────────────────

const audience = program.command("audience").description("Manage audience segments (hasna.audience.v1)");

audience
  .command("create <slug>")
  .description("Create an audience segment from predicates over tags/attributes/groups")
  .requiredOption("--name <name>", "Human-readable audience name")
  .requiredOption("--predicates <json>", "JSON array of predicates, e.g. '[{\"kind\":\"tag\",\"value\":\"beta\"}]'")
  .option("--match <match>", "Predicate combinator: all|any", "all")
  .option("--policy <policy>", `Consent policy: ${CONSENT_POLICIES.join("|")}`, "opt_in")
  .option("--json", "Output JSON")
  .action(async (slug: string, opts: { name: string; predicates: string; match: string; policy: string; json?: boolean }) => {
    const store = getStore();
    if (!["all", "any"].includes(opts.match)) fail("--match must be all or any");
    if (!(CONSENT_POLICIES as readonly string[]).includes(opts.policy)) {
      fail(`--policy must be one of: ${CONSENT_POLICIES.join("|")}`);
    }
    try {
      const created = await store.createAudience({
        audience_id: slug,
        name: opts.name,
        match: opts.match as "all" | "any",
        predicates: parsePredicates(opts.predicates),
        consent_policy: opts.policy as ConsentPolicy,
      });
      if (opts.json) {
        console.log(JSON.stringify(created, null, 2));
        return;
      }
      console.log(chalk.green(`\nCreated audience ${created.audience_id} (${created.id})\n`));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

audience
  .command("list")
  .description("List audience segments")
  .option("--json", "Output JSON")
  .action(async (opts: { json?: boolean }) => {
    const store = getStore();
    const audiences = await store.listAudiences();
    if (opts.json) {
      console.log(JSON.stringify(audiences, null, 2));
      return;
    }
    if (!audiences.length) {
      console.log(chalk.yellow("\nNo audiences yet. Create one with: contacts audience create\n"));
      return;
    }
    console.log();
    renderTable(
      ["Audience", "Name", "Match", "Policy", "Predicates", "Synced"],
      audiences.map((a) => ({
        Audience: a.audience_id,
        Name: a.name,
        Match: a.match,
        Policy: a.consent_policy,
        Predicates: String(a.predicates.length),
        Synced: a.suppression_synced_at || "never",
      })),
    );
    console.log(chalk.gray(`\n${audiences.length} audience(s)\n`));
  });

audience
  .command("show <id>")
  .description("Show an audience as its hasna.audience.v1 contract document")
  .action(async (id: string) => {
    const store = getStore();
    try {
      console.log(JSON.stringify(toAudienceContract(await store.getAudience(id)), null, 2));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

audience
  .command("delete <id>")
  .description("Delete an audience segment")
  .action(async (id: string) => {
    const store = getStore();
    try {
      await store.deleteAudience(id);
      console.log(chalk.green(`\nDeleted audience ${id}\n`));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

audience
  .command("resolve <id>")
  .description("Resolve an audience to recipients for a channel, honoring consent + suppression")
  .requiredOption("--channel <channel>", `Delivery channel: ${AUDIENCE_CHANNELS.join("|")}`)
  .option("--json", "Output JSON")
  .action(async (id: string, opts: { channel: string; json?: boolean }) => {
    const store = getStore();
    const channel = parseChannel(opts.channel);
    try {
      const resolution = await store.resolveAudience(id, channel);
      if (opts.json) {
        console.log(JSON.stringify(resolution, null, 2));
        return;
      }
      console.log();
      console.log(chalk.bold.blue(`━━━ Audience ${resolution.audience_id} → ${resolution.channel} ━━━`));
      console.log(chalk.gray(`  Policy: ${resolution.consent_policy}  Matched: ${resolution.matched}  Recipients: ${resolution.recipients.length}  Excluded: ${resolution.excluded.length}`));
      if (resolution.recipients.length) {
        console.log();
        renderTable(
          ["Contact", "Address", "Consent"],
          resolution.recipients.map((r) => ({ Contact: r.display_name, Address: r.address, Consent: r.consent_status })),
        );
      }
      if (resolution.excluded.length) {
        console.log();
        console.log(chalk.gray("  Excluded:"));
        for (const e of resolution.excluded) console.log(chalk.gray(`    ${e.contact_id} (${e.reason})`));
      }
      console.log();
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

// ─── contacts consent ─────────────────────────────────────────────────────────

const consent = program.command("consent").description("Manage per-channel subscription consent for contacts");

consent
  .command("set <contactId>")
  .description("Set a contact's consent status for a channel")
  .requiredOption("--channel <channel>", `Channel: ${AUDIENCE_CHANNELS.join("|")}`)
  .requiredOption("--status <status>", `Status: ${CONSENT_STATUSES.join("|")}`)
  .option("--source <source>", "Where the consent signal came from (form, import, reply, ...)")
  .action(async (contactId: string, opts: { channel: string; status: string; source?: string }) => {
    const store = getStore();
    const channel = parseChannel(opts.channel);
    if (!(CONSENT_STATUSES as readonly string[]).includes(opts.status)) {
      fail(`--status must be one of: ${CONSENT_STATUSES.join("|")}`);
    }
    try {
      const record = await store.setContactConsent(contactId, channel, opts.status as ConsentStatus, opts.source);
      console.log(chalk.green(`\nConsent for ${contactId} on ${record.channel}: ${record.status}\n`));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

consent
  .command("show <contactId>")
  .description("Show a contact's consent status per channel")
  .option("--json", "Output JSON")
  .action(async (contactId: string, opts: { json?: boolean }) => {
    const store = getStore();
    const records = await store.listContactConsent(contactId);
    if (opts.json) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }
    if (!records.length) {
      console.log(chalk.yellow(`\nNo consent records for ${contactId} (all channels: unknown)\n`));
      return;
    }
    console.log();
    renderTable(
      ["Channel", "Status", "Source", "Updated"],
      records.map((r) => ({ Channel: r.channel, Status: r.status, Source: r.source || "", Updated: r.updated_at })),
    );
    console.log();
  });

// ─── contacts suppression ─────────────────────────────────────────────────────

const suppression = program.command("suppression").description("Manage suppressed addresses and sync them to mailery");

suppression
  .command("add <address>")
  .description("Suppress an address on a channel (also opt-outs the linked contact)")
  .requiredOption("--channel <channel>", `Channel: ${AUDIENCE_CHANNELS.join("|")}`)
  .option("--contact <contactId>", "Contact this address belongs to")
  .option("--reason <reason>", "Why the address is suppressed (unsubscribe, bounce, complaint, ...)")
  .action(async (address: string, opts: { channel: string; contact?: string; reason?: string }) => {
    const store = getStore();
    const channel = parseChannel(opts.channel);
    try {
      const entry = await store.suppressAddress({ channel, address, contact_id: opts.contact, reason: opts.reason });
      console.log(chalk.green(`\nSuppressed ${entry.address} on ${entry.channel}\n`));
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

suppression
  .command("remove <address>")
  .description("Remove an address from the suppression list")
  .requiredOption("--channel <channel>", `Channel: ${AUDIENCE_CHANNELS.join("|")}`)
  .action(async (address: string, opts: { channel: string }) => {
    const store = getStore();
    await store.unsuppressAddress(parseChannel(opts.channel), address);
    console.log(chalk.green(`\nUnsuppressed ${address}\n`));
  });

suppression
  .command("list")
  .description("List suppressed addresses")
  .option("--channel <channel>", `Filter by channel: ${AUDIENCE_CHANNELS.join("|")}`)
  .option("--unsynced", "Only entries not yet pushed to mailery")
  .option("--json", "Output JSON")
  .action(async (opts: { channel?: string; unsynced?: boolean; json?: boolean }) => {
    const store = getStore();
    const channel = opts.channel ? parseChannel(opts.channel) : undefined;
    const entries = await store.listSuppressions({ channel, unsyncedOnly: opts.unsynced });
    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (!entries.length) {
      console.log(chalk.yellow("\nNo suppressions recorded\n"));
      return;
    }
    console.log();
    renderTable(
      ["Address", "Channel", "Reason", "Synced"],
      entries.map((e) => ({ Address: e.address, Channel: e.channel, Reason: e.reason || "", Synced: e.synced_at || "pending" })),
    );
    console.log(chalk.gray(`\n${entries.length} suppression(s)\n`));
  });

suppression
  .command("sync")
  .description("Push unsynced email suppressions to mailery (@hasna/mailery)")
  .option("--dry-run", "Report what would be pushed without pushing")
  .action(async (opts: { dryRun?: boolean }) => {
    const store = getStore();
    try {
      const result = await store.syncSuppressions(opts.dryRun);
      if (result.dry_run) {
        console.log(chalk.cyan(`\n[dry-run] ${result.pending} suppression(s) pending push via ${result.adapter}\n`));
        return;
      }
      console.log(chalk.green(`\nPushed ${result.pushed}/${result.pending} suppression(s) via ${result.adapter}`));
      for (const f of result.failed) console.log(chalk.red(`  failed: ${f.address} — ${f.error}`));
      console.log();
      if (result.failed.length) process.exit(1);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

}
