import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationSplitView {
            List(SidebarItem.allCases, selection: $model.selectedItem) { item in
                Label(item.rawValue, systemImage: item.systemImage)
                    .tag(item)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 190, ideal: 220, max: 280)
        } detail: {
            Group {
                switch model.currentItem {
                case .dashboard:
                    DashboardView()
                case .sources:
                    SourcesView()
                case .searchAsk:
                    SearchAskView()
                case .notes:
                    NotesView()
                case .ingestion:
                    IngestionView()
                case .sync:
                    SyncView()
                case .settings:
                    SettingsView()
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    StatusPill(
                        label: model.snapshot.mode.capitalized,
                        systemImage: model.snapshot.mode == "hosted" ? "icloud" : "internaldrive",
                        tone: model.snapshot.mode == "hosted" ? .ok : .neutral
                    )
                    StatusPill(
                        label: model.snapshot.authenticated ? "Cloud Ready" : "Local Only",
                        systemImage: model.snapshot.authenticated ? "checkmark.seal" : "icloud.slash",
                        tone: model.snapshot.authenticated ? .ok : .warning
                    )
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .help("Refresh local and cloud status")
                    .disabled(model.isRefreshing)
                }
            }
        }
    }
}

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    SectionHeader(
                        title: "Open Knowledge",
                        subtitle: model.snapshot.workspaceHome.isEmpty ? model.workspacePath : model.snapshot.workspaceHome
                    )
                    Spacer()
                    if let refreshedAt = model.snapshot.refreshedAt {
                        Text(refreshedAt, style: .time)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let error = model.snapshot.lastError {
                    StatusBanner(title: "Refresh failed", message: error, tone: .danger)
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
                    MetricTile(title: "Sources", value: "\(model.snapshot.db.int("sources") ?? 0)", detail: "Indexed source refs", systemImage: "folder")
                    MetricTile(title: "Chunks", value: "\(model.snapshot.db.int("chunks") ?? 0)", detail: "Searchable excerpts", systemImage: "text.quote")
                    MetricTile(title: "Wiki Pages", value: "\(model.snapshot.db.int("wiki_pages") ?? 0)", detail: "Generated artifacts", systemImage: "doc.richtext")
                    MetricTile(title: "Runs", value: "\(model.snapshot.db.int("runs") ?? 0)", detail: "Prompt and maintenance ledger", systemImage: "clock.arrow.circlepath")
                    MetricTile(title: "Conflicts", value: "\(model.snapshot.openConflicts)", detail: "Open sync conflicts", systemImage: "exclamationmark.triangle")
                    MetricTile(title: "Providers", value: "\(model.snapshot.activeProviderCount)/\(model.snapshot.providerCount)", detail: "Configured AI providers", systemImage: "cpu")
                }

                HStack(alignment: .top, spacing: 12) {
                    OKCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Local Store", subtitle: nil)
                            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                                KeyValueRow(key: "Mode", value: model.snapshot.mode)
                                KeyValueRow(key: "Storage", value: model.snapshot.storageType)
                                KeyValueRow(key: "Schema", value: "\(model.snapshot.db.int("schema_version") ?? 0)")
                                KeyValueRow(key: "Validation", value: model.snapshot.validation.bool("ok") == true ? "Strict validation ok" : "Needs attention")
                            }
                        }
                    }
                    OKCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Cloud", subtitle: nil)
                            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                                KeyValueRow(key: "API", value: model.snapshot.apiUrl)
                                KeyValueRow(key: "Auth", value: model.snapshot.authenticated ? "Authenticated" : "Not authenticated")
                                KeyValueRow(key: "Source", value: model.snapshot.auth.string("source") ?? "none")
                                KeyValueRow(key: "Client", value: model.snapshot.cloudReady ? "Ready" : "Unavailable")
                            }
                        }
                    }
                }

                RecentRunsView()
            }
            .okPagePadding()
        }
        .navigationTitle("Dashboard")
    }
}

