// Store resolution for the macOS shell — decide which store the bundled server
// will use, BEFORE starting it, and hand it an environment that can only produce
// that answer.
//
// A macOS GUI app launched from the Dock or Finder does NOT inherit the shell
// environment: `~/.zshrc` and the fleet's sourced `*.env` files never reach it.
// So `ProcessInfo.processInfo.environment` here contains no HASNA_CONVERSATIONS_*
// at all, even when the user's terminal has them — and a server handed that empty
// environment happily opens the on-box SQLite file and reports success.
//
// That is not hypothetical. Measured 2026-07-31 on station03: this app served 358
// channels / 4550 messages out of ~/.hasna/conversations/messages.db while the
// hosted service held 1124 / 72652, with no error and nothing in the UI to suggest
// the data was not the fleet's. The owner reasonably concluded the app worked.
//
// The remedy is to read the fleet's own config file explicitly and to FAIL CLOSED:
// if a store cannot be established unambiguously, refuse and name what is missing
// rather than let the server choose a local database. No URL or key is ever
// embedded here — the file is the source of truth, and it is the same file the
// `conversations` CLI reads.
//
// TWO PROPERTIES THIS FILE OWES, and the second was missing until 2026-07-31:
//
//  1. FAIL CLOSED. No unambiguous store ⇒ no server is started at all.
//
//  2. THE ANNOUNCEMENT MATCHES THE OUTCOME. An earlier version read three env
//     vars while the resolver it guards honoured eight, five of which select the
//     local store — `HASNA_CONVERSATIONS_MODE`, `CONVERSATIONS_STORAGE_MODE`,
//     `CONVERSATIONS_MODE`, `HASNA_CONVERSATIONS_DB_PATH`, `CONVERSATIONS_DB_PATH`
//     — and it forwarded the whole inherited environment to the child. With any
//     one of those set, the shell logged `store=hosted` and the child resolved
//     LOCAL. A guard that classifies an environment differently from the resolver
//     it guards is its own source of wrong-store bugs; src/lib/store/index.ts says
//     exactly that in prose above `firstSet`.
//
//     So the child environment is CONSTRUCTED rather than filtered: every
//     store-selecting key is removed, and only the resolved selection is
//     re-emitted under canonical names. There is no key left for an inherited
//     variable to steer the store with, and no list of exceptions to keep in step.
//     The key names come from StoreEnvContract, which is generated from the same
//     TypeScript contract the resolver uses.

import Foundation

/// Canonical fleet config for the conversations client. Written by the fleet
/// provisioning path and read by the CLI; the app must not invent its own
/// location and must never embed a URL or key of its own.
public let fleetCloudEnvPath = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".hasna/cloud/conversations.env").path

/// Distinguishes "no such file" from "present but unreadable". Collapsing those
/// two makes the error message name the wrong cause — an unreadable but perfectly
/// correct config file would otherwise be reported as not defining its variables,
/// sending the operator to edit a file that is already right.
public enum EnvFileReadError: Error {
    case unreadable(String)
}

/// Parse a `KEY=value` env file, tolerating `export ` prefixes and quoted values.
/// Values are never logged — only key NAMES are ever emitted anywhere.
public func parseEnvFile(at path: String) throws -> [String: String] {
    let text: String
    do {
        text = try String(contentsOfFile: path, encoding: .utf8)
    } catch {
        if !FileManager.default.fileExists(atPath: path) { return [:] }
        throw EnvFileReadError.unreadable(error.localizedDescription)
    }
    var out: [String: String] = [:]
    // Split on `isNewline`, NOT on the literal "\n". In Swift a String is a
    // collection of grapheme clusters and CRLF is ONE cluster, so
    // `split(separator: "\n")` never matches a CRLF line ending and returns the
    // whole file as a single line — every variable after the first is lost, and
    // the first one's value swallows the rest of the file. Measured 2026-07-31:
    // a CRLF config file resolved to `.unresolved`, so the app refused to start
    // on a configuration that is correct. It fails closed, which is why nobody
    // had seen it; an operator whose editor wrote CRLF would have been told the
    // file does not define its variables while looking at a file that does.
    for rawLine in text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline) {
        var line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        if line.isEmpty || line.hasPrefix("#") { continue }
        if line.hasPrefix("export ") { line = String(line.dropFirst("export ".count)) }
        guard let eq = line.firstIndex(of: "=") else { continue }
        let key = String(line[line.startIndex..<eq]).trimmingCharacters(in: .whitespacesAndNewlines)
        var val = String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if val.count >= 2,
           (val.hasPrefix("\"") && val.hasSuffix("\"")) || (val.hasPrefix("'") && val.hasSuffix("'")) {
            val = String(val.dropFirst().dropLast())
        }
        if !key.isEmpty { out[key] = val }
    }
    return out
}

