// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// The self-hosted client speaks a NATIVE dialect (`/api/v1/...`, `/v1/auth/me`,
// `/v1/api-keys`) while the public API is `/v1/...` with `/v1/me` and
// `/v1/keys`. These two canonicalizers are the ONLY bridge, shared by request
// routing and response validation. The failure modes a happy-path test
// misses are PREFIX-BOUNDARY cases: `/api/v12/...` and `/v1/api-keysx` must
// NOT match their near-twin patterns, and `/v1/auth/me` is rewritten only as
// an exact match — a trailing `/extra` must pass through untouched. A
// boundary bug here silently 404s or misroutes a whole route family.

import { describe, expect, it } from "bun:test";
import {
  canonicalizeApiV1Pathname,
  canonicalizeClientDialectPathname,
  canonicalizeSelfHostedPathname,
} from "./self-hosted-paths.js";

describe("canonicalizeApiV1Pathname", () => {
  it("strips the /api prefix from the /api/v1 alias", () => {
    expect(canonicalizeApiV1Pathname("/api/v1")).toBe("/v1");
    expect(canonicalizeApiV1Pathname("/api/v1/health")).toBe("/v1/health");
    expect(canonicalizeApiV1Pathname("/api/v1/")).toBe("/v1/");
    expect(canonicalizeApiV1Pathname("/api/v1/me")).toBe("/v1/me");
  });

  it("leaves non-alias paths untouched", () => {
    expect(canonicalizeApiV1Pathname("/v1/health")).toBe("/v1/health");
    expect(canonicalizeApiV1Pathname("/v1")).toBe("/v1");
    expect(canonicalizeApiV1Pathname("")).toBe("");
    expect(canonicalizeApiV1Pathname("/")).toBe("/");
  });

  it("rejects prefix-boundary near-misses — /api/v12 is not /api/v1", () => {
    expect(canonicalizeApiV1Pathname("/api/v12/health")).toBe("/api/v12/health");
    expect(canonicalizeApiV1Pathname("/api/v1x")).toBe("/api/v1x");
    expect(canonicalizeApiV1Pathname("/api/v1x/health")).toBe("/api/v1x/health");
    // Case-sensitive: /API/v1 is not the alias.
    expect(canonicalizeApiV1Pathname("/API/v1/health")).toBe("/API/v1/health");
  });
});

describe("canonicalizeClientDialectPathname", () => {
  it("maps the identity and api-keys dialect onto canonical routes", () => {
    expect(canonicalizeClientDialectPathname("/v1/auth/me")).toBe("/v1/me");
    expect(canonicalizeClientDialectPathname("/v1/api-keys")).toBe("/v1/keys");
    expect(canonicalizeClientDialectPathname("/v1/api-keys/abc123")).toBe("/v1/keys/abc123");
    expect(canonicalizeClientDialectPathname("/v1/api-keys/abc/def")).toBe("/v1/keys/abc/def");
    expect(canonicalizeClientDialectPathname("/v1/api-keys/")).toBe("/v1/keys/");
  });

  it("leaves non-dialect paths untouched", () => {
    expect(canonicalizeClientDialectPathname("/v1/me")).toBe("/v1/me");
    expect(canonicalizeClientDialectPathname("/v1/keys")).toBe("/v1/keys");
    expect(canonicalizeClientDialectPathname("/v1/inbox")).toBe("/v1/inbox");
  });

  it("rewrites /v1/auth/me only as an exact match", () => {
    expect(canonicalizeClientDialectPathname("/v1/auth/me/extra")).toBe("/v1/auth/me/extra");
    expect(canonicalizeClientDialectPathname("/v1/auth/mex")).toBe("/v1/auth/mex");
  });

  it("rejects prefix-boundary near-misses on the api-keys dialect", () => {
    expect(canonicalizeClientDialectPathname("/v1/api-keysx")).toBe("/v1/api-keysx");
    expect(canonicalizeClientDialectPathname("/v1/api-keysx/abc")).toBe("/v1/api-keysx/abc");
    expect(canonicalizeClientDialectPathname("/v1/api_keys/abc")).toBe("/v1/api_keys/abc");
  });
});

describe("canonicalizeSelfHostedPathname", () => {
  it("composes both canonicalizers in order — api alias first, then dialect", () => {
    expect(canonicalizeSelfHostedPathname("/api/v1/auth/me")).toBe("/v1/me");
    expect(canonicalizeSelfHostedPathname("/api/v1/api-keys/abc")).toBe("/v1/keys/abc");
    expect(canonicalizeSelfHostedPathname("/v1/auth/me")).toBe("/v1/me");
    expect(canonicalizeSelfHostedPathname("/v1/me")).toBe("/v1/me");
    expect(canonicalizeSelfHostedPathname("/api/v1/me")).toBe("/v1/me");
    expect(canonicalizeSelfHostedPathname("/v1/inbox")).toBe("/v1/inbox");
  });
});