struct SourcesView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "Sources", subtitle: "Read-only source refs, revisions, and chunks owned by open-files or imported source refs.")

                if model.snapshot.sourceRows.isEmpty {
                    EmptyState(systemImage: "folder.badge.questionmark", title: "No indexed sources", message: "Ingest an open-files, file, s3, http, or https source ref from the Ingestion page.")
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(Array(model.snapshot.sourceRows.enumerated()), id: \.offset) { _, row in
                            OKCard {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Label(row.string("kind") ?? "source", systemImage: "doc.text.magnifyingglass")
                                            .font(.headline)
                                        Spacer()
                                        Text("\(row.int("chunks") ?? 0) chunk(s)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(row.string("title") ?? row.string("uri") ?? "Untitled source")
                                        .font(.callout.weight(.medium))
                                    Text(row.string("uri") ?? "")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                    }
                }
            }
            .okPagePadding()
        }
        .navigationTitle("Sources")
    }
}

struct SearchAskView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "Search & Ask", subtitle: "Query local knowledge or the hosted API using the same source and artifact contracts.")

                HStack(alignment: .top, spacing: 12) {
                    OKCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Search", systemImage: "magnifyingglass")
                                .font(.headline)
                            TextField("Search indexed knowledge", text: $model.searchQuery, axis: .vertical)
                                .textFieldStyle(.roundedBorder)
                            HStack {
                                Picker("Mode", selection: $model.searchMode) {
                                    ForEach(KnowledgeRunMode.allCases) { mode in
                                        Text(mode.rawValue).tag(mode)
                                    }
                                }
                                .pickerStyle(.segmented)
                                Toggle("Semantic", isOn: $model.searchSemantic)
                                Stepper("Limit \(model.searchLimit)", value: $model.searchLimit, in: 1...25)
                            }
                            Button {
                                Task { await model.search() }
                            } label: {
                                Label(model.isSearching ? "Searching" : "Search", systemImage: "magnifyingglass")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(OKDesign.accent)
                            .disabled(model.isSearching || model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }

                    OKCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Ask", systemImage: "quote.bubble")
                                .font(.headline)
                            TextField("Ask a citation-backed question", text: $model.askPrompt, axis: .vertical)
                                .lineLimit(3...7)
                                .textFieldStyle(.roundedBorder)
                            HStack {
                                Picker("Mode", selection: $model.askMode) {
                                    ForEach(KnowledgeRunMode.allCases) { mode in
                                        Text(mode.rawValue).tag(mode)
                                    }
                                }
                                .pickerStyle(.segmented)
                                Toggle("Semantic", isOn: $model.askSemantic)
                                Toggle("Generate", isOn: $model.askGenerate)
                            }
                            Stepper("Limit \(model.askLimit)", value: $model.askLimit, in: 1...25)
                            Button {
                                Task { await model.ask() }
                            } label: {
                                Label(model.isAsking ? "Asking" : "Ask", systemImage: "arrow.up.message")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(OKDesign.accent)
                            .disabled(model.isAsking || model.askPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }

                OutputPanel(title: "Search Result", text: model.searchResultText)
                OutputPanel(title: "Answer Result", text: model.askResultText)
            }
            .okPagePadding()
        }
        .navigationTitle("Search & Ask")
    }
}

