import * as managed from "@hasna/sandboxes/managed"
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
} from "@hasna/sandboxes/managed"

const factory: (dependencies: ManagedAdapterDependenciesV1) => ManagedProviderAdapterV1 =
  createE2bAdapter

void factory
void DAYTONA_GUEST_BROKER_PTY_ID
void createDaytonaDenyAllCandidate
void createE2bDenyAllCandidate
void withDaytonaGuestBrokerSdkSession
void withAuthenticatedE2bGuestBrokerDuplexSdkSession
// @ts-expect-error unauthenticated E2B session helper is intentionally not public
void managed.withE2bGuestBrokerSdkSession
// @ts-expect-error raw E2B duplex helper is intentionally not public
void managed.withE2bGuestBrokerDuplexSdkSession
void (undefined as unknown as DaytonaCredentialBoundCreateV1)
void (undefined as unknown as DaytonaOfficialBrokerProcessV1)
void (undefined as unknown as E2bCredentialBoundCreateV1)
void (undefined as unknown as E2bOfficialBrokerCommandsV1)
void (undefined as unknown as GuestBrokerSdkSessionV1)
