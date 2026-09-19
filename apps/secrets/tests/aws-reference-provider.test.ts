import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAwsSecretValueForReference, setAwsReferenceClientFactoryForTests } from "../src/aws-reference-provider.js";

const account = "0".repeat(12);
const region = "us-east-1";
const reference = ["arn", "aws", "secretsmanager", region, account, "secret", "synthetic/value-aB12cD"].join(":");
const version = "a".repeat(32);
const fixture = "synthetic-" + Array.from({ length: 5 }, (_, index) => `part${index}`).join("-");
let saved: NodeJS.ProcessEnv;
let directory: string;
let config: string;
let identityCalls: unknown[];
let secretCalls: unknown[];
let selections: unknown[];
let destroys: number;

function profileText(extra = ""): string {
  return `[profile synthetic-provider]\nregion = ${region}\n\n[profile synthetic-target]\nsource_profile = synthetic-provider\naccount_id = ${account}\nregion = ${region}\n${extra}`;
}

function fake(options: { account?: string; response?: Record<string, unknown>; identityError?: Error; secretError?: Error; destroyError?: Error } = {}) {
  setAwsReferenceClientFactoryForTests((selection) => {
    selections.push(selection);
    return {
      identity: { send: async (command: any) => {
        identityCalls.push(command);
        if (options.identityError) throw options.identityError;
        return { Account: options.account ?? account };
      } } as any,
      secrets: { send: async (command: any) => {
        secretCalls.push(command);
        if (options.secretError) throw options.secretError;
        return options.response ?? { ARN: reference, VersionId: version, VersionStages: ["AWSCURRENT"], SecretString: fixture };
      } } as any,
      destroy: () => { destroys++; if (options.destroyError) throw options.destroyError; },
    };
  });
}

