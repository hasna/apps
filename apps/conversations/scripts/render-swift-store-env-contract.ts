// Write Sources/HasnaConversationsCore/StoreEnvContract.swift from the
// TypeScript client-flip contract.
//
//     bun run scripts/render-swift-store-env-contract.ts          # print
//     bun run scripts/render-swift-store-env-contract.ts --write  # write the file
//
// The renderer itself lives in src/lib/store/swift-env-contract.ts so that it is
// typechecked and importable by the test that asserts the checked-in Swift file
// still matches it.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderSwiftStoreEnvContract,
  SWIFT_CONTRACT_PATH,
} from "../src/lib/store/swift-env-contract.js";

const rendered = renderSwiftStoreEnvContract();
if (process.argv.includes("--write")) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  writeFileSync(join(repoRoot, SWIFT_CONTRACT_PATH), rendered);
  console.log(`wrote ${SWIFT_CONTRACT_PATH}`);
} else {
  process.stdout.write(rendered);
}
