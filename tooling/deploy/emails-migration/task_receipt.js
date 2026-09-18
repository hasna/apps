import { createHash, timingSafeEqual } from "node:crypto";

const canonicalValue = (value) => Array.isArray(value)
  ? value.map(canonicalValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
    : value;
const canonical = (value) => JSON.stringify(canonicalValue(value));
const sha256 = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const requiredHash = (name) => {
  const value = process.env[name]?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be a sha256`);
  return value;
};
const emit = (value) => process.stdout.write(`EMAILS_MIGRATION_RECEIPT:${canonical(value)}\n`);
const operation = process.env.EMAILS_MIGRATION_OPERATION?.trim();

if (operation === "kms") {
  const proofId = requiredHash("EMAILS_MIGRATION_PROOF_ID");
  const { buildProviderRootKms } = await import("./src/server/self-hosted/provider-root-kms.ts");
  const kms = buildProviderRootKms();
  if (!kms) throw new Error("Managed provider KMS is not configured");
  const context = { app: "emails", tenant: `deploy-${proofId.slice(0, 24)}`, root: `proof-${proofId.slice(24, 48)}`, purpose: "provider-root" };
  const generated = await kms.generate(context, AbortSignal.timeout(30_000));
  let decrypted;
  try {
    decrypted = await kms.decrypt(generated.ciphertext, context, AbortSignal.timeout(30_000));
    if (generated.plaintext.length !== 32 || decrypted.length !== 32 || !timingSafeEqual(generated.plaintext, decrypted)) {
      throw new Error("Managed provider KMS round trip mismatch");
    }
    emit({ schema: "emails.migration-kms-proof.v1", configured: true, roundTrip: true, keyMaterialEmitted: false, proofId });
  } finally {
    generated.plaintext.fill(0);
    decrypted?.fill(0);
  }
} else if (operation === "plan" || operation === "apply") {
  const [{ getSelfHostedPool, closeSelfHostedPool }, { emailsSelfHostedMigrations }, { MigrationLedger, migrationAcceptsChecksum }] = await Promise.all([
    import("./src/server/self-hosted/env.ts"),
    import("./src/server/self-hosted/migrations.ts"),
    import("./src/storage-kit/index.ts"),
  ]);
  const migrations = emailsSelfHostedMigrations();
  const migrationById = new Map(migrations.map((migration) => [migration.id, migration]));
  const { client } = getSelfHostedPool();
  const snapshot = async (reader) => {
    const rows = await reader.many("SELECT id, checksum FROM schema_migrations ORDER BY id ASC");
    const ledger = rows.map((row) => ({ id: String(row.id), checksum: String(row.checksum) }));
    const applied = new Map(ledger.map((row) => [row.id, row.checksum]));
    for (const row of ledger) {
      const migration = migrationById.get(row.id);
      if (!migration) throw new Error(`Unknown production migration: ${row.id}`);
      if (!migrationAcceptsChecksum(migration, row.checksum)) throw new Error(`Production migration checksum drift: ${row.id}`);
    }
    const plan = migrations.map((migration) => ({
      id: migration.id,
      checksum: migration.checksum,
      state: applied.has(migration.id) ? "already_applied" : "pending",
    }));
    const expectedAfterLedger = migrations.map((migration) => ({
      id: migration.id,
      checksum: applied.get(migration.id) ?? migration.checksum,
    })).sort((a, b) => a.id.localeCompare(b.id));
    return {
      ledger,
      ledgerSha256: sha256(ledger),
      plan,
      planSha256: sha256({ plan, expectedAfterLedger }),
      expectedAfterLedger,
      expectedAfterLedgerSha256: sha256(expectedAfterLedger),
    };
  };
  try {
    if (operation === "plan") {
      const before = await snapshot(client);
      emit({ schema: "emails.migration-production-plan.v1", operation, ...before, databaseMutated: false });
    } else {
      const expectedLedger = requiredHash("EMAILS_MIGRATION_EXPECTED_LEDGER_SHA256");
      const expectedPlan = requiredHash("EMAILS_MIGRATION_EXPECTED_PLAN_SHA256");
      const expectedAfter = requiredHash("EMAILS_MIGRATION_EXPECTED_AFTER_LEDGER_SHA256");
      const receipt = await client.transaction(async (tx) => {
        // Block competing ledger access after lock acquisition while the
        // reviewed plan, schema changes, and ledger rows commit together.
        // A separate cutover guard must first drain old API/worker writers.
        await tx.execute("LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE");
        const before = await snapshot(tx);
        if (before.ledgerSha256 !== expectedLedger || before.planSha256 !== expectedPlan || before.expectedAfterLedgerSha256 !== expectedAfter) {
          throw new Error("Production migration plan changed after review");
        }
        const pending = before.plan.filter((row) => row.state === "pending").map((row) => row.id);
        const ledger = new MigrationLedger(tx, migrations);
        await ledger.migrate();
        const after = await snapshot(tx);
        if (after.ledgerSha256 !== expectedAfter || after.plan.some((row) => row.state !== "already_applied")) {
          throw new Error("Production migration ledger did not reach the reviewed target");
        }
        return {
        schema: "emails.migration-production-applied.v1",
        operation,
        beforeLedger: before.ledger,
        beforeLedgerSha256: before.ledgerSha256,
        plan: before.plan,
        planSha256: before.planSha256,
        appliedMigrationIds: pending,
        afterLedger: after.ledger,
        afterLedgerSha256: after.ledgerSha256,
        databaseMutated: pending.length > 0,
        automaticRollback: false,
        };
      });
      emit(receipt);
    }
  } finally {
    await closeSelfHostedPool();
  }
} else {
  throw new Error("Unsupported Emails migration operation");
}
