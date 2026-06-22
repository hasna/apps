import Foundation

enum KnowledgeBridgeError: LocalizedError {
    case commandFailed(CommandResult)
    case invalidJSON(String)
    case cloudUnavailable
    case commandUnavailable(String)
    case timeout(String)

    var errorDescription: String? {
        switch self {
        case .commandFailed(let result):
            return result.stderr.isEmpty ? "knowledge exited with status \(result.exitCode)" : result.stderr
        case .invalidJSON(let text):
            return "The knowledge command did not return JSON: \(text.prefix(180))"
        case .cloudUnavailable:
            return "Hosted credentials are not available for cloud mode."
        case .commandUnavailable(let command):
            return "Could not find \(command). Install @hasna/knowledge or set an explicit command path in Settings."
        case .timeout(let command):
            return "\(command) timed out."
        }
    }
}

struct CommandResult {
    let exitCode: Int32
    let stdout: String
    let stderr: String

    var succeeded: Bool {
        exitCode == 0
    }
}

final class KnowledgeCommandRunner {
    var commandPath: String
    var timeoutSeconds: TimeInterval = 120

    init(commandPath: String) {
        self.commandPath = commandPath
    }

    func run(_ args: [String], cwd: URL, extraEnvironment: [String: String] = [:]) async throws -> CommandResult {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let stdout = Pipe()
            let stderr = Pipe()
            let outputBuffer = LockedDataBuffer()
            let errorBuffer = LockedDataBuffer()
            let invocation: CommandInvocation

            do {
                invocation = try resolveInvocation(args: args, cwd: cwd, extraEnvironment: extraEnvironment)
            } catch {
                continuation.resume(throwing: error)
                return
            }

            process.executableURL = invocation.executableURL
            process.arguments = invocation.arguments
            process.currentDirectoryURL = cwd
            process.standardOutput = stdout
            process.standardError = stderr
            process.environment = invocation.environment

            stdout.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if !data.isEmpty { outputBuffer.append(data) }
            }
            stderr.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if !data.isEmpty { errorBuffer.append(data) }
            }

            let completion = LockedCompletion<CommandResult>()

            process.terminationHandler = { completed in
                stdout.fileHandleForReading.readabilityHandler = nil
                stderr.fileHandleForReading.readabilityHandler = nil
                outputBuffer.append(stdout.fileHandleForReading.readDataToEndOfFile())
                errorBuffer.append(stderr.fileHandleForReading.readDataToEndOfFile())
                let result = CommandResult(
                    exitCode: completed.terminationStatus,
                    stdout: String(data: outputBuffer.data, encoding: .utf8) ?? "",
                    stderr: String(data: errorBuffer.data, encoding: .utf8) ?? ""
                )
                completion.resumeOnce(continuation, with: .success(result))
            }

            do {
                try process.run()
                DispatchQueue.global().asyncAfter(deadline: .now() + timeoutSeconds) {
                    guard process.isRunning else { return }
                    process.terminate()
                    completion.resumeOnce(continuation, with: .failure(KnowledgeBridgeError.timeout(invocation.displayName)))
                }
            } catch {
                completion.resumeOnce(continuation, with: .failure(error))
            }
        }
    }

    func runJSON(_ args: [String], cwd: URL, extraEnvironment: [String: String] = [:]) async throws -> [String: Any] {
        let result = try await run(args, cwd: cwd, extraEnvironment: extraEnvironment)
        guard result.succeeded else {
            throw KnowledgeBridgeError.commandFailed(result)
        }
        guard let data = result.stdout.data(using: .utf8),
              let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw KnowledgeBridgeError.invalidJSON(result.stdout)
        }
        return parsed
    }

    private func resolveInvocation(args: [String], cwd: URL, extraEnvironment: [String: String]) throws -> CommandInvocation {
        let environment = defaultEnvironment(extraEnvironment: extraEnvironment)
        let command = commandPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let autoCommand = command.isEmpty || command == "auto" || command == "knowledge"

        if autoCommand {
            if let bundled = Bundle.main.resourceURL?.appendingPathComponent("knowledge.js"),
               FileManager.default.fileExists(atPath: bundled.path),
               let bun = findExecutable("bun", environment: environment) {
                return CommandInvocation(executableURL: bun, arguments: [bundled.path] + args, environment: environment, displayName: "bundled knowledge")
            }

            let repoEntrypoint = cwd.appendingPathComponent("bin/knowledge.js")
            if FileManager.default.fileExists(atPath: repoEntrypoint.path),
               let bun = findExecutable("bun", environment: environment) {
                return CommandInvocation(executableURL: bun, arguments: [repoEntrypoint.path] + args, environment: environment, displayName: "repo knowledge")
            }

            if let knowledge = findExecutable("knowledge", environment: environment) {
                return CommandInvocation(executableURL: knowledge, arguments: args, environment: environment, displayName: "knowledge")
            }

            throw KnowledgeBridgeError.commandUnavailable("knowledge")
        }

        if command.hasSuffix(".js"), let bun = findExecutable("bun", environment: environment) {
            return CommandInvocation(executableURL: bun, arguments: [command] + args, environment: environment, displayName: command)
        }

        if command.contains("/") {
            return CommandInvocation(executableURL: URL(fileURLWithPath: NSString(string: command).expandingTildeInPath), arguments: args, environment: environment, displayName: command)
        }

        return CommandInvocation(executableURL: URL(fileURLWithPath: "/usr/bin/env"), arguments: [command] + args, environment: environment, displayName: command)
    }

    private func defaultEnvironment(extraEnvironment: [String: String]) -> [String: String] {
        var env = ProcessInfo.processInfo.environment.merging(extraEnvironment) { _, next in next }
        let existingPath = env["PATH"] ?? ""
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let additions = [
            "\(home)/.bun/bin",
            "\(home)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
            "/usr/bin",
            "/bin"
        ]
        env["PATH"] = ([existingPath] + additions).filter { !$0.isEmpty }.joined(separator: ":")
        return env
    }

    private func findExecutable(_ name: String, environment: [String: String]) -> URL? {
        let paths = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
        for path in paths {
            let candidate = URL(fileURLWithPath: path).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }
}