struct NotesView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "Notes", subtitle: "Compatibility notes from the local JSON store. Source-backed knowledge should use ingestion and cited wiki workflows.")

                OKCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Add Note", systemImage: "square.and.pencil")
                            .font(.headline)
                        TextField("Title", text: $model.noteTitle)
                            .textFieldStyle(.roundedBorder)
                        TextField("Content", text: $model.noteContent, axis: .vertical)
                            .lineLimit(4...10)
                            .textFieldStyle(.roundedBorder)
                        Button {
                            Task { await model.addNote() }
                        } label: {
                            Label("Add", systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(OKDesign.accent)
                    }
                }

                if !model.noteOutput.isEmpty {
                    OutputPanel(title: "Note Output", text: model.noteOutput)
                }

                if model.snapshot.itemRows.isEmpty {
                    EmptyState(systemImage: "note.text", title: "No notes", message: "Add a note above or ingest source-backed knowledge.")
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(Array(model.snapshot.itemRows.enumerated()), id: \.offset) { _, row in
                            OKCard {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(row.string("title") ?? "Untitled")
                                        .font(.headline)
                                    Text(row.string("content_preview") ?? "")
                                        .font(.callout)
                                        .foregroundStyle(.secondary)
                                    let tags = row.array("tags")?.compactMap { $0 as? String } ?? []
                                    if !tags.isEmpty {
                                        Text(tags.joined(separator: ", "))
                                            .font(.caption)
                                            .foregroundStyle(OKDesign.linkAccent)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .okPagePadding()
        }
        .navigationTitle("Notes")
    }
}

struct IngestionView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "Ingestion & Indexing", subtitle: "Import source refs, consume manifests, and refresh derived search state through the knowledge CLI.")

                HStack(alignment: .top, spacing: 12) {
                    OKCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Source Ref", systemImage: "link")
                                .font(.headline)
                            TextField("open-files://file/... or file:///absolute/path", text: $model.sourceRef)
                                .textFieldStyle(.roundedBorder)
                            Button {
                                Task { await model.ingestSource() }
                            } label: {
                                Label("Ingest Source", systemImage: "tray.and.arrow.down")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(OKDesign.accent)
                            .disabled(model.isIngesting)
                        }
                    }

                    OKCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Manifest", systemImage: "list.bullet.rectangle")
                                .font(.headline)
                            TextField("open-files manifest JSONL path or s3://...", text: $model.manifestPath)
                                .textFieldStyle(.roundedBorder)
                            Button {
                                Task { await model.ingestManifest() }
                            } label: {
                                Label("Ingest Manifest", systemImage: "square.and.arrow.down")
                            }
                            .buttonStyle(.bordered)
                            .disabled(model.isIngesting)
                        }
                    }
                }

                OKCard {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Index Maintenance")
                                .font(.headline)
                            Text("Queue missing embeddings or run deterministic fake embeddings for local smoke checks.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            Task { await model.reindexEnqueue() }
                        } label: {
                            Label("Queue", systemImage: "text.badge.plus")
                        }
                        Button {
                            Task { await model.refreshFakeEmbeddings() }
                        } label: {
                            Label("Fake Embeddings", systemImage: "sparkles")
                        }
                    }
                }

                OutputPanel(title: "Ingestion Output", text: model.ingestOutput)
            }
            .okPagePadding()
        }
        .navigationTitle("Ingestion")
    }
}

