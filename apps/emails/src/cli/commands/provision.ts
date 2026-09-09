import { inspectAddressProvisioningJob, provisionAddress, formatAddressProvisioningResult, addressProvisioningReady, type ProvisionAddressOptions } from "../../lib/address-provisioning-api.js";
import { Option, type Command } from "commander";
import { handleError, parseCliListPage } from "../utils.js";
import type { MxAssessment } from "../../lib/mx-ownership.js";

export interface ProvisionCommandDeps {
  inspectMx?: (domain: string) => Promise<MxAssessment>;
}

export function registerProvisionCommands(program: Command, output: (data: unknown, formatted: string) => void, _deps: ProvisionCommandDeps = {}): void {
  const cmd = program
    .command("provision")
    .description("Inspect provisioning status and manage domain/address provisioning");

  // ── status ────────────────────────────────────────────────────────────────
  cmd
    .command("status [domain]")
    .description("Show provisioning status of domains and addresses")
    .option("--limit <n>", "Maximum domains to show (default 20 compact, 50 verbose/json)")
    .option("--offset <n>", "Number of domains to skip", "0")
    .option("--verbose", "Show all address provisioning rows per domain")
    .action(async (reference: string | undefined, opts: { limit?: string; offset?: string; verbose?: boolean }) => {
      try {
        const { listDomains } = await import("../../db/domains.js");
        const { listDomainProvisioningByIds, listAddressProvisioningByDomains } = await import("../../db/provisioning.js");
        const page = parseCliListPage(opts);
        const normalized = reference?.trim().toLowerCase();
        const matching = listDomains().filter((domain) => !normalized || domain.domain.toLowerCase() === normalized || domain.id.startsWith(normalized));
        if (normalized && matching.length === 0) throw new Error(`Domain not found: ${reference}`);
        if (normalized && matching.length > 1) throw new Error(`Ambiguous domain: ${reference}`);
        const domains = matching.slice(page.offset, page.offset + page.limit);
        const ids = domains.map((domain) => domain.id);
        const [states, addresses] = await Promise.all([listDomainProvisioningByIds(ids), listAddressProvisioningByDomains(ids)]);
        const result = domains.map((domain) => ({ id: domain.id, domain: domain.domain, provider_id: domain.provider_id, provisioning: states.get(domain.id), addresses: addresses.get(domain.id) ?? [] }));
        const lines = result.flatMap((domain) => [
          `${domain.domain}: ${domain.provisioning?.provisioning_status ?? "unknown"} (${domain.addresses.length} addresses)`,
          ...(domain.provisioning?.last_error ? [`  ${domain.provisioning.last_error}`] : []),
          ...(opts.verbose ? domain.addresses.map((address) => `  ${address.email}: ${address.provisioning.provisioning_status}`) : []),
        ]);
        output(result, lines.join("\n") || "No domains registered.");
      } catch (e) { handleError(e); }
    });

  // ── address create ─────────────────────────────────────────────────────────
  cmd
    .command("address <email>")
    .description("Create an email address on a provisioned domain")
    .requiredOption("--provider <id>", "Provider ID")
    .option("--domain <id>", "Domain ID (defaults to the address's domain if registered)")
    .option("--receive <strategy>", "Receive strategy: ses-s3 | cf-routing | resend-webhook", "ses-s3")
    .option("--forward-to <email>", "Forward target (for cf-routing)")
    .option("--owner <name|id>", "Owner (human or agent). Human owners require --administrator.")
    .option("--administrator <name|id>", "Administering agent (required for human owners; defaults to owner for agents)")
    .option("--dry-run", "Resolve inputs and show the planned change without writing address, provisioning, or ownership state")
    .option("--wait", "Advance provisioning now and wait until the address is ready to receive")
    .option("--timeout <sec>", "Max seconds to wait when --wait is used (1–300)", "120")
    .option("--interval <sec>", "Seconds between readiness checks when --wait is used (1–60)", "5")
    .option("--bucket <name>", "Inbound bucket assertion (must match server ingest configuration)")
    .action(async (email: string, opts: ProvisionAddressOptions) => {
      try {
        const result = await provisionAddress(email, opts);
        output(result, formatAddressProvisioningResult(result));
        if (!addressProvisioningReady(result)) process.exitCode = 1;
      } catch (e) { handleError(e); }
    });

  cmd.command("job <id>").description("Read a durable address provisioning receipt")
    .option("--retry", "Recheck readiness using the job's original inputs")
    .action(async (id:string, opts:{retry?:boolean})=>{
      try { const result=await inspectAddressProvisioningJob(id,opts.retry);output(result,formatAddressProvisioningResult(result));if(!addressProvisioningReady(result))process.exitCode=1; }
      catch(error){handleError(error);}
    });

  // ── domain setup ─────────────────────────────────────────────────────────
  cmd
    .command("domain <domain>")
    .description("Provision a domain for sending: SES identity + MAIL FROM + publish DNS in Cloudflare")
    .requiredOption("--provider <id>", "SES provider ID")
    .option("--send <provider>", "Send provider", "ses")
    .option("--add-mx", "Also publish inbound MX (ses-s3 receive)")
    .option("--force-mx-switch", "Allow adding SES inbound MX even when existing root MX belongs to another provider")
    .option("--mail-from <subdomain>", "Custom MAIL FROM subdomain (default mail.<domain>)")
    .option("--dry-run", "Resolve inputs and show the planned change without calling providers or writing to the DB")
    .option("--wait", "Poll SES until the domain is verified for sending")
    .option("--timeout <sec>", "Max seconds to wait for verification", "600")
    .action(async (domain: string, opts: import("../../lib/domain-dns-api.js").DomainDnsOptions) => {
      try {
        const { provisionSendingDomain, formatDomainDns, domainDnsSucceeded } = await import("../../lib/domain-dns-api.js");
        const result = await provisionSendingDomain(domain, opts); output(result, formatDomainDns(result));
        if (!domainDnsSucceeded(result, opts.wait)) process.exitCode = 1;
      } catch (error) { handleError(error); }
    });

  // ── up: full end-to-end orchestrator ─────────────────────────────────────
  cmd
    .command("up <domain>")
    .description("Configure an owned domain, verify existing inbound infrastructure, create addresses and checkpoint delivery tests")
    .requiredOption("--provider <id>", "SES provider ID")
    .option("--addresses <list>", "Comma-separated local parts to create", "one,two,three")
    .option("--bucket <name>", "Inbound S3 bucket (defaults to config inbound_s3_bucket)")
    .option("--add-mx", "Explicitly publish inbound MX (existing MX is preserved by default)", false)
    .option("--no-add-mx", "Preserve existing root MX and skip SES inbound MX publishing")
    .option("--force-mx-switch", "Allow adding SES inbound MX even when existing root MX belongs to another provider")
    .option("--count <n>", "Round-trip messages per pair (0 = skip test)", "1")
    .option("--timeout <sec>", "Max seconds to wait for SES verification", "600")
    .option("--no-test", "Skip the final round-trip test")
     .option("--source <id>", "Poll this bound S3 source for test receipts")
    .option("--dry-run", "Inspect the plan without creating a job or making provider changes")
    .option("--idempotency-key <key>", "Explicit new run identity; reuse it to resume the same intent")
    .addOption(new Option("--buy-if-needed", "Legacy purchase selector").hideHelp())
    .addOption(new Option("--purchase-profile <profile>", "Legacy purchase profile").hideHelp())
    .action(async (domain: string, opts: import("../../lib/provision-up-api.js").ProvisionUpOptions) => {
      const controller = new AbortController(), stop = () => controller.abort();
      let checkpoint: import("../../lib/provision-up-api.js").ProvisionUpResult | undefined;
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      try {
        const api = await import("../../lib/provision-up-api.js");
        const result = await api.runProvisionUp(domain, opts, controller.signal, value => { checkpoint = value; });
        output(result, api.formatProvisionUp(result));
        if (!api.provisionUpSucceeded(result)) process.exitCode = 1;
      } catch (error) {
        if (checkpoint) { const api = await import("../../lib/provision-up-api.js"); output(checkpoint, api.formatProvisionUp(checkpoint)); }
        if (controller.signal.aborted) { process.exitCode = 130; if (!checkpoint) output({ interrupted: true }, "Provisioning interrupted. Inspect existing runs before starting another identity."); }
        else handleError(error);
      } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    });

  // ── roundtrip (acceptance test) ─────────────────────────────────────────
  cmd
    .command("roundtrip")
    .description("Send tokened emails around an address ring and verify their receipts in the shared API inbox")
    .requiredOption("--domain <domain>", "Domain whose addresses to test")
    .requiredOption("--provider <id>", "Server provider ID for sending and optional inbound source association")
    .option("--addresses <list>", "Comma-separated local parts", "one,two,three")
    .option("--count <n>", "Messages per directed pair", "16")
    .option("--profile <profile>", "Legacy AWS profile selector; server-owned credentials require --source instead")
    .option("--source <id>", "Also poll this server-bound S3 source during receipt checks")
    .option("--bucket <name>", "Also sync S3, asserting this bucket matches the server source binding")
    .option("--sync-cursor <cursor>", "Resume S3 polling from a previous incomplete roundtrip result")
    .option("--idempotency-key <key>", "Reuse this run identity to safely resume sends after an interrupted run")
    .option("--poll-attempts <n>", "Receipt poll attempts", "12")
    .option("--poll-interval <ms>", "Receipt poll interval ms", "10000")
    .option("--throttle <ms>", "Delay between sends (SES sandbox = 1100)", "1100")
    .action(async (opts: import("../../lib/roundtrip-api.js").RoundtripOptions) => {
      const controller = new AbortController();
      let runId = opts.idempotencyKey;
      const stop = () => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        const { planRoundtrip, runRoundtrip, createRoundtripMail } = await import("../../lib/roundtrip-api.js");
        const plan = planRoundtrip(opts);
        runId = plan.runId;
        if (opts.syncCursor && !opts.source && !opts.bucket) throw new Error("A sync cursor requires --source or --bucket.");
        const mail = await createRoundtripMail(controller.signal);
        const sync = opts.source || opts.bucket
          ? await (await import("../../lib/inbox-ingest-api.js")).createInboxIngestClient("sync-s3", controller.signal)
          : undefined;
        const result = await runRoundtrip({ ...opts, idempotencyKey: plan.runId }, { mail, sync, signal: controller.signal });
        output(result, [`Roundtrip ${result.run_id}: ${result.received}/${result.expected} receipts verified; ${result.confirmed_sent} sends confirmed.`,
          ...result.errors, ...result.items.filter(item => item.error).map(item => `${item.from} → ${item.to}: ${item.error}`),
          ...(!result.complete ? [`Resume with --idempotency-key ${result.run_id}${result.sync_cursor ? ` --sync-cursor ${result.sync_cursor}` : ""}.`] : [])].join("\n"));
        if (!result.complete) process.exitCode = controller.signal.aborted ? 130 : 1;
      } catch (e) {
        if (controller.signal.aborted) {
          output({ run_id: runId ?? null, complete: false, confirmed_sent: 0, received: 0, errors: ["Roundtrip interrupted before sending."] }, "Roundtrip interrupted before sending.");
          process.exitCode = 130;
        } else handleError(e);
      }
      finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    });

  // ── daemon (reconciler loop) ─────────────────────────────────────────────
  cmd
    .command("daemon")
    .description("Advance existing authorized provisioning runs one bounded step per tick")
    .requiredOption("--provider <id>", "SES provider ID")
    .option("--bucket <name>", "Inbound S3 bucket (defaults to config inbound_s3_bucket)")
    .option("--add-mx", "Only advance saved runs that explicitly requested MX publication")
    .option("--force-mx-switch", "Allow adding SES inbound MX even when existing root MX belongs to another provider")
    .option("--once", "Run a single reconcile tick and exit")
    .option("--interval <sec>", "Seconds between ticks", "30")
    .option("--max-ticks <n>", "Stop after N ticks (default: unlimited)")
    .action(async (opts) => {
      const controller = new AbortController(), stop = () => controller.abort();
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      try {
        const { runProvisionDaemon } = await import("../../lib/provision-up-api.js");
        await runProvisionDaemon(opts, controller.signal, result => {
          output(result, result.jobs.map(job => `${job.input.domain}: ${job.status} (${job.id}, ${job.receipt?.phase ?? "pending"})`).join("\n") || "No matching provisioning runs are due.");
          if (result.jobs.some(job => job.status === "blocked")) process.exitCode = 1;
        });
      } catch (error) { if (controller.signal.aborted) process.exitCode = 130; else handleError(error); }
      finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    });

  // ── retry ───────────────────────────────────────────────────────────────
  cmd
    .command("retry <domain>")
    .description("Resume a saved provisioning intent while retaining its evidence and send identities")
    .option("--provider <id>", "Provider ID")
    .option("--job <id>", "Exact saved run ID (required if multiple runs match)")
    .action(async (domain: string, opts: { provider?: string; job?: string }) => {
      try { const api = await import("../../lib/provision-up-api.js"); const result = await api.retryProvisionUp(domain, opts); output(result, api.formatProvisionUp(result)); }
      catch (error) { handleError(error); }
    });
  cmd.command("run <id>").description("Inspect a durable full provisioning run and its delivery evidence")
    .action(async (id: string) => { try { const api = await import("../../lib/provision-up-api.js"); const result = await api.inspectProvisionUp(id); output(result, api.formatProvisionUp(result)); } catch (error) { handleError(error); } });
}
