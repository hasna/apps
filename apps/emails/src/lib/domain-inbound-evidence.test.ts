// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// The domain-inbound evidence family decides whether an inbound pipeline is
// LIVE for a domain. The filter logic is where the failures live:
//
//   - the expected prefix is `inbound/<domain>/`, computed from the
//     LOWERCASED domain — a source registered for "Example.COM" must match
//     the domain "example.com", and a prefix with stray leading slashes or a
//     missing trailing slash must still match (normalizedPrefix trims,
//     strips leading slashes, and forces a trailing one);
//   - the provider filter is a strict mismatch reject: a source with a
//     provider_id that differs from the domain's is excluded, while a source
//     with NO provider_id is included (a source not yet bound to a provider
//     must not be hidden);
//   - the readiness signal distinguishes a NON-postgres source of truth
//     (which cannot report S3 evidence at all) from a postgres one, and the
//     postgres branch must never fabricate counts — with no configured
//     sources or buckets it reports ZERO, not the domain's inbound_status
//     dressed up as evidence.

import { describe, expect, it } from "bun:test";
import type { Domain } from "../types/index.js";
import { domainInboundReadinessSignals, listDomainLiveS3Sources, type S3MailSource } from "./domain-inbound-evidence.js";

function domain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: "dom-1",
    domain: "example.com",
    provider_id: "prov-1",
    source_of_truth: "postgres",
    inbound_status: "not_configured",
    ...overrides,
  } as Domain;
}

function source(overrides: Partial<S3MailSource> = {}): S3MailSource {
  return {
    id: "src-1",
    type: "s3",
    bucket: "inbound",
    prefix: "inbound/example.com/",
    status: "live",
    region: "us-east-1",
    ...overrides,
  } as S3MailSource;
}

describe("listDomainLiveS3Sources", () => {
  it("matches the source whose prefix is exactly inbound/<domain>/", () => {
    const sources = [source({ id: "match", prefix: "inbound/example.com/" }), source({ id: "other", prefix: "inbound/other.com/" })];
    const hits = listDomainLiveS3Sources(domain(), sources);
    expect(hits.map((s) => s.id)).toEqual(["match"]);
  });

  it("matches prefixes with stray slashes and missing trailing slashes", () => {
    const sources = [
      source({ id: "leading-slash", prefix: "/inbound/example.com" }),
      source({ id: "trailing-missing", prefix: "inbound/example.com" }),
      source({ id: "double-inner", prefix: "inbound//example.com/" }),
    ];
    // normalizedPrefix only strips LEADING slashes; an interior double slash
    // changes the prefix and must NOT match.
    const hits = listDomainLiveS3Sources(domain(), sources);
    expect(hits.map((s) => s.id).sort()).toEqual(["leading-slash", "trailing-missing"]);
  });

  it("matches case-insensitively on both the domain and the prefix", () => {
    const sources = [source({ id: "upper-prefix", prefix: "INBOUND/EXAMPLE.COM/" })];
    const hits = listDomainLiveS3Sources(domain({ domain: "Example.COM" }), sources);
    expect(hits.map((s) => s.id)).toEqual(["upper-prefix"]);
  });

  it("excludes sources bound to a different provider but keeps unbound ones", () => {
    const sources = [
      source({ id: "wrong-provider", provider_id: "prov-2", prefix: "inbound/example.com/" }),
      source({ id: "unbound", provider_id: undefined, prefix: "inbound/example.com/" }),
      source({ id: "same-provider", provider_id: "prov-1", prefix: "inbound/example.com/" }),
    ];
    const hits = listDomainLiveS3Sources(domain(), sources);
    expect(hits.map((s) => s.id).sort()).toEqual(["same-provider", "unbound"]);
  });

  it("returns no sources for a domain with no matching prefix", () => {
    expect(listDomainLiveS3Sources(domain(), [source({ prefix: "other/example.com/" })])).toEqual([]);
    expect(listDomainLiveS3Sources(domain(), [])).toEqual([]);
  });
});

describe("domainInboundReadinessSignals", () => {
  it("reports the plain signals for a non-postgres source of truth — no S3 claims", () => {
    const signals = domainInboundReadinessSignals(
      domain({ source_of_truth: "local", inbound_status: "configured" }),
      { mode: "local" } as never,
    );
    expect(signals).toEqual({
      mode: "local",
      source_of_truth: "local",
      inbound_status: "configured",
    });
    expect("live_s3_sources" in signals).toBe(false);
  });

  it("reports zero S3 evidence for a postgres source of truth with no configuration", () => {
    // In the hermetic runner HOME is a fresh temp dir: no config file, no
    // registered sources or buckets. The answer must be ZERO — never the
    // inbound_status dressed up as evidence, never null.
    const signals = domainInboundReadinessSignals(
      domain({ source_of_truth: "postgres", inbound_status: "configured" }),
      { mode: "selfhosted" } as never,
    );
    expect(signals).toEqual({
      mode: "selfhosted",
      source_of_truth: "postgres",
      inbound_status: "configured",
      live_s3_sources: 0,
      inbound_buckets: 0,
    });
  });
});
