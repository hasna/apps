// Deployed-server compatibility: server releases through 1.3.x serialize
// database `*_json` columns into responses as JSON-encoded STRINGS (`"[]"`
// rather than `[]`). The response validator refused that whole payload —
// `body.domains[0].nameservers_json must be an array` — which killed
// `domain list`, `domain usable`, usable-sender resolution, and the Domains
// section of `status` against a live 1.3.0 deployment.
//
// The tolerance under test: a `*_json` field arriving as a string is decoded
// ONCE and re-validated against the same declared schema. A decoded value the
// contract accepts is normalized in place; a string that does not parse, or
// parses to a rejected shape, keeps the exact original refusal. Fields not
// named `*_json` never get the second reading.

import { describe, expect, test } from "bun:test";
import {
  ApiWireResponseError,
  validateApiSdkSuccessResponse,
} from "./api-wire.js";

const METHOD = "GET";
const PATH = "/v1/domains";

function domainRow(nameservers: unknown): Record<string, unknown> {
  return {
    id: "domain-1",
    domain: "example.com",
    status: "pending",
    provider: null,
    verified: false,
    notes: null,
    provisioning_status: "none",
    purchase_provider: null,
    dns_provider: "cloudflare",
    send_provider: null,
    cf_zone_id: null,
    registrar: null,
    nameservers_json: nameservers,
    mail_from_domain: null,
    last_error: null,
    next_check_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function listBody(nameservers: unknown): { domains: Record<string, unknown>[] } {
  return { domains: [domainRow(nameservers)] };
}

const REFUSAL =
  "Api GET /v1/domains returned an invalid successful response: "
  + "body.domains[0].nameservers_json must be an array";

describe("serialized *_json response tolerance (server 1.3.x string form)", () => {
  test("accepts a string-encoded empty list and normalizes it in place", () => {
    const body = listBody("[]");
    validateApiSdkSuccessResponse(METHOD, PATH, 200, body);
    expect(body.domains[0]!["nameservers_json"]).toEqual([]);
  });

  test("accepts a string-encoded nameserver list and normalizes it in place", () => {
    const body = listBody('["ns1.example.test","ns2.example.test"]');
    validateApiSdkSuccessResponse(METHOD, PATH, 200, body);
    expect(body.domains[0]!["nameservers_json"]).toEqual([
      "ns1.example.test",
      "ns2.example.test",
    ]);
  });

  test("still accepts the decoded array form, untouched", () => {
    const body = listBody(["ns1.example.test"]);
    validateApiSdkSuccessResponse(METHOD, PATH, 200, body);
    expect(body.domains[0]!["nameservers_json"]).toEqual(["ns1.example.test"]);
  });

  test.each([
    ["a string that is not JSON", "not json"],
    ["a string of JSON with the wrong shape", '{"ns":"ns1.example.test"}'],
    ["a string of JSON holding the wrong item type", "[1,2]"],
    ["a double-encoded string", '"[]"'],
  ])("still refuses %s with the exact original error", (_label, value) => {
    expect(() => validateApiSdkSuccessResponse(METHOD, PATH, 200, listBody(value)))
      .toThrow(ApiWireResponseError);
    expect(() => validateApiSdkSuccessResponse(METHOD, PATH, 200, listBody(value)))
      .toThrow(REFUSAL);
  });

  test("still refuses a value that is neither an array nor a string", () => {
    expect(() => validateApiSdkSuccessResponse(METHOD, PATH, 200, listBody(42)))
      .toThrow(REFUSAL);
  });

  test("a refused string form leaves the body unmodified", () => {
    const body = listBody('{"ns":"ns1.example.test"}');
    expect(() => validateApiSdkSuccessResponse(METHOD, PATH, 200, body))
      .toThrow(ApiWireResponseError);
    expect(body.domains[0]!["nameservers_json"]).toBe('{"ns":"ns1.example.test"}');
  });

  test("the second reading is scoped to *_json fields only", () => {
    // `domains` is an array field too, but is not part of the serialized-column
    // class; a string here stays exactly as refused as before.
    expect(() => validateApiSdkSuccessResponse(METHOD, PATH, 200, { domains: "[]" }))
      .toThrow(
        "Api GET /v1/domains returned an invalid successful response: "
        + "body.domains must be an array",
      );
  });
});
