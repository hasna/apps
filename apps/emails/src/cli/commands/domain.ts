import { connectDomain, formatDomainConnection, type ConnectDomainOptions } from "../../lib/domain-connect-api.js";
import { selfHostedApiRequest } from "../../db/self-hosted-store.js";
import { Option, type Command } from "commander";
import type { DnsRecord, Provider } from "../../types/index.js";
import chalk from "../../lib/chalk-lite.js";
import { listDomains, listUsableDomains, deleteDomain, findDomainsByName, getDomain, getDomainByName, moveDomainProvider } from "../../db/domains.js";
import { getProvider } from "../../db/providers.js";
import { providerDnsPublishing } from "../../providers/index.js";
import { createWarmingSchedule, deleteWarmingSchedule, getWarmingSchedule, listWarmingSchedules, updateWarmingStatus } from "../../db/warming.js";
import { describeWarmingProgress, formatWarmingStatus, generateWarmingPlan, getTodaySentCountsByDomain, type WarmingSchedule } from "../../lib/warming.js";
import { colorDnsStatus, tableRow, truncate } from "../../lib/format.js";
import { confirmDestructiveAction, formatListHint, handleError, isCliVerboseOutput, parseCliListPage, parseCliPage, resolveId } from "../utils.js";
import { normalizeRoute53RegistrationContact } from "../../lib/route53-contact.js";

/**
 * The DNS records `domain` is expected to publish.
 *
 * Mirrors the MCP `get_dns_records` tool: the provider's own records when a
 * provider resolves (explicitly, or from the domain's registration), otherwise
 * the generic SES SPF + DMARC pair, which needs no credentials at all. Both
 * `dns` and `check` need exactly this, so they share it rather than each
 * growing their own resolution rules.
 */
async function expectedDnsRecords(
  domain: string,
  providerRef: string | undefined,
): Promise<{ records: DnsRecord[]; providerId: string | null; provider: Provider | null; dkimUnavailable: string | null }> {
  let provider = null;
  if (providerRef) {
    const providerId = resolveId("providers", providerRef);
    provider = getProvider(providerId);
    if (!provider) handleError(new Error(`Provider not found: ${providerRef}`));
  } else {
    const registered = findDomainsByName(domain)[0];
    if (registered) provider = getProvider(registered.provider_id);
  }
  const generic = async (): Promise<DnsRecord[]> => {
    const { generateSpfRecord, generateDmarcRecord } = await import("../../lib/dns.js");
    return [generateSpfRecord(domain), generateDmarcRecord(domain)];
  };
  if (!provider) {
    return { records: await generic(), providerId: null, provider: null, dkimUnavailable: null };
  }
  if (!providerDnsPublishing(provider).publishes) return { records: [], providerId: provider.id, provider, dkimUnavailable: null };
  const { readRegisteredDomainDns } = await import("../../lib/domain-records-api.js");
  const result = await readRegisteredDomainDns(domain, providerRef);
  return { records: result.records as DnsRecord[], providerId: provider.id, provider, dkimUnavailable: null };
}


function resolveSelfHostedDomainId(ref: string): string {
  const exact = getDomain(ref);
  if (exact) return exact.id;
  // Matches the domain NAME as well as an id prefix: every sibling domain verb
  // takes the name, and `domain list` prints it — a remove that refused the
  // name was the family's one odd verb out (task 55c19dde).
  const wanted = ref.trim().toLowerCase();
  const matches = listDomains()
    .filter((domain) => domain.id.startsWith(ref) || domain.domain.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    handleError(new Error(`Domain ID is ambiguous: ${matches.map((domain) => domain.id.slice(0, 8)).join(", ")}`));
  }
  handleError(new Error(`Domain not found: ${ref}`));
}

