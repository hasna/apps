import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AMBIENT_APP_ROUTING_NAMES = [
  "DATABASE_URL",
  "APP_API_URL", "APP_API_KEY",
  "HASNA_TODOS_DATABASE_URL", "HASNA_TODOS_DATABASE_URL_OWNER",
  "TODOS_DATABASE_URL", "TODOS_DATABASE_URL_OWNER",
  "HASNA_TODOS_API_URL", "HASNA_TODOS_API_KEY",
  "TODOS_API_URL", "TODOS_API_KEY", "TODOS_API", "TODOS_URL", "TODOS_V1_BASE_URL", "TODOS_V1_TOKEN",
  "HASNA_TODOS_API_SIGNING_KEY", "TODOS_API_SIGNING_KEY", "HASNA_TODOS_SIGNING_KEY", "TODOS_SIGNING_KEY",
  "HASNA_TODOS_STORAGE_MODE", "HASNA_TODOS_MODE", "TODOS_STORAGE_MODE", "TODOS_MODE",
  "HASNA_TODOS_DB_PATH", "TODOS_DB_PATH",
  "HASNA_CONVERSATIONS_DATABASE_URL", "HASNA_CONVERSATIONS_DATABASE_URL_OWNER",
  "CONVERSATIONS_DATABASE_URL", "CONVERSATIONS_DATABASE_URL_OWNER",
  "HASNA_CONVERSATIONS_API_URL", "HASNA_CONVERSATIONS_API_KEY",
  "CONVERSATIONS_API_URL", "CONVERSATIONS_API_KEY",
  "HASNA_CONVERSATIONS_API_SIGNING_KEY", "CONVERSATIONS_API_SIGNING_KEY",
  "HASNA_CONVERSATIONS_STORAGE_MODE", "HASNA_CONVERSATIONS_MODE",
  "CONVERSATIONS_STORAGE_MODE", "CONVERSATIONS_MODE",
  "HASNA_CONVERSATIONS_DB_PATH", "CONVERSATIONS_DB_PATH",
  "HASNA_API_SIGNING_KEY", "API_KEY_SIGNING_SECRET",
] as const;

async function writeExecutable(path: string, lines: string[]): Promise<void> {
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  await chmod(path, 0o700);
}

test("dual-HTTP wrapper strips every supported ambient app route and credential before Bun", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "todos-incident-publisher-safety-"));
  const logPath = join(binDir, "calls.log");
  try {
    await writeExecutable(join(binDir, "createdb"), [
      "#!/usr/bin/env bash",
      'printf "createdb|%s\\n" "$*" >> "$TODOS_INCIDENT_PUBLISHER_TEST_SPY_LOG"',
    ]);
    await writeExecutable(join(binDir, "dropdb"), [
      "#!/usr/bin/env bash",
      'printf "dropdb|%s\\n" "$*" >> "$TODOS_INCIDENT_PUBLISHER_TEST_SPY_LOG"',
    ]);
    await writeExecutable(join(binDir, "psql"), [
      "#!/usr/bin/env bash",
      'printf "psql|%s\\n" "$*" >> "$TODOS_INCIDENT_PUBLISHER_TEST_SPY_LOG"',
      'printf "0\\n"',
    ]);
    await writeExecutable(join(binDir, "bun"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "ambient_count=0",
      `for ambient_name in ${AMBIENT_APP_ROUTING_NAMES.join(" ")}; do`,
      '  if [[ -n "${!ambient_name-}" ]]; then',
      '    ambient_count=$((ambient_count + 1))',
      '    printf "ambient-set|%s\\n" "$ambient_name" >> "$TODOS_INCIDENT_PUBLISHER_TEST_SPY_LOG"',
      "  fi",
      "done",
      'printf "bun|ambient=%s|db=%s|contract=%s|args=%s\\n" "$ambient_count" "${TODOS_INCIDENT_PUBLISHER_TEST_DATABASE_URL-}" "${TODOS_INCIDENT_CONVERSATIONS_CONTRACT_DIR-}" "$*" >> "$TODOS_INCIDENT_PUBLISHER_TEST_SPY_LOG"',
      '[[ "$ambient_count" == "0" ]]',
    ]);

    const hostileRouting = Object.fromEntries(
      AMBIENT_APP_ROUTING_NAMES.map((name) => [name, "synthetic-hostile-routing-marker"]),
    );
    const child = Bun.spawn(["bash", "scripts/verify-incident-publisher-postgres.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...hostileRouting,
        PGHOST: "remote.invalid",
        PGHOSTADDR: "203.0.113.8",
        PGPORT: "6543",
        PGUSER: "remote-user",
        PGPASSWORD: "synthetic-hostile-password-marker",
        PGSERVICE: "remote-service",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        TODOS_INCIDENT_PUBLISHER_TEST_BUN_BIN: join(binDir, "bun"),
        TODOS_INCIDENT_PUBLISHER_TEST_DB_USER: "fixture-user",
        TODOS_INCIDENT_PUBLISHER_TEST_SPY_LOG: logPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const callLog = await readFile(logPath, "utf8");
    expect(exitCode, `${stdout}\n${stderr}\n${callLog}`).toBe(0);
    expect(`${stdout}\n${stderr}`).toContain(
      "incident publisher dual-HTTP PostgreSQL verification passed; residual databases=0",
    );
    expect(`${stdout}\n${stderr}`).not.toContain("synthetic-hostile");

    const calls = callLog.trim().split("\n");
    expect(calls).toHaveLength(5);
    expect(calls[0]).toMatch(
      /^createdb\|--host=127\.0\.0\.1 --port=5432 --username=fixture-user todos_incident_e00050_[0-9]+_[0-9]+$/,
    );
    expect(calls[1]).toMatch(
      /^psql\|--host=127\.0\.0\.1 --port=5432 --username=fixture-user --dbname=todos_incident_e00050_[0-9]+_[0-9]+ -Xv ON_ERROR_STOP=1 -c ALTER DATABASE "todos_incident_e00050_[0-9]+_[0-9]+" SET timezone TO 'Europe\/Bucharest'$/,
    );
    expect(calls[2]).toMatch(
      /^bun\|ambient=0\|db=postgresql:\/\/fixture-user@127\.0\.0\.1:5432\/todos_incident_e00050_[0-9]+_[0-9]+\|contract=\/home\/hasna\/\.hasna\/repos\/worktrees\/station01\/open-conversations\/[^|]+\|args=--no-env-file test src\/incidents\/outbox-publisher\.integration\.test\.ts$/,
    );
    expect(calls[3]).toMatch(
      /^dropdb\|--host=127\.0\.0\.1 --port=5432 --username=fixture-user --if-exists --force todos_incident_e00050_[0-9]+_[0-9]+$/,
    );
    expect(calls[4]).toContain("psql|--host=127.0.0.1 --port=5432 --username=fixture-user --dbname=postgres");
    expect(calls.join("\n")).not.toContain("synthetic-hostile");
  } finally {
    await rm(binDir, { recursive: true, force: true });
  }
});
