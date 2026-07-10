import {
  E2BRunnerPendingV1,
  SandboxesReferenceServiceV1,
  providerCreationTokenDigest,
  providerIdempotencyTokenDigest,
} from "@hasna/sandboxes";
import { PostgresSandboxRepositoryV1 } from "@hasna/sandboxes/postgres";

for (const exported of [
  SandboxesReferenceServiceV1,
  PostgresSandboxRepositoryV1,
  providerCreationTokenDigest,
  providerIdempotencyTokenDigest,
]) {
  if (typeof exported !== "function") throw new Error("packed SDK export is unreachable");
}
const descriptor = await new E2BRunnerPendingV1().descriptor();
if (descriptor.status !== "pending_conformance") {
  throw new Error("packed managed adapter did not remain fail-closed");
}
