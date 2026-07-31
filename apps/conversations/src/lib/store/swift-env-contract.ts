// Render the Swift store-env contract from the SAME TypeScript contract the
// runtime resolver uses.
//
// WHY THIS EXISTS. The macOS shell must decide which store the bundled server
// will resolve BEFORE it starts that server, so it has to know the same env-key
// names. Restating them in Swift is how the two drift: the shell read three keys
// while `src/lib/store/index.ts` honoured eight, five of which select the local
// SQLite store — so the shell logged `store=hosted` while the child served local
// data, silently, which is the exact defect the shell exists to prevent.
//
// Swift cannot import TypeScript, so "derive, do not restate" is implemented as
// generate-and-check: this module renders the Swift source, and
// `src/lib/store/swift-env-contract.test.ts` asserts the checked-in file is
// byte-identical to what it renders. That check runs in the EXISTING
// ubuntu-latest CI job, so a change to the key contract that does not reach the
// Swift shell fails CI on Linux without needing a macOS runner.
//
// Regenerate with: bun run scripts/render-swift-store-env-contract.ts --write

import { defaultCloudBaseUrl } from "../contracts-client/transport.js";
import { DEPRECATED_STORAGE_MODE_ALIASES } from "../contracts-client/mode.js";
import { APP, DB_PATH_KEYS, ENV_KEYS } from "./index.js";

/** Repo-relative path of the generated Swift file. */
export const SWIFT_CONTRACT_PATH = "Sources/HasnaConversationsCore/StoreEnvContract.swift";

function swiftStringArray(values: readonly string[], indent: string): string {
  return values.map((v) => `${indent}${JSON.stringify(v)},`).join("\n");
}

/** Render the Swift source for the store-env contract. */
export function renderSwiftStoreEnvContract(): string {
  return `// GENERATED FILE — DO NOT EDIT.
//
// Rendered from the TypeScript client-flip contract by
// scripts/render-swift-store-env-contract.ts. Regenerate with:
//
//     bun run scripts/render-swift-store-env-contract.ts --write
//
// src/lib/store/swift-env-contract.test.ts asserts this file matches the
// contract, so an env-key change that does not reach the macOS shell fails CI on
// Linux — no macOS runner required. Editing this file by hand will be reverted
// by the next regeneration and will fail that test in the meantime.

import Foundation

/// Env-var names the conversations client resolver honours, and the order it
/// honours them in. Mirrors \`clientTransportEnvKeys("${APP}")\` and
/// \`DB_PATH_KEYS\` from src/lib/store/index.ts.
public enum StoreEnvContract {
    /// Storage-mode keys, highest precedence first.
    public static let modeKeys: [String] = [
${swiftStringArray(ENV_KEYS.modeKeys, "        ")}
    ]

    /// API base-URL keys, highest precedence first.
    public static let apiUrlKeys: [String] = [
${swiftStringArray(ENV_KEYS.apiUrlKeys, "        ")}
    ]

    /// API-key keys, highest precedence first. Values are NEVER logged.
    public static let apiKeyKeys: [String] = [
${swiftStringArray(ENV_KEYS.apiKeyKeys, "        ")}
    ]

    /// Local SQLite path overrides. Highest-precedence signal of all: these beat
    /// a complete and valid API url + key pair.
    public static let dbPathKeys: [String] = [
${swiftStringArray([...DB_PATH_KEYS], "        ")}
    ]

    /// Base URL the transport uses when an API key is present but no URL is set.
    public static let defaultCloudBaseUrl = ${JSON.stringify(defaultCloudBaseUrl(APP))}

    /// Mode token selecting the on-box SQLite store.
    public static let localModeToken = "local"

    /// Mode tokens selecting the hosted service, including deprecated aliases
    /// the resolver still accepts.
    public static let cloudModeTokens: [String] = [
${swiftStringArray(["cloud", ...DEPRECATED_STORAGE_MODE_ALIASES], "        ")}
    ]

    /// Every key that can steer the child server's store choice. The child env is
    /// built by removing all of these and re-emitting only the resolved
    /// selection, so no inherited variable can redirect the store behind the
    /// shell's back.
    public static let storeSelectingKeys: [String] =
        modeKeys + apiUrlKeys + apiKeyKeys + dbPathKeys
}
`;
}

