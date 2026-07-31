// GENERATED FILE — DO NOT EDIT.
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
/// honours them in. Mirrors `clientTransportEnvKeys("conversations")` and
/// `DB_PATH_KEYS` from src/lib/store/index.ts.
public enum StoreEnvContract {
    /// Storage-mode keys, highest precedence first.
    public static let modeKeys: [String] = [
        "HASNA_CONVERSATIONS_STORAGE_MODE",
        "HASNA_CONVERSATIONS_MODE",
        "CONVERSATIONS_STORAGE_MODE",
        "CONVERSATIONS_MODE",
    ]

    /// API base-URL keys, highest precedence first.
    public static let apiUrlKeys: [String] = [
        "HASNA_CONVERSATIONS_API_URL",
        "CONVERSATIONS_API_URL",
    ]

    /// API-key keys, highest precedence first. Values are NEVER logged.
    public static let apiKeyKeys: [String] = [
        "HASNA_CONVERSATIONS_API_KEY",
        "CONVERSATIONS_API_KEY",
    ]

    /// Local SQLite path overrides. Highest-precedence signal of all: these beat
    /// a complete and valid API url + key pair.
    public static let dbPathKeys: [String] = [
        "HASNA_CONVERSATIONS_DB_PATH",
        "CONVERSATIONS_DB_PATH",
    ]

    /// Base URL the transport uses when an API key is present but no URL is set.
    public static let defaultCloudBaseUrl = "https://conversations.hasna.xyz"

    /// Mode token selecting the on-box SQLite store.
    public static let localModeToken = "local"

    /// Mode tokens selecting the hosted service, including deprecated aliases
    /// the resolver still accepts.
    public static let cloudModeTokens: [String] = [
        "cloud",
        "remote",
        "hybrid",
        "self_hosted",
    ]

    /// Every key that can steer the child server's store choice. The child env is
    /// built by removing all of these and re-emitting only the resolved
    /// selection, so no inherited variable can redirect the store behind the
    /// shell's back.
    public static let storeSelectingKeys: [String] =
        modeKeys + apiUrlKeys + apiKeyKeys + dbPathKeys
}
