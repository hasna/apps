import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getAuthConfig, getAuthIdentity, saveAuthConfig, clearAuthConfig, getApiUrl, getAuthFilePath } from "../../lib/auth-store.js";
import { resolveSkillsFleet, resolveSkillsConnection, SKILLS_API_KEY_ENV, SKILLS_API_URL_ENV } from "../../lib/fleet-credentials.js";


const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const DEFAULT_DEVICE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

import { HostedApiError, RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
const CONFIG_HINT_STATUSES = new Set([401, 403, 404, 405, 501]);


function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserCommand(url: string): string[] | null {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}

function openBrowser(url: string): void {
  const command = browserCommand(url);
  if (!command) return;
  try {
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

async function ensureApiKey(loginResult: any, origin: string): Promise<string | undefined> {
  if (loginResult.apiKey) return loginResult.apiKey;
  if (!loginResult.token) return undefined;
  const keyRes = await apiRequest("/api/auth/keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${loginResult.token}` },
    body: JSON.stringify({ name: "cli" }),
  }, origin);
  return keyRes.key;
}

async function persistLoginResult(loginResult: any, origin: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const storedKey = await ensureApiKey(loginResult, origin);
  if (!storedKey) return undefined;

  saveAuthConfig({
    apiKey: storedKey,
    email: loginResult.user.email,
    orgId: loginResult.organization.id,
    orgSlug: loginResult.organization.slug,
    userId: loginResult.user.id,
  }, env, origin);

  return storedKey;
}

function printLoginSuccess(loginResult: any, json: boolean) {
  if (json || !isTTY) {
    console.log(JSON.stringify({
      status: "authenticated",
      email: loginResult.user.email,
      organization: loginResult.organization.slug,
      firstLogin: loginResult.firstLogin,
    }));
    return;
  }

  console.log(chalk.green(`\n✓ Signed in as ${loginResult.user.email}`));
  console.log(chalk.dim(`  Organization: ${loginResult.organization.name}`));
  if (loginResult.firstLogin) {
    // The real path, not an assumed one: HASNA_HOME / HASNA_CONFIG_HOME relocate
    // the credentials file the shared ladder reads.
    console.log(chalk.dim(`  API key saved to ${getAuthFilePath()}`));
  }
}

async function doLogin(email: string, code?: string, json?: boolean) {
  const env = { ...process.env };
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

    if (json || !isTTY) {
      console.log(JSON.stringify({ status: "code_sent", email, message: "Check email for 6-digit code, then run: skills auth login --email " + email + " --code <CODE>" }));
      return;
    }

    code = await prompt(chalk.bold("Code: "));
  }

  let verifyRes: any;
  try {
    verifyRes = await apiRequest("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }, origin);
  } catch (err) {
    writeCommandError(err, "Failed to verify login code", json);
    return;
  }

  if (verifyRes.error) {
    writeCommandError(new Error(verifyRes.error), "Failed to verify login code", json);
    return;
  }

  let storedKey: string | undefined;
  try {
    storedKey = await persistLoginResult(verifyRes, origin, env);
  } catch (err) {
    writeCommandError(err, "Login succeeded but API key creation failed", json);
    return;
  }
  if (!storedKey) {
    writeCommandError(new Error("Login succeeded but API key creation failed"), "Login succeeded but API key creation failed", json);
    return;
  }

  printLoginSuccess(verifyRes, Boolean(json));
}

async function doApiKeyLogin(apiKey: string, json?: boolean) {
  const env = { ...process.env };
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

  const identity = authIdentityPayload("stored", whoami);
  const email = stringField(identity.email);
  const orgId = stringField(identity.orgId);
  const orgSlug = stringField(identity.organization);
  const userId = stringField(identity.userId);

  // Only what `whoami` actually returned is stored. Filling a missing identity
  // field with a placeholder both invents a fact about the user and, when the
  // placeholder names a deployment variant, hands every later reader of
  // `auth.json` a fingerprint of the instance the key belongs to.
  saveAuthConfig({
    apiKey: trimmed,
    ...(email ? { email } : {}),
    ...(orgId ? { orgId } : {}),
    ...(orgSlug ? { orgSlug } : {}),
    ...(userId ? { userId } : {}),
  }, env, origin);

  if (json || !isTTY) {
    console.log(JSON.stringify({ ...identity, status: "authenticated" }, null, 2));
    return;
  }

  printWhoami(identity);
}

interface DeviceLoginOptions {
  json?: boolean;
  open?: boolean;
  poll?: boolean;
  pollTimeoutMs?: string;
}

async function doDeviceLogin(options: DeviceLoginOptions) {
  const env = { ...process.env };
  let origin: string;
  try { origin = getApiUrl("Device sign in"); }
  catch (error) { writeCommandError(error, "Configure a Skills API before signing in", options.json); return; }
  let start: any;
  try {
    start = await apiRequest("/api/auth/device/start", {
      method: "POST",
      body: JSON.stringify({ client: "skills-cli" }),
    }, origin);
  } catch (err) {
    writeCommandError(err, "Failed to start device login", options.json);
    return;
  }

  if (start.error) {
    writeCommandError(new Error(start.error), "Failed to start device login", options.json);
    return;
  }

  const verificationUrl = start.verificationUriComplete || start.verificationUri;
  const shouldPoll = Boolean(options.poll || (isTTY && !options.json));

  if (options.open !== false && isTTY && verificationUrl) {
    openBrowser(verificationUrl);
  }

  if (!shouldPoll) {
    const payload = {
      status: "pending",
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      verificationUriComplete: start.verificationUriComplete,
      expiresIn: start.expiresIn,
      interval: start.interval,
      poll: "skills auth login --device --poll",
    };
    if (options.json || !isTTY) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(chalk.bold("\nSign in in your browser\n"));
      console.log(`${chalk.dim("Code:")} ${start.userCode}`);
      console.log(`${chalk.dim("URL:")}  ${verificationUrl}`);
    }
    return;
  }

  if (!options.json) {
    console.log(chalk.bold("\nSign in in your browser\n"));
    console.log(`${chalk.dim("Code:")} ${start.userCode}`);
    console.log(`${chalk.dim("URL:")}  ${verificationUrl}`);
    console.log(chalk.dim("\nWaiting for authentication..."));
  }

  const intervalMs = Math.max(1000, Number(start.interval || 5) * 1000);
  const timeoutMs = Number(options.pollTimeoutMs || DEFAULT_DEVICE_POLL_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let tokenRes: any;
    try {
      tokenRes = await apiRequest("/api/auth/device/token", {
        method: "POST",
        body: JSON.stringify({ deviceCode: start.deviceCode }),
      }, origin);
    } catch (err) {
      writeCommandError(err, "Failed to poll device login", options.json);
      return;
    }

    if (tokenRes.error === "authorization_pending" || tokenRes.status === "pending") {
      await sleep(intervalMs);
      continue;
    }

    if (tokenRes.error) {
      writeCommandError(new Error(tokenRes.detail || tokenRes.error), "Failed to poll device login", options.json);
      return;
    }

    let storedKey: string | undefined;
    try {
      storedKey = await persistLoginResult(tokenRes, origin, env);
    } catch (err) {
      writeCommandError(err, "Login succeeded but API key creation failed", options.json);
      return;
    }
    if (!storedKey) {
      writeCommandError(new Error("Login succeeded but API key creation failed"), "Login succeeded but API key creation failed", options.json);
      return;
    }

    printLoginSuccess(tokenRes, Boolean(options.json));
    return;
  }

  const error = "Device login timed out before browser authentication completed";
  if (options.json || !isTTY) console.log(JSON.stringify({ status: "expired", error }));
  else console.error(chalk.red(error));
  process.exitCode = 1;
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
      try { console.log(JSON.stringify(await new RemoteSkillsAuthClient(getApiUrl("List API keys")).listApiKeys(options.email, options.code), null, 2)); }
      catch (error) { writeCommandError(error, "Failed to list API keys", options.json); }
    });
  keys.command("create").argument("<name>").option("--scope <scope>", "Limit key scope (repeatable)", (value: string, all: string[]) => [...all, value], [] as string[])
    .option("--json", "Output the newly created key as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .description("Create a key; the returned secret is shown once and must be stored securely")
    .action(async (name: string, options: { json: boolean; scope: string[]; email: string; code: string }) => {
      try {
        const client = new RemoteSkillsAuthClient(getApiUrl("Create API key"));
        const created = await client.createApiKey(options.email, options.code, name, options.scope.length ? options.scope : undefined);
        console.log(JSON.stringify(created, null, 2));
      } catch (error) { writeCommandError(error, "Failed to create API key", options.json); }
    });
  keys.command("revoke").argument("<key-id>").option("--json", "Output as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .action(async (id: string, options: { json: boolean; email: string; code: string }) => {
      try { console.log(JSON.stringify(await new RemoteSkillsAuthClient(getApiUrl("Revoke API key")).revokeApiKey(options.email, options.code, id), null, 2)); }
      catch (error) { writeCommandError(error, "Failed to revoke API key", options.json); }
    });

  auth
    .command("login")
    .description("Sign in with browser/device code or email code")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .option("--api-key <key>", "Verify and store an API key")
    .option("--device", "Use browser/device-code login", false)
    .option("--no-open", "Do not open a browser for device-code login")
    .option("--poll", "Poll until browser authentication completes in non-interactive mode", false)
    .option("--poll-timeout-ms <ms>", "Maximum time to wait for device-code login")
    .option("--json", "Output result as JSON", false)
    .action(async (options: { email?: string; code?: string; apiKey?: string; device?: boolean; open?: boolean; poll?: boolean; pollTimeoutMs?: string; json?: boolean }) => {
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
        const existing = getAuthConfig();
        if (existing) {
          console.log(chalk.dim(`Already signed in as ${existing.email}`));
          const again = await prompt("Sign in with a different account? (y/N) ");
          if (again.toLowerCase() !== "y") return;
        }
        email = await prompt(chalk.bold("Email: "));
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
        const existing = getAuthConfig();
        if (existing) {
          console.log(chalk.dim(`Already signed in as ${existing.email}`));
          const again = await prompt("Continue with a different account? (y/N) ");
          if (again.toLowerCase() !== "y") return;
        }
        email = await prompt(chalk.bold("Email: "));
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
    .description("Remove this profile's stored credentials; injected keys remain configured")
    .option("--json", "Output as JSON", false)
    .action((options: { json?: boolean }) => {
      const { stillResolves } = clearAuthConfig();
      if (options.json) console.log(JSON.stringify({ status: stillResolves ? "credential_still_configured" : "signed_out", stillResolves }));
      else console.log(stillResolves
        ? "Stored credential removed. A credential is still configured by the environment, profile selection, or Keychain; clear it there to finish signing out."
        : "Signed out; this profile has no stored credential.");
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
