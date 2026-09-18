import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const account = "0".repeat(12);
const region = "us-east-1";
const provider = "synthetic-provider";
const secretId = ["arn", "aws", "secretsmanager", region, account, "secret", "synthetic/cli-fixture-aB12cD"].join(":");
const selectedReference = [secretId, "field", "", ""].join(":");
const historicalVersion = "v".repeat(32);
const fixtureValue = ["synthetic", "value", randomUUID()].join("-");
const causeMarker = ["synthetic", "cause", randomUUID()].join("-");
let testDir: string;
let preloadPath: string;
let configPath: string;
let credentialsPath: string;
let childPath: string;
let nextRun = 0;

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "secrets-cli-exact-reference-"));
  configPath = join(testDir, "aws-config");
  credentialsPath = join(testDir, "aws-credentials");
  preloadPath = join(testDir, "fake-provider.ts");
  childPath = join(testDir, "boolean-child.ts");
  writeFileSync(configPath, `[profile ${provider}]\naccount_id = ${account}\nregion = ${region}\n`, { mode: 0o600 });
  writeFileSync(credentialsPath, "", { mode: 0o600 });
  writeFileSync(childPath, [
    'const expectedArgs = JSON.parse(process.env.REFERENCE_EXPECTED_ARGS ?? "[]");',
    'console.log(process.env.COMPARE_FIXTURE === process.env.REFERENCE_EXPECTED_VALUE &&',
    '  JSON.stringify(process.argv.slice(2)) === JSON.stringify(expectedArgs));',
  ].join("\n"), { mode: 0o600 });
  writeFileSync(preloadPath, `
import { appendFileSync } from "node:fs";
import { setAwsReferenceClientFactoryForTests } from ${JSON.stringify(join(rootDir, "src/aws-reference-provider.ts"))};
import { setAwsClientFactoryForTests } from ${JSON.stringify(join(rootDir, "src/aws.ts"))};
const fixture = ${JSON.stringify({ account, region, provider, secretId, historicalVersion, fixtureValue, causeMarker })};
const audit = (event) => appendFileSync(process.env.REFERENCE_AUDIT_PATH, event + "\\n");
const demand = (condition) => { if (!condition) throw new Error("Synthetic request invariant failed"); };
globalThis.fetch = async () => { throw new Error("Unexpected test network request"); };
setAwsClientFactoryForTests(() => { throw new Error("Unexpected legacy AWS request"); });
setAwsReferenceClientFactoryForTests(({ profile, region }) => {
  audit("factory");
  demand(profile === fixture.provider && region === fixture.region);
  let identified = false;
  return {
    identity: { send: async (command) => {
      audit("identity");
      demand(command.constructor.name === "GetCallerIdentityCommand");
      identified = true;
      return { Account: fixture.account };
    } },
    secrets: { send: async (command) => {
      audit("read");
      demand(identified && command.constructor.name === "GetSecretValueCommand");
      demand(command.input.SecretId === fixture.secretId);
      const mode = process.env.REFERENCE_TEST_MODE;
      if (mode === "history") {
        demand(command.input.VersionId === fixture.historicalVersion);
        demand(!Object.prototype.hasOwnProperty.call(command.input, "VersionStage"));
      } else {
        demand(command.input.VersionStage === "AWSCURRENT");
        demand(!Object.prototype.hasOwnProperty.call(command.input, "VersionId"));
      }
      if (mode === "provider-error") {
        throw new Error("Synthetic provider error: " + fixture.fixtureValue, { cause: new Error(fixture.causeMarker) });
      }
      const value = mode === "malformed-json" ? '{"field":' + fixture.fixtureValue :
        mode === "nonstring" ? 42 : mode === "plain" ? fixture.fixtureValue :
        mode === "nonstring-field" ? JSON.stringify({ field: 42 }) :
        JSON.stringify({ field: fixture.fixtureValue, other: "unused-synthetic-field" });
      return { ARN: fixture.secretId, VersionId: fixture.historicalVersion,
        VersionStages: mode === "history" ? ["AWSPREVIOUS"] : ["AWSCURRENT"], SecretString: value };
    } },
    destroy: () => audit("destroy"),
  };
});
`, { mode: 0o600 });
});

afterAll(() => { if (testDir) rmSync(testDir, { recursive: true, force: true }); });

