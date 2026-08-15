import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSedoSearchResponse,
  parseSedoFault,
  buildSedoSearchParams,
} from "./sedo.js";

const FIXTURES = join(import.meta.dir, "__fixtures__");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("buildSedoSearchParams", () => {
  it("uses the documented Sedo param names (keyword, kwtype, resultsize)", () => {
    const params = buildSedoSearchParams("cloud", { limit: 25 });
    expect(params.keyword).toBe("cloud");
    // 'C' = Contains — the marketplace search mode
    expect(params.kwtype).toBe("C");
    expect(params.resultsize).toBe(25);
    // Must NOT use the old wrong names that caused E1201
    expect(params).not.toHaveProperty("searchword");
    expect(params).not.toHaveProperty("limit");
  });

  it("passes tld and price filters through", () => {
    const params = buildSedoSearchParams("ai", {
      tld: "com",
      minPrice: 100,
      maxPrice: 5000,
    });
    expect(params.tld).toBe("com");
    expect(params.price_min).toBe(100);
    expect(params.price_max).toBe(5000);
  });
});

describe("parseSedoSearchResponse", () => {
  it("parses a real SEDOSEARCH response into domain listings", () => {
    const result = parseSedoSearchResponse(
      fixture("sedo-domainsearch-cloud.xml"),
    );

    expect(result.total).toBe(3);
    expect(result.domains).toHaveLength(3);

    const [first, second, third] = result.domains;
    expect(first.domain).toBe("cloud.biz");
    expect(first.price).toBe(200000);
    expect(first.currency).toBe("EUR"); // currency code 0 = EUR
    expect(first.forSale).toBe(true);

    expect(second.domain).toBe("cloud.de");
    expect(third.domain).toBe("clouds.io");
    expect(third.price).toBe(60500);
    expect(third.currency).toBe("USD"); // currency code 1 = USD
  });

  it("throws a descriptive error for a SEDOFAULT response", () => {
    expect(() => parseSedoSearchResponse(fixture("sedo-fault-e1201.xml"))).toThrow(
      /E1201/,
    );
  });
});

describe("parseSedoFault", () => {
  it("extracts the fault code from a SEDOFAULT response", () => {
    const fault = parseSedoFault(fixture("sedo-fault-e1201.xml"));
    expect(fault).not.toBeNull();
    expect(fault?.code).toBe("E1201");
  });

  it("returns null for a non-fault response", () => {
    expect(parseSedoFault(fixture("sedo-domainsearch-cloud.xml"))).toBeNull();
  });
});
