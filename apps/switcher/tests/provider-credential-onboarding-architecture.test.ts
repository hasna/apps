import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(packageRoot, "src");
const onboardingPath = join(sourceRoot, "provider-credential-onboarding.ts");
const read = (path: string) => readFile(path, "utf8");

async function onboardingSource() {
  try { return await read(onboardingPath); }
  catch { expect(false, "src/provider-credential-onboarding.ts must own provider setup orchestration").toBe(true); return ""; }
}

const definitions = (source: string, name: string) => new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function|class|const|type|interface)\\s+${name}\\b`).test(source);
const importsFrom = (source: string, module: string) => new RegExp(`(?:from\\s+|export\\s+\\{[^}]*\\}\\s+from\\s+)["']${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(source);

async function localEdges(path: string) {
  const source = await read(path);
  const edges: string[] = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const base = resolve(dirname(path), match[1]);
    const candidates = extname(base) ? [base] : [`${base}.ts`, join(base, "index.ts")];
    for (const candidate of candidates) {
      if (await Bun.file(candidate).exists()) { edges.push(normalize(candidate)); break; }
    }
  }
  return edges;
}

async function pathBackToOnboarding(path: string, seen = new Set<string>()): Promise<string[] | undefined> {
  const normalized = normalize(path);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  for (const edge of await localEdges(normalized)) {
    if (edge === normalize(onboardingPath)) return [normalized, edge];
    const tail = await pathBackToOnboarding(edge, seen);
    if (tail) return [normalized, ...tail];
  }
  return undefined;
}

test("the extraction leaves credentials.ts as the binding, resolution, and protected-delivery owner", async () => {
  const [credentials, onboarding] = await Promise.all([read(join(sourceRoot, "credentials.ts")), onboardingSource()]);
  for (const name of ["credentialBindingSchema", "CredentialBindings", "CredentialResolver", "deliverVaultCredential"])
    expect(definitions(credentials, name), `credentials.ts must continue to define ${name}`).toBe(true);
  for (const marker of ["SWITCHER_CREDENTIAL_DELIVERY_URL", "fetchVaultCredential", "runVaultCommand", "resolveVaultOperatorEnvironment"])
    expect(credentials, `credentials.ts must retain protected credential infrastructure: ${marker}`).toContain(marker);

  for (const name of ["discoverVaultReferences", "selectVaultReference", "verifyProviderAuthentication", "ensureProviderCredential", "providerCredentialSetupCommand", "providerCredentialFingerprint"])
    expect(definitions(credentials, name), `credentials.ts must not continue to define onboarding concern ${name}`).toBe(false);
  expect(credentials).not.toContain("node:readline/promises");
  expect(credentials).not.toContain("./auth");
  expect(importsFrom(onboarding, "./credentials"), "the onboarding module must depend inward on credential primitives").toBe(true);
  for (const name of ["credentialBindingSchema", "CredentialBindings", "CredentialResolver", "deliverVaultCredential"])
    expect(definitions(onboarding, name), `the onboarding module must consume rather than redefine credential primitive ${name}`).toBe(false);
});

test("the focused onboarding module owns discovery, prompt, authentication, preflight, and dry-run catalog policy", async () => {
  const onboarding = await onboardingSource();
  for (const name of ["discoverVaultReferences", "selectVaultReference", "verifyProviderAuthentication", "ensureProviderCredential", "providerCredentialSetupCommand", "providerCredentialFingerprint", "launchCatalog"])
    expect(definitions(onboarding, name), `provider-credential-onboarding.ts must define ${name}`).toBe(true);
  expect(onboarding).toContain("node:readline/promises");
  expect(onboarding).toContain("./auth");
  expect(onboarding).toContain("dry_run_catalog_unavailable");
  expect(onboarding).toContain("requireProviderAuthentication");
  expect(onboarding).toContain("credential_preflight_changed");
});

test("CLI and launcher consume the focused boundary while public package exports stay unchanged", async () => {
  const [cli, launcher, directLaunch, packageJson, publicIndex] = await Promise.all([
    read(join(sourceRoot, "cli.ts")), read(join(sourceRoot, "launcher.ts")), read(join(sourceRoot, "direct-launch.ts")), Bun.file(join(packageRoot, "package.json")).json(), read(join(sourceRoot, "index.ts")),
  ]);
  expect(importsFrom(cli, "./provider-credential-onboarding")).toBe(true);
  expect(importsFrom(cli, "./credentials")).toBe(true);
  expect(importsFrom(launcher, "./provider-credential-onboarding")).toBe(true);
  expect(importsFrom(directLaunch, "./provider-credential-onboarding"), "direct-launch keeps its existing launchCatalog export as a compatibility re-export").toBe(true);
  expect(definitions(directLaunch, "launchCatalog"), "direct-launch must no longer implement dry-run credential policy").toBe(false);
  expect(packageJson.exports).toEqual({
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./sdk": { types: "./dist/sdk.d.ts", import: "./dist/sdk.js" },
  });
  expect(publicIndex.trim()).toBe('export * from "./sdk";');

  const [directModule, onboardingModule] = await Promise.all([
    import(new URL("../src/direct-launch.ts", import.meta.url).href),
    import(new URL("../src/provider-credential-onboarding.ts", import.meta.url).href),
  ]);
  expect(directModule.launchCatalog, "direct-launch must retain the exact launchCatalog export identity").toBe(onboardingModule.launchCatalog);
});

test("the onboarding dependency edge is one-way and cannot cycle back through credential infrastructure", async () => {
  await onboardingSource();
  const credentialsPath = join(sourceRoot, "credentials.ts");
  const [credentials, onboarding] = await Promise.all([read(credentialsPath), read(onboardingPath)]);
  expect(importsFrom(onboarding, "./credentials")).toBe(true);
  expect(importsFrom(credentials, "./provider-credential-onboarding")).toBe(false);
  const cycle = await pathBackToOnboarding(credentialsPath);
  expect(cycle?.map(path => relative(packageRoot, path)), `dependency cycle: ${cycle?.join(" -> ") ?? "none"}`).toBeUndefined();
});
