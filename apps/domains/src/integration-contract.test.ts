import { describe, it, expect } from "bun:test";
import * as domains from "./index.js";

describe("open-emails integration contract", () => {
  it("exports the buy/zone/NS/delegate/capability surface", () => {
    for (const name of [
      "r53CheckAvailability", "r53RegisterDomain", "r53GetRegistrationStatus", "r53UpdateNameservers",
      "cfCreateZone", "cfGetZone", "cfEnsureZone", "delegateDomainToCloudflare",
      "selectBuyRegistrar", "selectDnsProvider", "canBuy",
      "classifyRegistrationStatus", "pollRegistrationUntilDone",
    ]) {
      expect(typeof (domains as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
