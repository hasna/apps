import { expect, test } from "bun:test";
import { serverConfig } from "./config.js";

test("hosted runtime defaults to a reachable container bind and requires PostgreSQL and S3", () => {
  const env = { HASNA_TRASH_DATABASE_URL: "postgresql://fixture@localhost/fixture", HASNA_TRASH_API_SIGNING_KEY: "x".repeat(32), HASNA_TRASH_S3_BUCKET: "fixture-bucket", HASNA_TRASH_S3_REGION: "us-east-1" };
  const config = serverConfig([], env);
  expect(config.hostname).toBe("0.0.0.0"); expect(config.port).toBe(8080);
  expect(serverConfig(["--host", "127.0.0.1", "--port", "0"], env).port).toBe(0);
  for (const key of Object.keys(env)) expect(() => serverConfig([], { ...env, [key]: undefined })).toThrow();
  expect(() => serverConfig(["--port", "bad"], env)).toThrow();
  expect(() => serverConfig([], { ...env, HASNA_TRASH_API_SIGNING_KEY: "short" })).toThrow();
});

test("migration requires only an explicit database; malformed args never become startup", () => {
  const config = serverConfig(["migrate"], { HASNA_TRASH_DATABASE_URL: "postgresql://fixture@localhost/fixture" });
  expect(config.command).toBe("migrate");
  expect(() => serverConfig(["unknown"], {})).toThrow();
  expect(() => serverConfig(["migrate"], {})).toThrow();
  expect(() => serverConfig(["--sqlite", "local.db"], {})).toThrow();
});
