import {
  DAYTONA_GUEST_BROKER_PTY_ID,
  createDaytonaDenyAllCandidate,
  createE2bAdapter,
  createE2bDenyAllCandidate,
  withAuthenticatedE2bGuestBrokerDuplexSdkSession,
  withDaytonaGuestBrokerSdkSession,
  type DaytonaCredentialBoundCreateV1,
  type DaytonaOfficialBrokerProcessV1,
  type E2bCredentialBoundCreateV1,
  type E2bOfficialBrokerCommandsV1,
  type GuestBrokerSdkSessionV1,
  type ManagedAdapterDependenciesV1,
  type ManagedProviderAdapterV1,
} from "@hasna/sandboxes"
import {
  authorizePreparedDisposableSandboxTaskV2,
  prepareDisposableSandboxTaskIntentV2,
  type DisposableSandboxTaskAuthorityPortV2,
  type DisposableSandboxTaskIntentV2,
  type DisposableTaskJournalPortV2,
} from "@hasna/sandboxes/managed"
import {
  PostgresDisposableTaskJournalV1,
  PostgresDurableJournalWitnessV1,
  applyPostgresDisposableTaskJournalMigrationV2,
  applyPostgresDurableJournalWitnessMigrationV1,
  type PostgresClientV1,
  type PostgresSessionV1,
} from "@hasna/sandboxes/postgres"

const factory: (dependencies: ManagedAdapterDependenciesV1) => ManagedProviderAdapterV1 =
  createE2bAdapter

void factory
void DAYTONA_GUEST_BROKER_PTY_ID
void createDaytonaDenyAllCandidate
void createE2bDenyAllCandidate
void withAuthenticatedE2bGuestBrokerDuplexSdkSession
void withDaytonaGuestBrokerSdkSession
void (undefined as unknown as DaytonaCredentialBoundCreateV1)
void (undefined as unknown as DaytonaOfficialBrokerProcessV1)
void (undefined as unknown as E2bCredentialBoundCreateV1)
void (undefined as unknown as E2bOfficialBrokerCommandsV1)
void (undefined as unknown as GuestBrokerSdkSessionV1)
void authorizePreparedDisposableSandboxTaskV2
void prepareDisposableSandboxTaskIntentV2
void (undefined as unknown as DisposableSandboxTaskAuthorityPortV2)
void (undefined as unknown as DisposableSandboxTaskIntentV2)
void (undefined as unknown as DisposableTaskJournalPortV2)
void PostgresDisposableTaskJournalV1
void PostgresDurableJournalWitnessV1
void applyPostgresDisposableTaskJournalMigrationV2
void applyPostgresDurableJournalWitnessMigrationV1
void (undefined as unknown as PostgresClientV1)
void (undefined as unknown as PostgresSessionV1)
