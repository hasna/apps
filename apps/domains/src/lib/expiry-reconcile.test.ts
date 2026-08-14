import { describe, it, expect } from "bun:test";
import {
  parseDate, daysBetween, classifyRegistry, verdictFor, prearm, FIXTURES,
  reconcileExpiry, dedupeRegistrarRows, coverageRegressions,
  type ReconcileDeps, type RegistryReading,
} from "./expiry-reconcile.js";

// All fixture domain names here are synthetic. This package is public; a real
// portfolio domain in a committed fixture is a disclosure that ships to npm.

describe("parseDate", () => {
  it("parses the shapes registries actually emit", () => {
    expect(parseDate("2026-09-05")).toBe("2026-09-05");
    expect(parseDate("2027-01-14T23:59:59Z")).toBe("2027-01-14");
    expect(parseDate("2027-01-14T23:59:59.0Z")).toBe("2027-01-14");
    expect(parseDate("2026.09.05")).toBe("2026-09-05");
    expect(parseDate("05/09/2026")).toBe("2026-09-05");
    expect(parseDate("5-Sep-2026")).toBe("2026-09-05");
    expect(parseDate("2026-09-05.")).toBe("2026-09-05");
  });

  it("returns null rather than silently becoming today()", () => {
    // This is the property that keeps a BAD_DATE from scoring as a comparison.
    expect(parseDate(null)).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("whenever")).toBeNull();
    expect(parseDate("2026-13-05")).toBeNull(); // month 13
    expect(parseDate("2026-02-30")).toBeNull(); // not a real day
  });
});

describe("daysBetween", () => {
  it("counts whole days signed", () => {
    expect(daysBetween("2027-09-05", "2026-09-05")).toBe(365);
    expect(daysBetween("2026-09-05", "2026-09-05")).toBe(0);
    expect(daysBetween("2026-09-04", "2026-09-05")).toBe(-1);
  });
});

describe("classifyRegistry — extract before diagnose", () => {
  it("reads an expiry out of a WHOIS body", () => {
    const r = classifyRegistry("fixture-alpha.md", "whois", FIXTURES.mismatchWhois, null);
    expect(r.subclass).toBe("OK");
    expect(r.date).toBe("2026-09-05");
  });

  it("reads an expiry out of an RDAP body", () => {
    const r = classifyRegistry("fixture-beta.co", "rdap", FIXTURES.matchRdap, null);
    expect(r.subclass).toBe("OK");
    expect(r.date).toBe("2027-01-14");
  });

  it("does NOT call a good answer throttled just because its footer quotes a rate-limit policy", () => {
    // The regression that matters: 23 of 677 real bodies carry this boilerplate
    // AND a valid expiry. Marker-first ordering scored all 23 as throttled.
    const r = classifyRegistry("fixture-beta.co", "whois", FIXTURES.boilerplateRateLimit, null);
    expect(r.subclass).toBe("OK");
    expect(r.date).toBe("2027-01-14");
  });

  it("still detects a real throttle page, where no answer was extracted", () => {
    const r = classifyRegistry("fixture-delta.com", "whois", FIXTURES.throttle, null);
    expect(r.subclass).toBe("THROTTLED");
    expect(r.date).toBeNull();
  });

  it("treats a short but complete DENIC answer as NO_EXPIRY, not as a transport fault", () => {
    const r = classifyRegistry("fixture-gamma.de", "whois", FIXTURES.denicShort, null);
    expect(r.subclass).toBe("NO_EXPIRY");
  });

  it("rejects an answer about a different name", () => {
    const body = JSON.stringify({ ldhName: "SOMETHING-ELSE.CO", events: [] });
    const r = classifyRegistry("fixture-beta.co", "rdap", body, null);
    expect(r.subclass).toBe("NOT_MINE");
  });

  it("reports transport failure rather than inventing a reading", () => {
    expect(classifyRegistry("a.com", "whois", null, "ETIMEDOUT").subclass).toBe("TRANSPORT");
    expect(classifyRegistry("a.com", "whois", "", null).subclass).toBe("TRANSPORT");
    expect(classifyRegistry("a.com", "rdap", "{not json", null).subclass).toBe("TRANSPORT");
  });

  it("classifies an unparseable date as BAD_DATE, never as a match", () => {
    const body = JSON.stringify({
      ldhName: "FIXTURE-BETA.CO",
      events: [{ eventAction: "expiration", eventDate: "sometime next year" }],
    });
    const r = classifyRegistry("fixture-beta.co", "rdap", body, null);
    expect(r.subclass).toBe("BAD_DATE");
    expect(r.date).toBeNull();
  });
});

const ok = (date: string): RegistryReading => ({ date, subclass: "OK", detail: date });

