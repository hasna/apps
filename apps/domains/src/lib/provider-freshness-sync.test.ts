import { afterEach, describe, expect, mock, test } from "bun:test";
import type { CreateDomainInput, Domain, UpdateDomainInput } from "../db/domains.js";
import { _setFetch as setGoDaddyFetch, syncToLocalDb as syncGoDaddy } from "./godaddy.js";

type AwsCommand = { input: Record<string, unknown> };

class FakeCommand implements AwsCommand {
  input: Record<string, unknown>;

  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

class CreateHostedZoneCommand extends FakeCommand {}
class ListHostedZonesCommand extends FakeCommand {}
class GetHostedZoneCommand extends FakeCommand {}
class DeleteHostedZoneCommand extends FakeCommand {}
class ChangeResourceRecordSetsCommand extends FakeCommand {}
class ListResourceRecordSetsCommand extends FakeCommand {}
class ListHostedZonesByNameCommand extends FakeCommand {}

class CheckDomainAvailabilityCommand extends FakeCommand {}
class DisableDomainTransferLockCommand extends FakeCommand {}
class GetDomainDetailCommand extends FakeCommand {}
class GetOperationDetailCommand extends FakeCommand {}
class ListDomainsCommand extends FakeCommand {}
class ListPricesCommand extends FakeCommand {}
class RegisterDomainCommand extends FakeCommand {}
class RetrieveDomainAuthCodeCommand extends FakeCommand {}
class TransferDomainCommand extends FakeCommand {}
class UpdateDomainNameserversCommand extends FakeCommand {}

const route53Send = mock(async (command: AwsCommand) => {
  if (command instanceof ListHostedZonesCommand) {
    return {
      HostedZones: [{
        Id: "/hostedzone/ZDNS",
        Name: "dns-only.example.",
        ResourceRecordSetCount: 2,
        Config: { PrivateZone: false },
      }],
      IsTruncated: false,
    };
  }
  if (command instanceof GetHostedZoneCommand) {
    return {
      HostedZone: { Id: "/hostedzone/ZDNS", Name: "dns-only.example." },
      DelegationSet: { NameServers: ["ns-1.example", "ns-2.example"] },
    };
  }
  throw new Error(`Unexpected Route 53 command: ${command.constructor.name}`);
});

const route53DomainsSend = mock(async (command: AwsCommand) => {
  if (command instanceof ListDomainsCommand) {
    return {
      Domains: [{
        DomainName: "registered.example",
        Expiry: new Date("2027-08-10T00:00:00.000Z"),
        AutoRenew: true,
        TransferLock: false,
      }],
    };
  }
  throw new Error(`Unexpected Route 53 Domains command: ${command.constructor.name}`);
});

mock.module("@aws-sdk/client-route-53", () => ({
  ChangeResourceRecordSetsCommand,
  CreateHostedZoneCommand,
  DeleteHostedZoneCommand,
  GetHostedZoneCommand,
  ListHostedZonesByNameCommand,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  Route53Client: class Route53Client {
    send = route53Send;
  },
}));

mock.module("@aws-sdk/client-route-53-domains", () => ({
  CheckDomainAvailabilityCommand,
  DisableDomainTransferLockCommand,
  GetDomainDetailCommand,
  GetOperationDetailCommand,
  ListDomainsCommand,
  ListPricesCommand,
  RegisterDomainCommand,
  RetrieveDomainAuthCodeCommand,
  Route53DomainsClient: class Route53DomainsClient {
    send = route53DomainsSend;
  },
  TransferDomainCommand,
  UpdateDomainNameserversCommand,
}));

const { createRoute53Provider } = await import("./route53.js");

function domain(name: string, metadata: Record<string, unknown> = {}): Domain {
  return {
    id: name,
    name,
    registrar: null,
    status: "active",
    registered_at: null,
    expires_at: null,
    auto_renew: true,
    is_premium: false,
    premium_price: null,
    standard_price: null,
    purchase_price: null,
    purchase_date: null,
    nameservers: [],
    whois: {},
    ssl_expires_at: null,
    ssl_issuer: null,
    notes: null,
    metadata,
    created_at: "",
    updated_at: "",
    expiry_synced_at: null,
  };
}

afterEach(() => {
  setGoDaddyFetch(null);
  delete process.env["GODADDY_API_KEY"];
  delete process.env["GODADDY_API_SECRET"];
  route53Send.mockClear();
  route53DomainsSend.mockClear();
});

describe("registrar sync freshness provenance", () => {
  test("GoDaddy stamps one registrar-read instant on both creates and updates", async () => {
    process.env["GODADDY_API_KEY"] = "fixture-key";
    process.env["GODADDY_API_SECRET"] = "fixture-secret";
    setGoDaddyFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/domains")) {
        return Response.json([
          { domain: "new.example", status: "ACTIVE", expires: "2027-08-10T00:00:00.000Z", renewAuto: true, nameServers: [] },
          { domain: "existing.example", status: "ACTIVE", expires: "2027-09-10T00:00:00.000Z", renewAuto: false, nameServers: [] },
        ]);
      }
      const name = url.endsWith("/new.example") ? "new.example" : "existing.example";
      return Response.json({
        domain: name,
        status: "ACTIVE",
        expires: name === "new.example" ? "2027-08-10T00:00:00.000Z" : "2027-09-10T00:00:00.000Z",
        renewAuto: name === "new.example",
        nameServers: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }) as typeof fetch);

    const created: CreateDomainInput[] = [];
    const updated: UpdateDomainInput[] = [];
    const existing = domain("existing.example");

    const result = await syncGoDaddy({
      getDomainByName: async (name) => name === existing.name ? existing : null,
      createDomain: async (input) => {
        created.push(input);
        return domain(input.name);
      },
      updateDomain: async (_id, input) => {
        updated.push(input);
        return { ...existing, ...input } as Domain;
      },
    });

    expect(result).toMatchObject({ synced: 2, created: 1, updated: 1, errors: [] });
    expect(created[0]?.expiry_synced_at).toEqual(expect.any(String));
    expect(updated[0]?.expiry_synced_at).toBe(created[0]?.expiry_synced_at);
  });

  test("Route 53 stamps registrar inventory but not DNS-only hosted-zone discovery", async () => {
    const created: CreateDomainInput[] = [];
    const provider = createRoute53Provider({ region: "us-east-1" });

    const result = await provider.syncToLocalDb({
      getDomainByName: async () => null,
      createDomain: async (input) => {
        created.push(input);
        return domain(input.name, input.metadata);
      },
      updateDomain: async () => null,
    });

    const registered = created.find((row) => row.name === "registered.example");
    const dnsOnly = created.find((row) => row.name === "dns-only.example");

    expect(result).toMatchObject({ synced: 2, created: 2, updated: 0, errors: [] });
    expect(registered?.expiry_synced_at).toEqual(expect.any(String));
    expect(dnsOnly?.expiry_synced_at).toBeUndefined();
  });
});
