import type { Command } from "commander";
import net from "node:net";
import { readFileSync } from "node:fs";
import {
  prearm, reconcileExpiry, dedupeRegistrarRows, coverageRegressions,
  STALE_SOON_DAYS,
  type RegistrarRow, type ReconcileDeps, type ReconcileRecord, type Verdict,
} from "../../lib/expiry-reconcile.js";
import { getRegistrarProvider, getAvailableProviders } from "../../lib/registrar.js";

import { printLine, printErrorLine } from "../../lib/stdout.js";
/**
 * READ-ONLY. This command issues WHOIS port-43 queries and HTTP GET only. It
 * never renews, never writes to the portfolio store, and must never grow a
 * mutation flag — a reconciler that can write is a reconciler that can hide the
 * disagreement it was built to surface.
 */

const IANA_RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

/** Registries reachable over WHOIS port 43 but absent from the RDAP bootstrap. */
const TLD_WHOIS: Record<string, string> = {
  ag: "whois.nic.ag", bo: "whois.nic.bo", co: "whois.registry.co",
  de: "whois.denic.de", io: "whois.nic.io", it: "whois.nic.it",
  la: "whois.nic.la", md: "whois.nic.md", me: "whois.nic.me",
  ro: "whois.rotld.ro", sc: "whois.nic.sc", st: "whois.nic.st",
  us: "whois.nic.us", vc: "whois.identitydigital.services",
  ws: "whois.website.ws",
};

async function loadRdapBootstrap(path?: string): Promise<Record<string, string>> {
  const raw = path
    ? readFileSync(path, "utf8")
    : await (await fetch(IANA_RDAP_BOOTSTRAP, { headers: { Accept: "application/json" } })).text();
  const boot = JSON.parse(raw) as { services: Array<[string[], string[]]> };
  const map: Record<string, string> = {};
  for (const [tlds, bases] of boot.services) {
    let base = bases[0] ?? "";
    if (base && !base.endsWith("/")) base += "/";
    for (const t of tlds) map[t.toLowerCase()] = base;
  }
  return map;
}

function whoisRaw(server: string, query: string, timeoutMs = 25000): Promise<{ raw: string | null; netErr: string | null }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (r: { raw: string | null; netErr: string | null }) => { if (!settled) { settled = true; resolve(r); } };
    const sock = net.createConnection({ host: server, port: 43 });
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => sock.write(query + "\r\n"));
    sock.on("data", (c: Buffer | string) => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    sock.on("end", () => done({ raw: Buffer.concat(chunks).toString("utf8"), netErr: null }));
    sock.on("timeout", () => { sock.destroy(); done({ raw: null, netErr: `timeout after ${timeoutMs}ms` }); });
    sock.on("error", (e) => { sock.destroy(); done({ raw: null, netErr: `${e.name}: ${e.message}`.slice(0, 180) }); });
  });
}

