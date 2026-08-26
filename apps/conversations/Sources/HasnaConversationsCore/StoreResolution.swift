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
// The client selects the HTTP API by the API url + key pair (owner directive
// 2026-07-29; knowledge k_ms5wv466_u0jidq).
//
// TWO PROPERTIES THIS FILE OWES:
//
//  1. FAIL CLOSED. No unambiguous store ⇒ no server is started at all.
//
//  2. THE ANNOUNCEMENT MATCHES THE OUTCOME. An earlier version read three env
//     vars while the resolver it guarded honoured more, several of which select
//     the local store — `HASNA_CONVERSATIONS_DB_PATH`, `CONVERSATIONS_DB_PATH`
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
/// P1-B (todos 12e26c2b): retargeted to the PRIMARY fleet credential location
/// `~/.hasna/fleet-env/conversations.env`; the legacy `~/.hasna/cloud/...`
/// location is deprecated (removed after 2026-10-01).
public let fleetCloudEnvPath = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".hasna/fleet-env/conversations.env").path

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
    /// Hosted service, fully configured.
    ///
    /// `url` is the LOGGABLE form of the configured URL — scheme, host and port,
    /// and NOTHING else: no userinfo, no path, no query, no fragment. It is what
    /// the shell announces, and it must never be the raw configured value,
    /// because every component of a URL except the scheme and the authority's
    /// host and port is a place an operator can put a credential, and everything
    /// this process logs is persisted. The raw value goes into `env` for the
    /// child and nowhere else.
    ///
    /// See `loggableURL` for why this is stated as what is KEPT rather than as
    /// what is removed.
    case cloud(env: [String: String], url: String)
    /// Local SQLite, but only because it was asked for by name. `selectedBy` is
    /// the env-var NAME that chose it, so the log can say which variable was
    /// actually read rather than naming one the operator may never have set.
    case explicitLocal(env: [String: String], selectedBy: String)
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
        case .explicitLocal(let env, let selectedBy):
            return "explicitLocal(selectedBy: \(selectedBy), envKeys: \(redactedKeys(env)))"
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
    case local(dbPath: String?, selectedBy: String)
    /// The HTTP API, fully configured. `url` is always present: the resolver
    /// requires the full url + key pair and refuses a half configuration.
    case cloud(url: String, apiKey: String)
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

/// Reduce a URL to the parts that say WHICH SERVER is being contacted, so it is
/// safe to log: scheme, host, port. Nothing else survives.
///
/// A base URL is not automatically a non-secret, and it has more than one place
/// to hide a credential:
///
///   - `userinfo` — `https://svc:SECRET@host/v1`, the shape a basic-auth proxy
///     in front of the service needs. `toV1BaseUrl` (transport.ts) clears
///     `search` and `hash` but not `username`/`password`, so a userinfo URL
///     survives into the transport and actually authenticates. It is a working
///     configuration, which is exactly why an operator would write one.
///   - `query` — the familiar `?access_token=` shape.
///   - `fragment` — where one-time and delegated credentials most often live,
///     precisely because fragments are never sent to servers or written to
///     server logs, which is what makes them the part a naive redactor skips.
///   - `path` — the webhook shape, `https://host/services/T0/B0/SECRET`.
///
/// BUILT AS AN ALLOW-LIST, AND THAT IS THE POINT. An earlier version cleared
/// `query` and `fragment` and re-emitted the rest, which leaked userinfo
/// verbatim into `NSLog` while this file's own comments asserted it did not.
/// Removing the components someone thought of leaves every component they did
/// not think of — including any that a future URL grammar or a future Foundation
/// adds — in the output by default. Copying only the components that are
/// definitionally not credentials inverts that: a component nobody considered is
/// absent because it was never copied, not because it was remembered.
///
/// THE COST, STATED SO IT IS NOT REDISCOVERED AS A BUG: the path is dropped, so
/// a deployment served under a path prefix announces only its origin. That is a
/// deliberate trade. The announcement exists to answer "is this app talking to
/// the fleet's hosted service or to something else", which the host answers on
/// its own; the path is the one remaining component carrying an operator-supplied
/// string, and no rule can tell a route prefix from a secret inside one.
///
/// A URL that does not parse, or that names no host, cannot reach here —
/// `unusableURLReason` refuses it first — but if one ever did, the safe answer
/// is to name nothing rather than echo an unparsed string back into the log.
public func loggableURL(_ raw: String) -> String {
    guard let parsed = URLComponents(string: raw),
          let scheme = parsed.scheme,
          let host = parsed.host, !host.isEmpty
    else { return "(unparseable URL)" }

    var safe = URLComponents()
    safe.scheme = scheme
    // An IPv6 literal must keep its brackets or the port becomes part of the
    // address. Foundation has returned this component both bracketed and bare
    // across versions, so re-add them only when they are missing.
    safe.host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    safe.port = parsed.port
    return safe.string ?? "(unparseable URL)"
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
/// src/lib/store/index.ts, in the same order: an explicit local DB path; then
/// the url + key pair.
func storeSelection(from env: [String: String], source: String) -> StoreSelection {
    // 1. An explicit local SQLite path is the narrowest, most specific signal.
    if let dbHit = firstSet(env, StoreEnvContract.dbPathKeys) {
        return .local(dbPath: dbHit.value, selectedBy: dbHit.key)
    }

    let urlHit = firstSet(env, StoreEnvContract.apiUrlKeys)
    let keyHit = firstSet(env, StoreEnvContract.apiKeyKeys)

    // 2. The URL + key pair is the fleet flip signal.
    if let urlHit, let keyHit {
        if let bad = unusableURLReason(urlHit) { return .refuse(reason: bad) }
        return .cloud(url: urlHit.value, apiKey: keyHit.value)
    }

    // 2a. Half a cloud configuration is an error, never a fall-back to local.
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

    // 3. This source says nothing.
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
    case .cloud(let url, let apiKey):
        var env = withoutStoreSelectingKeys(environment)
        env[StoreEnvContract.apiKeyKeys[0]] = apiKey
        env[StoreEnvContract.apiUrlKeys[0]] = url
        // With url + key present, src/lib/store/index.ts resolves the API
        // transport on its own; nothing else is emitted.
        return .cloud(env: env, url: loggableURL(url))

    case .local(let dbPath, let selectedBy):
        var env = withoutStoreSelectingKeys(environment)
        if let dbPath { env[StoreEnvContract.dbPathKeys[0]] = dbPath }
        return .explicitLocal(env: env, selectedBy: selectedBy)

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
