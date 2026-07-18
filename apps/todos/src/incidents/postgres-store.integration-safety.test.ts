import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function writeExecutable(path: string, lines: string[]): Promise<void> {
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  await chmod(path, 0o700);
}

async function runWrapper(binDir: string, logPath: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(["bash", "scripts/verify-incident-postgres.sh"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      TODOS_INCIDENT_TEST_BUN_BIN: join(binDir, "bun"),
      TODOS_INCIDENT_TEST_DB_USER: "fixture-user",
      TODOS_INCIDENT_TEST_SPY_LOG: logPath,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

const spyEnvironment = [
  'printf "%s|%s|PGHOST=%s|PGHOSTADDR=%s|PGPORT=%s|PGSERVICE=%s|PGSERVICEFILE=%s|PGUSER=%s|PGPASSWORD=%s|PGPASSFILE=%s\\n"',
  '"$1" "$2" "${PGHOST-}" "${PGHOSTADDR-}" "${PGPORT-}" "${PGSERVICE-}" "${PGSERVICEFILE-}" "${PGUSER-}" "${PGPASSWORD-}" "${PGPASSFILE-}"',
  '>> "$TODOS_INCIDENT_TEST_SPY_LOG"',
].join(" ");

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

test("PostgreSQL wrapper pins every command and Bun child despite hostile libpq target state", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "todos-incident-pg-spy-"));
  const logPath = join(binDir, "calls.log");
  try {
    await writeExecutable(join(binDir, "createdb"), [
      "#!/usr/bin/env bash",
      `set -- createdb "$*"`,
      spyEnvironment,
    ]);
    await writeExecutable(join(binDir, "dropdb"), [
      "#!/usr/bin/env bash",
      `set -- dropdb "$*"`,
      spyEnvironment,
    ]);
    await writeExecutable(join(binDir, "psql"), [
      "#!/usr/bin/env bash",
      `set -- psql "$*"`,
      spyEnvironment,
      'printf "0\\n"',
    ]);
    await writeExecutable(join(binDir, "bun"), [
      "#!/usr/bin/env bash",
      `set -- bun "$* URL=\${TODOS_INCIDENT_TEST_DATABASE_URL-}"`,
      spyEnvironment,
    ]);

    const result = await runWrapper(binDir, logPath, {
      PGHOST: "remote.invalid",
      PGHOSTADDR: "203.0.113.8",
      PGPORT: "6543",
      PGSERVICE: "wrong-service",
      PGSERVICEFILE: "/tmp/wrong-service-file",
      PGUSER: "wrong-user",
      PGPASSWORD: "pw-marker",
      PGPASSFILE: "/tmp/wrong-pass-file",
    });
    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "incident PostgreSQL verification passed; rollback residual tables=0",
    );

    const calls = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatch(
      /^createdb\|--host=127\.0\.0\.1 --port=5432 --username=fixture-user todos_incident_ee2ecad7_[0-9]+_[0-9]+\|/,
    );
    expect(calls[1]).toMatch(
      /^bun\|test src\/incidents\/postgres-store\.integration\.test\.ts URL=postgresql:\/\/fixture-user@127\.0\.0\.1:5432\/todos_incident_ee2ecad7_[0-9]+_[0-9]+\|/,
    );
    expect(calls[2]).toMatch(
      /^psql\|--host=127\.0\.0\.1 --port=5432 --username=fixture-user --dbname=todos_incident_ee2ecad7_[0-9]+_[0-9]+ -XAtqc /,
    );
    expect(calls[3]).toMatch(
      /^dropdb\|--host=127\.0\.0\.1 --port=5432 --username=fixture-user --if-exists todos_incident_ee2ecad7_[0-9]+_[0-9]+\|/,
    );
    for (const call of calls) {
      expect(call).toMatch(
        /\|PGHOST=\|PGHOSTADDR=\|PGPORT=\|PGSERVICE=\|PGSERVICEFILE=\|PGUSER=\|PGPASSWORD=\|PGPASSFILE=\/tmp\/[^|]+$/,
      );
    }
    const pgpassFile = calls[0]!.match(/PGPASSFILE=([^|]+)$/)?.[1];
    expect(pgpassFile).toBeTruthy();
    expect(await Bun.file(pgpassFile!).exists()).toBe(false);
  } finally {
    await rm(binDir, { recursive: true, force: true });
  }
});

test("PostgreSQL wrapper never drops a collision database that this run did not create", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "todos-incident-pg-collision-"));
  const logPath = join(binDir, "calls.log");
  try {
    await writeExecutable(join(binDir, "createdb"), [
      "#!/usr/bin/env bash",
      `set -- createdb "$*"`,
      spyEnvironment,
      "exit 1",
    ]);
    for (const command of ["dropdb", "psql", "bun"]) {
      await writeExecutable(join(binDir, command), [
        "#!/usr/bin/env bash",
        `set -- unexpected-${command} "$*"`,
        spyEnvironment,
        "exit 99",
      ]);
    }

    const result = await runWrapper(binDir, logPath);
    expect(result.exitCode).not.toBe(0);
    const calls = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^createdb\|--host=127\.0\.0\.1 --port=5432 --username=fixture-user /);
    expect(calls[0]).not.toContain("unexpected-dropdb");
  } finally {
    await rm(binDir, { recursive: true, force: true });
  }
});
