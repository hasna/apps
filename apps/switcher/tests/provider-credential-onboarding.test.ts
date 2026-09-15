import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CommandInterrupted, Fault, type ProviderInput } from "../src/domain";
import * as credentialModule from "../src/credentials";
import { providerFromPreset } from "../src/presets";
import { resolveLaunchProvider } from "../src/direct-launch";
import { SwitcherError, type SwitcherClient } from "../src/sdk";

/**
 * Proposed production seam: credential onboarding belongs ahead of catalog/model
 * selection for both direct and saved-profile launches. The implementation should
 * export ensureProviderCredential from credentials.ts and accept the narrow
 * collaborators below so discovery/prompt/auth can be tested without exposing a
 * credential value or invoking a real vault.
 */
type VaultReference = {
  account: string;
  key: string;
  url?: string;
  executable: string;
  operator: { kind: "contracts" } | { kind: "env" } | { kind: "keychain"; account: string };
};
type CredentialBindingRecord = {
  schema: 1;
  credentialEnv: string;
  origins: string[];
  source: { kind: "vault"; key: string; url?: string; executable: string; operator: VaultReference["operator"] };
};
type ResolverSeam = {
  bindings: {
    get(name: string): Promise<CredentialBindingRecord | undefined>;
    bind(binding: CredentialBindingRecord): Promise<CredentialBindingRecord>;
  };
  resolve(provider: ProviderInput): Promise<string | undefined>;
};
type EnsureOptions = {
  interactive: boolean;
  resolver: ResolverSeam;
  discoverVaultReferences(request: { provider: ProviderInput; credentialEnv: string }): Promise<VaultReference[]>;
  selectVaultReference?(request: { provider: ProviderInput; matches: VaultReference[] }): Promise<VaultReference | undefined>;
  verifyProviderAuthentication(request: { provider: ProviderInput; credential: string }): Promise<{ authenticated: boolean; status?: number }>;
};
type EnsureProviderCredential = (provider: ProviderInput, options: EnsureOptions) => Promise<{
  source: "environment" | "binding";
  configured: boolean;
  providerFingerprint: string;
  resolveCredential(provider:ProviderInput):Promise<string|undefined>;
}>;

function expectedApi(): EnsureProviderCredential {
  const candidate = (credentialModule as Record<string, unknown>).ensureProviderCredential;
  expect(candidate, "credentials.ts must export the shared pre-picker onboarding seam ensureProviderCredential").toBeFunction();
  return candidate as EnsureProviderCredential;
}

const provider = () => providerFromPreset("openrouter", { harness: "codex" });
const references = [
  { account: "account-a", key: "provider/openrouter/account-a", executable: "/trusted/secrets", operator: { kind: "contracts" as const } },
  { account: "account-b", key: "provider/openrouter/account-b", executable: "/trusted/secrets", operator: { kind: "contracts" as const } },
];

function fixture(options: { environmentCredential?: string; existing?: CredentialBindingRecord; resolved?: string } = {}) {
  let binding = options.existing;
  const events: string[] = [];
  const resolver: ResolverSeam = {
    bindings: {
      async get(name) { events.push(`binding:get:${name}`); return binding; },
      async bind(next) { events.push(`binding:bind:${next.source.key}`); binding = next; return next; },
    },
    async resolve(input) {
      events.push(`resolve:${input.credentialEnv}`);
      if (binding && !binding.origins.includes(new URL(input.baseUrl).origin))
        throw new Fault(422, "credential_authority", "The selected binding does not authorize this provider origin; no alternate account was selected.");
      return options.environmentCredential ?? (binding ? options.resolved ?? "fixture-current-vault-value" : undefined);
    },
  };
  return { resolver, events, binding: () => binding };
}

const successfulAuth: EnsureOptions["verifyProviderAuthentication"] = async ({ credential }) => ({ authenticated: credential === "fixture-current-vault-value" || credential === "fixture-explicit-environment" });