export function registerDomainCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  const lifecycle = (action: string) => async (ref: string, opts: { provider?: string; force?: boolean }) => {
    try {
      if (opts.provider !== undefined && !opts.provider.trim()) throw new Error("--provider must name a provider ID.");
      if (opts.force) throw new Error("Readiness checks cannot be bypassed. Fix the reported DNS/provider prerequisites before enabling mail.");
      if (action === "verify") {
        const { verifyRegisteredDomain } = await import("../../lib/domain-records-api.js");
        const result = await verifyRegisteredDomain(ref, opts.provider);
        output(result, JSON.stringify(result, null, 2) + "\n");
        return;
      }
      const domainId = resolveSelfHostedDomainId(ref);
      const providerId = opts.provider ? resolveId("providers", opts.provider) : undefined;
      const result = selfHostedApiRequest("POST", `/domains/${encodeURIComponent(domainId)}/${action}`, providerId ? { provider_id: providerId } : {});
      if (result.status < 200 || result.status >= 300) {
        const error = result.json as { error?: string };
        throw new Error(error?.error ?? `Domain operation failed (HTTP ${result.status}).`);
      }
      output(result.json, JSON.stringify(result.json, null, 2) + "\n");
    } catch (error) { handleError(error); }
  };
  const domainCmd = program.command("domain").description("Manage sending domains");
  const domainsCmd = program.command("domains").description("Manage domain lifecycle");

  const listDomainsAction = (opts: { provider?: string; limit?: string; offset?: string; verbose?: boolean }) => {
    try {
      const page = parseCliPage(opts);
      const domains = opts.limit === undefined
        ? listDomains(opts.provider).slice(page.offset)
        : listDomains(opts.provider, page);
      if (domains.length === 0) {
        output([], chalk.dim("No domains configured."));
        return;
      }
      const lines: string[] = [chalk.bold("\nDomains:")];
      for (const d of domains) {
        const dkim = colorDnsStatus(d.dkim_status);
        const spf = colorDnsStatus(d.spf_status);
        const dmarc = colorDnsStatus(d.dmarc_status);
        lines.push(`  ${chalk.cyan(d.id.slice(0, 8))}  ${d.domain}  DKIM:${dkim}  SPF:${spf}  DMARC:${dmarc}`);
      }
      lines.push("");
      lines.push(formatListHint({
        shown: domains.length,
        limit: page.limit,
        offset: page.offset,
        complete: opts.limit === undefined,
        noun: "domain",
        detailCommand: "use emails domain dns <domain> for DNS details",
        verbose: opts.verbose || isCliVerboseOutput(),
      }));
      output(domains, lines.join("\n"));
    } catch (e) {
      handleError(e);
    }
  };

  const statusLifecycleAction = (domainOrId: string | undefined, opts: { provider?: string; limit?: string; offset?: string; verbose?: boolean }) => {
    try {
      // Report the server-owned domain registry, or render the single match.
      if (!domainOrId) {
        listDomainsAction(opts);
        return;
      }
      const match = listDomains()
        .find((d) => d.id === domainOrId || d.id.startsWith(domainOrId) || d.domain.toLowerCase() === domainOrId.toLowerCase());
      if (!match) {
        handleError(new Error(`Domain not found: ${domainOrId}`));
        return;
      }
      output(match, `${chalk.bold(`\nDomain ${match.domain}`)}\n  ID:   ${match.id.slice(0, 8)}\n  Outbound: ${match.outbound_status}  Inbound: ${match.inbound_status}\n  DNS:  DKIM:${colorDnsStatus(match.dkim_status)} SPF:${colorDnsStatus(match.spf_status)} DMARC:${colorDnsStatus(match.dmarc_status)}\n  ${chalk.dim(`Live DNS readiness: emails domain check ${match.domain}`)}\n`);
    } catch (e) {
      handleError(e);
    }
  };

  // ── dns / check: read-only, wired to the libraries that always implemented them ──
  // Neither command needs a server or a mode. `src/lib/dns.ts` builds the
  // expected records, `src/lib/dns-check.ts` resolves what is actually published
  // and grades the authentication signals, and `src/lib/mx-ownership.ts` names
  // who owns root MX — all pure, all covered by their own suites, and all
  // previously unreachable from any command.

  const dnsAction = async (domain: string, opts: { provider?: string }) => {
    try {
      const { records, providerId, provider, dkimUnavailable } = await expectedDnsRecords(domain, opts.provider);
      const { formatDnsTable } = await import("../../lib/dns.js");
      // An empty table is ambiguous on its own — a provider type that publishes no
      // DNS records at all, a domain not yet added to a provider that does, and a
      // provider lookup that failed all arrive here as `[]`. `providerDnsPublishing`
      // is what distinguishes the first from the other two. Asked only when the
      // table is empty AND a provider resolved, exactly as the MCP `get_dns_records`
      // twin does it: a provider type `getAdapter()` accepts but the descriptor does
      // not would otherwise turn a good table into a throw.
      const support = records.length === 0 && provider && !dkimUnavailable
        ? providerDnsPublishing(provider)
        : undefined;
      const lines = [chalk.bold(`\nDNS records for ${domain}:`), "", formatDnsTable(records, support)];
      if (!providerId) {
        // Said out loud: without a provider these are the generic SES SPF/DMARC
        // pair, NOT the domain's DKIM records. Silently omitting DKIM would read
        // as "no DKIM required".
        lines.push(chalk.dim("  No provider resolved — showing generic SPF/DMARC only."));
        lines.push(chalk.dim(`  Pass --provider <id> to include the provider's DKIM records.`));
      } else if (dkimUnavailable) {
        // The provider resolved but could not be asked, so these are the generic
        // SPF/DMARC pair. Naming DKIM as the missing part is the whole point:
        // printing the pair silently would read as "no DKIM required".
        lines.push(chalk.yellow(`  DKIM was NOT retrieved: ${dkimUnavailable}.`));
        lines.push(chalk.dim("  SPF and DMARC above are the domain's own and do not depend on the provider account."));
        lines.push(chalk.dim("  Read the provider's DKIM records where the credentials live, or from the provider's dashboard."));
      }
      lines.push(chalk.dim(`  Confirm what is published: emails domain check ${domain}`));
      output({ domain, provider_id: providerId, records, dkim_unavailable: dkimUnavailable }, lines.join("\n"));
    } catch (e) {
      handleError(e);
    }
  };

  const checkAction = async (domain: string, opts: { provider?: string }) => {
    try {
      const { records, providerId, provider, dkimUnavailable } = await expectedDnsRecords(domain, opts.provider);
      const [{ checkDomainAuthentication, formatDnsCheck }, { inspectPublicMx, ownerLabel }] = await Promise.all([
        import("../../lib/dns-check.js"),
        import("../../lib/mx-ownership.js"),
      ]);
      const check = await checkDomainAuthentication(domain, records);
      // Root-MX ownership is the check that stops an operator pointing a live
      // mailbox domain at SES by accident; it is why `--force-mx-switch` exists.
      const mx = await inspectPublicMx(domain);

      // The same descriptor `dnsAction` passes, for the same reason and under the
      // same condition. `expectedDnsRecords` returns the provider precisely so
      // BOTH siblings can answer the empty case; this one was reading only
      // `providerId` and discarding it, so `domain dns` said "Nothing is missing"
      // while the `domain check` it recommends answered "No DNS records to check."
      const support = check.records.length === 0 && provider && !dkimUnavailable
        ? providerDnsPublishing(provider)
        : undefined;
      const lines = [chalk.bold(`\nLive DNS check for ${domain}:`), "", formatDnsCheck(check.records, support)];
      lines.push(`  Root MX:   ${ownerLabel(mx.owner)} ${chalk.dim(`(${mx.summary})`)}`);
      lines.push(`  Outbound:  ${check.outbound_ready ? chalk.green("ready") : chalk.yellow("not ready")}`);
      lines.push(`  Inbound:   ${check.inbound_ready ? chalk.green("ready") : chalk.yellow("not ready")}`);
      for (const requirement of check.missing_requirements) lines.push(chalk.red(`  ✗ ${requirement}`));
      for (const warning of check.warnings) lines.push(chalk.yellow(`  ⚠ ${warning}`));
      if (!providerId) {
        lines.push(chalk.dim("  No provider resolved — DKIM was not checked. Pass --provider <id> to include it."));
      } else if (dkimUnavailable) {
        lines.push(chalk.yellow(`  DKIM was NOT checked: ${dkimUnavailable}.`));
      }
      lines.push("");
      output({ ...check, provider_id: providerId, mx }, lines.join("\n"));
    } catch (e) {
      handleError(e);
    }
  };

  const addDomainAction = async (
    domain: string,
    opts: { provider: string; dryRun?: boolean; domainType?: string; sendOnly?: boolean; bucket?: string; region?: string },
    commandPrefix: "domain" | "domains",
  ) => {
    try {
      const { registerSharedDomain } = await import("../../lib/domain-registration-api.js");
      const result = await registerSharedDomain(domain, opts);
      output({ ...result, cli_equivalent: `emails ${commandPrefix} add ${domain} --provider ${opts.provider}${opts.sendOnly ? " --send-only" : ""}` }, JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } catch (e) {
      handleError(e);
    }
  };

  domainsCmd
    .action(() => listDomainsAction({}));

  domainsCmd
    .command("list")
    .description("List domains with lifecycle readiness")
    .option("--provider <id>", "Filter by provider ID")
    .option("--limit <n>", "Maximum domains to show (default: all registered domains)")
    .option("--offset <n>", "Number of domains to skip", "0")
    .option("--verbose", "Show expanded lifecycle details")
    .action(listDomainsAction);

  domainsCmd
    .command("status [domain]")
    .description("Show domain lifecycle readiness")
    .option("--provider <id>", "Provider ID")
    .option("--limit <n>", "Maximum domains to show when no domain is passed")
    .option("--offset <n>", "Number of domains to skip when no domain is passed", "0")
    .option("--verbose", "Show expanded lifecycle details")
    .action(statusLifecycleAction);

  domainsCmd
    .command("add <domain>")
    .description("Add a domain and provision its SES inbound receipt rule (use --send-only to deliberately skip inbound)")
    .requiredOption("--provider <id>", "Provider ID")
    .addOption(new Option("--domain-type <type>", "Legacy compatibility label; account storage is server-owned").hideHelp())
    .option("--send-only", "Register the domain WITHOUT inbound: deliberately skip the SES receipt rule (mail to the domain will not be received)")
    .option("--bucket <name>", "Inbound S3 bucket selector (defaults to the matching account source)")
    .option("--region <region>", "Region selector for the registered account source")
    .option("--dry-run", "Resolve inputs and show the planned change — the app row AND the inbound chain — without calling AWS or writing to the DB")
    .action((domain: string, opts: { provider: string; dryRun?: boolean; domainType?: string; sendOnly?: boolean; bucket?: string; region?: string }) => addDomainAction(domain, opts, "domains"));

  domainsCmd
    .command("connect <domain>")
    .description("Connect an already-owned domain through the API and record DNS publication tasks")
    .requiredOption("--provider <id>", "Provider ID")
    .option("--dns-provider <provider>", "DNS provider label: manual, cloudflare, or route53", "manual")
    .option("--no-register-provider", "Do not call the mail provider to register the domain")
    .option("--dry-run", "Show the connection plan without calling the provider or writing to the DB")
    .action(async (domain: string, opts: ConnectDomainOptions) => { try { const result=await connectDomain(domain,opts); output(result,formatDomainConnection(result)); if(result.connection.status === "blocked")process.exitCode=1; } catch(error){handleError(error);} });

  domainsCmd
    .command("dns <domain>")
    .description("Show the DNS records a domain must publish (DKIM/SPF/DMARC)")
    .option("--provider <id>", "Provider ID")
    .action(dnsAction);

  domainsCmd
    .command("verify <domain>")
    .description("Verify domain DNS through its bound server provider")
    .option("--provider <id>", "Provider ID")
    .action(lifecycle("verify"));

  domainsCmd
    .command("check <domain>")
    .description("Live DNS check with per-domain authentication readiness")
    .option("--provider <id>", "Provider ID")
    .action(checkAction);

  domainsCmd
    .command("enable-inbound <domain>")
    .description("Check DNS and SES receipt routing, then mark inbound ready")
    .option("--provider <id>", "Provider ID")
    .option("--force", "Deprecated: readiness checks cannot be bypassed")
    .action(lifecycle("enable-inbound"));

  domainsCmd
    .command("enable-outbound <domain>")
    .description("Verify the provider domain and enable outbound sending")
    .option("--provider <id>", "Provider ID")
    .option("--force", "Deprecated: readiness checks cannot be bypassed")
    .action(lifecycle("enable-outbound"));

  domainsCmd
    .command("disable-outbound <domain>")
    .description("Disable outbound sending for every address at this domain")
    .option("--provider <id>", "Provider ID")
    .action(lifecycle("disable-outbound"));

  domainCmd
    .command("add <domain>")
    .description("Add a domain and provision its SES inbound receipt rule (use --send-only to deliberately skip inbound)")
    .requiredOption("--provider <id>", "Provider ID")
    .addOption(new Option("--domain-type <type>", "Legacy compatibility label; account storage is server-owned").hideHelp())
    .option("--send-only", "Register the domain WITHOUT inbound: deliberately skip the SES receipt rule (mail to the domain will not be received)")
    .option("--bucket <name>", "Inbound S3 bucket selector (defaults to the matching account source)")
    .option("--region <region>", "Region selector for the registered account source")
    .option("--dry-run", "Resolve inputs and show the planned change — the app row AND the inbound chain — without calling AWS or writing to the DB")
    .action((domain: string, opts: { provider: string; dryRun?: boolean; domainType?: string; sendOnly?: boolean; bucket?: string; region?: string }) => addDomainAction(domain, opts, "domain"));

  // ── readiness: the inbound-chain drift detector ─────────────────────────────
  // Read shared registry evidence without treating it as a live AWS probe.
  domainCmd
    .command("readiness [domain]")
    .description("Read account inbound readiness evidence; explicitly marks unobserved live AWS state")
    .option("--bucket <name>", "Filter account sources by bucket")
    .option("--region <region>", "Filter account sources by region")
    .action(async (domainArg: string | undefined, opts: { bucket?: string; region?: string }) => {
      try {
        const { sharedInboundStatus } = await import("../../lib/domain-registration-api.js");
        const report = await sharedInboundStatus({ domain: domainArg, ...opts });
        output(report, JSON.stringify(report, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  domainCmd
    .command("connect <domain>")
    .description("Connect an already-owned domain through the API and record DNS publication tasks")
    .requiredOption("--provider <id>", "Provider ID")
    .option("--dns-provider <provider>", "DNS provider label: manual, cloudflare, or route53", "manual")
    .option("--no-register-provider", "Do not call the mail provider to register the domain")
    .option("--dry-run", "Show the connection plan without calling the provider or writing to the DB")
    .action(async (domain: string, opts: ConnectDomainOptions) => { try { const result=await connectDomain(domain,opts); output(result,formatDomainConnection(result)); if(result.connection.status === "blocked")process.exitCode=1; } catch(error){handleError(error);} });

  // ── adopt: seamlessly add an already-registered & SES-verified domain ────────
  // Account-backed connection, inbound setup, alias registration and optional sync.
  domainCmd
    .command("adopt <domain>")
    .description("Add an already-registered, SES-verified domain: register it, wire SES inbound (S3), add a catch-all, and optionally sync")
    .requiredOption("--provider <id>", "SES provider where the domain is verified")
    .option("--no-inbound", "Skip SES inbound (S3 receipt rule) setup")
    .option("--bucket <name>", "Inbound S3 bucket selector (defaults to the matching account source)")
    .option("--region <region>", "Region selector for the registered account source")
    .option("--catch-all <target>", "Route ALL mail for this domain to this address")
    .option("--sync", "Run an initial inbound sync after wiring")
    .option("--force-mx-switch", "Legacy option: use setup-cloudflare --add-mx --force-mx-switch for explicit MX changes")
    .action(async (domain: string, opts: { provider: string; inbound?: boolean; bucket?: string; region?: string; catchAll?: string; sync?: boolean; forceMxSwitch?: boolean }) => {
      try {
        const { registerSharedDomain } = await import("../../lib/domain-registration-api.js");
        const result = await registerSharedDomain(domain, { ...opts, sendOnly: opts.inbound === false, adopt: true });
        output(result, JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 1;
      } catch (e) { handleError(e); }
    });

  domainCmd
    .command("list")
    .description("List domains")
    .option("--provider <id>", "Filter by provider ID")
    .option("--limit <n>", "Maximum domains to show (default: all registered domains)")
    .option("--offset <n>", "Number of domains to skip", "0")
    .option("--verbose", "Show expanded list hints")
    .action(listDomainsAction);

  domainCmd
    .command("dns <domain>")
    .description("Show the DNS records a domain must publish (DKIM/SPF/DMARC)")
    .option("--provider <id>", "Provider ID (optional if domain is unambiguous)")
    .action(dnsAction);

  domainCmd
    .command("verify <domain>")
    .description("Verify domain DNS through its bound server provider")
    .option("--provider <id>", "Provider ID")
    .action(lifecycle("verify"));

  domainCmd
    .command("status")
    .description("Show domain readiness summary table")
    .option("--provider <id>", "Filter by provider ID")
    .option("--limit <n>", "Maximum domains to show (default 20 compact, 50 verbose/json)")
    .option("--offset <n>", "Number of domains to skip", "0")
    .option("--verbose", "Show per-domain issues and first fix command")
    .action((opts) => statusLifecycleAction(undefined, opts));

  domainCmd
    .command("usable")
    .description("List domains usable for sending and/or receiving")
    .option("--receive", "Only domains ready to receive")
    .option("--send", "Only domains ready to send")
    .option("--provider <id>", "Filter by provider ID")
    .option("--limit <n>", "Maximum domains to show (default 20 compact, 50 verbose/json)")
    .option("--offset <n>", "Number of domains to skip after filtering", "0")
    .option("--verbose", "Show expanded list hints")
    .action((opts: { receive?: boolean; send?: boolean; provider?: string; limit?: string; offset?: string; verbose?: boolean }) => {
      try {
        const page = parseCliListPage(opts);
        // A verified domain both sends and receives; the usable filter keys off
        // verification, which is the only signal this client stores.
        const domains = listUsableDomains({
          provider_id: opts.provider,
          send: opts.send,
          receive: opts.receive,
          limit: page.limit,
          offset: page.offset,
        });
        const lines = domains.length ? [chalk.bold("\nUsable domains:")] : [chalk.dim("No usable domains found.")];
        for (const d of domains) {
          lines.push(`  ${chalk.cyan(d.domain)}  ${chalk.dim(d.provider_id.slice(0, 8))}  ${chalk.green("send+receive")}`);
        }
        lines.push("");
        lines.push(formatListHint({
          shown: domains.length,
          limit: page.limit,
          offset: page.offset,
          noun: "domain",
          detailCommand: "a domain becomes usable once its DKIM/SPF are verified",
          verbose: opts.verbose || isCliVerboseOutput(),
        }));
        output(domains, lines.join("\n"));
      } catch (e) {
        handleError(e);
      }
    });

  domainCmd
    .command("move-provider <domain>")
    .description("Move an existing domain and its addresses to another provider")
    .requiredOption("--to-provider <id>", "Target provider ID")
    .option("--from-provider <id>", "Source provider ID; required if the domain exists on multiple providers")
    .option("--dry-run", "Show the planned provider move without mutating state")
    .option("--yes", "Skip confirmation prompt")
    .action(async (domainName: string, opts: { toProvider: string; fromProvider?: string; dryRun?: boolean; yes?: boolean }) => {
      try {
        const toProviderId = resolveId("providers", opts.toProvider);
        const toProvider = getProvider(toProviderId);
        if (!toProvider) handleError(new Error(`Provider not found: ${opts.toProvider}`));

        let domain;
        if (opts.fromProvider) {
          const fromProviderId = resolveId("providers", opts.fromProvider);
          domain = getDomainByName(fromProviderId, domainName);
          if (!domain) handleError(new Error(`Domain not found for source provider: ${domainName}`));
        } else {
          const matches = findDomainsByName(domainName);
          if (matches.length === 0) handleError(new Error(`Domain not found: ${domainName}`));
          if (matches.length > 1) {
            const choices = matches.map((d) => `${d.id.slice(0, 8)} provider=${d.provider_id.slice(0, 8)}`).join(", ");
            handleError(new Error(`Domain is ambiguous; pass --from-provider. Matches: ${choices}`));
          }
          domain = matches[0];
        }

        const plan = {
          domain: domain!.domain,
          domain_id: domain!.id,
          from_provider_id: domain!.provider_id,
          to_provider_id: toProviderId,
          to_provider_name: toProvider!.name,
        };

        if (opts.dryRun) {
          output({ dry_run: true, ...plan }, chalk.dim(`Would move ${domain!.domain} to ${toProvider!.name}. Address reassignment is handled server-side.`));
          return;
        }

        await confirmDestructiveAction(`Move ${domain!.domain} to ${toProvider!.name}?`, opts.yes);
        const result = moveDomainProvider(domain!.id, toProviderId);
        output({ ...plan, ...result }, chalk.green(`✓ Moved ${domain!.domain} to ${toProvider!.name}; server owns address reassignment.`));
      } catch (e) {
        handleError(e);
      }
    });

  domainCmd
    .command("remove <id>")
    .description("Remove a domain")
    .option("--yes", "Skip confirmation prompt")
    .action(async (id: string, opts: { yes?: boolean }) => {
      try {
        const resolvedId = resolveSelfHostedDomainId(id);
        const domain = getDomain(resolvedId);
        if (!domain) handleError(new Error(`Domain not found: ${id}`));
        await confirmDestructiveAction(`Remove domain ${domain.domain}?`, opts.yes);
        deleteDomain(resolvedId);
        console.log(chalk.green(`✓ Domain removed: ${domain.domain}`));
      } catch (e) {
        handleError(e);
      }
    });

  domainCmd
    .command("check <domain>")
    .description("Live DNS check — verify actual DNS records against expected")
    .option("--provider <id>", "Provider ID")
    .action(checkAction);

  // ─── DNS SETUP (server-side) ───────────────────────────────────────────────

  domainCmd
    .command("setup-cloudflare <domain>")
    .description("Publish sending DNS through the API's bound Cloudflare zone")
    .requiredOption("--provider <id>", "SES or Resend provider ID")
    .option("--mx", "Also add MX record for receiving email")
    .option("--mx-server <host>", "Assert the exact inbound MX hostname configured in the server DNS binding")
    .option("--register-ses", "Register the domain with SES first if not already added")
    .option("--force-mx-switch", "Allow adding MX even when existing root MX belongs to another provider")
    .option("--dry-run", "Resolve server bindings without provider calls or writes")
    .action(async (domain: string, opts: import("../../lib/domain-dns-api.js").DomainDnsOptions) => {
      try { const { setupDomainCloudflare, formatDomainDns, domainDnsSucceeded } = await import("../../lib/domain-dns-api.js"); const result = await setupDomainCloudflare(domain, opts); output(result, formatDomainDns(result)); if (!domainDnsSucceeded(result)) process.exitCode = 1; }
      catch (error) { handleError(error); }
    });

  domainCmd.command("dns-job <id>").description("Inspect a shared domain DNS provisioning receipt")
    .action(async (id: string) => { try { const { inspectDomainDnsJob, formatDomainDns } = await import("../../lib/domain-dns-api.js"); const result = await inspectDomainDnsJob(id); output(result, formatDomainDns(result)); if (result.job.status === "blocked") process.exitCode = 1; } catch (error) { handleError(error); } });

  // ─── DOMAIN WARMING ────────────────────────────────────────────────────────
  // Warming schedules are a first-class repository resource (`warming_schedules`
  // in SQLite, `/v1/warming` on the self-hosted server), so these commands call
  // the collapsed warming family (src/db/warming.ts) — one implementation over
  // the store seam, async, resolved from storage configuration. The MCP tools in
  // src/mcp/tools/warming.ts are the same calls over a different transport.

  const warmingStatusColor = (status: WarmingSchedule["status"]): string =>
    status === "active" ? chalk.green(status) : status === "paused" ? chalk.yellow(status) : chalk.dim(status);

  // pause/resume/complete are the same repository write with a different target
  // state, so they share one transition path: fail loud when the domain has no
  // schedule, otherwise emit the updated row.
  const transitionWarmingStatus = async (domain: string, status: WarmingSchedule["status"], formatted: string) => {
    try {
      const updated = await updateWarmingStatus(domain, status);
      if (!updated) {
        handleError(new Error(
          `Warming schedule not found for domain: ${domain}. Start one with 'emails domain warm ${domain} --target <n>'.`,
        ));
        return;
      }
      output(updated, `${formatted}\n${chalk.dim(`  Details: emails domain warm-status ${domain}`)}`);
    } catch (e) {
      handleError(e);
    }
  };

  domainCmd
    .command("warm <domain>")
    .description("Start a warming schedule for a domain")
    .requiredOption("--target <n>", "Target daily send volume", parseInt)
    .option("--start-date <YYYY-MM-DD>", "Start date (default: today)")
    .option("--provider <id>", "Provider ID to associate")
    // ASYNC because the warming ramp reads today's sent mail through the store seam.
    .action(async (domain: string, opts: { target: number; startDate?: string; provider?: string }) => {
      try {
        if (!Number.isInteger(opts.target) || opts.target <= 0) {
          handleError(new Error(`Invalid --target '${opts.target}'. Pass a positive whole daily send volume.`));
        }
        if (opts.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(opts.startDate)) {
          handleError(new Error(`Invalid --start-date '${opts.startDate}'. Use YYYY-MM-DD.`));
        }
        // The /v1 store does not reject a duplicate domain client-side (SQLite
        // does, with a raw UNIQUE error), so check first: a second POST would
        // otherwise leave two schedules for one domain and whichever the reads
        // happened to find would win.
        const existing = await getWarmingSchedule(domain);
        if (existing) {
          handleError(new Error(
            `${domain} already has a warming schedule (status ${existing.status}, target ${existing.target_daily_volume}/day, started ${existing.start_date}). ` +
              `Inspect it with 'emails domain warm-status ${domain}', change state with 'emails domain warm-pause|warm-resume|warm-complete ${domain}', ` +
              `or retarget by removing it first: 'emails domain warm-delete ${domain}'.`,
          ));
        }
        const providerId = opts.provider ? resolveId("providers", opts.provider) : undefined;
        const schedule = await createWarmingSchedule({
          domain,
          provider_id: providerId,
          target_daily_volume: opts.target,
          start_date: opts.startDate,
        });
        const progress = await describeWarmingProgress(schedule);
        const plan = generateWarmingPlan(schedule.target_daily_volume);
        output({ schedule, ...progress, plan_days: plan.length, final_day: progress.total_days }, [
          chalk.green(`✓ Warming schedule created for ${domain}`),
          await formatWarmingStatus(schedule, progress),
          chalk.dim(`\nWill reach target (${schedule.target_daily_volume}/day) in ${progress.total_days} days`),
        ].join("\n"));
      } catch (e) {
        handleError(e);
      }
    });

  domainCmd
    .command("warm-status <domain>")
    .description("Show warming schedule status for a domain")
    .action(async (domain: string) => {
      try {
        const schedule = await getWarmingSchedule(domain);
        if (!schedule) {
          handleError(new Error(
            `Warming schedule not found for domain: ${domain}. Start one with 'emails domain warm ${domain} --target <n>'.`,
          ));
          return;
        }
        const progress = await describeWarmingProgress(schedule);
        output(
          { schedule, ...progress },
          `\n${await formatWarmingStatus(schedule, progress)}\n`,
        );
      } catch (e) {
        handleError(e);
      }
    });

  domainCmd
    .command("warm-list")
    .description("List all domain warming schedules")
    .option("--status <status>", "Filter by status (active, paused, completed)")
    .option("--limit <n>", "Maximum schedules to show (default 20 compact, 50 verbose/json)")
    .option("--offset <n>", "Number of schedules to skip", "0")
    .option("--verbose", "Show expanded list hints")
    .action(async (opts: { status?: string; limit?: string; offset?: string; verbose?: boolean }) => {
      try {
        if (opts.status && !["active", "paused", "completed"].includes(opts.status)) {
          handleError(new Error(`Invalid --status '${opts.status}'. Use active, paused, or completed.`));
        }
        const page = parseCliListPage(opts);
        const schedules = await listWarmingSchedules(opts.status, page);
        if (schedules.length === 0) {
          output([], chalk.dim("No warming schedules found."));
          return;
        }
        // One ledger read for the whole page instead of one per row: in
        // self-hosted mode each read is a synchronous curl spawn over today's
        // messages, so a 20-row page used to cost 20 identical requests.
        const sentByDomain = await getTodaySentCountsByDomain(schedules.map((schedule) => schedule.domain));
        const lines: string[] = [""];
        lines.push(tableRow(
          [chalk.bold("Domain"), 20],
          [chalk.bold("Status"), 10],
          [chalk.bold("Start Date"), 12],
          [chalk.bold("Target"), 10],
          [chalk.bold("Today's Limit"), 14],
          [chalk.bold("Sent Today"), 12],
        ));
        for (const schedule of schedules) {
          const progress = await describeWarmingProgress(
            schedule,
            sentByDomain.get(schedule.domain.trim().toLowerCase()) ?? 0,
          );
          lines.push(tableRow(
            [truncate(schedule.domain, 20), 20],
            [warmingStatusColor(schedule.status), 10],
            [schedule.start_date, 12],
            [String(schedule.target_daily_volume), 10],
            [progress.today_limit !== null ? String(progress.today_limit) : chalk.dim("n/a"), 14],
            [String(progress.today_sent), 12],
          ));
        }
        lines.push("");
        lines.push(formatListHint({
          shown: schedules.length,
          limit: page.limit,
          offset: page.offset,
          noun: "warming schedule",
          detailCommand: "use emails domain warm-status <domain> for details",
          verbose: opts.verbose || isCliVerboseOutput(),
        }));
        output(schedules, lines.join("\n"));
      } catch (e) {
        handleError(e);
      }
    });

  domainCmd
    .command("warm-pause <domain>")
    .description("Pause a domain warming schedule")
    .action((domain: string) => transitionWarmingStatus(
      domain,
      "paused",
      chalk.yellow(`⏸ Warming schedule paused for ${domain}`),
    ));

  domainCmd
    .command("warm-resume <domain>")
    .description("Resume a paused domain warming schedule")
    .action((domain: string) => transitionWarmingStatus(
      domain,
      "active",
      chalk.green(`▶ Warming schedule resumed for ${domain}`),
    ));

  domainCmd
    .command("warm-complete <domain>")
    .description("Mark a domain warming schedule as completed")
    .action((domain: string) => transitionWarmingStatus(
      domain,
      "completed",
      chalk.green(`✓ Warming schedule completed for ${domain}; daily warming limits no longer apply`),
    ));

  // The fifth warming repository operation. Without it there is no way to
  // retarget a domain — `warm` refuses to shadow an existing schedule, and
  // pause/resume/complete only move status — so the refusal above would name a
  // recovery path that did not exist.
  domainCmd
    .command("warm-delete <domain>")
    .description("Delete a domain warming schedule (removes the daily cap entirely)")
    .option("--yes", "Skip confirmation prompt")
    .action(async (domain: string, opts: { yes?: boolean }) => {
      try {
        const existing = await getWarmingSchedule(domain);
        if (!existing) {
          handleError(new Error(
            `Warming schedule not found for domain: ${domain}. Start one with 'emails domain warm ${domain} --target <n>'.`,
          ));
          return;
        }
        await confirmDestructiveAction(
          `Delete the warming schedule for ${domain} (status ${existing.status}, target ${existing.target_daily_volume}/day)?`,
          opts.yes,
        );
        if (!(await deleteWarmingSchedule(domain))) {
          handleError(new Error(`Warming schedule for ${domain} could not be deleted.`));
          return;
        }
        output(
          { deleted: true, schedule: existing },
          chalk.green(`✓ Warming schedule deleted for ${domain}`) + "\n" +
            chalk.dim(`  Sends from ${domain} are no longer warming-capped. Start a new ramp with 'emails domain warm ${domain} --target <n>'.`),
        );
      } catch (e) {
        handleError(e);
      }
    });

  // ─── DOMAIN PURCHASING (via @hasna/domains / Route 53) ───────────────────

  domainCmd
    .command("available <domain>")
    .description("Check if a domain is available for purchase and get pricing")
    .action(async (domain: string) => {
      try {
        const { r53CheckAvailability } = await import("@hasna/domains");
        const result = await r53CheckAvailability(domain);
        if (result.available) {
          const price = result.price ? chalk.green(` — ${result.currency ?? "USD"} ${result.price}/yr`) : "";
          console.log(chalk.green(`✓ ${domain} is available${price}`));
        } else {
          console.log(chalk.red(`✗ ${domain} is not available`));
        }
        output(result, "");
      } catch (e) { handleError(e); }
    });

  domainCmd
    .command("buy <domain>")
    .description("Purchase a domain via Route 53")
    .requiredOption("--email <email>", "Registrant email")
    .requiredOption("--first-name <name>", "First name")
    .requiredOption("--last-name <name>", "Last name")
    .requiredOption("--phone <phone>", "Phone in E.164 format (e.g. +1.5551234567)")
    .requiredOption("--address <addr>", "Street address")
    .requiredOption("--city <city>", "City")
    .option("--state <state>", "State/province; optional and omitted for countries where Route 53 rejects it")
    .requiredOption("--country <code>", "Two-letter country code (e.g. US, RO)")
    .requiredOption("--zip <zip>", "ZIP/postal code")
    .option("--org <name>", "Organization name")
    .option("--years <n>", "Registration years", "1")
    .action(async (domain: string, opts: {
      email: string; firstName: string; lastName: string;
      phone: string; address: string; city: string; state?: string;
      country: string; zip: string; org?: string; years: string;
    }) => {
      try {
        const { r53CheckAvailability, r53RegisterDomain } = await import("@hasna/domains");
        console.log(chalk.dim(`Checking availability of ${domain}...`));
        const avail = await r53CheckAvailability(domain);
        if (!avail.available) { console.error(chalk.red(`✗ ${domain} is not available`)); process.exit(1); }
        const price = avail.price ? ` (${avail.currency ?? "USD"} ${avail.price}/yr)` : "";
        console.log(chalk.green(`  ✓ Available${price}`));
        const contact = normalizeRoute53RegistrationContact({
          first_name: opts.firstName, last_name: opts.lastName,
          email: opts.email, phone: opts.phone,
          address_line_1: opts.address, city: opts.city,
          state: opts.state, country_code: opts.country,
          zip_code: opts.zip, organization_name: opts.org,
        });
        const result = await r53RegisterDomain(domain, contact as Parameters<typeof r53RegisterDomain>[1], parseInt(opts.years));
        console.log(chalk.green(`✓ Registration submitted for ${domain}`));
        console.log(chalk.dim(`  Operation ID: ${result.operationId}`));
        console.log(chalk.dim(`  Check status: emails domain purchase-status ${result.operationId}`));
        output(result, "");
      } catch (e) { handleError(e); }
    });

  domainCmd
    .command("purchase-status <operationId>")
    .description("Check domain registration/purchase status")
    .action(async (operationId: string) => {
      try {
        const { r53GetRegistrationStatus } = await import("@hasna/domains");
        const result = await r53GetRegistrationStatus(operationId);
        const color = result.status === "SUCCESSFUL" ? chalk.green : result.status === "FAILED" ? chalk.red : chalk.yellow;
        console.log(`Status: ${color(result.status)}`);
        if (result.domain) console.log(`Domain: ${result.domain}`);
        if (result.message) console.log(`Message: ${result.message}`);
        output(result, "");
      } catch (e) { handleError(e); }
    });

  domainCmd
    .command("list-registered")
    .description("List domains registered in Route 53")
    .action(async () => {
      try {
        const { r53ListRegisteredDomains } = await import("@hasna/domains");
        const domains = await r53ListRegisteredDomains();
        if (domains.length === 0) { output([], chalk.dim("No domains registered in Route 53.")); return; }
        const lines = [chalk.bold("\nRegistered domains:")];
        for (const d of domains) {
          const expiry = d.expiry ? chalk.dim(` — expires ${d.expiry.split("T")[0]}`) : "";
          const renew = d.auto_renew ? chalk.green(" [auto-renew]") : "";
          lines.push(`  ${chalk.cyan(d.domain)}${expiry}${renew}`);
        }
        lines.push("");
        output(domains, lines.join("\n"));
      } catch (e) { handleError(e); }
    });

  const ownedSetup=domainCmd.command("setup <domain>")
    .description("Configure an already-owned domain through server-bound mail and Cloudflare DNS providers")
    .requiredOption("--provider <id>","Server provider ID: SES, or Resend with an existing domain identity")
    .option("--skip-buy","Compatibility spelling; setup always uses an already-owned domain")
    .option("--mx","Publish the explicitly bound SES inbound MX")
    .option("--force-mx-switch","Allow replacement of existing root MX with the bound target")
    .option("--dry-run","Check server bindings without provider calls or changes")
    .option("--wait","Wait for provider sending verification")
    .option("--timeout <seconds>","Verification wait limit, 1–900 seconds","600");
  const obsolete=["email","first-name","last-name","phone","address","city","state","country","zip","org","years"];
  for(const name of obsolete)ownedSetup.addOption(new Option(`--${name} <value>`,"Retired purchase option").hideHelp());
  ownedSetup.addOption(new Option("--buy","Retired purchase option").hideHelp());
  ownedSetup.action(async(domain:string,opts:Record<string,unknown>)=>{try{
    if(opts.buy!==undefined||obsolete.some(name=>opts[name.replace(/-([a-z])/g,(_match,c:string)=>c.toUpperCase())]!==undefined))
      throw Error("emails domain setup configures an already-owned domain and does not purchase domains or accept registrant data. Review domains route53 buy --help for the separate registrar workflow; no work was performed.");
    const {setupOwnedDomain,formatDomainDns}=await import("../../lib/domain-dns-api.js");
    const result=await setupOwnedDomain(domain,opts as unknown as import("../../lib/domain-dns-api.js").DomainDnsOptions);
    output(result,formatDomainDns(result));
    if(!(result.dry_run&&result.job.status==="planned")&&!(result.job.status==="verified"&&result.job.dns_published&&result.job.verified_for_sending))process.exitCode=1;
  }catch(error){handleError(error);}});
}
