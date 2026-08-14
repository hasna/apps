import { beforeEach, describe, expect, mock, test } from "bun:test";

type AwsCommand = { input: Record<string, unknown> };

class FakeCommand implements AwsCommand {
  input: Record<string, unknown>;

  constructor(input: Record<string, unknown>) {
    this.input = input;
  }
}

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

const domainCommands: AwsCommand[] = [];
const domainResponses: Array<{
  command: string;
  response: Record<string, unknown>;
}> = [];

function queueDomain(command: string, response: Record<string, unknown>) {
  domainResponses.push({ command, response });
}

function takeResponse(commandName: string) {
  const index = domainResponses.findIndex((item) => item.command === commandName);
  if (index === -1) throw new Error(`No fake AWS response queued for ${commandName}`);
  return domainResponses.splice(index, 1)[0].response;
}

const domainSend = mock(async (command: AwsCommand) => {
  domainCommands.push(command);
  return takeResponse(command.constructor.name);
});

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
    send = domainSend;
  },
  TransferDomainCommand,
  UpdateDomainNameserversCommand,
}));

const {
  getDomainDetail,
  getRegistrationStatus,
  registerDomain,
  requestTransferOutAuthCode,
  transferDomain,
} = await import("./route53.js");

const contact = {
  address_line_1: "1 Launch St",
  address_line_2: "Suite 2",
  city: "Bucharest",
  country_code: "ro",
  email: "ops@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
  organization_name: "Alumia",
  phone: "+40754013776",
  state: "B",
  zip_code: "010101",
};

beforeEach(() => {
  domainCommands.length = 0;
  domainResponses.length = 0;
  domainSend.mockClear();
});

describe("Route53 registrar lifecycle helpers", () => {
  test("registers domains with contact, nameservers, and privacy options", async () => {
    queueDomain("RegisterDomainCommand", { OperationId: "operation-123" });

    await expect(
      registerDomain("example.com", contact, 2, false, undefined, {
        nameservers: ["ns-1.awsdns.test", "ns-2.awsdns.test"],
        privacy_protected: false,
      }),
    ).resolves.toEqual({ operationId: "operation-123" });

    expect(domainCommands[0]).toBeInstanceOf(RegisterDomainCommand);
    expect(domainCommands[0].input).toMatchObject({
      AutoRenew: false,
      DomainName: "example.com",
      DurationInYears: 2,
      Nameservers: [{ Name: "ns-1.awsdns.test" }, { Name: "ns-2.awsdns.test" }],
      PrivacyProtectAdminContact: false,
      PrivacyProtectRegistrantContact: false,
      PrivacyProtectTechContact: false,
    });
    expect(domainCommands[0].input.AdminContact).toMatchObject({
      AddressLine1: "1 Launch St",
      AddressLine2: "Suite 2",
      ContactType: "COMPANY",
      CountryCode: "RO",
      OrganizationName: "Alumia",
      State: "B",
    });
  });

  test("transfers domains in with auth code, nameservers, and privacy options", async () => {
    queueDomain("TransferDomainCommand", { OperationId: "transfer-123" });

    await expect(
      transferDomain("example.com", "AUTH-IN-123", contact, 1, true, undefined, {
        nameservers: ["ns-1.awsdns.test"],
        privacy_protected: true,
      }),
    ).resolves.toEqual({ operationId: "transfer-123" });

    expect(domainCommands[0]).toBeInstanceOf(TransferDomainCommand);
    expect(domainCommands[0].input).toMatchObject({
      AuthCode: "AUTH-IN-123",
      AutoRenew: true,
      DomainName: "example.com",
      Nameservers: [{ Name: "ns-1.awsdns.test" }],
      PrivacyProtectRegistrantContact: true,
    });
  });

  test("merges domain detail with paginated summary data and privacy flags", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const updatedAt = new Date("2026-02-01T00:00:00.000Z");
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    queueDomain("GetDomainDetailCommand", {
      AdminPrivacy: false,
      CreationDate: createdAt,
      DomainName: "example.com",
      Nameservers: [{ Name: "ns-1.awsdns.test" }, { Name: undefined }],
      RegistrarName: "Amazon Registrar",
      StatusList: ["ok"],
      UpdatedDate: updatedAt,
    });
    queueDomain("ListDomainsCommand", {
      Domains: [{ DomainName: "other.com" }],
      NextPageMarker: "next",
    });
    queueDomain("ListDomainsCommand", {
      Domains: [
        {
          AutoRenew: true,
          DomainName: "example.com",
          Expiry: expiresAt,
          TransferLock: true,
        },
      ],
    });

    await expect(getDomainDetail("example.com")).resolves.toEqual({
      auto_renew: true,
      created: createdAt.toISOString(),
      domain: "example.com",
      expiry: expiresAt.toISOString(),
      nameservers: ["ns-1.awsdns.test"],
      privacy_protected: false,
      registrar_name: "Amazon Registrar",
      status_list: ["ok"],
      transfer_lock: true,
      updated: updatedAt.toISOString(),
    });
  });

  test("preserves unknown auto-renew and transfer-lock values as null", async () => {
    queueDomain("GetDomainDetailCommand", {
      DomainName: "example.com",
      Nameservers: [],
    });
    queueDomain("ListDomainsCommand", {
      Domains: [{ DomainName: "other.com" }],
    });

    await expect(getDomainDetail("example.com")).resolves.toMatchObject({
      auto_renew: null,
      domain: "example.com",
      transfer_lock: null,
    });
  });

  test("polls Route53 operation status", async () => {
    queueDomain("GetOperationDetailCommand", {
      DomainName: "example.com",
      Message: "done",
      Status: "SUCCESSFUL",
    });

    await expect(getRegistrationStatus("operation-123")).resolves.toEqual({
      domain: "example.com",
      message: "done",
      status: "SUCCESSFUL",
    });
  });

  test("disables transfer lock before retrieving transfer-out auth code", async () => {
    queueDomain("GetDomainDetailCommand", {
      DomainName: "example.com",
      Nameservers: [],
    });
    queueDomain("ListDomainsCommand", {
      Domains: [{ DomainName: "example.com", TransferLock: true }],
    });
    queueDomain("DisableDomainTransferLockCommand", {
      OperationId: "unlock-operation",
    });
    queueDomain("RetrieveDomainAuthCodeCommand", {
      AuthCode: "AUTH-CODE-123",
    });

    await expect(requestTransferOutAuthCode("example.com")).resolves.toEqual({
      auth_code: "AUTH-CODE-123",
      transfer_lock_disabled: true,
      transfer_lock_operation_id: "unlock-operation",
    });
    expect(domainCommands.map((command) => command.constructor.name)).toEqual([
      "GetDomainDetailCommand",
      "ListDomainsCommand",
      "DisableDomainTransferLockCommand",
      "RetrieveDomainAuthCodeCommand",
    ]);
  });
});