async function refused(ref = reference): Promise<void> {
  let caught: unknown;
  try { await getAwsSecretValueForReference("synthetic-provider", account, ref); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toMatch(/^AWS_SECRET_REFERENCE_(INVALID|VALUE_INVALID|READ_FAILED)$/);
  expect((caught as Error).message).not.toContain(fixture);
  expect(Object.hasOwn(caught as object, "cause")).toBe(false);
}

beforeEach(() => {
  saved = { ...process.env };
  directory = mkdtempSync(join(tmpdir(), "secrets-exact-reference-"));
  config = join(directory, "config");
  writeFileSync(config, profileText(), { mode: 0o600 });
  writeFileSync(join(directory, "credentials"), "", { mode: 0o600 });
  process.env.AWS_CONFIG_FILE = config;
  process.env.AWS_SHARED_CREDENTIALS_FILE = join(directory, "credentials");
  process.env.HASNA_SECRETS_TEST_ISOLATION = "1";
  identityCalls = []; secretCalls = []; selections = []; destroys = 0;
  setAwsReferenceClientFactoryForTests();
});

afterEach(() => {
  setAwsReferenceClientFactoryForTests();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  rmSync(directory, { recursive: true, force: true });
});

describe("exact-reference provider reads", () => {
  it("asserts the profile account, then performs exactly one current-version read", async () => {
    fake();
    expect(await getAwsSecretValueForReference("synthetic-provider", account, reference)).toBe(fixture);
    expect(selections).toEqual([{ profile: "synthetic-target", region }]);
    expect(identityCalls.map((x: any) => x.constructor.name)).toEqual(["GetCallerIdentityCommand"]);
    expect(secretCalls.map((x: any) => x.constructor.name)).toEqual(["GetSecretValueCommand"]);
    expect((secretCalls[0] as any).input).toEqual({ SecretId: reference, VersionStage: "AWSCURRENT" });
    expect(destroys).toBe(1);
  });

  it("selects a JSON field without passing that suffix to AWS", async () => {
    fake({ response: { ARN: reference, VersionStages: ["AWSCURRENT"], SecretString: JSON.stringify({ selected: fixture, ignored: "other" }) } });
    expect(await getAwsSecretValueForReference("synthetic-provider", account, `${reference}:selected::`)).toBe(fixture);
    expect((secretCalls[0] as any).input).toEqual({ SecretId: reference, VersionStage: "AWSCURRENT" });
  });

  it("preserves an exact historical ID without adding AWSCURRENT", async () => {
    fake({ response: { ARN: reference, VersionId: version, VersionStages: ["AWSPREVIOUS"], SecretString: fixture } });
    expect(await getAwsSecretValueForReference("synthetic-provider", account, `${reference}:::${version}`)).toBe(fixture);
    expect((secretCalls[0] as any).input).toEqual({ SecretId: reference, VersionId: version });
  });

  it("preserves an explicit staging label", async () => {
    fake({ response: { ARN: reference, VersionId: version, VersionStages: ["AWSPREVIOUS"], SecretString: fixture } });
    expect(await getAwsSecretValueForReference("synthetic-provider", account, `${reference}::AWSPREVIOUS:`)).toBe(fixture);
    expect((secretCalls[0] as any).input).toEqual({ SecretId: reference, VersionStage: "AWSPREVIOUS" });
  });

  it("refuses a wrong actual caller before any secret read", async () => {
    fake({ account: "1".repeat(12) });
    await refused();
    expect(identityCalls).toHaveLength(1);
    expect(secretCalls).toHaveLength(0);
    expect(destroys).toBe(1);
  });

  it("refuses ARN-account and profile-region mismatches before creating clients", async () => {
    fake();
    await refused(reference.replace(account, "1".repeat(12)));
    writeFileSync(config, profileText().replaceAll(region, "eu-west-1"));
    await refused();
    expect(selections).toHaveLength(0);
    expect(identityCalls).toHaveLength(0);
    expect(secretCalls).toHaveLength(0);
  });

  it("refuses missing or ambiguous configured profiles without fallback", async () => {
    fake();
    writeFileSync(config, "");
    await refused();
    writeFileSync(config, profileText(`\n[profile second-target]\nsource_profile = synthetic-provider\naccount_id = ${account}\nregion = ${region}\n`));
    await refused();
    expect(selections).toHaveLength(0);
  });

  it("uses the exact ARN region when the selected profile does not set one", async () => {
    writeFileSync(config, profileText().replaceAll(`region = ${region}\n`, ""));
    fake();
    expect(await getAwsSecretValueForReference("synthetic-provider", account, reference)).toBe(fixture);
    expect(selections).toEqual([{ profile: "synthetic-target", region }]);
  });

  it.each([
    { ARN: reference + "other", VersionStages: ["AWSCURRENT"], SecretString: fixture },
    { ARN: reference, VersionStages: ["AWSPREVIOUS"], SecretString: fixture },
    { ARN: reference, SecretString: fixture },
    { ARN: reference, VersionStages: ["AWSCURRENT"], SecretBinary: new Uint8Array([1]), SecretString: fixture },
    { ARN: reference, VersionStages: ["AWSCURRENT"], SecretString: 7 },
  ])("refuses response identity/type drift %#", async (response) => {
    fake({ response });
    await refused();
    expect(secretCalls).toHaveLength(1);
    expect(destroys).toBe(1);
  });

  it("refuses a different historical version returned by AWS", async () => {
    fake({ response: { ARN: reference, VersionId: "b".repeat(32), SecretString: fixture } });
    await refused(`${reference}:::${version}`);
    expect(secretCalls).toHaveLength(1);
  });

  it.each(["identity", "secret", "destroy"])("sanitizes %s errors and drops their causes", async (phase) => {
    fake({ [phase + "Error"]: new Error(fixture, { cause: fixture }) });
    await refused();
    expect(secretCalls.length).toBe(phase === "identity" ? 0 : 1);
  });

  it("does not expose malformed JSON snippets or run an alias/list fallback", async () => {
    fake({ response: { ARN: reference, VersionStages: ["AWSCURRENT"], SecretString: `{${fixture}` } });
    await refused(`${reference}:selected::`);
    expect(secretCalls).toHaveLength(1);
  });

  it("the reset test factory refuses instead of reaching AWS", async () => {
    await refused();
    expect(identityCalls).toHaveLength(0);
    expect(secretCalls).toHaveLength(0);
  });

  it("aborts a stalled identity read and never starts the value request", async () => {
    const original = globalThis.setTimeout;
    const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) => original(callback, 5)) as typeof setTimeout);
    let signal: AbortSignal | undefined;
    setAwsReferenceClientFactoryForTests(() => ({
      identity: { send: (_: unknown, options: { abortSignal: AbortSignal }) => {
        signal = options.abortSignal;
        return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error(fixture)), { once: true }));
      } } as any,
      secrets: { send: () => { throw new Error("unexpected value request"); } } as any,
    }));
    try { await refused(); expect(signal?.aborted).toBe(true); } finally { timer.mockRestore(); }
  });
});
