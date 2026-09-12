import { loginWorkspace } from "./workspace-selection.js";
import { captureProfileWorkspace } from "../../lib/workspace-profile.js";
import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getAuthConfig, getAuthIdentity, getApiUrl, credentialPlacement, credentialPlacementMessage, CREDENTIAL_STORE_UNMANAGED } from "../../lib/auth-store.js";
import { resolveSkillsFleet, resolveSkillsConnection, SkillsFleetCredentialError, SKILLS_API_KEY_ENV, SKILLS_API_URL_ENV } from "../../lib/fleet-credentials.js";


const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const DEFAULT_DEVICE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

import { HostedApiError, RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
const CONFIG_HINT_STATUSES = new Set([401, 403, 404, 405, 501]);


function prompt(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: string | null) => {
      if (settled) return;
      settled = true;
      rl.close();
      if (answer === null) process.exitCode = 130;
      resolve(answer);
    };
    rl.once("SIGINT", () => finish(null));
    rl.once("close", () => finish(null));
    rl.question(question, answer => finish(answer.trim()));
  });
}
function authForPrompt() {
  try { return getAuthConfig(); }
  catch (error) {
    if (error instanceof SkillsFleetCredentialError && error.code === "MISSING_API_CREDENTIAL") return null;
    throw error;
  }
}

async function apiRequest(path: string, options?: RequestInit, instance?: string) {
  const origin = instance ?? getApiUrl(`${(options?.method || "GET").toUpperCase()} ${path}`);
  return new RemoteSkillsAuthClient(origin).request(path, options);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function commandErrorPayload(err: unknown, fallback: string): Record<string, unknown> {
  if (err instanceof HostedApiError) {
    return {
      error: err.message || fallback,
      ...(err.status !== undefined ? { status: err.status } : {}),
      ...(err.code ? { code: err.code } : {}),
      ...(err.detail && err.detail !== err.message ? { detail: err.detail } : {}),
      ...(err.endpoint ? { endpoint: err.endpoint } : {}),
      ...(err.apiUrl ? { apiUrl: err.apiUrl } : {}),
    };
  }
  const code = isRecord(err) && typeof err.code === "string" ? err.code : undefined;
  return {
    error: (err as Error)?.message || fallback,
    ...(code ? { code } : {}),
  };
}

function writeCommandError(err: unknown, fallback: string, json?: boolean): void {
  const payload = commandErrorPayload(err, fallback);
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
    return;
  }

  const message = String(payload.detail || payload.error || fallback);
  const status = typeof payload.status === "number" ? payload.status : undefined;
  const showStatus = status !== undefined && !message.startsWith(String(status));
  console.error(chalk.red(showStatus ? `${message} (HTTP ${status})` : message));
  if (payload.endpoint) console.error(chalk.dim(`Endpoint: ${payload.endpoint}`));
  if (status !== undefined && CONFIG_HINT_STATUSES.has(status)) {
    console.error(chalk.dim(`Hint: check ${SKILLS_API_URL_ENV} (currently ${payload.apiUrl}) or run: skills setup`));
  }
  process.exitCode = 1;
}

/**
 * Which rung of the fleet ladder supplied the credential in effect.
 *
 * Reported, never re-resolved: `whoami` shows the operator where the key it just
 * used came from — an env key NAME, a Keychain item reference, or a file path —
 * so a stale export and a rotated file are told apart at a glance. Never a value.
 */
