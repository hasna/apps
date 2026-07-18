import { expect, test } from "bun:test";

test("live incident verification refuses a non-task PostgreSQL database before connecting", async () => {
  const child = Bun.spawn([
    process.execPath,
    "test",
    "src/incidents/postgres-store.integration.test.ts",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TODOS_INCIDENT_TEST_ALLOW_TEMP_DATABASE: "1",
      TODOS_INCIDENT_TEST_DATABASE_URL: "postgresql://local-test-user@127.0.0.1:5432/postgres",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).not.toBe(0);
  expect(`${stdout}\n${stderr}`).toContain(
    "Live incident PostgreSQL verification refuses a database outside its task-owned name prefix",
  );
});

test("live incident verification refuses connection-string target overrides before connecting", async () => {
  const child = Bun.spawn([
    process.execPath,
    "test",
    "src/incidents/postgres-store.integration.test.ts",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TODOS_INCIDENT_TEST_ALLOW_TEMP_DATABASE: "1",
      TODOS_INCIDENT_TEST_DATABASE_URL:
        "postgresql://local-test-user@127.0.0.1:5432/todos_incident_ee2ecad7_123_456?host=remote.invalid",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(exitCode).not.toBe(0);
  expect(`${stdout}\n${stderr}`).toContain(
    "Live incident PostgreSQL verification only accepts an unambiguous passwordless local PostgreSQL URL",
  );
});
