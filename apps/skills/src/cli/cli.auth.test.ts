import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCliInCwd } from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("CLI server auth", () => {

  test("auth whoami accepts an env credential without storing or exposing the key", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-whoami-api-key-"));
    const seenAuthHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/whoami" && req.method === "GET") {
          seenAuthHeaders.push(req.headers.get("authorization"));
          return Response.json({
            user: { id: "user_env", email: "env@example.com", role: "owner" },
            organization: { id: "org_env", slug: "env-org", name: "Env Org" },
          });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const env = {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "sk_env_whoami",
      };

      const result = await runCliInCwd(["auth", "whoami", "--json"], tmpDir, env);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        status: "authenticated",
        // The SOURCE, by name: an operator debugging a stale export needs to see
        // which rung of the ladder answered, never the value.
        authSource: "SKILLS_API_KEY",
        email: "env@example.com",
        organization: "env-org",
        organizationName: "Env Org",
        role: "owner",
      });
      expect(result.stdout).not.toContain("sk_env_whoami");
      expect(seenAuthHeaders).toEqual(["Bearer sk_env_whoami"]);
      expect(existsSync(join(tmpDir, ".hasna", "skills", "config", "credentials"))).toBe(false);
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("auth login --api-key verifies and stores a server key without echoing it", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-api-key-login-"));
    const seenAuthHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/whoami" && req.method === "GET") {
          seenAuthHeaders.push(req.headers.get("authorization"));
          return Response.json({
            user: { id: "user_key", email: "key@example.com", role: "owner" },
            organization: { id: "org_key", slug: "key-org", name: "Key Org" },
          });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const apiKey = "sk_server_login";
      const result = await runCliInCwd(["auth", "login", "--api-key", apiKey, "--json"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: "authenticated",
        authSource: "stored",
        email: "key@example.com",
        organization: "key-org",
      });
      expect(result.stdout).not.toContain(apiKey);
      expect(seenAuthHeaders).toEqual([`Bearer ${apiKey}`]);

      // Stored in the shared credentials file the whole fleet reads, owner-only,
      // with the display identity beside it rather than inside it.
      const credentialsPath = join(tmpDir, ".hasna", "skills", "config", "credentials");
      expect(readFileSync(credentialsPath, "utf8")).toContain(`HASNA_SKILLS_API_KEY=${apiKey}`);
      expect(statSync(credentialsPath).mode & 0o077).toBe(0);
      const identityPath = join(tmpDir, ".hasna", "skills", "config", "identity.json");
      expect(JSON.parse(readFileSync(identityPath, "utf8"))).toMatchObject({
        email: "key@example.com",
        orgSlug: "key-org",
      });
      expect(readFileSync(identityPath, "utf8")).not.toContain(apiKey);
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("the credentials file outranks a stale export, and identity follows the key that was used", async () => {
    // The inversion the shared ladder exists for: a shell that outlived a key
    // rotation holds a stale `export`, while the file on disk is current. Disk
    // therefore beats env — and the recorded identity is shown only because the
    // key in effect is the one this CLI stored.
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-whoami-disk-over-env-"));
    const configDir = join(tmpDir, ".hasna", "skills", "config");
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(configDir, "credentials"), "HASNA_SKILLS_API_KEY=stored_fixture_key\n", { mode: 0o600 });
    writeFileSync(join(configDir, "identity.json"), JSON.stringify({
      email: "stored@example.com",
      orgId: "org_stored",
      orgSlug: "stored-org",
      userId: "user_stored",
    }), { mode: 0o600 });

    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/whoami" && req.method === "GET") {
          expect(req.headers.get("authorization")).toBe("Bearer stored_fixture_key");
          return Response.json({
            user: { role: "member" },
            organization: { name: "Stored Org" },
          });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      writeFileSync(join(configDir, "credentials"), `HASNA_SKILLS_API_KEY=stored_fixture_key\nHASNA_SKILLS_API_URL=http://127.0.0.1:${server.port}\n`, { mode: 0o600 });
      const result = await runCliInCwd(["auth", "whoami", "--json"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "stale_exported_key",
      });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        status: "authenticated",
        authSource: join(configDir, "credentials"),
        role: "member",
        organizationName: "Stored Org",
        email: "stored@example.com",
      });
      // Never a value, from any tier.
      expect(result.stdout).not.toContain("stored_fixture_key");
      expect(result.stdout).not.toContain("stale_exported_key");
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("an env credential never borrows the stored identity of a different key", async () => {
    // identity.json describes the credential THIS CLI wrote. With that credential
    // gone and a key coming from the environment, showing the recorded email
    // would attribute one principal's session to another's account.
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-whoami-env-no-stale-identity-"));
    const configDir = join(tmpDir, ".hasna", "skills", "config");
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(configDir, "identity.json"), JSON.stringify({
      email: "stored@example.com",
      orgSlug: "stored-org",
    }), { mode: 0o600 });

    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/whoami" && req.method === "GET") {
          expect(req.headers.get("authorization")).toBe("Bearer env_fixture_key");
          return Response.json({ user: { role: "member" }, organization: { name: "Env Org" } });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const result = await runCliInCwd(["auth", "whoami", "--json"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "env_fixture_key",
      });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toMatchObject({
        status: "authenticated",
        authSource: "SKILLS_API_KEY",
        role: "member",
        organizationName: "Env Org",
      });
      expect(result.stdout).not.toContain("stored@example.com");
      expect(result.stdout).not.toContain("stored-org");
      expect(result.stdout).not.toContain("env_fixture_key");
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("device login stores credentials for the Skills API", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-device-auth-"));
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/device/start" && req.method === "POST") {
          return Response.json({
            deviceCode: "device_secret",
            userCode: "ABCD-EFGH",
            verificationUri: `${url.origin}/auth/device`,
            verificationUriComplete: `${url.origin}/auth/device?code=ABCD-EFGH`,
            expiresIn: 900,
            interval: 1,
          }, { status: 201 });
        }

        if (url.pathname === "/api/auth/device/token" && req.method === "POST") {
          return Response.json({
            token: "jwt_device",
            apiKey: "sk_device_login",
            user: { id: "user_1", email: "user@example.com", displayName: null, role: "owner" },
            organization: { id: "org_1", slug: "user", name: "User" },
            firstLogin: false,
          });
        }

        return Response.json({ error: `missing route ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const env = {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      };
      const login = await runCliInCwd([
        "auth",
        "login",
        "--device",
        "--poll",
        "--poll-timeout-ms",
        "1000",
        "--no-open",
        "--json",
      ], tmpDir, env);
      expect(login.exitCode).toBe(0);
      expect(JSON.parse(login.stdout)).toMatchObject({
        status: "authenticated",
        email: "user@example.com",
        organization: "user",
      });

      const credentialsPath = join(tmpDir, ".hasna", "skills", "config", "credentials");
      expect(existsSync(credentialsPath)).toBe(true);
      expect(statSync(credentialsPath).mode & 0o077).toBe(0);
      expect(readFileSync(credentialsPath, "utf8")).toContain("HASNA_SKILLS_API_KEY=sk_device_login");
      expect(JSON.parse(readFileSync(join(tmpDir, ".hasna", "skills", "config", "identity.json"), "utf8"))).toMatchObject({
        email: "user@example.com",
        orgSlug: "user",
      });
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("email sign-in failures report status, endpoint and a condensed body (issue #24)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-signup-opaque-error-"));
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "Something went wrong!" }, { status: 500 }),
    });

    try {
      const apiUrl = `http://127.0.0.1:${server.port}`;
      const result = await runCliInCwd(["auth", "signup", "--email", "me@example.com"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: apiUrl,
      });

      expect(result.exitCode).not.toBe(0);
      // The server message must survive, but never on its own: a bare
      // "Something went wrong!" leaves users with nothing to act on.
      expect(result.stderr).toContain("Something went wrong!");
      expect(result.stderr).toContain("500");
      expect(result.stderr).toContain(`POST ${apiUrl}/api/auth/login`);
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("email sign-in condenses non-JSON error pages instead of dumping them (issue #24)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-signup-html-error-"));
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(
        "<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head>\n<body>\n<h1>Something went wrong!</h1>\n<p>noise</p>\n</body></html>",
        { status: 502, headers: { "content-type": "text/html" } },
      ),
    });

    try {
      const result = await runCliInCwd(["auth", "signup", "--email", "me@example.com"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Something went wrong!");
      expect(result.stderr).toContain("502");
      expect(result.stderr).not.toContain("<!DOCTYPE html>");
      expect(result.stderr).not.toContain("<h1>");
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("email sign-in against an API without email routes points at SKILLS_API_URL (issue #24)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-signup-wrong-api-"));
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "authentication required", code: "AUTH_REQUIRED" }, { status: 401 }),
    });

    try {
      const result = await runCliInCwd(["auth", "signup", "--email", "me@example.com"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("401");
      expect(result.stderr).toContain("SKILLS_API_URL");
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("unreachable API errors name the endpoint that could not be reached (issue #24)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-signup-unreachable-"));
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const port = server.port;
    server.stop(true);

    try {
      const result = await runCliInCwd(["auth", "signup", "--email", "me@example.com"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${port}`,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`http://127.0.0.1:${port}/api/auth/login`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("--json auth failures carry the endpoint and status machine-readably (issue #24)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-json-endpoint-"));
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "Something went wrong!" }, { status: 500 }),
    });

    try {
      const apiUrl = `http://127.0.0.1:${server.port}`;
      const result = await runCliInCwd(["auth", "login", "--email", "me@example.com", "--json"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: apiUrl,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: "Something went wrong!",
        status: 500,
        endpoint: `POST ${apiUrl}/api/auth/login`,
      });
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("an API URL carrying embedded credentials is refused, and never echoed (issue #24)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-endpoint-redaction-"));
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "Something went wrong!" }, { status: 500 }),
    });

    try {
      const credentialedApiUrl = new URL(`http://127.0.0.1:${server.port}`);
      credentialedApiUrl.username = "apiuser";
      credentialedApiUrl.password = "pw-not-real";

      const result = await runCliInCwd(["auth", "signup", "--email", "me@example.com"], tmpDir, {
        HOME: tmpDir,
        SKILLS_API_URL: credentialedApiUrl.toString(),
      });

      // The shared authority validator refuses userinfo outright — a URL that
      // carries a password is a credential in a place nothing redacts. Refusing
      // is stronger than redacting it in one message, and no request is sent.
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("credentials");
      expect(result.stderr).not.toContain("pw-not-real");
      expect(result.stderr).not.toContain("apiuser");
      expect(result.stdout).not.toContain("pw-not-real");
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("server auth failures stay structured with --json", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cli-hosted-json-errors-"));
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("temporary outage", { status: 503, statusText: "Unavailable" }),
    });

    try {
      const env = {
        HOME: tmpDir,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: "sk_json_errors",
      };
      for (const args of [
        ["auth", "whoami", "--json"],
        ["auth", "login", "--device", "--json"],
      ]) {
        const result = await runCliInCwd(args, tmpDir, env);
        expect(result.exitCode, args.join(" ")).not.toBe(0);
        expect(result.stderr, args.join(" ")).toBe("");
        const payload = JSON.parse(result.stdout);
        expect(payload).toMatchObject({ error: "temporary outage", status: 503 });
        expect(result.stdout, args.join(" ")).not.toContain("Stack trace");
        expect(result.stdout, args.join(" ")).not.toContain("bin/index.js");
      }
    } finally {
      server.stop(true);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
