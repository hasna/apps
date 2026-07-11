import {
  E2BRunnerPendingV1,
  SandboxesReferenceServiceV1,
  providerCreationTokenDigest,
  providerIdempotencyTokenDigest,
} from "@hasna/sandboxes";
import { PostgresSandboxRepositoryV1 } from "@hasna/sandboxes/postgres";
import { createE2bAdapter } from "@hasna/sandboxes/managed";

for (const exported of [
  SandboxesReferenceServiceV1,
  PostgresSandboxRepositoryV1,
  providerCreationTokenDigest,
  providerIdempotencyTokenDigest,
  createE2bAdapter,
]) {
  if (typeof exported !== "function") throw new Error("packed SDK export is unreachable");
}
const descriptor = await new E2BRunnerPendingV1().descriptor();
if (descriptor.status !== "pending_conformance") {
  throw new Error("packed managed adapter did not remain fail-closed");
}
