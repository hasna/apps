import { beforeEach, describe, expect, mock, test } from "bun:test";

type AwsCommand = { input: Record<string, unknown> };

class FakeCommand implements AwsCommand {
  input: Record<string, unknown>;

  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

class ChangeResourceRecordSetsCommand extends FakeCommand {}
class CreateHostedZoneCommand extends FakeCommand {}
class DeleteHostedZoneCommand extends FakeCommand {}
class GetHostedZoneCommand extends FakeCommand {}
class ListHostedZonesByNameCommand extends FakeCommand {}
class ListHostedZonesCommand extends FakeCommand {}
class ListResourceRecordSetsCommand extends FakeCommand {}

const route53Commands: AwsCommand[] = [];
const route53Responses: Array<{
  command: string;
  response: Record<string, unknown> | Error;
}> = [];

function queueRoute53(command: string, response: Record<string, unknown> | Error) {
  route53Responses.push({ command, response });
}

function takeResponse(commandName: string) {
  const index = route53Responses.findIndex((item) => item.command === commandName);
  if (index === -1) throw new Error(`No fake AWS response queued for ${commandName}`);
  return route53Responses.splice(index, 1)[0].response;
}

const route53Send = mock(async (command: AwsCommand) => {
  route53Commands.push(command);
  const response = takeResponse(command.constructor.name);
  if (response instanceof Error) throw response;
  return response;
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

const {
  createRoute53Provider,
  createHostedZone,
  deleteRecord,
  deleteDefaultHostedZone,
  deleteHostedZone,
  findHostedZoneByNameservers,
  listHostedZonesByDomain,
  upsertRecord,
} = await import("./route53.js");

const config = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

beforeEach(() => {
  route53Commands.length = 0;
  route53Responses.length = 0;
  route53Send.mockClear();
});

describe("Route53 DNS and hosted-zone helpers", () => {
  test("declares changed-group writes because the adapter UPSERTs only supplied record sets", () => {
    expect(createRoute53Provider(config).dnsWriteScope).toBe("changed-groups");
  });

  test("creates hosted zones with caller reference and nameservers", async () => {
    queueRoute53("CreateHostedZoneCommand", {
      DelegationSet: { NameServers: ["ns-1.awsdns.test"] },
      HostedZone: { Id: "/hostedzone/ZNEW", Name: "example.com." },
    });

    await expect(
      createHostedZone("example.com", "Managed by test", config, {
        callerReference: "caller-ref-test",
      }),
    ).resolves.toMatchObject({
      id: "ZNEW",
      name_servers: ["ns-1.awsdns.test"],
    });
    expect(route53Commands[0]).toBeInstanceOf(CreateHostedZoneCommand);
    expect(route53Commands[0].input).toMatchObject({
      CallerReference: "caller-ref-test",
      HostedZoneConfig: { Comment: "Managed by test" },
      Name: "example.com",
    });
  });

  test("finds public hosted zones by delegated nameservers", async () => {
    queueRoute53("ListHostedZonesByNameCommand", {
      HostedZones: [
        { Config: { PrivateZone: true }, Id: "/hostedzone/ZPRIVATE", Name: "example.com." },
        { Config: { PrivateZone: false }, Id: "/hostedzone/ZPUBLIC", Name: "example.com." },
      ],
    });
    queueRoute53("GetHostedZoneCommand", {
      DelegationSet: { NameServers: ["NS-2.AWSDNS.TEST.", "ns-1.awsdns.test"] },
      HostedZone: { Id: "/hostedzone/ZPUBLIC", Name: "example.com." },
    });

    await expect(
      findHostedZoneByNameservers("example.com", [
        "ns-1.awsdns.test.",
        "ns-2.awsdns.test",
      ], config),
    ).resolves.toMatchObject({
      id: "ZPUBLIC",
      name_servers: ["NS-2.AWSDNS.TEST.", "ns-1.awsdns.test"],
    });
    expect(route53Commands[0]).toBeInstanceOf(ListHostedZonesByNameCommand);
    expect(route53Commands[1]).toBeInstanceOf(GetHostedZoneCommand);
  });

  test("returns UPSERT change IDs", async () => {
    queueRoute53("ChangeResourceRecordSetsCommand", {
      ChangeInfo: { Id: "/change/CHANGE123" },
    });

    await expect(
      upsertRecord("ZPUBLIC", {
        name: "www.example.com.",
        type: "A",
        ttl: 300,
        values: ["192.0.2.10"],
      }, config, { comment: "Managed by test" }),
    ).resolves.toEqual({ changeId: "CHANGE123" });
    expect(route53Commands[0].input).toMatchObject({
      ChangeBatch: {
        Comment: "Managed by test",
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: "www.example.com.",
              ResourceRecords: [{ Value: "192.0.2.10" }],
              TTL: 300,
              Type: "A",
            },
          },
        ],
      },
      HostedZoneId: "ZPUBLIC",
    });
  });

  test("returns DELETE change IDs", async () => {
    queueRoute53("ChangeResourceRecordSetsCommand", {
      ChangeInfo: { Id: "/change/DELETE123" },
    });

    await expect(
      deleteRecord("ZPUBLIC", {
        name: "old.example.com.",
        type: "TXT",
        ttl: 300,
        values: ["\"old\""],
      }, config, { comment: "Delete by test" }),
    ).resolves.toEqual({ changeId: "DELETE123" });
    expect(route53Commands[0].input).toMatchObject({
      ChangeBatch: {
        Comment: "Delete by test",
        Changes: [
          {
            Action: "DELETE",
            ResourceRecordSet: {
              Name: "old.example.com.",
              ResourceRecords: [{ Value: "\"old\"" }],
              TTL: 300,
              Type: "TXT",
            },
          },
        ],
      },
      HostedZoneId: "ZPUBLIC",
    });
  });

  test("lists only exact public hosted zones for durable registration provenance", async () => {
    queueRoute53("ListHostedZonesByNameCommand", {
      IsTruncated: false,
      HostedZones: [
        { Config: { PrivateZone: false }, Id: "/hostedzone/ZBEFORE", Name: "example.com.", ResourceRecordSetCount: 2 },
        { Config: { PrivateZone: true }, Id: "/hostedzone/ZPRIVATE", Name: "example.com.", ResourceRecordSetCount: 2 },
        { Config: { PrivateZone: false }, Id: "/hostedzone/ZOTHER", Name: "other.com.", ResourceRecordSetCount: 2 },
      ],
    });
    await expect(listHostedZonesByDomain("example.com", config)).resolves.toEqual([
      expect.objectContaining({ id: "ZBEFORE", name: "example.com.", private_zone: false }),
    ]);
  });

  test("deletes a proven default zone without deleting any record sets", async () => {
    queueRoute53("GetHostedZoneCommand", {
      DelegationSet: { NameServers: ["ns-1.awsdns.test", "ns-2.awsdns.test"] },
      HostedZone: { Id: "/hostedzone/ZAUTO", Name: "example.com.", Config: { PrivateZone: false } },
    });
    queueRoute53("ListResourceRecordSetsCommand", {
      IsTruncated: false,
      ResourceRecordSets: [
        {
          Name: "example.com.", Type: "NS", TTL: 172800,
          ResourceRecords: [{ Value: "ns-1.awsdns.test." }, { Value: "ns-2.awsdns.test" }],
        },
        {
          Name: "example.com.", Type: "SOA", TTL: 900,
          ResourceRecords: [{ Value: "ns-1.awsdns.test. hostmaster.awsdns.test. 1 7200 900 1209600 86400" }],
        },
      ],
    });
    queueRoute53("DeleteHostedZoneCommand", {});

    await expect(deleteDefaultHostedZone(
      "ZAUTO",
      "example.com",
      ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      config,
    )).resolves.toEqual({ deleted: true });
    expect(route53Commands.some((command) => command instanceof ChangeResourceRecordSetsCommand)).toBe(false);
    expect(route53Commands.at(-1)).toBeInstanceOf(DeleteHostedZoneCommand);
  });

  test("aborts safe cleanup when any non-default record exists", async () => {
    queueRoute53("GetHostedZoneCommand", {
      DelegationSet: { NameServers: ["ns-1.awsdns.test", "ns-2.awsdns.test"] },
      HostedZone: { Id: "/hostedzone/ZAUTO", Name: "example.com.", Config: { PrivateZone: false } },
    });
    queueRoute53("ListResourceRecordSetsCommand", {
      IsTruncated: false,
      ResourceRecordSets: [
        { Name: "example.com.", Type: "NS", ResourceRecords: [{ Value: "ns-1.awsdns.test" }, { Value: "ns-2.awsdns.test" }] },
        { Name: "example.com.", Type: "SOA", ResourceRecords: [{ Value: "soa" }] },
        { Name: "www.example.com.", Type: "A", TTL: 300, ResourceRecords: [{ Value: "192.0.2.10" }] },
      ],
    });

    await expect(deleteDefaultHostedZone(
      "ZAUTO",
      "example.com",
      ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      config,
    )).resolves.toEqual({
      deleted: false,
      reason: "hosted zone contains records other than the expected apex NS and SOA",
    });
    expect(route53Commands.some((command) => command instanceof ChangeResourceRecordSetsCommand)).toBe(false);
    expect(route53Commands.some((command) => command instanceof DeleteHostedZoneCommand)).toBe(false);
  });

  test("treats Route 53 HostedZoneNotEmpty as a safe TOCTOU abort", async () => {
    queueRoute53("GetHostedZoneCommand", {
      DelegationSet: { NameServers: ["ns-1.awsdns.test", "ns-2.awsdns.test"] },
      HostedZone: { Id: "/hostedzone/ZAUTO", Name: "example.com.", Config: { PrivateZone: false } },
    });
    queueRoute53("ListResourceRecordSetsCommand", {
      IsTruncated: false,
      ResourceRecordSets: [
        { Name: "example.com.", Type: "NS", ResourceRecords: [{ Value: "ns-1.awsdns.test" }, { Value: "ns-2.awsdns.test" }] },
        { Name: "example.com.", Type: "SOA", ResourceRecords: [{ Value: "soa" }] },
      ],
    });
    const changed = new Error("The specified hosted zone contains non-required resource record sets");
    changed.name = "HostedZoneNotEmpty";
    queueRoute53("DeleteHostedZoneCommand", changed);

    await expect(deleteDefaultHostedZone(
      "ZAUTO",
      "example.com",
      ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      config,
    )).resolves.toEqual({
      deleted: false,
      reason: "hosted zone changed after inspection and Route 53 refused deletion",
    });
    expect(route53Commands.some((command) => command instanceof ChangeResourceRecordSetsCommand)).toBe(false);
  });

  test("aborts cleanup while the registrar still delegates to the Route 53 zone", async () => {
    queueRoute53("GetHostedZoneCommand", {
      DelegationSet: { NameServers: ["ns-1.awsdns.test", "ns-2.awsdns.test"] },
      HostedZone: { Id: "/hostedzone/ZAUTO", Name: "example.com.", Config: { PrivateZone: false } },
    });
    await expect(deleteDefaultHostedZone(
      "ZAUTO",
      "example.com",
      ["NS-2.AWSDNS.TEST.", "ns-1.awsdns.test"],
      config,
    )).resolves.toEqual({
      deleted: false,
      reason: "registrar delegation still points at the Route 53 hosted zone",
    });
    expect(route53Commands).toHaveLength(1);
  });

  test("deletes hosted zones only after deleting paginated non-NS/SOA records", async () => {
    queueRoute53("ListResourceRecordSetsCommand", {
      IsTruncated: true,
      NextRecordName: "next.example.com.",
      NextRecordType: "TXT",
      ResourceRecordSets: [
        { Name: "example.com.", Type: "NS" },
        {
          Name: "www.example.com.",
          ResourceRecords: [{ Value: "192.0.2.10" }],
          TTL: 300,
          Type: "A",
        },
      ],
    });
    queueRoute53("ListResourceRecordSetsCommand", {
      IsTruncated: false,
      ResourceRecordSets: [
        {
          Name: "verify.example.com.",
          ResourceRecords: [{ Value: "\"token\"" }],
          TTL: 300,
          Type: "TXT",
        },
        { Name: "example.com.", Type: "SOA" },
      ],
    });
    queueRoute53("ChangeResourceRecordSetsCommand", {
      ChangeInfo: { Id: "/change/delete" },
    });
    queueRoute53("DeleteHostedZoneCommand", {});

    await deleteHostedZone("/hostedzone/ZPUBLIC", config);

    expect(route53Commands[0].input).toMatchObject({ HostedZoneId: "ZPUBLIC" });
    expect(route53Commands[1].input).toMatchObject({
      HostedZoneId: "ZPUBLIC",
      StartRecordName: "next.example.com.",
      StartRecordType: "TXT",
    });
    expect(route53Commands[2].input).toMatchObject({
      ChangeBatch: {
        Changes: [
          {
            Action: "DELETE",
            ResourceRecordSet: expect.objectContaining({ Name: "www.example.com.", Type: "A" }),
          },
          {
            Action: "DELETE",
            ResourceRecordSet: expect.objectContaining({
              Name: "verify.example.com.",
              Type: "TXT",
            }),
          },
        ],
      },
      HostedZoneId: "ZPUBLIC",
    });
    expect(route53Commands[3]).toBeInstanceOf(DeleteHostedZoneCommand);
    expect(route53Commands[3].input).toEqual({ Id: "ZPUBLIC" });
  });
});
