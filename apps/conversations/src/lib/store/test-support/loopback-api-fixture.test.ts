import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activateClientEnvironment } from "./client-environment.js";
import { startLoopbackApiFixture } from "./loopback-api-fixture.js";

test("loopback fixture rejects anonymous callers and isolates saved-credential clients", async () => {
  const fixture = await startLoopbackApiFixture();
  try {
    expect((await fetch(`${fixture.url}/v1/channels`)).status).toBe(401);
    expect(fixture.env.HASNA_STATION).toMatch(/^fixture-/);
    expect(fixture.env.HASNA_CONVERSATIONS_API_KEY).toBeUndefined();
    expect(fixture.env.HASNA_CONVERSATIONS_DB_PATH).toBeUndefined();
    expect(existsSync(join(fixture.home, ".hasna", "conversations", "config", "credentials"))).toBe(true);
    expect(fixture.home).not.toBe(fixture.backendHome);
  } finally {
    await fixture.stop();
  }
  expect(existsSync(fixture.root)).toBe(false);
});

test("fixture rejects client database creation and still cleans up", async () => {
  const fixture = await startLoopbackApiFixture();
  writeFileSync(join(fixture.home, "unexpected.sqlite-wal"), "synthetic fixture sentinel");
  await expect(fixture.stop()).rejects.toThrow("unexpectedly created a database artifact");
  expect(existsSync(fixture.root)).toBe(false);
});

test("client fixture excludes inherited provider credentials and restores the caller environment", () => {
  const original = process.env.TELEGRAM_BOT_TOKEN;
  const sentinel = crypto.randomUUID();
  try {
    process.env.TELEGRAM_BOT_TOKEN = sentinel;
    const restore = activateClientEnvironment({});
    try { expect(process.env.TELEGRAM_BOT_TOKEN).toBeUndefined(); }
    finally { restore(); }
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe(sentinel);
  } finally {
    if (original === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = original;
  }
});