for (const launchKind of ["direct", "saved-profile"] as const) {
  test(`${launchKind} launch requires a usable credential before catalog refresh or the model picker`, async () => {
    const ensure = expectedApi();
    const { resolver, events } = fixture();
    const launchEvents: string[] = [];
    await expect(ensure(provider(), {
      interactive: false,
      resolver,
      discoverVaultReferences: async () => { launchEvents.push("discover"); return []; },
      verifyProviderAuthentication: async () => { launchEvents.push("authenticate"); return { authenticated: true }; },
    })).rejects.toMatchObject({ code: "credential_setup_required" });
    launchEvents.push("catalog");
    launchEvents.push("picker");
    expect([...events, ...launchEvents]).not.toContain("authenticate");
    expect(launchEvents).toEqual(["catalog", "picker"]);
  });
}

test("first-run setup binds the chosen metadata reference, authenticates it, and later launches reuse the binding", async () => {
  const ensure = expectedApi();
  const { resolver, events, binding } = fixture();
  let discoveries = 0, selections = 0, authentications = 0;
  const options: EnsureOptions = {
    interactive: true,
    resolver,
    discoverVaultReferences: async () => { discoveries++; return [references[0]]; },
    selectVaultReference: async ({ matches }) => { selections++; expect(matches.map(match => match.account)).toEqual(["account-a"]); return matches[0]; },
    verifyProviderAuthentication: async request => { authentications++; return successfulAuth(request); },
  };
  const prepared=await ensure(provider(), options);
  expect(prepared).toMatchObject({ source: "binding", configured: true, providerFingerprint: expect.any(String) });
  expect(await prepared.resolveCredential(provider())).toBe("fixture-current-vault-value");
  expect(Object.keys(prepared)).not.toContain("resolveCredential");
  expect(binding()).toEqual({
    schema: 1,
    credentialEnv: "SWITCHER_PROVIDER_OPENROUTER",
    origins: ["https://openrouter.ai"],
    source: { kind: "vault", key: references[0].key, executable: references[0].executable, operator: references[0].operator },
  });
  await expect(ensure(provider(), options)).resolves.toMatchObject({ source: "binding", configured: false, providerFingerprint: expect.any(String) });
  expect({ discoveries, selections, authentications }).toEqual({ discoveries: 1, selections: 1, authentications: 2 });
  expect(events.filter(event => event.startsWith("binding:bind"))).toEqual([`binding:bind:${references[0].key}`]);
});

test("ambiguous metadata matches require an explicit account choice and never select the first match implicitly", async () => {
  const ensure = expectedApi();
  const { resolver, events, binding } = fixture();
  let shown: VaultReference[] = [];
  await ensure(provider(), {
    interactive: true,
    resolver,
    discoverVaultReferences: async () => references,
    selectVaultReference: async ({ matches }) => { shown = matches; return matches[1]; },
    verifyProviderAuthentication: successfulAuth,
  });
  expect(shown.map(match => ({ account: match.account, key: match.key }))).toEqual([
    { account: "account-a", key: "provider/openrouter/account-a" },
    { account: "account-b", key: "provider/openrouter/account-b" },
  ]);
  expect(binding()?.source.key).toBe(references[1].key);
  expect(events).not.toContain(`binding:bind:${references[0].key}`);
});

test("cancelling account selection starts no authentication or launch and saves no binding", async () => {
  const ensure = expectedApi();
  const { resolver, events, binding } = fixture();
  let authenticated = false;
  await expect(ensure(provider(), {
    interactive: true,
    resolver,
    discoverVaultReferences: async () => references,
    selectVaultReference: async () => undefined,
    verifyProviderAuthentication: async () => { authenticated = true; return { authenticated: true }; },
  })).rejects.toBeInstanceOf(CommandInterrupted);
  expect(authenticated).toBe(false);
  expect(binding()).toBeUndefined();
  expect(events.some(event => event.startsWith("binding:bind"))).toBe(false);
});