private struct CommandInvocation {
    let executableURL: URL
    let arguments: [String]
    let environment: [String: String]
    let displayName: String
}

private final class LockedDataBuffer {
    private let lock = NSLock()
    private var storage = Data()

    var data: Data {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func append(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock()
        storage.append(data)
        lock.unlock()
    }
}

private final class LockedCompletion<T> {
    private let lock = NSLock()
    private var resumed = false

    func resumeOnce(_ continuation: CheckedContinuation<T, Error>, with result: Result<T, Error>) {
        lock.lock()
        guard !resumed else {
            lock.unlock()
            return
        }
        resumed = true
        lock.unlock()

        switch result {
        case .success(let value):
            continuation.resume(returning: value)
        case .failure(let error):
            continuation.resume(throwing: error)
        }
    }
}

enum KnowledgeRunMode: String, CaseIterable, Identifiable, Hashable {
    case local = "Local"
    case cloud = "Cloud"
    case automatic = "Auto"

    var id: String { rawValue }
}

enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
    case dashboard = "Dashboard"
    case sources = "Sources"
    case searchAsk = "Search & Ask"
    case notes = "Notes"
    case ingestion = "Ingestion"
    case sync = "Sync"
    case settings = "Settings"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .dashboard: return "gauge.with.dots.needle.67percent"
        case .sources: return "folder"
        case .searchAsk: return "text.magnifyingglass"
        case .notes: return "note.text"
        case .ingestion: return "tray.and.arrow.down"
        case .sync: return "arrow.triangle.2.circlepath"
        case .settings: return "gearshape"
        }
    }
}

struct KnowledgeSnapshot {
    var paths: [String: Any] = [:]
    var inventory: [String: Any] = [:]
    var storage: [String: Any] = [:]
    var db: [String: Any] = [:]
    var sync: [String: Any] = [:]
    var auth: [String: Any] = [:]
    var remote: [String: Any] = [:]
    var providers: [String: Any] = [:]
    var reindex: [String: Any] = [:]
    var embeddings: [String: Any] = [:]
    var validation: [String: Any] = [:]
    var wikiLint: [String: Any] = [:]
    var refreshedAt: Date?
    var lastError: String?