describe("verdictFor — UNVERIFIABLE never becomes MATCH", () => {
  it("MISMATCH when the two sides disagree beyond tolerance", () => {
    const v = verdictFor({ domain: "a.md", tld: "md", registrarDate: "2027-09-05", status: "ACTIVE", reading: ok("2026-09-05") });
    expect(v.verdict).toBe("MISMATCH");
    expect(v.why).toContain("delta=+365d");
  });

  it("MATCH when they agree, and inside the 1-day tz tolerance", () => {
    expect(verdictFor({ domain: "a.co", tld: "co", registrarDate: "2027-01-14", status: "ACTIVE", reading: ok("2027-01-14") }).verdict).toBe("MATCH");
    expect(verdictFor({ domain: "a.co", tld: "co", registrarDate: "2027-01-15", status: "ACTIVE", reading: ok("2027-01-14") }).verdict).toBe("MATCH");
  });

  it("2 days apart is a MISMATCH — the tolerance does not swallow real drift", () => {
    expect(verdictFor({ domain: "a.co", tld: "co", registrarDate: "2027-01-16", status: "ACTIVE", reading: ok("2027-01-14") }).verdict).toBe("MISMATCH");
  });

  it("a null registrar expiry on an ACTIVE row is a coverage hole, not a pass", () => {
    const v = verdictFor({ domain: "a.com", tld: "com", registrarDate: null, status: "ACTIVE", reading: ok("2027-01-14") });
    expect(v.verdict).toBe("UNVERIFIABLE_UNEXPECTED");
  });

  it("a null registrar expiry on a CANCELLED row is expected", () => {
    const v = verdictFor({ domain: "a.com", tld: "com", registrarDate: null, status: "CANCELLED", reading: ok("2027-01-14") });
    expect(v.verdict).toBe("UNVERIFIABLE_EXPECTED");
  });

  it("splits NO_EXPIRY by registry policy — .de expected, .com a regression", () => {
    const noExp: RegistryReading = { date: null, subclass: "NO_EXPIRY", detail: "none" };
    expect(verdictFor({ domain: "a.de", tld: "de", registrarDate: "2027-03-01", status: "ACTIVE", reading: noExp }).verdict).toBe("UNVERIFIABLE_EXPECTED");
    const v = verdictFor({ domain: "a.com", tld: "com", registrarDate: "2027-03-01", status: "ACTIVE", reading: noExp });
    expect(v.verdict).toBe("UNVERIFIABLE_UNEXPECTED");
    expect(v.why).toContain("REGRESSION");
  });

  it("an unenumerable registrar is UNCHECKABLE even when both dates are present and agree", () => {
    // The failure this prevents: Cloudflare-registrar rows carry a hardcoded
    // auto_renew and no usable expiry, so scoring them MATCH reports coverage
    // the check does not have.
    const v = verdictFor({ domain: "a.com", tld: "com", registrarDate: "2027-01-14", registrarName: "Cloudflare", status: "ACTIVE", reading: ok("2027-01-14") });
    expect(v.verdict).toBe("UNVERIFIABLE_UNEXPECTED");
    expect(v.why).toContain("UNCHECKABLE");
  });

  it("NOT_AT_REGISTRY for a name the registry does not know", () => {
    const v = verdictFor({ domain: "a.com", tld: "com", registrarDate: "2027-01-14", status: "ACTIVE", reading: { date: null, subclass: "NOT_FOUND", detail: "marker=no match" } });
    expect(v.verdict).toBe("NOT_AT_REGISTRY");
  });
});

describe("prearm — the instrument must prove it can fire AND stay silent", () => {
  it("passes on the shipped fixtures, and every case asserts a value", () => {
    const { ok: passed, cases } = prearm();
    const failed = cases.filter((c) => !c.passed).map((c) => `${c.name} -> ${c.got}`);
    expect(failed).toEqual([]);
    expect(passed).toBe(true);
    expect(cases.length).toBeGreaterThanOrEqual(9);
  });

  it("contains BOTH a known-positive and a known-negative case", () => {
    // A pre-arm made only of positives cannot detect an instrument that fires
    // on everything.
    const { cases } = prearm();
    expect(cases.some((c) => c.name.startsWith("KNOWN-POSITIVE"))).toBe(true);
    expect(cases.some((c) => c.name.startsWith("KNOWN-NEGATIVE"))).toBe(true);
  });

  it("THE PRE-ARM ITSELF CAN FAIL — a broken classifier is caught, not waved through", () => {
    // Without this, "prearm passed" is unfalsifiable. Feed the classifier a
    // corrupted body and assert the known-positive case stops holding.
    const broken = classifyRegistry("fixture-alpha.md", "whois", FIXTURES.mismatchWhois.replace("Expires on:     2026-09-05", "Expires on:     garbage"), null);
    const v = verdictFor({ domain: "fixture-alpha.md", tld: "md", registrarDate: "2027-09-05", status: "ACTIVE", reading: broken });
    expect(v.verdict).not.toBe("MISMATCH");
    expect(v.verdict).toBe("UNVERIFIABLE_UNEXPECTED");
  });
});

describe("dedupeRegistrarRows", () => {
  it("drops the repeats inclusive marker paging produces", () => {
    const { rows, dupesRemoved } = dedupeRegistrarRows([
      { domain: "a.com" }, { domain: "b.com" }, { domain: "a.com" },
    ]);
    expect(rows.length).toBe(2);
    expect(dupesRemoved).toBe(1);
  });
});