function selectors(reference = selectedReference): string[] {
  return ["--provider", provider, "--account", account, "--env", "COMPARE_FIXTURE", "--secret-ref", reference];
}

function child(...args: string[]): string[] {
  return [process.execPath, "--no-env-file", childPath, ...args];
}

async function runCli(args: string[], mode = "json", expectedArgs: string[] = []) {
  const auditPath = join(testDir, `audit-${++nextRun}`);
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(AWS_|HASNA_|SECRETS_|OPEN_SECRETS_|XDG_|PG|DATABASE_URL$|REFERENCE_|COMPARE_FIXTURE$)/.test(key)) delete env[key];
  }
  delete env.BUN_OPTIONS;
  delete env.NODE_OPTIONS;
  Object.assign(env, {
    HOME: testDir,
    HASNA_HOME: join(testDir, "hasna-home"),
    HASNA_CONFIG_HOME: join(testDir, "hasna-home", "config"),
    HASNA_STATION: `synthetic-exact-reference-${process.pid}`,
    HASNA_SECRETS_TEST_ISOLATION: "1",
    NODE_ENV: "test",
    AWS_CONFIG_FILE: configPath,
    AWS_SHARED_CREDENTIALS_FILE: credentialsPath,
    AWS_EC2_METADATA_DISABLED: "true",
    REFERENCE_TEST_MODE: mode,
    REFERENCE_AUDIT_PATH: auditPath,
    REFERENCE_EXPECTED_VALUE: fixtureValue,
    REFERENCE_EXPECTED_ARGS: JSON.stringify(expectedArgs),
    NO_COLOR: "1",
  });
  const proc = Bun.spawn({
    cmd: [process.execPath, "--no-env-file", "--preload", preloadPath, "src/index.ts", ...args],
    cwd: rootDir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 10000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    const calls = existsSync(auditPath) ? readFileSync(auditPath, "utf8").trim().split("\n") : [];
    return { stdout, stderr, exitCode, calls };
  } finally { clearTimeout(timer); }
}

function expectPrivateOutput(result: { stdout: string; stderr: string }): void {
  const output = result.stdout + result.stderr;
  expect(output).not.toContain(fixtureValue);
  expect(output).not.toContain(causeMarker);
  expect(output).not.toContain(secretId);
  expect(output).not.toContain("Synthetic provider error");
}

