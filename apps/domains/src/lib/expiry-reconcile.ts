/**
 * expiry-reconcile — registry-vs-registrar expiry disagreement check.
 *
 * READ-ONLY. Issues only WHOIS port-43 queries and HTTP GET. Contains no
 * mutation verb of any kind and never calls a renewal path.
 *
 * WHY THIS COMPARES REGISTRAR AGAINST REGISTRY, AND NOT AGAINST OUR OWN DB
 * -----------------------------------------------------------------------
 * `syncToLocalDb` in ./brandsight.ts copies the registrar's `expires` and
 * `auto_renew` straight onto our row. Our `expires_at` is therefore a MIRROR of
 * the registrar, so a DB-vs-registrar check is one system read twice: it agrees
 * by construction and proves nothing. Only the registry can say when the name is
 * actually deleted.
 *
 * That distinction is load-bearing rather than academic. A registrar record
 * reading 2027 against a registry record reading 2026 is invisible to every
 * dashboard we own, because every dashboard we own is downstream of the
 * registrar. An alarm on our own `expires_at` is silent for this entire class.
 *
 * THREE OUTCOMES, and UNVERIFIABLE is never scored as MATCH:
 *   MATCH            both sides published a date and they agree within TOL_DAYS
 *   MISMATCH         both sides published a date and they disagree
 *   UNVERIFIABLE     at least one side published nothing -> its own count
 *   NOT_AT_REGISTRY  registry affirmatively does not know this name
 *
 * UNVERIFIABLE is split, because merging the split is how a false all-clear ships:
 *   EXPECTED    registry policy publishes no expiry (.ro/.de), or the registrar
 *               row is CANCELLED with no expiry. A known, stable constant.
 *   UNEXPECTED  transport failure, throttling, unparseable date, a missing expiry
 *               on a TLD that normally publishes one, or a registrar we cannot
 *               enumerate. THIS IS AN ALARM: coverage silently shrank, and a
 *               shrinking denominator is how "0 mismatches" gets published by a
 *               blind instrument.
 */

export const TOL_DAYS = 1; // registries publish in local tz, registrars in UTC
export const STALE_SOON_DAYS = 45;

/**
 * TLDs whose registry publishes NO expiry field as a matter of policy.
 * Membership is a measured fact. A TLD in this set producing no expiry is
 * EXPECTED; one NOT in it is a coverage regression.
 */
export const NO_EXPIRY_TLDS = new Set(["ro", "de"]);

/**
 * Registrars we cannot enumerate an expiry from. A domain here is UNCHECKABLE
 * and must never be scored as compliant.
 *
 * Cloudflare is declared `type: "dns"` in ./registrar.ts with no
 * `createRegistrar`, and ./cloudflare.ts iterates zones while hardcoding
 * `auto_renew: false`. So Cloudflare-registrar domains carry no usable expiry
 * and are invisible to registrar enumeration. Reporting them as MATCH — or
 * omitting them — is the failure this constant exists to prevent.
 */
export const UNENUMERABLE_REGISTRARS = new Set(["cloudflare"]);

export type Subclass =
  | "OK" | "TRANSPORT" | "THROTTLED" | "NOT_FOUND"
  | "NO_EXPIRY" | "BAD_DATE" | "NOT_MINE";

export type Verdict =
  | "MATCH" | "MISMATCH" | "NOT_AT_REGISTRY"
  | "UNVERIFIABLE_EXPECTED" | "UNVERIFIABLE_UNEXPECTED";

/**
 * Throttle/soft-block markers. CONSULTED ONLY WHEN NO ANSWER WAS EXTRACTED —
 * see the ordering note in classifyRegistry.
 *
 * Measured against a 677-body corpus: the looser phrase "rate limit" appears in
 * 23 of 677 bodies, and in all 23 it is registry terms-of-use boilerplate
 * sitting in a response that carries a perfectly good `Registry Expiry Date`.
 * Real throttle markers in that corpus: 0. A marker list alone is therefore
 * 23/23 false-positive here; the ordering is what makes it safe. Phrases that
 * occur in policy prose are deliberately NOT in this list.
 */
const THROTTLE_MARKERS = [
  "error code: 1015", "too many requests", "quota exceeded",
  "exceeded the maximum", "please slow down", "you have exceeded",
  "connection limit exceeded", "request limit exceeded",
  "rate limit exceeded", "429 too many",
];