function credentialSource(): string | null {
  try {
    const fleet = resolveSkillsFleet();
    return fleet.mode === "hosted" ? fleet.apiKeySource : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function authIdentityPayload(
  authSource: string,
  live: unknown,
  cached?: { email?: string; orgId?: string; orgSlug?: string; userId?: string } | null,
  offline = false,
): Record<string, unknown> {
  const root = recordField(live) ?? {};
  const data = recordField(root.data);
  const user = recordField(root.user) ?? recordField(data?.user);
  const organization = recordField(root.organization) ?? recordField(root.org) ?? recordField(data?.organization);
  const email = stringField(user?.email) ?? cached?.email;
  const orgSlug = stringField(organization?.slug) ?? cached?.orgSlug;
  const orgName = stringField(organization?.name);
  const userId = stringField(user?.id) ?? cached?.userId;
  const orgId = stringField(organization?.id) ?? cached?.orgId;
  const role = stringField(user?.role);

  return {
    status: "authenticated",
    authSource,
    ...(offline ? { offline: true } : {}),
    ...(email ? { email } : {}),
    ...(orgSlug ? { organization: orgSlug } : {}),
    ...(orgName ? { organizationName: orgName } : {}),
    ...(userId ? { userId } : {}),
    ...(orgId ? { orgId } : {}),
    ...(role ? { role } : {}),
  };
}

function printWhoami(payload: Record<string, unknown>): void {
  if (payload.email) console.log(chalk.bold("Email:  ") + payload.email);
  if (payload.organization) console.log(chalk.bold("Org:    ") + payload.organization);
  if (payload.role) console.log(chalk.bold("Role:   ") + payload.role);
  if (payload.organizationName) console.log(chalk.bold("Name:   ") + payload.organizationName);
  if (payload.authSource) console.log(chalk.dim(`Auth:   ${payload.authSource}`));
  if (payload.offline) console.log(chalk.dim("(offline — showing cached info)"));
}

/**
 * Where every verb that used to WRITE a credential now stops.
 *
 * `auth login` (email code, device code, `--api-key`), `auth signup` and
 * workspace enrollment wrote `~/.hasna/skills/config/credentials` until 0.5.10.
 * Credential provisioning is a separate, owner-authorised workflow (fleet
 * credential rule 2026-09-09; fail-closed ruling 2026-09-07, hasna/apps#1720):
 * this CLI names where the key belongs — Keychain item, credentials-file line,
 * environment variable — and never writes or prints one. Exit 1, because
 * nothing the verb's name promises has happened.
 */
function writeUnmanaged(json: boolean | undefined, extra: Record<string, unknown> = {}): void {
  const error = credentialPlacementMessage();
  if (json) {
    console.log(JSON.stringify({ status: "credential_store_unmanaged", code: CREDENTIAL_STORE_UNMANAGED, error, placement: credentialPlacement(), ...extra }, null, 2));
  } else {
    console.error(chalk.red(error));
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value === "string") console.error(chalk.dim(`  ${key}: ${value}`));
    }
  }
  process.exitCode = 1;
}

async function doLogin(email: string, code?: string, json?: boolean) {
  let origin: string;
  try { origin = getApiUrl("Sign in"); }
  catch (error) { writeCommandError(error, "Configure a Skills API before signing in", json); return; }
  if (!email || !email.includes("@")) {
    writeCommandError(new Error("Invalid email"), "Invalid email", json);
    process.exitCode = 1;
    return;
  }

  if (!code) {
    if (!json) console.log(chalk.dim("Sending code..."));
    let sendRes: any;
    try {
      sendRes = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email }),
      }, origin);
    } catch (err) {
      writeCommandError(err, "Failed to request login code", json);
      return;
    }

    if (sendRes.error) {
      writeCommandError(new Error(sendRes.error), "Failed to request login code", json);
      return;
    }

    if (!json) console.log(chalk.green("✓ Code sent to " + email));

    // The code is for `auth keys create`, which mints a key and shows it once;
    // this verb no longer verifies it, because verifying would mint a key this
    // CLI can neither store nor print.
    const next = `skills auth keys create <name> --email ${email} --code <CODE>`;
    const message = `Check email for the 6-digit code, then mint a key with: ${next} (shown once) and place it where the shared ladder reads it. ${credentialPlacementMessage()}`;
    if (json || !isTTY) {
      console.log(JSON.stringify({ status: "code_sent", email, message, next }));
      return;
    }
    console.log(chalk.dim(`  Next: ${next}`));
    console.log(chalk.dim(`  ${credentialPlacementMessage()}`));
    return;
  }

  // A code was supplied. Verifying it here would consume it to mint a key this
  // CLI can neither store nor print; leave it for `auth keys create` and say
  // where the key goes. No request is sent.
  writeUnmanaged(json, { email, next: `skills auth keys create <name> --email ${email} --code <the code you received>` });
}

async function doApiKeyLogin(apiKey: string, json?: boolean) {
  let origin: string;
  try { origin = getApiUrl("Verify API key"); }
  catch (error) { writeCommandError(error, "Configure a Skills API before signing in", json); return; }
  const trimmed = apiKey.trim();
  if (!trimmed) {
    writeCommandError(new Error("API key required"), "API key required", json);
    return;
  }

  let whoami: any;
  try {
    whoami = await apiRequest("/api/auth/whoami", {
      headers: { Authorization: `Bearer ${trimmed}` },
    }, origin);
  } catch (err) {
    writeCommandError(err, "Failed to verify API key", json);
    return;
  }

  const identity = authIdentityPayload("--api-key", whoami);

  // Verified, NOT stored: this CLI writes no credential file. The identity the
  // server returned is shown, and the placement names where the key belongs so
  // the operator can finish provisioning. The key itself is never echoed.
  const placement = credentialPlacement();
  if (json || !isTTY) {
    console.log(JSON.stringify({ ...identity, status: "verified", stored: false, code: CREDENTIAL_STORE_UNMANAGED, placement }, null, 2));
    return;
  }
  printWhoami(identity);
  console.log(chalk.dim(`  Verified only — nothing was stored. ${credentialPlacementMessage(process.env, "this key")}`));
}