async function rdapRaw(name: string, base: string, timeoutMs = 45000): Promise<{ raw: string | null; netErr: string | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}domain/${name}`, {
      headers: { Accept: "application/rdap+json", "User-Agent": "hasna-domains/reconcile-expiry (read-only)" },
      signal: ac.signal,
    });
    const body = await res.text();
    // A 404 or 429 body is DATA the classifier must see, not a transport fault.
    return { raw: body.length > 0 ? body : (res.status === 404 ? "no matching record" : res.status === 429 ? "too many requests" : ""), netErr: null };
  } catch (e) {
    return { raw: null, netErr: `${e instanceof Error ? e.name + ": " + e.message : String(e)}`.slice(0, 180) };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadRows(opts: { from?: string; provider?: string }): Promise<RegistrarRow[]> {
  if (opts.from) {
    const parsed = JSON.parse(readFileSync(opts.from, "utf8")) as Array<Record<string, unknown>>;
    return parsed.map((r) => ({
      domain: String(r["domain"] ?? r["name"] ?? ""),
      expiresAt: (r["expiresAt"] ?? r["expires"] ?? r["expires_at"] ?? null) as string | null,
      status: (r["status"] ?? null) as string | null,
      registrar: (r["registrar"] ?? null) as string | null,
    })).filter((r) => r.domain);
  }
  if (!opts.provider) {
    throw new Error("supply --from <registrar-dump.json> or --provider <name>");
  }
  const list = await getRegistrarProvider(opts.provider).listDomains();
  return list.map((d) => ({ domain: d.domain, expiresAt: d.expires || null, status: d.status, registrar: d.registrar }));
}

export function registerReconcileExpiryCommand(program: Command): void {
  program
    .command("reconcile-expiry")
    .description("READ-ONLY: compare each domain's REGISTRAR expiry against the REGISTRY's own expiry")
    .option("--from <file>", "Registrar dump JSON (array of {domain, expiresAt, status, registrar})")
    .option("--provider <name>", "Read the registrar inventory live via a configured provider")
    .option("--bootstrap <file>", "Local RDAP bootstrap JSON (default: fetch from IANA)")
    .option("--baseline <file>", "Prior run's JSON; enables coverage-regression detection")
    .option("--only <list>", "Comma-separated domains, or a TLD like '.md'")
    .option("--limit <n>", "Cap the number of domains checked")
    .option("--sample <n>", "Deterministic every-Nth sample across the population")
    .option("--rdap-delay <ms>", "Delay between RDAP queries", "1100")
    .option("--whois-delay <ms>", "Delay between WHOIS queries", "2500")
    .option("--self-test", "Run the pre-arm self-test and exit")
    .option("--json", "Output JSON")
    .action(async (opts: {
      from?: string; provider?: string; bootstrap?: string; baseline?: string;
      only?: string; limit?: string; sample?: string;
      rdapDelay: string; whoisDelay: string; selfTest?: boolean; json?: boolean;
    }) => {
      // PRE-ARM FIRST, ALWAYS. An instrument that has not proved it can both
      // fire and stay silent produces no trustworthy result, so a failure here
      // refuses the run rather than reporting a clean one.
      const arm = prearm();
      if (!opts.json) {
        printLine("=== PRE-ARM SELF-TEST (two-sided) ===");
        for (const c of arm.cases) printLine(`  [${c.passed ? "PASS" : "FAIL"}] ${c.name.padEnd(58)} -> ${c.got}`);
        printLine(`=== PRE-ARM ${arm.ok ? "PASS - instrument can fire AND can stay silent" : "FAIL - DO NOT TRUST ANY RESULT"} ===`);
      }
      if (!arm.ok) {
        printErrorLine("REFUSING TO RUN: pre-arm failed.");
        process.exit(3);
      }
      if (opts.selfTest) {
        if (opts.json) printLine(JSON.stringify({ prearm: arm }, null, 2));
        process.exit(0);
      }

      let rows: RegistrarRow[];
      try {
        rows = await loadRows(opts);
      } catch (e) {
        const configured = getAvailableProviders().filter((p) => p.configured).map((p) => p.name).join(", ") || "none";
        printErrorLine(`${e instanceof Error ? e.message : String(e)}`);
        printErrorLine(`configured providers: ${configured}`);
        process.exit(2);
        return;
      }

      const { rows: unique, dupesRemoved } = dedupeRegistrarRows(rows);
      let selected = unique;
      if (opts.only) {
        if (opts.only.startsWith(".")) {
          const t = opts.only.slice(1);
          selected = selected.filter((r) => r.domain.split(".").pop() === t);
        } else {
          const want = new Set(opts.only.split(",").map((s) => s.trim()));
          selected = selected.filter((r) => want.has(r.domain));
        }
      }
      if (opts.sample) selected = selected.filter((_, i) => i % parseInt(opts.sample!, 10) === 0);
      if (opts.limit) selected = selected.slice(0, parseInt(opts.limit, 10));

      const rdapMap = await loadRdapBootstrap(opts.bootstrap);
      const rdapDelay = parseInt(opts.rdapDelay, 10);
      const whoisDelay = parseInt(opts.whoisDelay, 10);
      let queries = 0;

      const deps: ReconcileDeps = {
        routeFor: (tld) => {
          if (rdapMap[tld]) return { method: "rdap", endpoint: rdapMap[tld]! };
          if (TLD_WHOIS[tld]) return { method: "whois", endpoint: TLD_WHOIS[tld]! };
          return null;
        },
        fetchRegistry: async (domain, method, endpoint) => {
          if (queries > 0) await sleep(method === "rdap" ? rdapDelay : whoisDelay);
          queries++;
          return method === "rdap" ? rdapRaw(domain, endpoint) : whoisRaw(endpoint, domain);
        },
      };

      if (!opts.json) {
        printLine(`\nREGISTRAR rows=${rows.length} unique=${unique.length} dupes_removed=${dupesRemoved}`);
        printLine(`SELECTED=${selected.length}`);
      }

      const report = await reconcileExpiry(selected, deps);

      let regressed: string[] = [];
      if (opts.baseline) {
        const base = JSON.parse(readFileSync(opts.baseline, "utf8")) as { records: Array<{ domain: string; verdict: Verdict }> };
        regressed = coverageRegressions(report.records, base.records ?? []);
        if (regressed.length > 0) report.exitCode = Math.max(report.exitCode, 2);
      }

      if (opts.json) {
        printLine(JSON.stringify({ ...report, coverageRegressions: regressed, queries }, null, 2));
        process.exit(report.exitCode);
        return;
      }

      const order: Verdict[] = ["MATCH", "MISMATCH", "NOT_AT_REGISTRY", "UNVERIFIABLE_EXPECTED", "UNVERIFIABLE_UNEXPECTED"];
      printLine(`\n=== VERDICT TALLY (n=${report.records.length}) ===`);
      for (const k of order) printLine(`  ${k.padEnd(24)} ${String(report.tally[k]).padStart(5)}`);
      const pct = report.records.length ? (100 * report.comparable / report.records.length).toFixed(1) : "0.0";
      printLine(`COMPARABLE = ${report.comparable} of ${report.records.length} (${pct}%)`);

      const show = (title: string, rs: ReconcileRecord[]) => {
        if (rs.length === 0) return;
        printLine(`\n=== ${title} ===`);
        for (const r of rs) printLine(`  ${r.domain.padEnd(26)} ${r.why.slice(0, 120)}`);
      };
      show("MISMATCHES", report.records.filter((r) => r.verdict === "MISMATCH"));
      show("NOT AT REGISTRY", report.records.filter((r) => r.verdict === "NOT_AT_REGISTRY"));
      show("UNVERIFIABLE / UNEXPECTED  (coverage loss - these are NOT clean)", report.records.filter((r) => r.verdict === "UNVERIFIABLE_UNEXPECTED"));

      printLine(`\nREGISTRY EXPIRY WITHIN ${STALE_SOON_DAYS}d: ${report.expiringSoon.length}`);
      for (const r of report.expiringSoon) {
        printLine(`   ${r.domain.padEnd(26)} registry=${r.registry} in ${r.daysToRegistryExpiry}d  verdict=${r.verdict}`);
      }

      if (opts.baseline) {
        printLine(`\nCOVERAGE REGRESSION vs baseline: ${regressed.length}`);
        for (const d of regressed.slice(0, 20)) printLine(`   ${d}  was comparable, now unverifiable`);
      }

      printLine(`\nEXIT=${report.exitCode}`);
      process.exit(report.exitCode);
    });
}