/// Which store the bundled server will be run against.
///
/// The associated environment is the one the child is actually given, already
/// stripped of every store-selecting key and carrying only the resolved
/// selection. It is not the inherited environment.
public enum StoreResolution: Equatable {
    /// Hosted service, fully configured. `url` is what will be announced — the
    /// configured URL, or the transport's default host when only a key was given.
    case cloud(env: [String: String], url: String)
    /// Local SQLite, but only because it was asked for by name.
    case explicitLocal(env: [String: String])
    /// Nothing unambiguous — the app refuses to start the server.
    case unresolved(reason: String)
}

extension StoreResolution: CustomDebugStringConvertible {
    /// Redacted on purpose: the child environment carries the API key, and a
    /// failing assertion or a log line must never print it. Key NAMES only.
    public var debugDescription: String {
        switch self {
        case .cloud(let env, let url):
            return "cloud(url: \(url), envKeys: \(redactedKeys(env)))"
        case .explicitLocal(let env):
            return "explicitLocal(envKeys: \(redactedKeys(env)))"
        case .unresolved(let reason):
            return "unresolved(\(reason))"
        }
    }

    private func redactedKeys(_ env: [String: String]) -> [String] {
        env.keys.filter { StoreEnvContract.storeSelectingKeys.contains($0) }.sorted()
    }
}

// MARK: - Per-source selection

/// What one environment source (the config file, or the inherited environment)
/// says about which store to use, applying the resolver's own precedence.
enum StoreSelection {
    /// This source says nothing about the store.
    case nothing
    /// The on-box SQLite store, chosen deliberately.
    case local(dbPath: String?)
    /// The hosted service. `url` is nil when only a key was given, in which case
    /// the transport uses its default host.
    case cloud(url: String?, apiKey: String, modeValue: String?)
    /// This source is self-contradictory or incomplete. Refuse; never downgrade.
    case refuse(reason: String)
}

