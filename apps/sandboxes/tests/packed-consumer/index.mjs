import {
  E2BRunnerPendingV1,
  SandboxesReferenceServiceV1,
  providerCreationTokenDigest,
  providerIdempotencyTokenDigest,
} from "@hasna/sandboxes";
import { PostgresSandboxRepositoryV1 } from "@hasna/sandboxes/postgres";
import * as postgres from "@hasna/sandboxes/postgres";
import {
  E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  createE2bAdapter,
  loadE2bGuestBrokerArtifactV1,
  verifyE2bGuestBrokerArtifactV1,
} from "@hasna/sandboxes/managed";
import * as managed from "@hasna/sandboxes/managed";

for (const exported of [
  SandboxesReferenceServiceV1,
  PostgresSandboxRepositoryV1,
  providerCreationTokenDigest,
  providerIdempotencyTokenDigest,
  createE2bAdapter,
  postgres.PostgresDisposableTaskJournalV1,
  postgres.PostgresDurableJournalWitnessV1,
  postgres.applyPostgresDisposableTaskJournalMigrationV2,
  postgres.loadPostgresDisposableTaskJournalMigrationSourceV1,
  postgres.loadPostgresDisposableTaskJournalMigrationSourceV2,
  postgres.loadPostgresDurableJournalWitnessMigrationSourceV1,
  managed.parseDisposableSandboxTaskRequestV1,
  managed.createEncryptedLocalCheckpointHandoffPortV1,
  managed.disposableSandboxTaskIntentSha256V2,
  managed.prepareDisposableSandboxTaskIntentV2,
  managed.authorizePreparedDisposableSandboxTaskV2,
  managed.dispatchPreparedDisposableSandboxTaskV2,
]) {
  if (typeof exported !== "function") throw new Error("packed SDK export is unreachable");
}
if ("createE2bDisposableSandboxTaskRunnerV1" in managed ||
    "__testOnlyRunDisposableSandboxTaskCandidateV1" in managed ||
    "__testOnlyCreateE2bDisposableSandboxTaskRunnerV1" in managed ||
    "__testOnlyDispatchPreparedDisposableSandboxTaskCandidateV2" in managed) {
  throw new Error("packed managed surface exposed a raw or test-only disposable runner");
}
if (managed.DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V1 !== false) {
  throw new Error("packed disposable task production gate unexpectedly opened");
}
if (managed.DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V2 !== false) {
  throw new Error("packed disposable task v2 production gate unexpectedly opened");
}
if (postgres.POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V2.relative_path !==
    "migrations/disposable-task-journal/0002_disposable_task_intent_v2.sql") {
  throw new Error("packed disposable task v2 migration descriptor is missing or changed");
}
const journalMigrationV1 = postgres.loadPostgresDisposableTaskJournalMigrationSourceV1();
const journalMigrationV2 = postgres.loadPostgresDisposableTaskJournalMigrationSourceV2();
const witnessMigrationV1 = postgres.loadPostgresDurableJournalWitnessMigrationSourceV1();
if (!journalMigrationV1.includes("CREATE TABLE sandboxes_disposable_task_journal.tasks (") ||
    !journalMigrationV2.includes("CREATE TABLE sandboxes_disposable_task_journal.tasks_v2 (") ||
    !witnessMigrationV1.includes("CREATE TABLE sandboxes_durable_journal_witness.heads (")) {
  throw new Error("packed migration sources are unreachable or changed");
}
const descriptor = await new E2BRunnerPendingV1().descriptor();
if (descriptor.status !== "pending_conformance") {
  throw new Error("packed managed adapter did not remain fail-closed");
}
const guestBroker = await loadE2bGuestBrokerArtifactV1();
if (guestBroker.byteLength !== E2B_GUEST_BROKER_ARTIFACT_SIZE_V1 ||
    !verifyE2bGuestBrokerArtifactV1(guestBroker)) {
  throw new Error("packed E2B guest broker artifact is missing or changed");
}