describe("reconcileExpiry — end to end with no network", () => {
  const deps = (bodies: Record<string, string>): ReconcileDeps => ({
    routeFor: (tld) => (tld === "de" ? { method: "whois", endpoint: "whois.denic.de" }
      : tld === "zz" ? null
        : { method: tld === "md" ? "whois" : "rdap", endpoint: `https://rdap.example.invalid/${tld}/` }),
    fetchRegistry: async (domain) => (bodies[domain] !== undefined
      ? { raw: bodies[domain]!, netErr: null }
      : { raw: null, netErr: "no fixture body" }),
    today: () => "2026-08-07",
  });

  it("FLAGS a disagreeing row and STAYS SILENT on an agreeing one, in the same run", () => {
    // This is the two-sided proof at the report level: one run, both outcomes.
    return reconcileExpiry(
      [
        { domain: "fixture-alpha.md", expiresAt: "2027-09-05", status: "ACTIVE" },
        { domain: "fixture-beta.co", expiresAt: "2027-01-14", status: "ACTIVE" },
      ],
      deps({
        "fixture-alpha.md": FIXTURES.mismatchWhois,
        "fixture-beta.co": FIXTURES.matchRdap,
      }),
    ).then((rep) => {
      expect(rep.tally.MISMATCH).toBe(1);
      expect(rep.tally.MATCH).toBe(1);
      expect(rep.comparable).toBe(2);
      expect(rep.exitCode).toBe(1);
      const mm = rep.records.find((r) => r.verdict === "MISMATCH")!;
      expect(mm.domain).toBe("fixture-alpha.md");
      expect(mm.registrar).toBe("2027-09-05");
      expect(mm.registry).toBe("2026-09-05");
    });
  });

  it("exits 0 when everything agrees — the check can pass, not only fail", () => {
    return reconcileExpiry(
      [{ domain: "fixture-beta.co", expiresAt: "2027-01-14", status: "ACTIVE" }],
      deps({ "fixture-beta.co": FIXTURES.matchRdap }),
    ).then((rep) => {
      expect(rep.tally.MISMATCH).toBe(0);
      expect(rep.exitCode).toBe(0);
    });
  });

  it("a transport failure is UNVERIFIABLE_UNEXPECTED and never inflates the comparable count", () => {
    return reconcileExpiry(
      [{ domain: "missing.co", expiresAt: "2027-01-14", status: "ACTIVE" }],
      deps({}),
    ).then((rep) => {
      expect(rep.tally.UNVERIFIABLE_UNEXPECTED).toBe(1);
      expect(rep.comparable).toBe(0);
      expect(rep.exitCode).toBe(2);
    });
  });

  it("a TLD with no known registry route is reported, never dropped", () => {
    return reconcileExpiry(
      [{ domain: "thing.zz", expiresAt: "2027-01-14", status: "ACTIVE" }],
      deps({}),
    ).then((rep) => {
      expect(rep.records.length).toBe(1);
      expect(rep.records[0]!.verdict).toBe("UNVERIFIABLE_UNEXPECTED");
      expect(rep.records[0]!.why).toContain("no registry route");
    });
  });

  it("computes days to registry expiry against an injected today", () => {
    return reconcileExpiry(
      [{ domain: "fixture-alpha.md", expiresAt: "2027-09-05", status: "ACTIVE" }],
      deps({ "fixture-alpha.md": FIXTURES.mismatchWhois }),
    ).then((rep) => {
      expect(rep.records[0]!.daysToRegistryExpiry).toBe(29);
      expect(rep.expiringSoon.length).toBe(1);
    });
  });

  it("a fetch that throws becomes a recorded UNVERIFIABLE, not a crashed run", () => {
    const throwing: ReconcileDeps = {
      routeFor: () => ({ method: "rdap", endpoint: "x" }),
      fetchRegistry: async () => { throw new Error("boom"); },
      today: () => "2026-08-07",
    };
    return reconcileExpiry([{ domain: "a.com", expiresAt: "2027-01-01" }], throwing).then((rep) => {
      expect(rep.records[0]!.verdict).toBe("UNVERIFIABLE_UNEXPECTED");
      expect(rep.records[0]!.why).toContain("boom");
    });
  });
});

describe("coverageRegressions", () => {
  it("catches a row that was comparable and has gone blind", () => {
    const regressed = coverageRegressions(
      [{ domain: "a.com", tld: "com", method: "rdap", verdict: "UNVERIFIABLE_UNEXPECTED", why: "", registrar: null, registry: null }],
      [{ domain: "a.com", verdict: "MATCH" }],
    );
    expect(regressed).toEqual(["a.com"]);
  });

  it("does not flag a row that was already unverifiable", () => {
    const regressed = coverageRegressions(
      [{ domain: "a.com", tld: "com", method: "rdap", verdict: "UNVERIFIABLE_EXPECTED", why: "", registrar: null, registry: null }],
      [{ domain: "a.com", verdict: "UNVERIFIABLE_EXPECTED" }],
    );
    expect(regressed).toEqual([]);
  });
});