private func firstSet(_ env: [String: String], _ keys: [String]) -> (key: String, value: String)? {
    for key in keys {
        let value = (env[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty { return (key, value) }
    }
    return nil
}

/// Normalize a storage-mode token the way `normalizeStorageMode` does: trim,
/// lowercase, and treat `-` as `_` so `self-hosted` and `self_hosted` agree.
private func normalizeModeToken(_ raw: String) -> String {
    raw.trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "-", with: "_")
}

/// Refuse a URL the transport could not use, rather than quietly reading local
/// data. Same two conditions the resolver applies: it must parse, and it must be
/// http(s).
private func unusableURLReason(_ hit: (key: String, value: String)) -> String? {
    guard let url = URL(string: hit.value), let scheme = url.scheme?.lowercased() else {
        return "\(hit.key) is not a parseable URL, so the hosted service cannot be reached."
    }
    guard scheme == "http" || scheme == "https" else {
        return "\(hit.key) must use http or https, so the hosted service cannot be reached."
    }
    return nil
}

/// Apply the resolver's precedence to ONE source.
///
/// Mirrors `assertUnambiguousStoreEnv` + `conversationsCloudEnv` in
/// src/lib/store/index.ts, in the same order: an explicit local DB path is the
/// narrowest signal and wins; then an explicit mode; then the url + key pair.
func storeSelection(from env: [String: String], source: String) -> StoreSelection {
    // 1. An explicit local SQLite path is the narrowest, most specific signal.
    if let dbHit = firstSet(env, StoreEnvContract.dbPathKeys) {
        return .local(dbPath: dbHit.value)
    }

    let urlHit = firstSet(env, StoreEnvContract.apiUrlKeys)
    let keyHit = firstSet(env, StoreEnvContract.apiKeyKeys)

    // 2. An explicit mode is authoritative — but must be spelled correctly.
    if let modeHit = firstSet(env, StoreEnvContract.modeKeys) {
        let token = normalizeModeToken(modeHit.value)
        if token == StoreEnvContract.localModeToken { return .local(dbPath: nil) }
        guard StoreEnvContract.cloudModeTokens.contains(token) else {
            return .refuse(reason: "\(modeHit.key) in \(source) is set to an unrecognised value. "
                + "Valid values are 'local' and 'cloud'. Refusing to guess which store to use.")
        }
        // Explicit cloud with no credential: refuse. Do NOT read the local store.
        guard let keyHit else {
            return .refuse(reason: "\(modeHit.key) in \(source) selects the hosted service but "
                + "\(StoreEnvContract.apiKeyKeys[0]) is not set. Refusing to serve the on-box "
                + "SQLite store in its place, because it holds a different dataset.")
        }
        if let urlHit, let bad = unusableURLReason(urlHit) { return .refuse(reason: bad) }
        return .cloud(url: urlHit?.value, apiKey: keyHit.value, modeValue: modeHit.value)
    }

    // 3. No explicit mode: the URL + key pair is the fleet flip signal.
    if let urlHit, let keyHit {
        if let bad = unusableURLReason(urlHit) { return .refuse(reason: bad) }
        return .cloud(url: urlHit.value, apiKey: keyHit.value, modeValue: nil)
    }

    // 3a. Half a cloud configuration is an error, never a fall-back to local.
    if let urlHit {
        return .refuse(reason: "\(source) defines \(urlHit.key) but not "
            + "\(StoreEnvContract.apiKeyKeys[0]), so the hosted service cannot be reached. "
            + "Refusing to serve the on-box SQLite store in its place, because it holds a "
            + "different dataset.")
    }
    if let keyHit {
        return .refuse(reason: "\(source) defines \(keyHit.key) but not "
            + "\(StoreEnvContract.apiUrlKeys[0]), so the hosted service cannot be reached. "
            + "Refusing to serve the on-box SQLite store in its place, because it holds a "
            + "different dataset.")
    }

    // 4. This source says nothing.
    return .nothing
}

// MARK: - Child environment construction

/// Strip every store-selecting key. What remains cannot steer the store.
func withoutStoreSelectingKeys(_ env: [String: String]) -> [String: String] {
    var out = env
    for key in StoreEnvContract.storeSelectingKeys { out.removeValue(forKey: key) }
    return out
}

// MARK: - Resolution

/// Resolve the store configuration for the child server, failing closed.
///
/// `environment` and `configPath` are parameters so the whole matrix is testable
/// without a running app: the untestability of this function was the reason its
/// behaviour was argued rather than measured.
///
/// The config FILE outranks the inherited environment whenever it says anything
/// at all. That is deliberate and it is the fix for the divergence: a GUI launch
/// inherits an empty environment by construction, so any store-selecting variable
/// that IS inherited came from somewhere other than the fleet's own config, and
/// must not be able to silently redirect the app away from the store that config
/// names. Within each source, precedence is the resolver's own.
public func resolveStore(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    configPath: String = fleetCloudEnvPath
) -> StoreResolution {
    let fileEnv: [String: String]
    do {
        fileEnv = try parseEnvFile(at: configPath)
    } catch EnvFileReadError.unreadable(let detail) {
        return .unresolved(reason: "\(configPath) exists but could not be read: \(detail)")
    } catch {
        return .unresolved(reason: "\(configPath) could not be read: \(error.localizedDescription)")
    }

    let fileSelection = storeSelection(from: fileEnv, source: configPath)
    let selection: StoreSelection
    if case .nothing = fileSelection {
        selection = storeSelection(from: environment, source: "the environment")
    } else {
        selection = fileSelection
    }

    switch selection {
    case .cloud(let url, let apiKey, let modeValue):
        var env = withoutStoreSelectingKeys(environment)
        env[StoreEnvContract.apiKeyKeys[0]] = apiKey
        if let url { env[StoreEnvContract.apiUrlKeys[0]] = url }
        // Carry an explicit mode through when one was given, but never invent one:
        // which token means "the hosted API" is the package's decision, not this
        // shell's. With url + key present and no mode, src/lib/store/index.ts
        // resolves the API transport on its own.
        if let modeValue { env[StoreEnvContract.modeKeys[0]] = modeValue }
        return .cloud(env: env, url: url ?? StoreEnvContract.defaultCloudBaseUrl)

    case .local(let dbPath):
        var env = withoutStoreSelectingKeys(environment)
        env[StoreEnvContract.modeKeys[0]] = StoreEnvContract.localModeToken
        if let dbPath { env[StoreEnvContract.dbPathKeys[0]] = dbPath }
        return .explicitLocal(env: env)

    case .refuse(let reason):
        return .unresolved(reason: reason)

    case .nothing:
        let reason = FileManager.default.fileExists(atPath: configPath)
            ? "\(configPath) does not define \(StoreEnvContract.apiUrlKeys[0]) and "
                + "\(StoreEnvContract.apiKeyKeys[0])."
            : "\(configPath) is missing, so there is no hosted-service configuration to read."
        return .unresolved(reason: reason)
    }
}