test("noninteractive setup never prompts and returns a structured error with an exact supported setup command", async () => {
  const ensure = expectedApi();
  const { resolver } = fixture();
  let prompted = false, authenticated = false;
  const result = ensure(provider(), {
    interactive: false,
    resolver,
    discoverVaultReferences: async () => [references[0]],
    selectVaultReference: async () => { prompted = true; return references[0]; },
    verifyProviderAuthentication: async () => { authenticated = true; return { authenticated: true }; },
  });
  await expect(result).rejects.toMatchObject({
    code: "credential_setup_required",
    message: "Provider credential setup is required. Run: switcher credentials bind SWITCHER_PROVIDER_OPENROUTER --origin https://openrouter.ai --vault-key <vault-key>. Or provide SWITCHER_PROVIDER_OPENROUTER in this launch process.",
  });
  expect(prompted).toBe(false);
  expect(authenticated).toBe(false);
});

test("interactive setup distinguishes an unavailable Secrets CLI from no matching metadata",async()=>{
  const ensure=expectedApi();const {resolver}=fixture();
  await expect(credentialModule.discoverVaultReferences(provider(),{},"")).rejects.toMatchObject({code:"vault_exec_unavailable"});
  await expect(ensure(provider(),{interactive:true,resolver,discoverVaultReferences:async()=>[],selectVaultReference:async()=>{throw new Error("must not prompt");},verifyProviderAuthentication:successfulAuth})).rejects.toMatchObject({code:"credential_match_missing"});
});

test("rejected provider credentials remain on the selected account and do not fall through to another match", async () => {
  const ensure = expectedApi();
  const { resolver, events, binding } = fixture();
  let selections = 0, authentications = 0;
  await expect(ensure(provider(), {
    interactive: true,
    resolver,
    discoverVaultReferences: async () => references,
    selectVaultReference: async ({ matches }) => { selections++; return matches[0]; },
    verifyProviderAuthentication: async () => { authentications++; return { authenticated: false, status: 401 }; },
  })).rejects.toMatchObject({ code: "provider_credential_rejected" });
  expect({ selections, authentications }).toEqual({ selections: 1, authentications: 1 });
  expect(binding()?.source.key).toBe(references[0].key);
  expect(events).not.toContain(`binding:bind:${references[1].key}`);
});

test("explicit environment credentials are preserved while a bound account's origin restriction remains fail-closed", async () => {
  const ensure = expectedApi();
  let discovered = false, bound = false;
  const explicit = fixture({ environmentCredential: "fixture-explicit-environment" });
  explicit.resolver.bindings.bind = async value => { bound = true; return value; };
  await expect(ensure(provider(), {
    interactive: true,
    resolver: explicit.resolver,
    discoverVaultReferences: async () => { discovered = true; return references; },
    selectVaultReference: async ({ matches }) => matches[0],
    verifyProviderAuthentication: successfulAuth,
  })).resolves.toMatchObject({ source: "environment", configured: false, providerFingerprint: expect.any(String) });
  expect({ discovered, bound }).toEqual({ discovered: false, bound: false });

  const restricted = fixture({
    environmentCredential: "fixture-explicit-environment",
    existing: {
      schema: 1,
      credentialEnv: "SWITCHER_PROVIDER_OPENROUTER",
      origins: ["https://different-account-authority.example"],
      source: { kind: "vault", key: references[0].key, executable: references[0].executable, operator: references[0].operator },
    },
  });
  await expect(ensure(provider(), {
    interactive: true,
    resolver: restricted.resolver,
    discoverVaultReferences: async () => { throw new Error("must not discover an alternate account"); },
    verifyProviderAuthentication: successfulAuth,
  })).rejects.toMatchObject({ code: "credential_authority" });
});