const NOTFOUND_MARKERS = [
  "no entries found", "not found", "no match", "no matching record",
  "no data found", "status: free", "status: available", "domain not registered",
];

const EXP_PATTERNS: RegExp[] = [
  /Registry Expiry Date:\s*(\S+)/i,
  /Expires on:\s*(\d{4}-\d{2}-\d{2})/i,
  /Expiry\s+Date:\s*(\S+)/i,
  /Expiration Date:\s*(\S+)/i,
  /Expiration Time:\s*(\S+)/i,
  /expires:\s*(\S+)/i,
  /Expire Date:\s*(\S+)/i,
  /paid-till:\s*(\S+)/i,
  /renewal date:\s*(\S+)/i,
];

/** Return an ISO yyyy-mm-dd date string, or null. null is a real answer and must never become today(). */
export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim().replace(/\.$/, "");

  // Leading ISO date covers the overwhelming majority, including full timestamps.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return validOrNull(+iso[1]!, +iso[2]!, +iso[3]!);

  const dotted = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(t);
  if (dotted) return validOrNull(+dotted[1]!, +dotted[2]!, +dotted[3]!);

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (dmy) return validOrNull(+dmy[3]!, +dmy[2]!, +dmy[1]!);

  const dMonY = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(t);
  if (dMonY) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mi = months.indexOf(dMonY[2]!.toLowerCase());
    if (mi >= 0) return validOrNull(+dMonY[3]!, mi + 1, +dMonY[1]!);
  }
  return null;
}

