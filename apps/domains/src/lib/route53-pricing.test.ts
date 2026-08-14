import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

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
  checkAvailability,
  getConfig,
  getTldPrice,
  listTldPrices,
} = await import("./route53.js");

const savedEnv = {
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_PROFILE: process.env.AWS_PROFILE,
  AWS_REGION: process.env.AWS_REGION,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
  ROUTE53_ACCESS_KEY_ID: process.env.ROUTE53_ACCESS_KEY_ID,
  ROUTE53_AWS_PROFILE: process.env.ROUTE53_AWS_PROFILE,
  ROUTE53_AWS_REGION: process.env.ROUTE53_AWS_REGION,
  ROUTE53_REGION: process.env.ROUTE53_REGION,
  ROUTE53_SECRET_ACCESS_KEY: process.env.ROUTE53_SECRET_ACCESS_KEY,
  ROUTE53_SESSION_TOKEN: process.env.ROUTE53_SESSION_TOKEN,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  domainCommands.length = 0;
  domainResponses.length = 0;
  domainSend.mockClear();
  restoreEnv();
});

afterAll(() => {
  restoreEnv();
});

describe("Route53 availability and pricing", () => {
  test("reads Route53-specific AWS aliases before generic AWS env", () => {
    process.env.AWS_ACCESS_KEY_ID = "generic-access";
    process.env.AWS_SECRET_ACCESS_KEY = "generic-secret";
    process.env.AWS_REGION = "eu-west-1";
    process.env.AWS_PROFILE = "generic-profile";
    process.env.ROUTE53_ACCESS_KEY_ID = "route53-access";
    process.env.ROUTE53_SECRET_ACCESS_KEY = "route53-secret";
    process.env.ROUTE53_SESSION_TOKEN = "route53-session";
    process.env.ROUTE53_REGION = "us-west-2";
    process.env.ROUTE53_AWS_PROFILE = "route53-profile";

    expect(getConfig()).toEqual({
      accessKeyId: "route53-access",
      profile: "route53-profile",
      region: "us-west-2",
      secretAccessKey: "route53-secret",
      sessionToken: "route53-session",
    });
  });

  test("returns raw availability status with registration and renewal pricing", async () => {
    queueDomain("CheckDomainAvailabilityCommand", { Availability: "AVAILABLE" });
    queueDomain("ListPricesCommand", {
      Prices: [
        {
          Name: "com",
          RegistrationPrice: { Currency: "USD", Price: 12.34 },
          RenewalPrice: { Price: 13.1 },
          TransferPrice: { Price: 9.99 },
        },
      ],
    });

    await expect(checkAvailability("example.com")).resolves.toEqual({
      availability: "AVAILABLE",
      available: true,
      currency: "USD",
      domain: "example.com",
      price: "12.34",
      renewal_price: "13.1",
      transfer_price: "9.99",
    });
    expect(domainCommands[0]).toBeInstanceOf(CheckDomainAvailabilityCommand);
    expect(domainCommands[0].input).toEqual({ DomainName: "example.com" });
    expect(domainCommands[1]).toBeInstanceOf(ListPricesCommand);
    expect(domainCommands[1].input).toEqual({ MaxItems: 1, Tld: "com" });
  });

  test("does not request pricing for unavailable domains", async () => {
    queueDomain("CheckDomainAvailabilityCommand", { Availability: "UNAVAILABLE" });

    await expect(checkAvailability("taken.com")).resolves.toEqual({
      availability: "UNAVAILABLE",
      available: false,
      domain: "taken.com",
    });
    expect(domainCommands).toHaveLength(1);
    expect(domainCommands[0]).toBeInstanceOf(CheckDomainAvailabilityCommand);
  });

  test("normalizes single-TLD pricing and paginates the public price list", async () => {
    queueDomain("ListPricesCommand", {
      Prices: [
        {
          Name: "ai",
          RegistrationPrice: { Currency: "USD", Price: 70 },
          RenewalPrice: { Price: 70 },
          TransferPrice: { Price: 68.5 },
        },
      ],
    });

    await expect(getTldPrice(".ai")).resolves.toEqual({
      currency: "USD",
      registration_price: "70",
      renewal_price: "70",
      tld: "ai",
      transfer_price: "68.5",
    });
    expect(domainCommands.at(-1)?.input).toEqual({ MaxItems: 1, Tld: "ai" });

    queueDomain("ListPricesCommand", {
      NextPageMarker: "page-2",
      Prices: [
        {
          Name: "com",
          RegistrationPrice: { Currency: "USD", Price: 12 },
          RenewalPrice: { Price: 13 },
          TransferPrice: { Price: 10 },
        },
      ],
    });
    queueDomain("ListPricesCommand", {
      Prices: [
        {
          Name: "net",
          RegistrationPrice: { Currency: "USD", Price: 14 },
          RenewalPrice: { Price: 15 },
          TransferPrice: { Price: 11 },
        },
      ],
    });

    const prices = await listTldPrices();
    expect(prices.map((price) => price.tld)).toEqual(["com", "net"]);
    expect(domainCommands.at(-2)?.input).toEqual({ Marker: undefined, MaxItems: 100 });
    expect(domainCommands.at(-1)?.input).toEqual({ Marker: "page-2", MaxItems: 100 });
  });
});