struct SyncView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "Sync", subtitle: "Inspect machine sync state, create local snapshots, and dry-run peer sync.")

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], spacing: 12) {
                    MetricTile(title: "Machines", value: "\(dictionary(model.snapshot.sync, "machines")?.int("total") ?? 0)", detail: "Registered sync machines", systemImage: "desktopcomputer")
                    MetricTile(title: "Snapshots", value: "\(dictionary(model.snapshot.sync, "snapshots")?.int("total") ?? 0)", detail: "Local sync snapshots", systemImage: "camera.metering.matrix")
                    MetricTile(title: "Imports", value: "\(dictionary(model.snapshot.sync, "imports")?.int("total") ?? 0)", detail: "Applied bundles", systemImage: "square.and.arrow.down")
                    MetricTile(title: "Open Conflicts", value: "\(model.snapshot.openConflicts)", detail: "Needs resolution", systemImage: "exclamationmark.triangle")
                }

                OKCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Button {
                                Task { await model.syncSnapshot() }
                            } label: {
                                Label("Snapshot", systemImage: "camera")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(OKDesign.accent)
                            TextField("Peer workspace path", text: $model.peerWorkspacePath)
                                .textFieldStyle(.roundedBorder)
                            Button {
                                Task { await model.syncDryRun() }
                            } label: {
                                Label("Dry Run", systemImage: "arrow.triangle.branch")
                            }
                        }
                    }
                }

                OutputPanel(title: "Sync Status", text: prettyJSON(model.snapshot.sync))
                OutputPanel(title: "Sync Output", text: model.syncOutput)
            }
            .okPagePadding()
        }
        .navigationTitle("Sync")
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "Settings", subtitle: "Configure the local command, workspace, hosted API, and account status.")

                OKCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Local Runtime", systemImage: "terminal")
                            .font(.headline)
                        TextField("knowledge command", text: $model.commandPath)
                            .textFieldStyle(.roundedBorder)
                        HStack {
                            TextField("Workspace", text: $model.workspacePath)
                                .textFieldStyle(.roundedBorder)
                            Button {
                                model.chooseWorkspace()
                            } label: {
                                Label("Choose", systemImage: "folder")
                            }
                            Button {
                                Task { await model.refresh() }
                            } label: {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                        }
                    }
                }

                OKCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Hosted Account", systemImage: "icloud")
                            .font(.headline)
                        TextField("Hosted API URL", text: $model.hostedApiUrl)
                            .textFieldStyle(.roundedBorder)
                        HStack {
                            TextField("Email", text: $model.loginEmail)
                                .textFieldStyle(.roundedBorder)
                            TextField("Organization", text: $model.loginOrg)
                                .textFieldStyle(.roundedBorder)
                        }
                        SecureField("API key", text: $model.loginApiKey)
                            .textFieldStyle(.roundedBorder)
                        HStack {
                            Button {
                                Task { await model.setupLocal() }
                            } label: {
                                Label("Use Local", systemImage: "internaldrive")
                            }
                            Button {
                                Task { await model.setupHosted() }
                            } label: {
                                Label("Use Hosted", systemImage: "icloud")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(OKDesign.accent)
                            Button {
                                Task { await model.loginHosted() }
                            } label: {
                                Label("Login", systemImage: "key")
                            }
                            Button {
                                Task { await model.logoutHosted() }
                            } label: {
                                Label("Logout", systemImage: "rectangle.portrait.and.arrow.right")
                            }
                        }
                    }
                }

                OKCard {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Status", subtitle: nil)
                        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                            KeyValueRow(key: "Mode", value: model.snapshot.mode)
                            KeyValueRow(key: "Storage", value: model.snapshot.storageType)
                            KeyValueRow(key: "API", value: model.snapshot.apiUrl)
                            KeyValueRow(key: "Auth", value: model.snapshot.authenticated ? "Authenticated" : "Not authenticated")
                            KeyValueRow(key: "Providers", value: "\(model.snapshot.activeProviderCount)/\(model.snapshot.providerCount)")
                        }
                    }
                }

                OutputPanel(title: "Settings Output", text: model.settingsOutput)
            }
            .okPagePadding()
        }
        .navigationTitle("Settings")
    }
}

struct RecentRunsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        OKCard {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: "Recent Runs", subtitle: nil)
                if model.snapshot.runRows.isEmpty {
                    Text("No runs recorded yet.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(model.snapshot.runRows.prefix(6).enumerated()), id: \.offset) { _, row in
                        HStack {
                            Label(row.string("type") ?? "run", systemImage: "clock")
                            Text(row.string("status") ?? "unknown")
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(row.string("id") ?? "")
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}

struct OutputPanel: View {
    let title: String
    let text: String

    var body: some View {
        OKCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.headline)
                ScrollView(.horizontal) {
                    Text(text.isEmpty ? "No output yet." : text)
                        .font(.system(.callout, design: .monospaced))
                        .foregroundStyle(text.isEmpty ? .secondary : .primary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 90, maxHeight: 260)
            }
        }
    }
}

struct EmptyState: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        OKCard {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                    Text(message)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct StatusBanner: View {
    let title: String
    let message: String
    let tone: StatusPill.Tone

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone == .danger ? "exclamationmark.triangle" : "info.circle")
                .foregroundStyle(tone.color)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(12)
        .background(tone.color.opacity(0.10), in: RoundedRectangle(cornerRadius: OKDesign.cardRadius, style: .continuous))
    }
}