interface DeviceLoginOptions {
  json?: boolean;
  open?: boolean;
  poll?: boolean;
  pollTimeoutMs?: string;
}

async function doDeviceLogin(options: DeviceLoginOptions) {
  const timeoutMs = Number(options.pollTimeoutMs ?? DEFAULT_DEVICE_POLL_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_DEVICE_POLL_TIMEOUT_MS) {
    writeCommandError(new Error("Device polling timeout must be an integer from 1 to 600000 milliseconds"), "Invalid polling timeout", options.json);
    return;
  }
  let origin: string;
  try { origin = getApiUrl("Device sign in"); }
  catch (error) { writeCommandError(error, "Configure a Skills API before signing in", options.json); return; }
  // Device login ends in a key this CLI can neither store nor print, so it is
  // refused before any request is sent. The authority is still resolved first,
  // so an unconfigured install gets the same MISSING_API_URL line as every
  // other verb instead of a placement hint for a service it never named.
  writeUnmanaged(options.json, {
    apiUrl: origin,
    next: "skills auth login --email <you>  (request a code), then: skills auth keys create <name> --email <you> --code <CODE>",
  });
}

export function registerAuth(parent: Command) {
  const auth = parent
    .command("auth")
    .description("Manage account authentication");

  const keys = auth.command("keys").description("Manage API keys on the configured instance");
  keys.command("list").option("--json", "Output as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .action(async (options: { json: boolean; email: string; code: string }) => {
      try { const target = await captureProfileWorkspace("List API keys"); target.unchanged(); console.log(JSON.stringify(await new RemoteSkillsAuthClient(target.origin).listApiKeys(options.email, options.code, target.context), null, 2)); }
      catch (error) { writeCommandError(error, "Failed to list API keys", options.json); }
    });
  keys.command("create").argument("<name>").option("--scope <scope>", "Limit key scope (repeatable)", (value: string, all: string[]) => [...all, value], [] as string[])
    .option("--json", "Output the newly created key as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .description("Create a key; the returned secret is shown once and must be stored securely")
    .action(async (name: string, options: { json: boolean; scope: string[]; email: string; code: string }) => {
      try {
        const target = await captureProfileWorkspace("Create API key");
        const client = new RemoteSkillsAuthClient(target.origin); target.unchanged();
        const created = await client.createApiKey(options.email, options.code, name, options.scope.length ? options.scope : undefined, target.context);
        console.log(JSON.stringify(created, null, 2));
      } catch (error) { writeCommandError(error, "Failed to create API key", options.json); }
    });
  keys.command("revoke").argument("<key-id>").option("--json", "Output as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .action(async (id: string, options: { json: boolean; email: string; code: string }) => {
      try { const target = await captureProfileWorkspace("Revoke API key"); target.unchanged(); console.log(JSON.stringify(await new RemoteSkillsAuthClient(target.origin).revokeApiKey(options.email, options.code, id, target.context), null, 2)); }
      catch (error) { writeCommandError(error, "Failed to revoke API key", options.json); }
    });

  auth
    .command("login")
    .description("Request a sign-in code, or verify an API key; this CLI stores no credentials")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .option("--membership-id <id>", "Enroll an exact workspace membership into an explicit HASNA_PROFILE")
    .option("--code-stdin", "Read a fresh six-digit code for workspace enrollment from stdin")
    .option("--api-key <key>", "Verify an API key and show where it belongs (nothing is stored)")
    .option("--device", "Use browser/device-code login", false)
    .option("--no-open", "Do not open a browser for device-code login")
    .option("--poll", "Poll until browser authentication completes in non-interactive mode", false)
    .option("--poll-timeout-ms <ms>", "Maximum time to wait for device-code login")
    .option("--json", "Output result as JSON", false)
    .action(async (options: { membershipId?: string; codeStdin?: boolean; email?: string; code?: string; apiKey?: string; device?: boolean; open?: boolean; poll?: boolean; pollTimeoutMs?: string; json?: boolean }) => {
      if (options.membershipId !== undefined) {
        if (options.apiKey || options.device || options.code || options.poll) {
          writeCommandError(new Error("Workspace login uses email and --code-stdin; do not combine it with device, API key or --code login."), "Invalid login options", options.json); return;
        }
        await loginWorkspace({ ...options, membershipId: options.membershipId }); return;
      }
      if (options.codeStdin) { writeCommandError(new Error("--code-stdin requires --membership-id for this login flow."), "Invalid login options", options.json); return; }
      if (options.apiKey) {
        await doApiKeyLogin(options.apiKey, options.json);
        return;
      }
      if (options.device || (!options.email && !options.code)) {
        await doDeviceLogin(options);
        return;
      }

      let email = options.email;

      if (!email && isTTY && !options.json) {
        const existing = authForPrompt();
        if (existing) {
          console.log(chalk.dim(`Already signed in as ${existing.email}`));
          const again = await prompt("Sign in with a different account? (y/N) ");
          if (again === null || again.toLowerCase() !== "y") return;
        }
        const answer = await prompt(chalk.bold("Email: "));
        if (answer === null) return;
        email = answer;
      }

      if (!email) {
        writeCommandError(new Error("Email required. Use: skills auth login --email you@example.com"), "Email required", options.json);
        return;
      }

      await doLogin(email, options.code, options.json);
    });

  auth
    .command("signup")
    .description("Create or sign in with your email (passwordless)")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .option("--json", "Output result as JSON without prompting", false)
    .action(async (options: { email?: string; code?: string; json?: boolean }) => {
      let email = options.email;

      if (!email && isTTY && !options.json) {
        const existing = authForPrompt();
        if (existing) {
          console.log(chalk.dim(`Already signed in as ${existing.email}`));
          const again = await prompt("Continue with a different account? (y/N) ");
          if (again === null || again.toLowerCase() !== "y") return;
        }
        const answer = await prompt(chalk.bold("Email: "));
        if (answer === null) return;
        email = answer;
      }

      if (!email) {
        const error = "Email required. Use: skills auth signup --email you@example.com";
        if (options.json) console.log(JSON.stringify({ error })); else console.error(chalk.red(error));
        process.exitCode = 1;
        return;
      }

      await doLogin(email, options.code, options.json);
    });

  auth
    .command("logout")
    .description("Report the credential in effect; this CLI stores and removes no credentials")
    .option("--json", "Output as JSON", false)
    .action((options: { json?: boolean }) => {
      // Nothing to clear: this CLI never wrote a credential (see writeUnmanaged).
      // The truthful answer is WHICH rung of the ladder the credential in effect
      // came from — a name, never a value — so the operator removes it there.
      const source = credentialSource();
      const stillResolves = source !== null;
      const placement = credentialPlacement();
      if (options.json) {
        console.log(JSON.stringify({ status: stillResolves ? "credential_still_configured" : "signed_out", stillResolves, source, managed: false, placement }));
        return;
      }
      console.log(stillResolves
        ? `A Skills credential is configured at ${source}. This CLI does not manage credentials; remove it there ` +
          `(the Keychain item ${placement.keychainItem}, the ${placement.envKey} line in ${placement.credentialsFile ?? "~/.hasna/skills/config/credentials"}, ` +
          `or the ${placement.envKey} variable) to sign out.`
        : "No Skills credential resolves on this machine; nothing to sign out of. This CLI stores no credentials.");
    });

  auth
    .command("whoami")
    .description("Show current account info")
    .option("--json", "Output as JSON", false)
    .action(async (options: { json?: boolean }) => {
      let fleet: Awaited<ReturnType<typeof resolveSkillsConnection>>;
      try {
        fleet = await resolveSkillsConnection();
      } catch (err) {
        writeCommandError(err, "Failed to resolve the Skills credential", options.json);
        return;
      }
      if (!fleet) {
        const payload = {
          status: "unauthenticated",
          error: `Not signed in. Run: skills auth login, or set ${SKILLS_API_KEY_ENV}`,
        };
        if (options.json) console.log(JSON.stringify(payload, null, 2));
        else console.log(chalk.dim(payload.error));
        return;
      }

      // The recorded identity belongs to the credential THIS CLI stored. When the
      // key in effect came from anywhere else — an env var, the Keychain, an
      // override — that identity describes a different principal, and showing it
      // would attribute one key's session to another key's account.
      const cached = (fleet.apiKeyTier === "disk" || fleet.apiKeyTier === "profile") ? getAuthIdentity() : null;
      const authSource = fleet.apiKeySource;
      try {
        const res = await apiRequest("/api/auth/whoami", {
          headers: { Authorization: `Bearer ${fleet.apiKey}` },
        }, fleet.apiOrigin);
        const payload = authIdentityPayload(authSource, res, cached);
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          printWhoami(payload);
        }
      } catch (err) {
        if (cached && Object.keys(cached).length > 0 && !(err instanceof HostedApiError && err.status !== undefined && err.status < 500)) {
          const payload = authIdentityPayload(authSource, {}, cached, true);
          if (options.json) console.log(JSON.stringify(payload, null, 2));
          else printWhoami(payload);
          return;
        }
        writeCommandError(err, "Failed to fetch current account", options.json);
      }
    });

}
