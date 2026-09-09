import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPrepublishTestEnv } from "./prepublish-local-test.mjs";

describe("canonical prepublish test isolation", () => {
  test("requires an explicit isolated home instead of inheriting operator state", () => {
    expect(() => buildPrepublishTestEnv({ HOME: "/operator/home" }, undefined)).toThrow();
    expect(() => buildPrepublishTestEnv({}, "relative-home")).toThrow();
  });

  test("does not force a retired selector or inherit any operator configuration", () => {
    const isolatedHome = join(tmpdir(), "emails-test-home");
    const operator = {
      HOME: "/operator/home", USERPROFILE: "/operator/home", PATH: "/test/bin", CI: "1",
      EMAILS_MODE: "local", EMAILS_DB_PATH: ":memory:", HASNA_EMAILS_MODE: "local",
      HASNA_EMAILS_DB_PATH: "/operator/db", EMAILS_DATABASE_URL: "operator-database",
      HASNA_EMAILS_API_URL: "https://emails.example.test", HASNA_EMAILS_API_KEY: "synthetic-api-key",
      EMAILS_SELF_HOSTED_URL: "https://emails.example.test", EMAILS_SELF_HOSTED_API_KEY: "synthetic-api-key",
      EMAILS_CLIENT_ENV_SECRET: "synthetic/client-env", EMAILS_SESSION_TOKEN: "synthetic-session",
      EMAILS_IDP_TOKEN: "synthetic-idp", MAILERY_MODE: "local", HASNA_MAILERY_API_URL: "https://legacy.example.test",
      HASNA_DATA_HOME: "/operator/data", HASNA_EMAILS_HOME: "/operator/emails", EMAILS_HOME: "/operator/legacy",
      XDG_DATA_HOME: "/operator/xdg", XDG_CONFIG_HOME: "/operator/config", XDG_STATE_HOME: "/operator/state",
      AWS_PROFILE: "operator", AWS_ACCESS_KEY_ID: "synthetic-aws-key", AWS_SECRET_ACCESS_KEY: "synthetic-aws-secret",
      AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://metadata.example.test", RESEND_API_KEY: "synthetic-resend",
      DATABASE_URL: "operator-database", PGHOST: "operator-database", NODE_OPTIONS: "--require operator-preload",
      npm_config_userconfig: "/operator/.npmrc", EMAILS_JSON_OUTPUT: "1", UNRECOGNIZED_SECRET: "synthetic-value",
    };
    const before = { ...operator };
    const env = buildPrepublishTestEnv(operator, isolatedHome);
    for (const key of Object.keys(operator)) {
      if (["HOME", "USERPROFILE", "PATH", "CI", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "npm_config_userconfig"].includes(key)) continue;
      expect((env as Record<string, string>)[key]).toBeUndefined();
    }
    expect(env.HOME).toBe(isolatedHome);
    expect(env.USERPROFILE).toBe(isolatedHome);
    expect(env.XDG_DATA_HOME).toBe(join(isolatedHome, "data"));
    expect(env.XDG_CONFIG_HOME).toBe(join(isolatedHome, "config"));
    expect(env.XDG_CACHE_HOME).toBe(join(isolatedHome, "cache"));
    expect(env.XDG_STATE_HOME).toBe(join(isolatedHome, "state"));
    expect(env.TMPDIR).toBe(join(isolatedHome, "tmp"));
    expect(env.npm_config_userconfig).toBe(join(isolatedHome, ".npmrc"));
    expect(env.AWS_EC2_METADATA_DISABLED).toBe("true");
    expect(env.PATH).toBe("/test/bin");
    expect(env.CI).toBe("1");
    expect(operator).toEqual(before);
  });
});


test("the actual runner creates private fixture directories under a group-writable umask", () => {
  const fixture = mkdtempSync(join(tmpdir(), "emails-runner-permissions-"));
  try {
    mkdirSync(join(fixture, "tmp"), { mode: 0o700 });
    const file = join(fixture, "permissions.test.ts");
    writeFileSync(file, `import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
test("private fixture directories", () => {
  for (const name of ["config", "data", "cache", "state", "tmp"]) {
    expect(statSync(join(process.env.HOME!, name)).mode & 0o777).toBe(0o700);
  }
});`);
    const result = spawnSync(process.execPath, ["-e", `
      process.umask(0o002);
      const result = Bun.spawnSync([process.execPath, ${JSON.stringify(join(import.meta.dir, "prepublish-local-test.mjs"))}, ${JSON.stringify(file)}], { stdout: "pipe", stderr: "pipe" });
      process.stdout.write(result.stdout); process.stderr.write(result.stderr);
      process.exit(result.exitCode);
    `], { encoding: "utf8", env: buildPrepublishTestEnv(process.env, fixture) });
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});


test("the actual runner canonicalizes a symlinked temporary root before filesystem tests", () => {
  const fixture = mkdtempSync(join(tmpdir(), "emails-runner-canonical-"));
  try {
    const target = join(fixture, "target"); mkdirSync(target, { mode: 0o700 });
    const alias = join(fixture, "alias"); symlinkSync(target, alias, "dir");
    const file = join(fixture, "canonical.test.ts");
    writeFileSync(file, `import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
test("canonical isolated paths", () => {
  for (const key of ["HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]) {
    expect(process.env[key]).toBe(realpathSync(process.env[key]!));
  }
});`);
    const result = spawnSync(process.execPath, [join(import.meta.dir, "prepublish-local-test.mjs"), file], {
      encoding: "utf8", timeout: 15000,
      env: { ...buildPrepublishTestEnv(process.env, fixture), TMPDIR: alias, TEMP: alias, TMP: alias },
    });
    expect(result.status, result.stderr).toBe(0);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
