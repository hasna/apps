// Backend route registry — machine-local provider routing records.
//
// A backend route says WHERE a harness talks (base URL), WHICH models it may
// use (semantic context metadata), and WHICH vault item authenticates it
// (a LOCATOR, never a value). The registry deliberately lives ONLY in the
// local `~/.hasna/accounts/accounts.json` store (schema v1): vault keys and
// org-specific endpoints are machine-local user data, and must not travel
// through the cloud `/v1` registry transport or be compiled into the
// published `@hasna/accounts` package (design 01a00e8a §"public code stays
// generic").
//
// Resolution fail-closes: a route whose `baseUrl` or `vaultKey` fails the
// semantic checks here is refused at `add` time AND at `resolve` time, so a
// hand-edited store cannot route a harness to an arbitrary endpoint with an
// arbitrary credential.

import type { BackendModel, BackendRoute, Profile } from "../types.js";
import { AccountsError } from "../types.js";
import { loadStore, saveStore } from "../storage.js";

/** Public transport only: https, or plain http bound to localhost. */
const HTTPS_BASE_URL = /^https:\/\/[^\s/]+(?::\d+)?(?:\/.*)?$/;
const LOCALHOST_BASE_URL = /^http:\/\/localhost(?::\d+)?(?:\/.*)?$/;

/**
 * Vault locators look like paths (`deepseek/api_key`). Anything that smells
 * like a live credential value is refused — a token pasted into `vaultKey`
 * would be echoed into the launch command line and the transcript.
 */
const VAULT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_./-]*$/;
const CREDENTIAL_VALUE_PATTERN =
  /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9]{8,}|gh[oprsu]_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/;

/**
 * A generic DeepSeek example route (public knowledge: endpoint, protocol and
 * a representative model). Org-specific routes are user data added via
 * `accounts backend add` — this constant exists so an operator can start with
 * `accounts backend add --example deepseek`, not so the package ships
 * anything org-specific.
 */
export const EXAMPLE_DEEPSEEK_BACKEND: BackendRoute = {
  id: "deepseek",
  name: "DeepSeek",
  protocol: "anthropic-messages",
  baseUrl: "https://api.deepseek.com/anthropic",
  vaultKey: "deepseek/api_key",
  models: [{ id: "deepseek-v4-flash", contextWindowTokens: 1_000_000 }],
  defaults: { model: "deepseek-v4-flash" },
};

export function validateBackendRoute(route: BackendRoute): BackendRoute {
  if (!HTTPS_BASE_URL.test(route.baseUrl) && !LOCALHOST_BASE_URL.test(route.baseUrl)) {
    throw new AccountsError(
      `backend "${route.id}" baseUrl must be https:// or http://localhost: got "${route.baseUrl}"`,
    );
  }
  if (!VAULT_KEY_PATTERN.test(route.vaultKey)) {
    throw new AccountsError(
      `backend "${route.id}" vaultKey must be a vault locator like "deepseek/api_key": got "${route.vaultKey}"`,
    );
  }
  if (CREDENTIAL_VALUE_PATTERN.test(route.vaultKey)) {
    throw new AccountsError(
      `backend "${route.id}" vaultKey looks like a credential VALUE, not a vault locator; store the value in the vault and reference it by key`,
    );
  }
  if (route.defaults && !route.models.some((model) => model.id === route.defaults!.model)) {
    throw new AccountsError(
      `backend "${route.id}" default model "${route.defaults.model}" is not among its registered models`,
    );
  }
  for (const [alias, modelId] of Object.entries(route.defaults?.aliases ?? {})) {
    if (modelId !== undefined && !route.models.some((model) => model.id === modelId)) {
      throw new AccountsError(
        `backend "${route.id}" alias ${alias} references unknown model "${modelId}"`,
      );
    }
  }
  return route;
}

/** Register or replace a backend route in the local store. */
export function addBackend(route: BackendRoute): BackendRoute {
  validateBackendRoute(route);
  const store = loadStore();
  const existing = store.backends.findIndex((backend) => backend.id === route.id);
  if (existing >= 0) store.backends[existing] = route;
  else store.backends.push(route);
  saveStore(store);
  return route;
}

export function listBackends(): BackendRoute[] {
  return [...loadStore().backends];
}

/** Remove a backend route; refused while any profile binds it. */
export function removeBackend(id: string): void {
  const store = loadStore();
  const route = store.backends.find((backend) => backend.id === id);
  if (!route) throw new AccountsError(`no backend route named "${id}"`);
  const bound = store.profiles.find((profile) => profile.backendRef === id);
  if (bound) {
    throw new AccountsError(
      `backend "${id}" is bound by profile "${bound.name}" (${bound.tool}); unbind it first (accounts set ${bound.name} --unbind-backend)`,
    );
  }
  store.backends = store.backends.filter((backend) => backend.id !== id);
  saveStore(store);
}

/** Resolve a backend route by id, failing closed on unknown or invalid records. */
export function resolveBackend(id: string): BackendRoute {
  const route = loadStore().backends.find((backend) => backend.id === id);
  if (!route) {
    throw new AccountsError(
      `no backend route named "${id}" — add it with \`accounts backend add\` (try \`accounts backend add --example deepseek\`)`,
    );
  }
  return validateBackendRoute(route);
}

/** The backend route a profile is bound to, if any. */
export function backendForProfile(profile: Profile): BackendRoute | undefined {
  if (!profile.backendRef) return undefined;
  return resolveBackend(profile.backendRef);
}

/** Resolve a model id within a backend, fail-closed on unknown ids. */
export function resolveBackendModel(backend: BackendRoute, modelId?: string): BackendModel {
  const id = modelId ?? backend.defaults?.model ?? backend.models[0]!.id;
  const model = backend.models.find((candidate) => candidate.id === id);
  if (!model) {
    throw new AccountsError(
      `model "${id}" is not registered on backend "${backend.id}" (registered: ${backend.models
        .map((candidate) => candidate.id)
        .join(", ")})`,
    );
  }
  return model;
}