test("an unauthenticated OpenRouter model catalog response is not accepted as provider authentication", async () => {
  const ensure = expectedApi();
  const { resolver } = fixture();
  let catalogSucceeded = false, authenticationChecked = false;
  const catalog = async () => { catalogSucceeded = true; return [{ id: "openai/gpt-sol-latest" }]; };
  expect(await catalog()).toHaveLength(1); // OpenRouter's public model catalog is deliberately unauthenticated.
  await expect(ensure(provider(), {
    interactive: true,
    resolver,
    discoverVaultReferences: async () => [references[0]],
    selectVaultReference: async ({ matches }) => matches[0],
    verifyProviderAuthentication: async () => { authenticationChecked = true; return { authenticated: false, status: 401 }; },
  })).rejects.toMatchObject({ code: "provider_credential_rejected" });
  expect(catalogSucceeded).toBe(true);
  expect(authenticationChecked).toBe(true);
});

test("OpenRouter authentication uses the bounded key endpoint rather than its public catalog", async () => {
  const calls: Array<{ path: string; authorization: string | null }> = [];
  const result = await credentialModule.verifyProviderAuthentication({
    provider: provider(),
    credential: "fixture-invalid-openrouter",
    fetch: (async (input,init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(null, { status: url.pathname.endsWith("/key") ? 401 : 200 });
    }) as typeof fetch,
  });
  expect(result).toEqual({ authenticated: false, status: 401 });
  expect(calls).toEqual([{path:"/api/v1/key",authorization:"Bearer fixture-invalid-openrouter"}]);
  const legacy=provider();delete (legacy as {credentialCheck?:unknown}).credentialCheck;
  expect(await credentialModule.verifyProviderAuthentication({provider:legacy,credential:"fixture",fetch:(async()=>new Response(null,{status:204})) as typeof fetch})).toEqual({authenticated:true,status:204});
});

test("existing OpenRouter providers created before credential checks remain launch-compatible",async()=>{
  const saved={...provider(),version:1,updatedAt:"2026-09-14T00:00:00.000Z"};delete (saved as {credentialCheck?:unknown}).credentialCheck;
  const client={getProvider:async(id:string)=>{if(id==="openrouter-responses")return saved;throw new SwitcherError(404,"not_found","missing");}} as unknown as SwitcherClient;
  await expect(resolveLaunchProvider(client,"openrouter",{harness:"codex"})).resolves.toEqual(saved);
});

test("provider authentication distinguishes rejected credentials from transient or redirected checks",async()=>{
  for(const status of [302,429,500])await expect(credentialModule.verifyProviderAuthentication({provider:provider(),credential:"fixture",fetch:(async()=>new Response(null,{status})) as typeof fetch})).rejects.toMatchObject({code:"provider_auth_unavailable"});
  await expect(credentialModule.verifyProviderAuthentication({provider:provider(),credential:"fixture",fetch:(async()=>{throw new Error("offline");}) as typeof fetch})).rejects.toMatchObject({code:"provider_auth_unavailable"});
});

test("default vault discovery runs metadata-only searches and reports the selected Contracts source", async () => {
  const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace/scratch/switcher-tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "credential-discovery-"));
  const executable = join(root, "secrets");
  try {
    await writeFile(executable, `#!${process.execPath}
const args=process.argv.slice(2);
if(args[0]!=="search"||args[2]!=="--json")process.exit(91);
if(process.env.HASNA_SECRETS_API_URL!=="https://vault.example"||process.env.HASNA_SECRETS_API_KEY_OVERRIDE!=="fixture-operator")process.exit(92);
console.log(JSON.stringify([{key:"accounts/openrouter/live/api_key",type:"api_key",label:"OpenRouter",expires_at:null,created_at:"2026-09-01",updated_at:"2026-09-15"}]));
`, { mode: 0o700 });
    const matches = await credentialModule.discoverVaultReferences(provider(), {
      PATH: root,
      HOME: root,
      HASNA_SECRETS_API_URL: "https://vault.example",
      HASNA_SECRETS_API_KEY: "fixture-operator",
    }, executable);
    expect(matches).toEqual([{
      account: "HASNA_SECRETS_API_KEY",
      key: "accounts/openrouter/live/api_key",
      executable,
      operator: { kind: "contracts" },
    }]);
    expect(JSON.stringify(matches)).not.toContain("fixture-operator");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