function validOrNull(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${pad4(y)}-${pad2(m)}-${pad2(d)}`;
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const pad4 = (n: number) => String(n).padStart(4, "0");

/** Whole days between two yyyy-mm-dd strings (a - b). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}

export interface RegistryReading {
  date: string | null;
  subclass: Subclass;
  detail: string;
}

/**
 * CLASSIFIER — pure function of (domain, method, raw body, transport error).
 * Pure so it can be replayed against retained bodies with no network at all.
 */
export function classifyRegistry(
  domain: string,
  method: "rdap" | "whois",
  raw: string | null,
  netErr: string | null,
): RegistryReading {
  if (netErr) return { date: null, subclass: "TRANSPORT", detail: netErr.slice(0, 200) };
  if (raw === null || raw.length === 0) return { date: null, subclass: "TRANSPORT", detail: "empty body, 0 bytes" };

  const low = raw.toLowerCase();

  // ORDER IS LOAD-BEARING: EXTRACT THE ANSWER FIRST, DIAGNOSE ONLY ON FAILURE.
  //
  // An earlier version tested throttle markers before anything else, reasoning
  // that a throttle page is well-formed and would pass a structure test. That
  // reasoning is correct and the ordering it produced was still wrong: it
  // suppressed 23 valid comparisons whose only sin was quoting a rate-limiting
  // policy in their footer. A body that CONTAINS THE ANSWER WE ASKED FOR is not
  // a throttle response, whatever else it says. Reaching diagnosis only when no
  // date came back makes a marker in boilerplate harmless by construction
  // rather than by careful word choice.
  const diagnose = (): RegistryReading | null => {
    for (const mk of THROTTLE_MARKERS) {
      if (low.includes(mk)) return { date: null, subclass: "THROTTLED", detail: `marker=${mk} bytes=${raw.length}` };
    }
    for (const mk of NOTFOUND_MARKERS) {
      if (low.includes(mk)) return { date: null, subclass: "NOT_FOUND", detail: `marker=${mk}` };
    }
    return null;
  };

  if (method === "rdap") {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return diagnose() ?? { date: null, subclass: "TRANSPORT", detail: `unparseable json, bytes=${raw.length}` };
    }

    // VALIDITY TEST — does the registry's answer concern the name we asked about?
    // This replaces a `length < 40` heuristic, a magic number unrelated to the
    // question, which put two structurally identical DENIC answers (39B and 40B)
    // on opposite sides of the line. A throttle page or generic error does not
    // echo the queried name; every real registry answer does.
    const ldh = String((j["ldhName"] as string | undefined) ?? "").toLowerCase().replace(/\.$/, "");
    const events = (j["events"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (ldh && ldh !== domain.toLowerCase()) {
      return { date: null, subclass: "NOT_MINE", detail: `ldhName=${ldh} asked=${domain}` };
    }
    if (!ldh && events.length === 0) {
      const d = diagnose();
      if (d) return d;
      const ec = j["errorCode"];
      if (ec !== undefined) {
        return { date: null, subclass: "TRANSPORT", detail: `registry error ${String(ec)}: ${String(j["title"] ?? j["description"] ?? "").slice(0, 90)}` };
      }
      return { date: null, subclass: "TRANSPORT", detail: `no ldhName and no events, bytes=${raw.length}` };
    }

    let expRaw: string | null = null;
    for (const ev of events) {
      if (ev["eventAction"] === "expiration") { expRaw = String(ev["eventDate"] ?? ""); break; } // FIRST, deterministically
    }
    if (!expRaw) {
      const actions = [...new Set(events.map((e) => String(e["eventAction"] ?? "?")))].sort().join(",");
      return { date: null, subclass: "NO_EXPIRY", detail: `events=${actions || "none"}` };
    }
    const d = parseDate(expRaw);
    return d ? { date: d, subclass: "OK", detail: expRaw } : { date: null, subclass: "BAD_DATE", detail: expRaw };
  }

  // WHOIS — extract first.
  for (const p of EXP_PATTERNS) {
    const m = p.exec(raw);
    if (m) {
      const expRaw = m[1]!.trim();
      const d = parseDate(expRaw);
      return d ? { date: d, subclass: "OK", detail: expRaw } : { date: null, subclass: "BAD_DATE", detail: expRaw };
    }
  }

  // No date came back. NOW diagnose why.
  const d = diagnose();
  if (d) return d;
  if (!low.includes(domain.toLowerCase())) {
    return { date: null, subclass: "TRANSPORT", detail: `response does not name ${domain}, bytes=${raw.length}` };
  }
  return { date: null, subclass: "NO_EXPIRY", detail: `valid ${raw.length}-byte answer, no expiry field` };
}

export interface VerdictInput {
  domain: string;
  tld: string;
  registrarDate: string | null;
  registrarName?: string | null;
  status?: string | null;
  reading: RegistryReading;
}

export interface VerdictResult {
  verdict: Verdict;
  why: string;
}

/** Fold the two sides into ONE outcome. UNVERIFIABLE never becomes MATCH. */
export function verdictFor(input: VerdictInput): VerdictResult {
  const { domain: _domain, tld, registrarDate, registrarName, status, reading } = input;
  const { date: registryDate, subclass, detail } = reading;

  // An unenumerable registrar is UNCHECKABLE, never compliant. Checked before
  // anything else, because such a row's registrar expiry is absent or hardcoded
  // and would otherwise fall through into a misleading classification.
  if (registrarName && UNENUMERABLE_REGISTRARS.has(registrarName.toLowerCase())) {
    return {
      verdict: "UNVERIFIABLE_UNEXPECTED",
      why: `UNCHECKABLE: registrar '${registrarName}' exposes no enumerable expiry; this row is not covered`,
    };
  }

  if (subclass === "NOT_FOUND") return { verdict: "NOT_AT_REGISTRY", why: `registry has no record: ${detail}` };
  if (subclass === "NOT_MINE") return { verdict: "NOT_AT_REGISTRY", why: `registry answered about a different name: ${detail}` };

  if (registrarDate === null) {
    return {
      verdict: status === "CANCELLED" ? "UNVERIFIABLE_EXPECTED" : "UNVERIFIABLE_UNEXPECTED",
      why: `registrar published no expiry (status=${status ?? "unknown"})`,
    };
  }

  if (subclass === "NO_EXPIRY") {
    if (NO_EXPIRY_TLDS.has(tld)) {
      return { verdict: "UNVERIFIABLE_EXPECTED", why: `registry policy: .${tld} publishes no expiry (${detail})` };
    }
    return { verdict: "UNVERIFIABLE_UNEXPECTED", why: `REGRESSION: .${tld} normally publishes expiry, this response did not (${detail})` };
  }

  if (subclass === "TRANSPORT" || subclass === "THROTTLED" || subclass === "BAD_DATE") {
    return { verdict: "UNVERIFIABLE_UNEXPECTED", why: `${subclass}: ${detail}` };
  }

  if (registryDate === null) {
    return { verdict: "UNVERIFIABLE_UNEXPECTED", why: "classifier returned OK with no date (bug)" };
  }

  const delta = daysBetween(registrarDate, registryDate);
  if (Math.abs(delta) <= TOL_DAYS) return { verdict: "MATCH", why: `delta=${delta >= 0 ? "+" : ""}${delta}d` };
  return {
    verdict: "MISMATCH",
    why: `registrar=${registrarDate} registry=${registryDate} delta=${delta >= 0 ? "+" : ""}${delta}d`,
  };
}

// ---------------------------------------------------------------------------
// PRE-ARM SELF-TEST — two-sided. Refuses to run if it cannot fire OR cannot
// stay silent.
//
// FIXTURES ARE SYNTHETIC. The shapes are byte-faithful to real registry
// responses; the NAMES are invented. This package is public, and a portfolio
// domain committed into a test fixture is a portfolio disclosure that ships to
// npm and stays in git history.
// ---------------------------------------------------------------------------

export const FIXTURES = {
  /** NIC.MD shape: registry says 2026, registrar record says 2027. */
  mismatchWhois: [
    "% (c) NIC.MD",
    "Domain  name:   fixture-alpha.md",
    "Domain state:   OK Delegated",
    "Registrar:      Example Registrar",
    "",
    "Registered on:  2025-09-05",
    "Expires on:     2026-09-05",
    "",
  ].join("\n"),

  /** RDAP shape where both sides agree. */
  matchRdap: JSON.stringify({
    ldhName: "FIXTURE-BETA.CO",
    events: [
      { eventAction: "registration", eventDate: "2025-01-14T17:37:14Z" },
      { eventAction: "expiration", eventDate: "2027-01-14T23:59:59Z" },
    ],
  }),

  /** A complete DENIC answer that is only 39 bytes and publishes no expiry. */
  denicShort: "Domain: fixture-gamma.de\nStatus: connect\n",

  throttle: "<html><head><title>Access denied</title></head><body>error code: 1015</body></html>",

  truncated: "",

  /**
   * Real registry shape: a GOOD answer whose footer quotes a rate-limiting
   * policy. Regression fixture for a defect the original check shipped, caught
   * only by running against the population — 23 of 677 real bodies look like
   * this, and a marker-first classifier scores every one of them as throttled.
   */
  boilerplateRateLimit: [
    "Domain Name: fixture-beta.co",
    "Registry Domain ID: D123-CO",
    "Registry Expiry Date: 2027-01-14T23:59:59.0Z",
    "Registrar: Example Registrar, LLC",
    "",
    ">>> Last update of WHOIS database: 2026-08-06T09:00:00.0Z <<<",
    "Access to the Whois and RDAP services is rate limited. For more",
    "information, visit https://example-registry.invalid/policies",
    "",
  ].join("\n"),
} as const;

export interface PrearmCase {
  name: string;
  passed: boolean;
  got: string;
}

/** Every case asserts a VALUE, not merely that the call returned. */
export function prearm(): { ok: boolean; cases: PrearmCase[] } {
  const cases: PrearmCase[] = [];
  const push = (name: string, passed: boolean, got: string) => cases.push({ name, passed, got });

  {
    const r = classifyRegistry("fixture-alpha.md", "whois", FIXTURES.mismatchWhois, null);
    const v = verdictFor({ domain: "fixture-alpha.md", tld: "md", registrarDate: "2027-09-05", status: "ACTIVE", reading: r });
    push("KNOWN-POSITIVE  disagreeing dates must be MISMATCH",
      v.verdict === "MISMATCH" && r.date === "2026-09-05", `${v.verdict} / registry=${r.date} / ${v.why}`);
  }
  {
    const r = classifyRegistry("fixture-beta.co", "rdap", FIXTURES.matchRdap, null);
    const v = verdictFor({ domain: "fixture-beta.co", tld: "co", registrarDate: "2027-01-14", status: "ACTIVE", reading: r });
    push("KNOWN-NEGATIVE  agreeing dates must be MATCH",
      v.verdict === "MATCH" && r.date === "2027-01-14", `${v.verdict} / registry=${r.date} / ${v.why}`);
  }
  {
    const r = classifyRegistry("fixture-gamma.de", "whois", FIXTURES.denicShort, null);
    const v = verdictFor({ domain: "fixture-gamma.de", tld: "de", registrarDate: "2027-03-01", status: "ACTIVE", reading: r });
    push("39-BYTE DENIC must be UNVERIFIABLE_EXPECTED, not throttled",
      v.verdict === "UNVERIFIABLE_EXPECTED", `${v.verdict} / ${v.why}`);
  }
  {
    const r = classifyRegistry("fixture-delta.com", "whois", FIXTURES.throttle, null);
    const v = verdictFor({ domain: "fixture-delta.com", tld: "com", registrarDate: "2027-01-01", status: "ACTIVE", reading: r });
    push("THROTTLE PAGE must be UNVERIFIABLE_UNEXPECTED, never MATCH",
      v.verdict === "UNVERIFIABLE_UNEXPECTED" && r.subclass === "THROTTLED", `${v.verdict} / ${v.why}`);
  }
  {
    const r = classifyRegistry("fixture-delta.com", "whois", FIXTURES.truncated, null);
    const v = verdictFor({ domain: "fixture-delta.com", tld: "com", registrarDate: "2027-01-01", status: "ACTIVE", reading: r });
    push("EMPTY BODY must be UNVERIFIABLE_UNEXPECTED, never MATCH",
      v.verdict === "UNVERIFIABLE_UNEXPECTED", `${v.verdict} / ${v.why}`);
  }
  {
    const r = classifyRegistry("fixture-beta.co", "whois", FIXTURES.boilerplateRateLimit, null);
    const v = verdictFor({ domain: "fixture-beta.co", tld: "co", registrarDate: "2027-01-14", status: "ACTIVE", reading: r });
    push("RATE-LIMIT BOILERPLATE in a GOOD answer must be MATCH",
      v.verdict === "MATCH" && r.subclass === "OK", `${v.verdict} / subclass=${r.subclass} / ${v.why}`);
  }
  {
    const r = classifyRegistry("fixture-eps.md", "whois", FIXTURES.mismatchWhois.replace("fixture-alpha.md", "fixture-eps.md"), null);
    const v = verdictFor({ domain: "fixture-eps.md", tld: "md", registrarDate: null, status: "CANCELLED", reading: r });
    push("NULL REGISTRAR EXPIRY must be UNVERIFIABLE, never MATCH",
      v.verdict === "UNVERIFIABLE_EXPECTED", `${v.verdict} / ${v.why}`);
  }
  {
    // A null expiry on a LIVE row is a coverage hole, not a clean result.
    const r = classifyRegistry("fixture-zeta.com", "rdap", FIXTURES.matchRdap.replace("FIXTURE-BETA.CO", "FIXTURE-ZETA.COM"), null);
    const v = verdictFor({ domain: "fixture-zeta.com", tld: "com", registrarDate: null, status: "ACTIVE", reading: r });
    push("NULL EXPIRY on an ACTIVE row must be UNVERIFIABLE_UNEXPECTED",
      v.verdict === "UNVERIFIABLE_UNEXPECTED", `${v.verdict} / ${v.why}`);
  }
  {
    const r = classifyRegistry("fixture-eta.com", "rdap", FIXTURES.matchRdap.replace("FIXTURE-BETA.CO", "FIXTURE-ETA.COM"), null);
    const v = verdictFor({ domain: "fixture-eta.com", tld: "com", registrarDate: "2027-01-14", registrarName: "Cloudflare", status: "ACTIVE", reading: r });
    push("UNENUMERABLE REGISTRAR must be UNCHECKABLE, never MATCH",
      v.verdict === "UNVERIFIABLE_UNEXPECTED" && v.why.startsWith("UNCHECKABLE"), `${v.verdict} / ${v.why}`);
  }

  return { ok: cases.every((c) => c.passed), cases };
}

// ---------------------------------------------------------------------------
// RUNNER — deps injected so the whole path is testable with no network.
// ---------------------------------------------------------------------------

export interface RegistrarRow {
  domain: string;
  expiresAt?: string | null;
  status?: string | null;
  registrar?: string | null;
}

export interface ReconcileDeps {
  /** Resolve a TLD to a registry endpoint, or null when no route is known. */
  routeFor(tld: string): { method: "rdap" | "whois"; endpoint: string } | null;
  /** Fetch the raw registry body. Must not throw; report transport failure via netErr. */
  fetchRegistry(domain: string, method: "rdap" | "whois", endpoint: string): Promise<{ raw: string | null; netErr: string | null }>;
  today?(): string;
}

export interface ReconcileRecord {
  domain: string;
  tld: string;
  method: "rdap" | "whois" | "none";
  verdict: Verdict;
  subclass?: Subclass;
  why: string;
  registrar: string | null;
  registry: string | null;
  status?: string | null;
  daysToRegistryExpiry?: number;
}

export interface ReconcileReport {
  records: ReconcileRecord[];
  tally: Record<Verdict, number>;
  comparable: number;
  expiringSoon: ReconcileRecord[];
  exitCode: number;
}

/** Deduplicate registrar rows — marker paging is inclusive and yields repeats. */
export function dedupeRegistrarRows(rows: RegistrarRow[]): { rows: RegistrarRow[]; dupesRemoved: number } {
  const seen = new Set<string>();
  const out: RegistrarRow[] = [];
  for (const r of rows) {
    if (seen.has(r.domain)) continue;
    seen.add(r.domain);
    out.push(r);
  }
  return { rows: out, dupesRemoved: rows.length - out.length };
}

export async function reconcileExpiry(rows: RegistrarRow[], deps: ReconcileDeps): Promise<ReconcileReport> {
  const today = deps.today?.() ?? new Date().toISOString().slice(0, 10);
  const records: ReconcileRecord[] = [];

  for (const r of rows) {
    const tld = r.domain.split(".").pop() ?? "";
    const registrarDate = parseDate(r.expiresAt);
    const route = deps.routeFor(tld);

    if (!route) {
      records.push({
        domain: r.domain, tld, method: "none",
        verdict: "UNVERIFIABLE_UNEXPECTED",
        why: `no registry route known for .${tld}`,
        registrar: registrarDate, registry: null, status: r.status ?? null,
      });
      continue;
    }

    let reading: RegistryReading;
    try {
      const { raw, netErr } = await deps.fetchRegistry(r.domain, route.method, route.endpoint);
      reading = classifyRegistry(r.domain, route.method, raw, netErr);
    } catch (err) {
      reading = { date: null, subclass: "TRANSPORT", detail: `EXCEPTION ${err instanceof Error ? err.message : String(err)}`.slice(0, 200) };
    }

    const v = verdictFor({
      domain: r.domain, tld, registrarDate,
      registrarName: r.registrar ?? null, status: r.status ?? null, reading,
    });

    const rec: ReconcileRecord = {
      domain: r.domain, tld, method: route.method,
      verdict: v.verdict, subclass: reading.subclass, why: v.why,
      registrar: registrarDate, registry: reading.date, status: r.status ?? null,
    };
    if (reading.date) rec.daysToRegistryExpiry = daysBetween(reading.date, today);
    records.push(rec);
  }

  const tally: Record<Verdict, number> = {
    MATCH: 0, MISMATCH: 0, NOT_AT_REGISTRY: 0,
    UNVERIFIABLE_EXPECTED: 0, UNVERIFIABLE_UNEXPECTED: 0,
  };
  for (const r of records) tally[r.verdict]++;

  const expiringSoon = records
    .filter((r) => r.daysToRegistryExpiry !== undefined && r.daysToRegistryExpiry <= STALE_SOON_DAYS)
    .sort((a, b) => (a.daysToRegistryExpiry ?? 0) - (b.daysToRegistryExpiry ?? 0));

  let exitCode = 0;
  if (tally.MISMATCH > 0) exitCode = 1;
  if (tally.NOT_AT_REGISTRY > 0) exitCode = Math.max(exitCode, 2);
  if (tally.UNVERIFIABLE_UNEXPECTED > 0) exitCode = Math.max(exitCode, 2);

  return { records, tally, comparable: tally.MATCH + tally.MISMATCH, expiringSoon, exitCode };
}

/**
 * Coverage regression against a prior run: a domain that WAS comparable and is
 * now unverifiable. A shrinking denominator is how "0 mismatches" gets
 * published by an instrument that has gone blind.
 */
export function coverageRegressions(current: ReconcileRecord[], baseline: Array<{ domain: string; verdict: Verdict }>): string[] {
  const base = new Map(baseline.map((b) => [b.domain, b.verdict]));
  return current
    .filter((r) => {
      const was = base.get(r.domain);
      return (was === "MATCH" || was === "MISMATCH") && r.verdict.startsWith("UNVERIFIABLE");
    })
    .map((r) => r.domain);
}
