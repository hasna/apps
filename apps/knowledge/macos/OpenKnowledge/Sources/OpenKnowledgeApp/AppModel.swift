import AppKit
import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var selectedItem: SidebarItem? = .dashboard
    @Published var snapshot = KnowledgeSnapshot()
    @Published var isRefreshing = false
    @Published var commandPath: String {
        didSet {
            runner.commandPath = commandPath
            UserDefaults.standard.set(commandPath, forKey: "knowledgeCommandPath")
        }
    }
    @Published var workspacePath: String {
        didSet {
            UserDefaults.standard.set(workspacePath, forKey: "knowledgeWorkspacePath")
        }
    }

    @Published var searchMode: KnowledgeRunMode = .local
    @Published var searchQuery = ""
    @Published var searchSemantic = false
    @Published var searchLimit = 8
    @Published var searchResultText = ""
    @Published var isSearching = false

    @Published var askMode: KnowledgeRunMode = .local
    @Published var askPrompt = ""
    @Published var askSemantic = true
    @Published var askGenerate = false
    @Published var askLimit = 8
    @Published var askResultText = ""
    @Published var isAsking = false

    @Published var sourceRef = ""
    @Published var manifestPath = ""
    @Published var ingestOutput = ""
    @Published var isIngesting = false

    @Published var noteTitle = ""
    @Published var noteContent = ""
    @Published var noteOutput = ""

    @Published var hostedApiUrl = ""
    @Published var loginEmail = ""
    @Published var loginOrg = ""
    @Published var loginApiKey = ""
    @Published var settingsOutput = ""

    @Published var peerWorkspacePath = ""
    @Published var syncOutput = ""

    private let runner: KnowledgeCommandRunner

    init() {
        let defaults = UserDefaults.standard
        let command = defaults.string(forKey: "knowledgeCommandPath") ?? "auto"
        let workspace = defaults.string(forKey: "knowledgeWorkspacePath") ?? FileManager.default.currentDirectoryPath
        self.commandPath = command
        self.workspacePath = workspace
        self.runner = KnowledgeCommandRunner(commandPath: command)
    }

    var workspaceURL: URL {
        URL(fileURLWithPath: NSString(string: workspacePath).expandingTildeInPath)
    }

    var currentItem: SidebarItem {
        selectedItem ?? .dashboard
    }

    var cloudClient: KnowledgeCloudClient? {
        KnowledgeCloudClient(snapshot: snapshot)
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }

        async let paths = safeCommandJSON(["paths", "--scope", "project", "--json"])
        async let inventory = safeCommandJSON(["inventory", "--scope", "project", "--limit", "24", "--json"])
        async let storage = safeCommandJSON(["storage", "status", "--scope", "project", "--json"])
        async let db = safeCommandJSON(["db", "stats", "--scope", "project", "--json"])
        async let sync = safeCommandJSON(["sync", "status", "--scope", "project", "--json"])
        async let auth = safeCommandJSON(["auth", "whoami", "--scope", "project", "--json"])
        async let remote = safeCommandJSON(["remote", "status", "--scope", "project", "--json"])
        async let providers = safeCommandJSON(["providers", "status", "--scope", "project", "--json"])
        async let reindex = safeCommandJSON(["reindex", "status", "--scope", "project", "--json"])
        async let embeddings = safeCommandJSON(["embeddings", "status", "--scope", "project", "--json"])
        async let validation = safeCommandJSON(["storage", "validate", "--strict", "--scope", "project", "--json"])
        async let wikiLint = safeCommandJSON(["wiki", "lint", "--scope", "project", "--json"])

        let resolvedPaths = await paths
        let resolvedInventory = await inventory
        let resolvedStorage = await storage
        let resolvedDb = await db
        let resolvedSync = await sync
        let resolvedAuth = await auth
        let resolvedRemote = await remote
        let resolvedProviders = await providers
        let resolvedReindex = await reindex
        let resolvedEmbeddings = await embeddings
        let resolvedValidation = await validation
        let resolvedWikiLint = await wikiLint
        let criticalError = resolvedPaths.string("error") ?? resolvedStorage.string("error") ?? resolvedDb.string("error")

        let nextSnapshot = KnowledgeSnapshot(
            paths: resolvedPaths,
            inventory: resolvedInventory,
            storage: resolvedStorage,
            db: resolvedDb,
            sync: resolvedSync,
            auth: resolvedAuth,
            remote: resolvedRemote,
            providers: resolvedProviders,
            reindex: resolvedReindex,
            embeddings: resolvedEmbeddings,
            validation: resolvedValidation,
            wikiLint: resolvedWikiLint,
            refreshedAt: Date(),
            lastError: criticalError
        )
        snapshot = nextSnapshot
        hostedApiUrl = snapshot.apiUrl
    }

    func search() async {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSearching = true
        defer { isSearching = false }

        do {
            let useCloud = resolvedCloudUse(for: searchMode)
            if useCloud {
                guard let cloudClient else { throw KnowledgeBridgeError.cloudUnavailable }
                searchResultText = prettyJSON(try await cloudClient.search(query: trimmed, semantic: searchSemantic, limit: searchLimit))
            } else {
                var args = ["search", trimmed, "--scope", "project", "--limit", String(searchLimit), "--json"]
                if searchSemantic { args.append("--semantic") }
                searchResultText = prettyJSON(try await commandJSON(args))
            }
        } catch {
            searchResultText = error.localizedDescription
        }
    }

    func ask() async {
        let trimmed = askPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isAsking = true
        defer { isAsking = false }

        do {
            let useCloud = resolvedCloudUse(for: askMode)
            if useCloud {
                guard let cloudClient else { throw KnowledgeBridgeError.cloudUnavailable }
                askResultText = prettyJSON(try await cloudClient.ask(prompt: trimmed, semantic: askSemantic, generate: askGenerate, limit: askLimit))
            } else {
                var args = ["ask", trimmed, "--scope", "project", "--limit", String(askLimit), "--json"]
                if askSemantic { args.append("--semantic") }
                if askGenerate { args.append("--generate") }
                askResultText = prettyJSON(try await commandJSON(args))
            }
        } catch {
            askResultText = error.localizedDescription
        }
    }

    func addNote() async {
        let title = noteTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let content = noteContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !content.isEmpty else { return }

        do {
            noteOutput = prettyJSON(try await commandJSON(["add", title, content, "--scope", "project", "--json"]))
            noteTitle = ""
            noteContent = ""
            await refresh()
        } catch {
            noteOutput = error.localizedDescription
        }
    }

    func ingestSource() async {
        let ref = sourceRef.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ref.isEmpty else { return }
        isIngesting = true
        defer { isIngesting = false }

        do {
            ingestOutput = prettyJSON(try await commandJSON(["ingest", "source", ref, "--scope", "project", "--json"]))
            await refresh()
        } catch {
            ingestOutput = error.localizedDescription
        }
    }

    func ingestManifest() async {
        let path = manifestPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return }
        isIngesting = true
        defer { isIngesting = false }

        do {
            ingestOutput = prettyJSON(try await commandJSON(["ingest", "manifest", path, "--scope", "project", "--json"]))
            await refresh()
        } catch {
            ingestOutput = error.localizedDescription
        }
    }

    func reindexEnqueue() async {
        do {
            ingestOutput = prettyJSON(try await commandJSON(["reindex", "enqueue", "--scope", "project", "--json"]))
            await refresh()
        } catch {
            ingestOutput = error.localizedDescription
        }
    }

    func refreshFakeEmbeddings() async {
        do {
            ingestOutput = prettyJSON(try await commandJSON(["reindex", "embeddings", "--scope", "project", "--fake", "--json"]))
            await refresh()
        } catch {
            ingestOutput = error.localizedDescription
        }
    }

    func setupLocal() async {
        do {
            settingsOutput = prettyJSON(try await commandJSON(["setup", "--mode", "local", "--scope", "project", "--json"]))
            await refresh()
        } catch {
            settingsOutput = error.localizedDescription
        }
    }

    func setupHosted() async {
        var args = ["setup", "--mode", "hosted", "--scope", "project", "--json"]
        let apiUrl = hostedApiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if !apiUrl.isEmpty {
            args += ["--api-url", apiUrl]
        }

        do {
            settingsOutput = prettyJSON(try await commandJSON(args))
            await refresh()
        } catch {
            settingsOutput = error.localizedDescription
        }
    }

    func loginHosted() async {
        let key = loginApiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        var args = ["auth", "login", "--api-key", key, "--scope", "project", "--json"]
        let email = loginEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        let org = loginOrg.trimmingCharacters(in: .whitespacesAndNewlines)
        let apiUrl = hostedApiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if !email.isEmpty { args += ["--email", email] }
        if !org.isEmpty { args += ["--org", org] }
        if !apiUrl.isEmpty { args += ["--api-url", apiUrl] }

        do {
            settingsOutput = prettyJSON(try await commandJSON(args))
            loginApiKey = ""
            await refresh()
        } catch {
            settingsOutput = error.localizedDescription
        }
    }

    func logoutHosted() async {
        do {
            settingsOutput = prettyJSON(try await commandJSON(["auth", "logout", "--scope", "project", "--json"]))
            await refresh()
        } catch {
            settingsOutput = error.localizedDescription
        }
    }

    func syncSnapshot() async {
        do {
            syncOutput = prettyJSON(try await commandJSON(["sync", "snapshot", "--scope", "project", "--no-tailscale", "--json"]))
            await refresh()
        } catch {
            syncOutput = error.localizedDescription
        }
    }

    func syncDryRun() async {
        let path = peerWorkspacePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return }
        do {
            syncOutput = prettyJSON(try await commandJSON(["sync", "dry-run", "--peer-workspace", path, "--scope", "project", "--json"]))
        } catch {
            syncOutput = error.localizedDescription
        }
    }

    func openWorkspaceFromURL(_ url: URL) {
        guard url.scheme == "openknowledge",
              url.host == "workspace",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let path = components.queryItems?.first(where: { $0.name == "path" })?.value,
              !path.isEmpty else {
            return
        }
        workspacePath = path
        Task { await refresh() }
    }

    func chooseWorkspace() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = workspaceURL
        if panel.runModal() == .OK, let url = panel.url {
            workspacePath = url.path
            Task { await refresh() }
        }
    }

    private func resolvedCloudUse(for mode: KnowledgeRunMode) -> Bool {
        switch mode {
        case .local:
            return false
        case .cloud:
            return true
        case .automatic:
            return snapshot.cloudReady
        }
    }

    private func commandJSON(_ args: [String]) async throws -> [String: Any] {
        try await runner.runJSON(args, cwd: workspaceURL)
    }

    private func safeCommandJSON(_ args: [String]) async -> [String: Any] {
        do {
            return try await commandJSON(args)
        } catch {
            return [
                "ok": false,
                "command": (["knowledge"] + args).joined(separator: " "),
                "error": error.localizedDescription
            ]
        }
    }
}