    var mode: String {
        dictionary(paths, "config")?.string("mode") ?? storage.string("mode") ?? "local"
    }

    var storageType: String {
        storage.string("storage_type") ?? storage.string("mode") ?? "local"
    }

    var workspaceHome: String {
        paths.string("home") ?? storage.string("workspace_home") ?? ""
    }

    var authenticated: Bool {
        auth.bool("authenticated") ?? false
    }

    var cloudReady: Bool {
        remote.bool("client_ready") ?? false
    }

    var apiUrl: String {
        auth.string("api_url") ?? remote.string("api_url") ?? "https://knowledge.hasna.xyz"
    }

    var activeProviderCount: Int {
        providers.array("providers")?.filter { ($0 as? [String: Any])?.bool("configured") == true }.count ?? 0
    }

    var providerCount: Int {
        providers.array("providers")?.count ?? 0
    }

    var openConflicts: Int {
        dictionary(sync, "conflicts")?.int("open") ?? 0
    }

    var sourceRows: [[String: Any]] {
        inventory.array("sources")?.compactMap { $0 as? [String: Any] } ?? []
    }

    var itemRows: [[String: Any]] {
        inventory.array("items")?.compactMap { $0 as? [String: Any] } ?? []
    }

    var runRows: [[String: Any]] {
        inventory.array("runs")?.compactMap { $0 as? [String: Any] } ?? []
    }
}

extension Dictionary where Key == String, Value == Any {
    func string(_ key: String) -> String? {
        self[key] as? String
    }

    func int(_ key: String) -> Int? {
        if let value = self[key] as? Int { return value }
        if let value = self[key] as? Double { return Int(value) }
        if let value = self[key] as? String { return Int(value) }
        return nil
    }

    func bool(_ key: String) -> Bool? {
        self[key] as? Bool
    }

    func array(_ key: String) -> [Any]? {
        self[key] as? [Any]
    }
}

func dictionary(_ record: [String: Any], _ key: String) -> [String: Any]? {
    record[key] as? [String: Any]
}

func prettyJSON(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
          let text = String(data: data, encoding: .utf8) else {
        return String(describing: value)
    }
    return text
}

final class KnowledgeCloudClient {
    private let apiUrl: URL
    private let apiKey: String

    init?(snapshot: KnowledgeSnapshot) {
        guard let key = Self.resolveApiKey(authPath: snapshot.auth.string("auth_path")) else {
            return nil
        }
        guard let url = URL(string: snapshot.apiUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else {
            return nil
        }
        self.apiUrl = url
        self.apiKey = key
    }

    static func resolveApiKey(authPath: String?) -> String? {
        let env = ProcessInfo.processInfo.environment
        if let key = env["KNOWLEDGE_API_KEY"], !key.isEmpty { return key }
        if let key = env["HASNA_KNOWLEDGE_API_KEY"], !key.isEmpty { return key }
        guard let authPath,
              let data = try? Data(contentsOf: URL(fileURLWithPath: NSString(string: authPath).expandingTildeInPath)),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = parsed["api_key"] as? String,
              !key.isEmpty else {
            return nil
        }
        return key
    }

    func search(query: String, semantic: Bool, limit: Int) async throws -> [String: Any] {
        try await request(path: "/api/v1/knowledge/search", body: [
            "query": query,
            "semantic": semantic,
            "limit": limit
        ])
    }

    func ask(prompt: String, semantic: Bool, generate: Bool, limit: Int) async throws -> [String: Any] {
        try await request(path: "/api/v1/knowledge/ask", body: [
            "query": prompt,
            "prompt": prompt,
            "semantic": semantic,
            "generate": generate,
            "limit": limit
        ])
    }

    private func request(path: String, body: [String: Any]) async throws -> [String: Any] {
        guard let endpoint = URL(string: path, relativeTo: apiUrl)?.absoluteURL else {
            throw KnowledgeBridgeError.invalidJSON(path)
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let text = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw KnowledgeBridgeError.invalidJSON(text)
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw KnowledgeBridgeError.invalidJSON(String(data: data, encoding: .utf8) ?? "")
        }
        return parsed
    }
}