describe("CLI exact provider reference exec", () => {
  it("blocks credential resolution in a CLI child with only NODE_ENV=test", async () => {
    const auditPath = join(testDir, `bare-test-audit-${++nextRun}`);
    const preload = join(testDir, "bare-test-preload.ts");
    const source = join(rootDir, "src");
    writeFileSync(preload, `
import { mock } from "bun:test";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const source = ${JSON.stringify(source)};
const require = createRequire(source + "/aws-reference-provider.ts");
mock.module(require.resolve("@aws-sdk/credential-providers"), () => ({
  fromIni: () => async () => {
    writeFileSync(${JSON.stringify(auditPath)}, "credential-resolution-attempted");
    throw new Error("Synthetic refusal before any network");
  },
}));
mock.module(source + "/aws.ts", () => ({
  loadAwsProfiles: async () => ({ synthetic: {} }),
  resolveAwsAccountProfile: () => ({ profile: "synthetic", region: ${JSON.stringify(region)} }),
}));
globalThis.fetch = async () => { throw new Error("Forbidden synthetic network request"); };
`, { mode: 0o600 });
    const proc = Bun.spawn({
      cmd: [process.execPath, "--no-env-file", "--preload", preload,
        join(source, "index.ts"), "exec", ...selectors(), "--", ...child()],
      cwd: testDir,
      env: { PATH: process.env.PATH, HOME: testDir, NODE_ENV: "test",
        AWS_CONFIG_FILE: configPath, AWS_SHARED_CREDENTIALS_FILE: credentialsPath,
        AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 10000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ]);
      expect(code).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("Unable to read exact account-scoped secret reference.\n");
      expect(existsSync(auditPath)).toBe(false);
    } finally { clearTimeout(timer); }
  });

  it("injects only the selected JSON field and emits boolean-only child output", async () => {
    const result = await runCli(["exec", ...selectors(), "--", ...child()]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("true\n");
    expect(result.stderr).toBe("");
    expect(result.calls).toEqual(["factory", "identity", "read", "destroy"]);
    expectPrivateOutput(result);
  });

  it("supports a base ARN returning a plain SecretString", async () => {
    const result = await runCli(["exec", ...selectors(secretId), "--", ...child()], "plain");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("true\n");
    expect(result.stderr).toBe("");
    expectPrivateOutput(result);
  });

  it("requests a historical version without an AWSCURRENT selector", async () => {
    const reference = [secretId, "field", "", historicalVersion].join(":");
    const result = await runCli(["exec", ...selectors(reference), "--", ...child()], "history");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("true\n");
    expect(result.stderr).toBe("");
    expect(result.calls).toEqual(["factory", "identity", "read", "destroy"]);
    expectPrivateOutput(result);
  });

  it.each(["provider-error", "malformed-json", "nonstring", "nonstring-field"])(
    "sanitizes %s without starting the child", async (mode) => {
      const result = await runCli(["exec", ...selectors(), "--", ...child()], mode);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Unable to read exact account-scoped secret reference.\n");
      expect(result.calls).toEqual(["factory", "identity", "read", "destroy"]);
      expectPrivateOutput(result);
    },
  );

  it("refuses an invalid destination name without echoing its input or reading AWS", async () => {
    const invalidName = ["invalid", randomUUID()].join("-");
    const flags = selectors();
    flags[5] = invalidName;
    const result = await runCli(["exec", ...flags, "--", ...child()]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Invalid destination environment variable name.\n");
    expect(result.stderr).not.toContain(invalidName);
    expect(result.calls).toEqual([]);
    expectPrivateOutput(result);
  });

  const invalidSelectors = [
    { label: "missing provider", flags: selectors().slice(2) },
    { label: "missing account", flags: [...selectors().slice(0, 2), ...selectors().slice(4)] },
    { label: "missing destination", flags: [...selectors().slice(0, 4), ...selectors().slice(6)] },
    { label: "missing reference value", flags: selectors().slice(0, -1) },
    { label: "positional selector", flags: ["synthetic-vault-key", ...selectors()] },
    { label: "mixed as selector", flags: [...selectors(), "--as", "OTHER_FIXTURE"] },
    { label: "duplicate provider", flags: [...selectors(), "--provider", provider] },
    { label: "duplicate reference", flags: [...selectors(), "--secret-ref", selectedReference] },
    { label: "unknown selector", flags: [...selectors(), "--unexpected-selector", "synthetic"] },
    { label: "equals reference syntax", flags: [...selectors().slice(0, 6), `--secret-ref=${selectedReference}`] },
  ];
  it.each(invalidSelectors)("refuses $label before provider access", async ({ flags }) => {
    const result = await runCli(["exec", ...flags, "--", ...child()]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toStartWith("Usage: secrets exec ");
    expect(result.calls).toEqual([]);
    expectPrivateOutput(result);
  });

  it("requires a separator and child command before reading AWS", async () => {
    for (const args of [["exec", ...selectors()], ["exec", ...selectors(), "--"]]) {
      const result = await runCli(args);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Usage: secrets exec ");
      expect(result.calls).toEqual([]);
      expectPrivateOutput(result);
    }
  });

  it("preserves selector-looking child argv after the separator", async () => {
    const args = ["--help", "--provider", "child-provider", "--secret-ref=child-value", "--env", "child-env", "--", "spaced argument"];
    const result = await runCli(["exec", ...selectors(), "--", ...child(...args)], "json", args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("true\n");
    expect(result.stderr).toBe("");
    expectPrivateOutput(result);
  });

  it("propagates the child's nonzero exit code without exposing its environment", async () => {
    const result = await runCli(["exec", ...selectors(), "--", process.execPath, "--no-env-file", "-e", "process.exit(7)"]);
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expectPrivateOutput(result);
  });

  it("sanitizes a child spawn failure without echoing the attempted command", async () => {
    const missingCommand = join(testDir, `missing-${randomUUID()}`);
    const result = await runCli(["exec", ...selectors(), "--", missingCommand]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Unable to execute the child command.\n");
    expect(result.stderr).not.toContain(missingCommand);
    expectPrivateOutput(result);
  });
});
