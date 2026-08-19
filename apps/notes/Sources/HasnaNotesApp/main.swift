// Hasna Notes — native macOS shell hosting the bundled web UI in a WKWebView.
//
// The UI itself lives in `web/` (copied into the app bundle at
// Contents/Resources/web). This shell:
//   1. opens a hidden-titlebar window and loads index.html offline (file://),
//   2. tags the document with the `native` body class so the web UI drops its
//      desktop-frame chrome and fills the OS window edge-to-edge, and
//   3. bridges REAL notes data between the HOSTED notes API (cloud-only
//      storage, `HasnaNotesCore.NotesHttpStore`) and the web UI:
//        - reads the store at launch and injects
//          `window.__BOOT__ = { notes, labels, settings }` as a
//          document-start user script (available before the page's JS runs),
//        - receives `{action, note}` messages on the `notes` message handler
//          (save / create / delete), writes them to disk, then pushes fresh
//          data back into the page via `window.HasnaNotes.hydrate(...)`.
//          (The rename 7c0cc889f4 had inserted a space — "window.Hasna Notes" —
//          which is a JS SyntaxError and silently killed every host->web call:
//          hydrate after mutations, destroy, and the menu-bar recording controls.)
import AppKit
import WebKit
import HasnaNotesCore
import Foundation

// MARK: - AI sidecar

/// Spawns and supervises the bundled Node AI sidecar (`Resources/ai-sidecar/server.mjs`).
///
/// The sidecar provides note auto-titling (`/title`) and voice-note transcription
/// (`/transcribe`) via the Vercel AI SDK + OpenAI. The host:
///   - finds a `node` binary,
///   - picks a free loopback TCP port,
///   - reads the OpenAI key from `OPENAI_API_KEY` (or `~/.hasna/notes/secrets/openai.env`),
///   - launches the child with `OPENAI_API_KEY`, `PORT`, and a per-run sidecar token,
///   - pipes child stdout/stderr to `NSLog` (prefix `Sidecar:`).
///
/// If node or the key is missing it simply doesn't spawn; `available` stays false and the
/// renderer disables AI features (it never crashes the app).
final class AISidecar {
    private(set) var port: Int = 0
    private(set) var running: Bool = false
    private(set) var available: Bool = false
    private(set) var realtimeAvailable: Bool = false
    private(set) var realtimeProvider: String = "openai"
    private(set) var token: String = UUID().uuidString + "-" + UUID().uuidString
    private var process: Process?

    /// Durable log file for sidecar output (port, request errors). NSLog visibility in the
    /// unified log is inconsistent across macOS releases, so we ALSO append here so the
    /// port and health are always recoverable: `~/Library/Logs/Hasna Notes/sidecar.log`.
    private static let logFileURL: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Hasna Notes", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("sidecar.log")
    }()

    /// Append a line to both NSLog (prefixed `Sidecar:`) and the durable log file.
    private static func logLine(_ line: String) {
        let str = line.hasPrefix("Sidecar:") ? line : "Sidecar: " + line
        NSLog("%@", str)
        let stamped = ISO8601DateFormatter().string(from: Date()) + " " + str + "\n"
        if let data = stamped.data(using: .utf8) {
            if let handle = try? FileHandle(forWritingTo: logFileURL) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            } else {
                try? data.write(to: logFileURL)
            }
        }
    }

    /// Candidate absolute node paths, then a PATH lookup via `/usr/bin/env`.
    /// Internal (not private) so callers can reuse the same resolution.
    static func findNode() -> String? {
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        for p in candidates where FileManager.default.isExecutableFile(atPath: p) {
            return p
        }
        // Fall back to `env node` resolution.
        let which = Process()
        which.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        which.arguments = ["node", "--version"]
        which.standardOutput = Pipe()
        which.standardError = Pipe()
        do {
            try which.run()
            which.waitUntilExit()
            if which.terminationStatus == 0 { return "/usr/bin/env" } // launch via env node
        } catch { /* not found */ }
        return nil
    }

    /// Optional per-app secrets file: `~/.hasna/notes/secrets/<name>.env`.
    /// Lets users hand the shell app a key without exporting env vars globally.
    private static func secretsFile(_ name: String) -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hasna/notes/secrets/\(name).env")
    }

    /// Read the OpenAI `sk-...` key from the process env, else the optional secrets file.
    private static func readKey() -> String? {
        if let env = ProcessInfo.processInfo.environment["OPENAI_API_KEY"], env.hasPrefix("sk-") {
            return env
        }
        if let text = try? String(contentsOf: secretsFile("openai"), encoding: .utf8) {
            // Match an sk-... token anywhere (handles KEY=value, quotes, export prefixes).
            if let range = text.range(of: "sk-[A-Za-z0-9_-]+", options: .regularExpression) {
                let key = String(text[range])
                if key.count > 20 { return key }
            }
        }
        return nil
    }

    private static func readElevenLabsKey() -> String? {
        if let env = ProcessInfo.processInfo.environment["ELEVENLABS_API_KEY"], !env.isEmpty {
            return env
        }
        if let text = try? String(contentsOf: secretsFile("elevenlabs"), encoding: .utf8) {
            if let range = text.range(of: "[A-Za-z0-9_-]{20,}", options: .regularExpression) {
                return String(text[range])
            }
        }
        return nil
    }

    /// Bind a socket to port 0, read the OS-assigned port, close it, and return the number.
    /// There is an inherent (tiny) race between close and the child binding, acceptable here.
    private static func freePort() -> Int? {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_port = 0
        let bound = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.bind(fd, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { return nil }
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        var assigned = sockaddr_in()
        let got = withUnsafeMutablePointer(to: &assigned) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.getsockname(fd, sa, &len)
            }
        }
        guard got == 0 else { return nil }
        return Int(UInt16(bigEndian: assigned.sin_port))
    }

    /// Locate `Resources/ai-sidecar/server.mjs` in the bundle.
    private static func serverScript() -> URL? {
        guard let res = Bundle.main.resourceURL else { return nil }
        let script = res.appendingPathComponent("ai-sidecar/server.mjs")
        return FileManager.default.fileExists(atPath: script.path) ? script : nil
    }

    /// Start the sidecar. Returns immediately; sets `available`/`port` as a side effect.
    func start() {
        guard let script = AISidecar.serverScript() else {
            AISidecar.logLine("server.mjs not found in bundle — AI features disabled")
            available = false
            return
        }
        guard let node = AISidecar.findNode() else {
            AISidecar.logLine("no node binary found — AI features disabled")
            available = false
            return
        }
        let openAIKey = AISidecar.readKey()
        let elevenLabsKey = AISidecar.readElevenLabsKey()
        guard openAIKey != nil || elevenLabsKey != nil else {
            AISidecar.logLine("no OpenAI or ElevenLabs key found — AI features disabled")
            available = false
            realtimeAvailable = false
            return
        }
        guard let chosen = AISidecar.freePort() else {
            AISidecar.logLine("could not allocate a free port — AI features disabled")
            available = false
            return
        }
        self.port = chosen

        let proc = Process()
        if node == "/usr/bin/env" {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            proc.arguments = ["node", script.path]
        } else {
            proc.executableURL = URL(fileURLWithPath: node)
            proc.arguments = [script.path]
        }
        var env = ProcessInfo.processInfo.environment
        if let openAIKey { env["OPENAI_API_KEY"] = openAIKey }
        if let elevenLabsKey { env["ELEVENLABS_API_KEY"] = elevenLabsKey }
        env["PORT"] = String(chosen)
        env["HASNA_NOTES_SIDECAR_TOKEN"] = token
        proc.environment = env
        let requestedProvider = (env["HASNA_NOTES_TRANSCRIPTION_PROVIDER"] ?? "").lowercased()
        let chosenRealtimeProvider: String
        if requestedProvider == "elevenlabs", elevenLabsKey != nil {
            chosenRealtimeProvider = "elevenlabs"
        } else if requestedProvider == "openai", openAIKey != nil {
            chosenRealtimeProvider = "openai"
        } else {
            chosenRealtimeProvider = openAIKey != nil ? "openai" : "elevenlabs"
        }

        // Pipe child stdout/stderr to NSLog + the durable log file (prefix `Sidecar:`).
        // The child never prints the key, so these logs are safe. The handler is @Sendable
        // (touches only its argument + the static logger) to satisfy Swift 6 concurrency.
        let out = Pipe(), err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        let logHandler: @Sendable (FileHandle) -> Void = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let s = String(data: data, encoding: .utf8) else { return }
            for line in s.split(separator: "\n") where !line.isEmpty {
                AISidecar.logLine(String(line))
            }
        }
        out.fileHandleForReading.readabilityHandler = logHandler
        err.fileHandleForReading.readabilityHandler = logHandler

        do {
            try proc.run()
            self.process = proc
            self.running = true
            self.available = openAIKey != nil
            self.realtimeAvailable = openAIKey != nil || elevenLabsKey != nil
            self.realtimeProvider = chosenRealtimeProvider
            AISidecar.logLine("spawned node pid=\(proc.processIdentifier) port=\(chosen) script=\(script.path) openai=\(openAIKey != nil) elevenlabs=\(elevenLabsKey != nil)")
        } catch {
            AISidecar.logLine("failed to launch node: \(error.localizedDescription)")
            self.running = false
            self.available = false
            self.realtimeAvailable = false
        }
    }

    /// Terminate the child (called on app terminate).
    func stop() {
        process?.terminate()
        process = nil
        running = false
    }
}

// MARK: - JSON helpers

/// Encode a Swift value graph (dictionaries/arrays/strings/numbers) into a compact
/// JSON string suitable for embedding in `window.__BOOT__ = <json>` and in
/// `evaluateJavaScript` arguments. Falls back to `null` on failure.
private func jsonString(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value) else {
        // Top-level scalars aren't valid JSON objects for JSONSerialization; wrap+unwrap.
        if let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
           let s = String(data: data, encoding: .utf8) {
            // strip the surrounding [ ]
            return String(s.dropFirst().dropLast())
        }
        return "null"
    }
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: []),
          let s = String(data: data, encoding: .utf8) else {
        return "null"
    }
    return s
}

/// Map a `Note` to the JSON-shaped dictionary the web UI consumes.
private func noteJSON(_ note: Note) -> [String: Any] {
    let contentPreview = note.body
        .replacingOccurrences(of: "\n", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return [
        "id": note.id.uuidString.lowercased(),
        "title": note.title,
        "body": note.body,
        "content": note.body,
        "contentFormat": note.contentFormat,
        "contentPreview": String(contentPreview.prefix(500)),
        "labels": note.labels,
        "tags": note.labels, // migration alias; user-facing name is labels
        "status": note.status.rawValue,
        "folder": note.folder,
        "machine": note.machine,
        "machineFriendlyName": note.machineFriendlyName,
        "rev": note.rev,
        "createdByActorType": note.createdByActorType,
        "createdByName": note.createdByName,
        "archivedAt": note.archivedAt.map(MarkdownStore.iso8601) ?? "",
        "trashedAt": note.trashedAt.map(MarkdownStore.iso8601) ?? "",
        "trashExpiresAt": note.trashExpiresAt.map(MarkdownStore.iso8601) ?? "",
        "restoredAt": note.restoredAt.map(MarkdownStore.iso8601) ?? "",
        "info": [
            "createdBy": note.createdByName.isEmpty ? note.author : note.createdByName,
            "createdByActorType": note.createdByActorType,
            "createdAt": MarkdownStore.iso8601(note.createdAt),
            "machine": note.machine,
            "machineFriendlyName": note.machineFriendlyName,
            "currentMachine": note.machine,
        ],
        "titleLocked": note.titleLocked,
        "titleSource": note.titleSource.rawValue,
        "titleContentFingerprint": note.titleContentFingerprint,
        "updatedAt": MarkdownStore.iso8601(note.updatedAt),
        "createdAt": MarkdownStore.iso8601(note.createdAt),
    ]
}

// MARK: - Notes bridge

/// Owns the HOSTED note store (personalnotes/v1 HTTP API) and the
/// boot/hydrate/save/delete round-trip. Kept separate from the message-handler
/// object so the WKWebView retain graph (see WeakScriptProxy) stays clean.
///
/// CLOUD-ONLY (owner brief 2026-08-19, row eca5b6da): the macOS app reads and
/// writes notes ONLY through the hosted HTTP store selected by
/// HASNA_NOTES_API_URL + HASNA_NOTES_API_KEY. The on-disk MarkdownStore is not
/// used by the app at all — an unset URL or a URL without its key leaves the
/// bridge UNAVAILABLE (fail closed, no local fallback) and the UI boots with a
/// visible configuration error instead of silently touching local files.
/// `@unchecked Sendable`: the backing store is an immutable value; mutations
/// are serialized by the app delegate's `notesQueue` + `mutationSerializer`.
final class NotesBridge: @unchecked Sendable {
    enum Backing {
        case http(NotesHttpStore)
        case unavailable(reason: String)
    }

    let backing: Backing
    let thisMachine: String

    init(env: [String: String] = ProcessInfo.processInfo.environment) {
        self.thisMachine = Note.currentMachine
        switch NotesTransportResolver.resolve(env: env) {
        case .http:
            let url = (env[NotesTransportResolver.apiUrlEnv] ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let key = (env[NotesTransportResolver.apiKeyEnv] ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !url.isEmpty, !key.isEmpty else {
                self.backing = .unavailable(
                    reason: "\(NotesTransportResolver.apiUrlEnv) and \(NotesTransportResolver.apiKeyEnv) must both be set for the hosted notes store."
                )
                return
            }
            self.backing = .http(NotesHttpStore(apiUrl: url, apiKey: key))
        case .local:
            self.backing = .unavailable(
                reason: "\(NotesTransportResolver.apiUrlEnv) is not set. This app is cloud-only: notes live in the hosted API and are never read from or written to local files on this Mac."
            )
        case .failClosed(let message):
            self.backing = .unavailable(reason: message)
        }
    }

    var unavailableReason: String? {
        if case .unavailable(let reason) = backing { return reason }
        return nil
    }

    private var httpStore: NotesHttpStore? {
        if case .http(let store) = backing { return store }
        return nil
    }

    /// The user's trash-retention preference. A UI preference only (the hosted
    /// API has no settings surface, and trash is never purged — owner brief
    /// req 8), persisted in UserDefaults rather than in a note file.
    private static let retentionPrefKey = "notes.trashRetentionDays"
    var trashRetentionDays: Int {
        get {
            let stored = UserDefaults.standard.integer(forKey: Self.retentionPrefKey)
            return stored > 0 ? stored : NotesSettings.defaultTrashRetentionDays
        }
        set { UserDefaults.standard.set(max(1, newValue), forKey: Self.retentionPrefKey) }
    }

    /// Load all notes from the hosted store (newest first, paged to
    /// exhaustion, trashed notes included). Never throws to the caller — an
    /// unreachable store yields an empty list and the UI falls back gracefully.
    func loadNotes() async -> [Note] {
        guard let store = httpStore else { return [] }
        do {
            var all: [NotesWireNote] = []
            var cursor: String? = nil
            repeat {
                let (notes, next) = try await store.listPage(includeDeleted: true, cursor: cursor)
                all.append(contentsOf: notes)
                cursor = next
            } while cursor != nil
            let retention = trashRetentionDays
            return all.map { NotesWireMapping.note(from: $0, retentionDays: retention) }
        } catch {
            NSLog("Hasna Notes: loadNotes failed: \(error.localizedDescription)")
            return []
        }
    }

    /// The `{notes, labels, settings, error?}` boot payload as a JSON string.
    func bootJSON() async -> String {
        let notes = await loadNotes()
        var payload: [String: Any] = [
            "notes": notes.map(noteJSON),
            // In hosted mode the label list is derived from the notes the
            // server stores — there is no separate local labels file.
            "labels": NotesBridge.labelUnion(notes),
            "settings": ["trashRetentionDays": trashRetentionDays],
            "listDefaults": ["limit": 10],
        ]
        if let reason = unavailableReason {
            payload["error"] = ["message": reason]
        }
        return jsonString(payload)
    }

    /// Union of every note's labels, order-preserving, deduplicated
    /// case-insensitively (same normalization as LabelStore).
    static func labelUnion(_ notes: [Note]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for note in notes {
            for label in note.labels {
                let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
                let key = trimmed.lowercased()
                guard !trimmed.isEmpty, !seen.contains(key) else { continue }
                seen.insert(key)
                out.append(trimmed)
            }
        }
        return out
    }

    // MARK: mutations

    /// Build a `Note` from a JS message payload. New notes (create) get a fresh UUID,
    /// `machine = thisMachine`, and `agent = Note.appAgent`. Saves preserve the id and
    /// (for existing notes) the original createdAt/machine from the hosted store.
    private func note(from dict: [String: Any], isCreate: Bool, existing: Note?) -> Note {
        let id = (dict["id"] as? String).flatMap { UUID(uuidString: $0) } ?? UUID()
        let title = (dict["title"] as? String) ?? ""
        let body = (dict["body"] as? String) ?? ""
        let labels = (dict["labels"] as? [String]) ?? (dict["tags"] as? [String]) ?? []
        let status = (dict["status"] as? String).flatMap { NoteStatus(rawValue: $0) } ?? .active
        let folder = (dict["folder"] as? String) ?? ""
        let contentFormat = (dict["contentFormat"] as? String) ?? (dict["contentType"] as? String) ?? "markdown"
        let titleSource = (dict["titleSource"] as? String).flatMap(NoteTitleSource.init(rawValue:))
        let titleLocked = (dict["titleLocked"] as? Bool)
            ?? (titleSource == .manual && !Note.isDefaultTitle(title))
        let titleContentFingerprint = (dict["titleContentFingerprint"] as? String) ?? ""

        let createdAt = existing?.createdAt
            ?? (dict["createdAt"] as? String).flatMap(MarkdownStore.parseDate)
            ?? Date()
        // Respect the client's updatedAt stamp (the web layer sets it at commit time).
        // Re-stamping with Date() here made the hydrate echo of every save compare
        // "newer" than the edit that produced it, so the web editor adopted its own
        // echo — including stale echoes of earlier queued saves — and stomped
        // keystrokes still in flight. Callers that send no stamp keep the old behavior.
        let updatedAt = (dict["updatedAt"] as? String).flatMap(MarkdownStore.parseDate) ?? Date()
        // Empty string counts as absent: the web layer no longer knows the
        // machine identity (the machine surface was removed), so attribution
        // falls back to this machine's stable identity here in the host.
        let machine = existing?.machine
            ?? (dict["machine"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? thisMachine
        let machineFriendlyName = existing?.machineFriendlyName ?? (dict["machineFriendlyName"] as? String) ?? ""
        let author = (dict["author"] as? String) ?? existing?.author ?? Note.currentAuthor
        let agent = (dict["agent"] as? String) ?? existing?.agent ?? Note.appAgent
        // `rev` is advisory here: the server bumps its own revision per update.
        let rev = (dict["rev"] as? Int) ?? existing?.rev ?? 1
        let createdByActorType = (dict["createdByActorType"] as? String) ?? existing?.createdByActorType ?? "human"
        let createdByName = (dict["createdByName"] as? String) ?? existing?.createdByName ?? author
        let archivedAt = (dict["archivedAt"] as? String).flatMap(MarkdownStore.parseDate) ?? existing?.archivedAt
        let trashedAt = (dict["trashedAt"] as? String).flatMap(MarkdownStore.parseDate) ?? existing?.trashedAt
        let trashExpiresAt = (dict["trashExpiresAt"] as? String).flatMap(MarkdownStore.parseDate) ?? existing?.trashExpiresAt
        let restoredAt = (dict["restoredAt"] as? String).flatMap(MarkdownStore.parseDate) ?? existing?.restoredAt

        return Note(
            id: id,
            title: title.isEmpty ? "Untitled Note" : title,
            labels: labels,
            status: status,
            folder: folder,
            contentFormat: contentFormat,
            titleLocked: titleLocked,
            titleSource: titleSource,
            titleContentFingerprint: titleContentFingerprint,
            rev: rev,
            createdAt: createdAt,
            updatedAt: updatedAt,
            author: author,
            agent: agent,
            machine: machine,
            machineFriendlyName: machineFriendlyName,
            createdByActorType: createdByActorType,
            createdByName: createdByName,
            archivedAt: archivedAt,
            trashedAt: trashedAt,
            trashExpiresAt: trashExpiresAt,
            restoredAt: restoredAt,
            body: body
        )
    }

    private func noteFromPayload(_ dict: [String: Any]) async -> Note? {
        guard let idStr = dict["id"] as? String, let id = UUID(uuidString: idStr) else { return nil }
        return await loadNotes().first(where: { $0.id == id })
    }

    /// Persist a create/save through the hosted store. Returns true on success.
    /// The server logs the note.created/note.updated audit event itself — the
    /// old local create-intent spool is retired with the on-disk store.
    @discardableResult
    func save(_ dict: [String: Any], isCreate: Bool) async -> Bool {
        guard let store = httpStore else {
            NSLog("Hasna Notes: save refused — hosted store unavailable: \(unavailableReason ?? "unknown")")
            return false
        }
        let payloadID = (dict["id"] as? String).flatMap { UUID(uuidString: $0) }
        let existing = isCreate ? nil : await loadNotes().first(where: { $0.id == payloadID })
        let note = note(from: dict, isCreate: isCreate, existing: existing)
        do {
            if isCreate {
                _ = try await store.createNote(NotesWireMapping.wireCreatePayload(for: note))
            } else {
                _ = try await store.updateNote(id: note.id.uuidString.lowercased(), NotesWireMapping.wireUpdatePayload(for: note))
            }
            return true
        } catch {
            NSLog("Hasna Notes: save failed: \(error.localizedDescription)")
            return false
        }
    }

    private func patch(_ note: Note) async -> Bool {
        guard let store = httpStore else { return false }
        do {
            _ = try await store.updateNote(id: note.id.uuidString.lowercased(), NotesWireMapping.wireUpdatePayload(for: note))
            return true
        } catch {
            NSLog("Hasna Notes: update failed: \(error.localizedDescription)")
            return false
        }
    }

    @discardableResult
    func archive(_ dict: [String: Any]) async -> Bool {
        guard var existing = await noteFromPayload(dict) else { return false }
        existing.status = .archived
        existing.archivedAt = Date()
        existing.trashedAt = nil
        existing.trashExpiresAt = nil
        existing.updatedAt = Date()
        return await patch(existing)
    }

    @discardableResult
    func trash(_ dict: [String: Any]) async -> Bool {
        guard let existing = await noteFromPayload(dict) else { return false }
        return await deleteNote(existing)
    }

    @discardableResult
    func restore(_ dict: [String: Any]) async -> Bool {
        guard var existing = await noteFromPayload(dict) else { return false }
        existing.status = .active
        existing.archivedAt = nil
        existing.trashedAt = nil
        existing.trashExpiresAt = nil
        existing.restoredAt = Date()
        existing.updatedAt = Date()
        return await patch(existing)
    }

    /// Soft-delete the note identified by the payload's id — SOFT DELETE ONLY
    /// (owner brief 2026-08-19 req 8): trash is never deleted, so delete()
    /// moves to Trash at most and NEVER purges. A note already in Trash stays
    /// hidden forever. The server stamps the delete tombstone; the wire note
    /// then reads back as `.trash`.
    @discardableResult
    func delete(_ dict: [String: Any]) async -> Bool {
        guard let idStr = dict["id"] as? String, let id = UUID(uuidString: idStr) else { return false }
        if let existing = await loadNotes().first(where: { $0.id == id }), existing.status == .trash {
            return false
        }
        return await trash(dict)
    }

    /// Permanent deletion is DISABLED app-wide (owner brief 2026-08-19 req 8: trash is
    /// never deleted — soft delete / hidden state only). Nothing is ever purged.
    @discardableResult
    func purge(_ dict: [String: Any]) async -> Bool {
        return false
    }

    private func deleteNote(_ note: Note) async -> Bool {
        guard let store = httpStore else { return false }
        do {
            try await store.deleteNote(id: note.id.uuidString.lowercased())
            return true
        } catch {
            NSLog("Hasna Notes: delete failed: \(error.localizedDescription)")
            return false
        }
    }

    @discardableResult
    func updateSettings(_ dict: [String: Any]) -> Bool {
        let days = (dict["trashRetentionDays"] as? Int)
            ?? (dict["trashRetentionDays"] as? NSNumber)?.intValue
            ?? NotesSettings.defaultTrashRetentionDays
        trashRetentionDays = days
        return true
    }

    /// In hosted mode the label list is derived from the notes the server
    /// stores; a standalone labels action has no server surface and is
    /// accepted as a no-op (label membership persists through note saves).
    @discardableResult
    func updateLabels(_ dict: [String: Any]) -> Bool {
        return true
    }
}
// MARK: - Brand palette (design tokens)

/// The native side of the shared design tokens (docs/design-rules-macos26.md §3.2).
/// MUST stay in sync with `web/styles.css` `:root` / `html[data-theme="dark"]`:
///   accent  #7C3AED light / #9D6BFF dark   (the ONE brand purple)
///   canvas  #FFFFFF light / #1B1D21 dark   (--bg, the continuous canvas)
/// Colors are appearance-dynamic so window backing and tints follow the effective
/// appearance instead of flashing a fixed light color in dark mode (spec §3.8, Rule 11).
enum BrandColor {
    // Computed (not stored) so the type stays trivially concurrency-safe under Swift 6.
    static var accent: NSColor {
        dynamic(
            light: NSColor(srgbRed: 0x7C / 255.0, green: 0x3A / 255.0, blue: 0xED / 255.0, alpha: 1),
            dark: NSColor(srgbRed: 0x9D / 255.0, green: 0x6B / 255.0, blue: 0xFF / 255.0, alpha: 1)
        )
    }
    static var canvas: NSColor {
        dynamic(
            light: .white,
            dark: NSColor(srgbRed: 0x1B / 255.0, green: 0x1D / 255.0, blue: 0x21 / 255.0, alpha: 1)
        )
    }

    private static func dynamic(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        }
    }
}

// MARK: - Weak message-handler proxy (leak-safety)

/// `WKUserContentController` RETAINS its script message handlers. If the AppDelegate
/// registered itself directly, the controller (owned by the configuration, owned by the
/// web view, owned by the window, owned by the delegate) would form a retain cycle and
/// the delegate/web view could never deallocate on a view teardown/reload.
///
/// This thin proxy is what the controller retains; it holds the real target WEAKLY and
/// forwards messages. On teardown the app removes the handler by name, but even if it
/// did not, the proxy's weak reference breaks the cycle. (This is the documented
/// Apple-recommended pattern for the WKScriptMessageHandler retain cycle.)
final class WeakScriptProxy: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(ucc, didReceive: message)
    }
}

// MARK: - Window drag strip

/// A transparent strip pinned to the top of the window that the user can grab to MOVE
/// the window. The window has a hidden titlebar fully covered by the WKWebView, and a
/// WKWebView swallows mouse drags — so without this the window is immovable. This view
/// overlays the empty native top-inset region and reports `mouseDownCanMoveWindow`, so a
/// drag there moves the window like a normal title bar (the traffic-light buttons, which
/// float above the content, keep working).
final class WindowDragStrip: NSView {
    /// Rects — in THIS view's local coordinate space — over which the strip must NOT
    /// claim the mouse, so the click falls through to the WKWebView below and the web
    /// control (minimize / compact-expand / compact form) receives it. The web layer
    /// reports these via the `window` message channel (`dragExclusions`); see
    /// `AppDelegate.applyDragExclusions`. Empty until the first report arrives.
    var passthroughRects: [NSRect] = []

    override var mouseDownCanMoveWindow: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        // AppKit supplies `point` in this view's coordinate space (no re-conversion —
        // a prior double-convert made the whole strip dead). Drag everywhere inside the
        // strip EXCEPT over the reported interactive controls, which pass through.
        guard bounds.contains(point) else { return nil }
        for r in passthroughRects where r.contains(point) { return nil }
        return self
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

// MARK: - App delegate

/// Carries a JS notes-mutation payload across the bridge-queue hop. `@unchecked` because
/// the dictionary comes straight from `WKScriptMessage.body` (plist value types) and is
/// never mutated after capture.
private struct NotesMutationPayload: @unchecked Sendable {
    let dict: [String: Any]
}

/// Chains async bridge mutations so the next starts only after the previous
/// completes. Replaces the ordering the old synchronous disk store got from
/// the serial `notesQueue` alone: HTTP awaits would otherwise let rapid
/// autosaves interleave and land out of order on the server.
private final class SerialMutations: @unchecked Sendable {
    private let lock = NSLock()
    private var tail: Task<Void, Never> = Task {}

    func enqueue(_ operation: @Sendable @escaping () async -> Void) {
        lock.lock()
        let previous = tail
        tail = Task {
            await previous.value
            await operation()
        }
        lock.unlock()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    /// Transparent overlay covering the full native header band; drags the window except
    /// over web-reported interactive controls. Held so `applyDragExclusions` can update it.
    private var dragStrip: WindowDragStrip?
    let bridge = NotesBridge()
    let sidecar = AISidecar()
    /// Serial queue for note mutations + the follow-up bootJSON rebuild. Script messages
    /// arrive on the main thread; running the hosted-store save/boot work there would
    /// freeze typing. The queue plus `mutationSerializer` keeps saves ordered while the
    /// UI thread only hops back in to evaluate the hydrate JavaScript.
    private let notesQueue = DispatchQueue(label: "Hasna Notes.notes-bridge", qos: .userInitiated)
    /// Orders async hosted-store mutations (see SerialMutations).
    private let mutationSerializer = SerialMutations()
    private let notesHandlerName = "notes"
    private let windowHandlerName = "window"
    private let recordingHandlerName = "recording"
    private var recordingStatus: String = "idle"
    private var recordingMenuTitleItem: NSMenuItem?
    private var recordingStartItem: NSMenuItem?
    private var recordingPauseItem: NSMenuItem?
    private var recordingResumeItem: NSMenuItem?
    private var recordingStopItem: NSMenuItem?

    // Menu-bar status item (NSStatusItem) — ALWAYS present while the app runs (vision
    // c10b7cf2/a4eff7ef: a menu-bar quick-capture app must offer "record from anywhere",
    // so the idle menu carries Start Recording + Open). While recording is active the
    // menu swaps to the elapsed timer (disabled title), Pause/Resume, and Stop. The
    // title timer ticks from a lightweight local NSTimer kept in sync by the web's
    // periodic `recording` tick messages.
    private var statusItem: NSStatusItem?
    private var statusTimerItem: NSMenuItem?
    private var statusStartItem: NSMenuItem?
    private var statusControlsSeparator: NSMenuItem?
    private var statusPauseItem: NSMenuItem?
    private var statusResumeItem: NSMenuItem?
    private var statusStopItem: NSMenuItem?
    private var statusTicker: Timer?
    private var recordingElapsedMs: Double = 0      // last elapsed reported by the web
    private var recordingElapsedSyncedAt: Date = Date()
    private var recordingPaused: Bool = false
    private var recordingLifecycleStatus: String = "idle"
    /// True while quit is deferred so an in-flight recording can stop + save first.
    private var quitPendingRecordingStop = false

    // Compact / quick-note window mode state.
    private var savedFrame: NSRect?
    private var savedLevel: NSWindow.Level = .normal
    private var savedCollectionBehavior: NSWindow.CollectionBehavior = []
    private var savedMinSize: NSSize = NSSize(width: 920, height: 640)
    private var isCompact = false

    func applicationDidFinishLaunching(_ note: Notification) {
        // Spawn the AI sidecar first so we know its port + availability before injecting
        // the `__AI__` boot flag below. Never blocks UI; failure just disables AI features.
        sidecar.start()

        let frame = NSRect(x: 0, y: 0, width: 1280, height: 820)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Hasna Notes"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        // Token canvas color (light #FFFFFF / dark #1B1D21) — follows the effective
        // appearance so dark mode never flashes a white backing on launch/resize.
        window.backgroundColor = BrandColor.canvas
        // An explicit web theme preference ('light'/'dark' in Settings → Appearance)
        // overrides the OS appearance for the whole window: re-apply the preference the
        // web layer last reported (persisted below) BEFORE first paint, so a light-theme
        // user on a dark Mac never sees a dark backing flash (Rule 11 / spec §3.8).
        applyThemePreference(UserDefaults.standard.string(forKey: Self.themePrefKey) ?? "system", persist: false)
        window.minSize = NSSize(width: 920, height: 640)
        window.center()

        // Boot is now asynchronous (the hosted HTTP store must be read before
        // `window.__BOOT__` can be injected): fetch the initial payload off the
        // main thread, then build the web view with the fresh boot JSON. The
        // window itself already exists (canvas-colored) so the UI never shows a
        // blank white frame while the store loads.
        let startupBridge = bridge
        notesQueue.async {
            Task {
                let boot = await startupBridge.bootJSON()
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    self.completeLaunch(frame: frame, boot: boot)
                }
            }
        }
    }

    /// Builds the WKWebView with the (already-fetched) boot payload and shows
    /// the window. Split out of `applicationDidFinishLaunching` because the
    /// boot payload now comes from the hosted store asynchronously.
    private func completeLaunch(frame: NSRect, boot: String) {
        let cfg = WKWebViewConfiguration()

        // 1.+2. Install the document-start user scripts (native class, `window.__BOOT__`
        //    real notes data, `window.__AI__` sidecar flag). Reinstalled with fresh boot
        //    data after every mutation — see installUserScripts.
        installUserScripts(into: cfg.userContentController, boot: boot)

        // 3. Register the `notes` + `window` + `recording` message handlers via a WEAK proxy (see
        //    WeakScriptProxy) so the controller→handler retain does not leak the web view.
        cfg.userContentController.add(WeakScriptProxy(self), name: notesHandlerName)
        cfg.userContentController.add(WeakScriptProxy(self), name: windowHandlerName)
        cfg.userContentController.add(WeakScriptProxy(self), name: recordingHandlerName)

        web = WKWebView(frame: frame, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        // uiDelegate lets us grant the microphone capture permission for voice notes
        // (the renderer calls getUserMedia({audio:true})).
        web.uiDelegate = self

        // Host the web view in a container and overlay a draggable top strip so the
        // hidden-titlebar window can be moved (the WKWebView alone swallows drags).
        let container = NSView(frame: frame)
        container.autoresizingMask = [.width, .height]
        web.frame = container.bounds
        container.addSubview(web)
        // The native drag band spans the FULL visible header in `body.native` mode: the
        // 38px traffic-light inset (`--native-inset`, sized for Tahoe's larger buttons)
        // PLUS the 30px control row beneath it (see `.content-header` in web/styles.css —
        // inset + row = this height; the three change TOGETHER, spec §3.8). The lower part
        // lives inside the WKWebView, which swallows drags — so the strip must cover it
        // too. The web layer reports the rects of the interactive controls in this band
        // (minimize / compact), which the strip's hitTest lets through; everywhere else
        // drags the window. The top-left 78×40 traffic-light keep-out stays drag-only.
        let headerDragHeight: CGFloat = 68
        let dragStrip = WindowDragStrip(frame: NSRect(x: 0, y: frame.height - headerDragHeight, width: frame.width, height: headerDragHeight))
        dragStrip.identifier = NSUserInterfaceItemIdentifier("window-drag-strip")
        dragStrip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(dragStrip)
        self.dragStrip = dragStrip
        window.contentView = container

        guard let webDir = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) else {
            NSLog("Hasna Notes: resourceURL is nil — cannot locate bundled web UI")
            return
        }
        let index = webDir.appendingPathComponent("index.html")
        NSLog("Hasna Notes: loading \(index.path) exists=\(FileManager.default.fileExists(atPath: index.path))")
        NSLog("Hasna Notes: boot payload bytes=\(boot.utf8.count) thisMachine=\(bridge.thisMachine)")
        web.loadFileURL(index, allowingReadAccessTo: webDir)

        buildMenu()
        // Idle menu-bar presence from launch: the quick-capture entry point exists
        // BEFORE any recording starts (previously the item only appeared mid-recording,
        // so there was no way to start a capture from the menu bar).
        showStatusItem()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: user scripts

    /// (Re)install the document-start user scripts: the `native` body class (injected as
    /// early as possible to avoid a flash of the desktop-frame layout), REAL notes data as
    /// `window.__BOOT__` (available before app.js runs, so first paint renders from disk),
    /// and the `window.__AI__` sidecar flag (port + AI feature availability).
    ///
    /// User scripts are snapshots baked in at add time, so the launch-time `__BOOT__`
    /// would be re-injected STALE on any page reload. Callers therefore reinstall the
    /// scripts with fresh boot JSON after every mutation; a reload then always boots from
    /// the current on-disk state. Must run on the main thread.
    private func installUserScripts(into controller: WKUserContentController, boot: String) {
        controller.removeAllUserScripts()
        let nativeJS = """
        document.documentElement.classList.add('native');
        document.addEventListener('DOMContentLoaded', function () {
          document.body.classList.add('native');
        }, { once: true });
        """
        controller.addUserScript(
            WKUserScript(source: nativeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        controller.addUserScript(
            WKUserScript(source: "window.__BOOT__ = \(boot);", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        let aiPayload: [String: Any] = [
            "port": sidecar.port,
            "available": sidecar.available,
            "running": sidecar.running,
            "realtime": sidecar.realtimeAvailable,
            "realtimeProvider": sidecar.realtimeProvider,
            "token": sidecar.token,
        ]
        controller.addUserScript(
            WKUserScript(source: "window.__AI__ = \(jsonString(aiPayload));", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        // Real bundle version for the About screen (`window.__VERSION__`, see
        // docs/ui-contracts.md "Version Bridge"): CFBundleShortVersionString is the
        // package.json version and CFBundleVersion the UTC build stamp, both written
        // by scripts/build_notes.sh. Empty when running the bare dev binary,
        // in which case the web UI keeps its static fallback text.
        let info = Bundle.main.infoDictionary ?? [:]
        let versionPayload: [String: Any] = [
            "version": (info["CFBundleShortVersionString"] as? String) ?? "",
            "build": (info["CFBundleVersion"] as? String) ?? "",
        ]
        controller.addUserScript(
            WKUserScript(source: "window.__VERSION__ = \(jsonString(versionPayload));", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        NSLog("Hasna Notes: didFinish navigation")
        webView.evaluateJavaScript("document.body && document.body.classList.add('native')", completionHandler: nil)

        // Diagnostic: count how many note rows the page actually rendered. Proves REAL
        // notes (not the browser sample) reached the DOM. The class is `.note-row`.
        webView.evaluateJavaScript("document.querySelectorAll('.note-row').length") { result, _ in
            let count = (result as? Int) ?? (result as? NSNumber)?.intValue ?? -1
            NSLog("Hasna Notes: rendered \(count) note rows")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("Hasna Notes: didFail navigation: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("Hasna Notes: didFailProvisionalNavigation: \(error.localizedDescription)")
    }

    // MARK: notes bridge (JS → Swift)

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let action = payload["action"] as? String else {
            return
        }

        // The `window` handler controls native window state (compact/quick-note mode) and,
        // per the recording contract, reflects the recording lifecycle into the menu-bar.
        if message.name == windowHandlerName {
            if action == "setCompact" {
                let on = (payload["on"] as? Bool) ?? false
                DispatchQueue.main.async { [weak self] in self?.setCompact(on) }
            } else if action == "dragExclusions" {
                // The web layer reports the viewport rects (CSS px, top-left origin) of the
                // header controls that must stay clickable. Convert + apply on the main thread.
                let rects = (payload["rects"] as? [[String: Any]]) ?? []
                DispatchQueue.main.async { [weak self] in self?.applyDragExclusions(rects) }
            } else if action == "recording" {
                // Contract: { action:"recording", state:'started'|'paused'|'resumed'|'stopping'|'transcribing'|'complete'|'error'|'stopped'|'tick', elapsedMs, status }
                let state = (payload["state"] as? String) ?? "stopped"
                let elapsedMs = (payload["elapsedMs"] as? Double)
                    ?? (payload["elapsedMs"] as? NSNumber)?.doubleValue ?? 0
                DispatchQueue.main.async { [weak self] in
                    self?.handleRecordingLifecycle(state: state, elapsedMs: elapsedMs)
                }
            } else if action == "theme" {
                // Contract: { action:"theme", theme:"system"|"light"|"dark" } — the web
                // layer reports its persisted appearance preference (on boot and on every
                // change) so the window backing matches the UI theme, not just the OS
                // appearance (Rule 11 / spec §3.8). Persisted natively too, so the NEXT
                // launch paints the right backing before the web layer boots.
                let pref = (payload["theme"] as? String) ?? "system"
                DispatchQueue.main.async { [weak self] in self?.applyThemePreference(pref, persist: true) }
            }
            return
        }

        if message.name == recordingHandlerName {
            if action == "state", let state = payload["state"] as? [String: Any] {
                let status = (state["status"] as? String) ?? recordingStatus
                DispatchQueue.main.async { [weak self] in self?.updateRecordingMenu(state: status) }
            }
            return
        }

        guard message.name == notesHandlerName else { return }
        let noteDict = (payload["note"] as? [String: Any]) ?? [:]
        let destructiveConfirmed = (payload["confirmed"] as? Bool) == true || (noteDict["confirmed"] as? Bool) == true

        // Mutations now round-trip through the hosted HTTP store: `note(from:)`
        // re-loads the whole store, and the follow-up `bootJSON()` loads it again.
        // Script messages arrive on the main thread, so that work runs off it; the
        // task-chain serializer keeps rapid saves landing in sequence (the web
        // layer compares hydrate echoes against its own edit base), and the main
        // thread is touched again only for the hydrate push.
        let note = NotesMutationPayload(dict: noteDict)
        let bridge = self.bridge
        let serializer = self.mutationSerializer
        notesQueue.async {
            Task {
                serializer.enqueue {
                    func allowDestructive(_ action: String) -> Bool {
                        if destructiveConfirmed { return true }
                        NSLog("Hasna Notes: ignored unconfirmed destructive notes action '\(action)'")
                        return false
                    }

                    var changed = false
                    switch action {
                    case "create": changed = await bridge.save(note.dict, isCreate: true)
                    case "save":   changed = await bridge.save(note.dict, isCreate: false)
                    case "archive": changed = await bridge.archive(note.dict)
                    case "trash":
                        guard allowDestructive(action) else { return }
                        changed = await bridge.trash(note.dict)
                    case "restore": changed = await bridge.restore(note.dict)
                    case "purge":
                        guard allowDestructive(action) else { return }
                        changed = await bridge.purge(note.dict)
                    case "settings": changed = bridge.updateSettings(note.dict)
                    case "labels": changed = bridge.updateLabels(note.dict)
                    case "delete":
                        guard allowDestructive(action) else { return }
                        changed = await bridge.delete(note.dict)
                    default:
                        NSLog("Hasna Notes: unknown notes action '\(action)'")
                    }

                    guard changed else { return }
                    // After any mutation, reload from the hosted store and push
                    // fresh data back into the page. Also reinstall the
                    // document-start user scripts so a page reload re-injects the
                    // CURRENT notes, not the launch-time `__BOOT__` snapshot.
                    let fresh = await bridge.bootJSON()
                    DispatchQueue.main.async { [weak self] in
                        guard let self, let web = self.web else { return }
                        self.installUserScripts(into: web.configuration.userContentController, boot: fresh)
                        web.evaluateJavaScript("window.HasnaNotes && window.HasnaNotes.hydrate(\(fresh))", completionHandler: nil)
                    }
                }
            }
        }
    }

    // MARK: compact / quick-note window mode

    /// Shrink to a small floating quick-note window (on=true) or restore the full window
    /// (on=false). The same app/web view is reused — only the native window changes.
    /// Convert the web-reported header-control rects (CSS px, viewport top-left origin) into
    /// the drag strip's local coordinate space (bottom-left origin) and store them as
    /// passthrough holes. The WKWebView fills the window content and the strip is pinned to
    /// the top spanning the full width, so a CSS x maps 1:1 to a strip-local x, and a CSS y
    /// measured from the viewport top maps to `stripHeight - y - height` from the strip bottom.
    /// Only rects that actually overlap the band are kept.
    private func applyDragExclusions(_ raw: [[String: Any]]) {
        guard let strip = dragStrip else { return }
        let stripH = strip.bounds.height
        func num(_ v: Any?) -> CGFloat? {
            if let d = v as? Double { return CGFloat(d) }
            if let n = v as? NSNumber { return CGFloat(n.doubleValue) }
            return nil
        }
        var rects: [NSRect] = []
        for r in raw {
            guard let x = num(r["x"]), let y = num(r["y"]),
                  let w = num(r["w"]), let h = num(r["h"]),
                  w > 0, h > 0 else { continue }
            let rect = NSRect(x: x, y: stripH - y - h, width: w, height: h)
            if rect.intersects(strip.bounds) { rects.append(rect) }
        }
        strip.passthroughRects = rects
    }

    /// Resize the top drag band. The full window uses the 68 px header band (38 px
    /// traffic-light inset + 30 px control row); the 220 px-tall compact quick-note
    /// window keeps only the 38 px inset so the band never covers the composer.
    private func setDragStripHeight(_ height: CGFloat) {
        guard let strip = dragStrip, let container = strip.superview else { return }
        strip.frame = NSRect(x: 0, y: container.bounds.height - height,
                             width: container.bounds.width, height: height)
    }

    /// The web layer's persisted appearance preference (Settings → Appearance), reported
    /// through the `window` bridge `theme` action and mirrored into UserDefaults so the
    /// next launch paints the right backing before the web layer boots.
    static let themePrefKey = "Hasna NotesThemePref"

    /// Pin (or release) the window's appearance to match the web theme preference.
    /// An explicit 'light'/'dark' pref forces the whole window's effective appearance,
    /// which (a) resolves the appearance-dynamic `BrandColor.canvas` backing to the SAME
    /// theme the web canvas shows — no wrong-theme flash behind launch/live-resize/
    /// overscroll — and (b) makes the WKWebView's `prefers-color-scheme` / initial
    /// `<meta name="color-scheme">` paint agree with the app theme (Rule 11, spec §3.8).
    /// 'system' (default) inherits the OS appearance again.
    private func applyThemePreference(_ pref: String, persist: Bool) {
        switch pref {
        case "light": window?.appearance = NSAppearance(named: .aqua)
        case "dark":  window?.appearance = NSAppearance(named: .darkAqua)
        default:      window?.appearance = nil   // follow the system appearance
        }
        // Re-assign so AppKit re-resolves the dynamic color under the new appearance now.
        window?.backgroundColor = BrandColor.canvas
        if persist { UserDefaults.standard.set(pref, forKey: Self.themePrefKey) }
    }

    private func setCompact(_ on: Bool) {
        guard let window = window else { return }
        // Rule 12 (docs/design-rules-macos26.md): the compact-window frame morph is a
        // spatial animation — honor the system Reduce Motion setting and snap instead.
        let animateFrame = !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if on {
            guard !isCompact else { return }
            // Remember where we were so we can restore exactly.
            savedFrame = window.frame
            savedLevel = window.level
            savedCollectionBehavior = window.collectionBehavior
            isCompact = true

            let size = NSSize(width: 380, height: 220)
            // The full-app minSize (920×640) would clamp the shrink, so relax it for the
            // quick-note window and restore it on exit.
            savedMinSize = window.minSize
            window.minSize = size
            // Position near the top-right of the screen with the visible window.
            let screen = window.screen ?? NSScreen.main
            var origin = NSPoint(x: 200, y: 200)
            if let vf = screen?.visibleFrame {
                origin = NSPoint(x: vf.maxX - size.width - 24, y: vf.maxY - size.height - 24)
            }
            window.level = .floating
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.setFrame(NSRect(origin: origin, size: size), display: true, animate: animateFrame)
            setDragStripHeight(38)
            window.makeKeyAndOrderFront(nil)
        } else {
            guard isCompact else { return }
            isCompact = false
            window.level = savedLevel
            window.collectionBehavior = savedCollectionBehavior
            window.minSize = savedMinSize
            if let f = savedFrame {
                window.setFrame(f, display: true, animate: animateFrame)
            }
            setDragStripHeight(68)
            window.makeKeyAndOrderFront(nil)
        }
    }

    // MARK: WKUIDelegate — media capture (microphone) permission

    /// Grant the renderer microphone access for voice notes. The app's
    /// NSMicrophoneUsageDescription drives the one-time macOS TCC prompt; once granted by
    /// the OS, this hands the in-page getUserMedia request the go-ahead.
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    // MARK: WKUIDelegate — JS dialogs (alert / confirm / prompt)

    // WKWebView renders NO UI for window.alert/confirm/prompt — without these handlers
    // confirm() silently resolves false and prompt() returns null, so every
    // confirm-gated destructive action in the web layer (note delete, label delete,
    // expired-trash cleanup) would no-op.
    // Each dialog runs as a sheet on the web view's window, never app-modal. The same
    // web view serves compact/quick-note mode, so both modes are covered.

    /// Shared NSAlert shell for the three JS dialogs.
    private func jsDialogAlert(message: String) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = "Hasna Notes"
        alert.informativeText = message
        return alert
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable () -> Void) {
        guard let host = webView.window ?? window else { completionHandler(); return }
        let alert = jsDialogAlert(message: message)
        alert.addButton(withTitle: "OK")
        // Sheet completions run on the main thread, but not every SDK annotates them
        // @MainActor — assumeIsolated keeps the hop explicit for the strict checker.
        alert.beginSheetModal(for: host) { _ in
            MainActor.assumeIsolated { completionHandler() }
        }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        guard let host = webView.window ?? window else { completionHandler(false); return }
        let alert = jsDialogAlert(message: message)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: host) { response in
            MainActor.assumeIsolated { completionHandler(response == .alertFirstButtonReturn) }
        }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        guard let host = webView.window ?? window else { completionHandler(nil); return }
        let alert = jsDialogAlert(message: prompt)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: host) { response in
            MainActor.assumeIsolated {
                completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
            }
        }
    }

    // MARK: teardown

    func applicationWillTerminate(_ notification: Notification) {
        // Drain pending note mutations (they run on the serial notes queue) so quitting
        // right after a keystroke can't drop the final debounced autosave.
        notesQueue.sync { }
        // Remove the menu-bar status item (and its ticker) so it never outlives the app.
        hideStatusItem()
        // Stop the AI sidecar child.
        sidecar.stop()
        // Remove the message handlers so the proxies (and thus the controller→delegate
        // edge) are released cleanly. Belt-and-suspenders alongside the weak proxy.
        web?.configuration.userContentController.removeScriptMessageHandler(forName: notesHandlerName)
        web?.configuration.userContentController.removeScriptMessageHandler(forName: windowHandlerName)
        web?.configuration.userContentController.removeScriptMessageHandler(forName: recordingHandlerName)
        web?.evaluateJavaScript("window.HasnaNotes && window.HasnaNotes.destroy()", completionHandler: nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    /// Upper bound on how long quit may wait for the stop→transcribe→save round-trip.
    private static let quitFailsafeSeconds: TimeInterval = 15

    /// Closing the last window (or Cmd+Q) mid-recording used to quit immediately and
    /// silently discard the take. Instead: auto-stop the recording (the web layer then
    /// transcribes and saves it as a note) and finish quitting when the lifecycle reports
    /// complete/stopped/error — with a failsafe so quit can never hang.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let active = recordingStatus == "recording" || recordingStatus == "paused"
            || recordingStatus == "stopping" || recordingStatus == "transcribing"
        guard active else { return .terminateNow }
        if !quitPendingRecordingStop {
            quitPendingRecordingStop = true
            if recordingStatus == "recording" || recordingStatus == "paused" {
                callRecordingJS("stop")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + AppDelegate.quitFailsafeSeconds) { [weak self] in
                guard let self, self.quitPendingRecordingStop else { return }
                self.quitPendingRecordingStop = false
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide Hasna Notes", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Hasna Notes", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // Standard Edit menu: without these responder-chain items the key equivalents
        // (Cmd+A/C/V/X/Z) never reach the WKWebView, so select-all/copy/paste/cut/undo
        // are dead in the editor and note lists.
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let winMenu = NSMenu(title: "Window")
        winMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        winItem.submenu = winMenu

        let recItem = NSMenuItem()
        main.addItem(recItem)
        let recMenu = NSMenu(title: "Recording")
        let title = NSMenuItem(title: "Recorder Idle", action: nil, keyEquivalent: "")
        title.isEnabled = false
        recordingMenuTitleItem = title
        recMenu.addItem(title)
        recMenu.addItem(NSMenuItem.separator())
        recordingStartItem = recMenu.addItem(withTitle: "Start Recording", action: #selector(recordingStart(_:)), keyEquivalent: "r")
        recordingStartItem?.keyEquivalentModifierMask = [.command, .shift]
        recordingPauseItem = recMenu.addItem(withTitle: "Pause Recording", action: #selector(recordingPause(_:)), keyEquivalent: "")
        recordingResumeItem = recMenu.addItem(withTitle: "Resume Recording", action: #selector(recordingResume(_:)), keyEquivalent: "")
        recordingStopItem = recMenu.addItem(withTitle: "Stop Recording", action: #selector(recordingStop(_:)), keyEquivalent: ".")
        recordingStopItem?.keyEquivalentModifierMask = [.command, .shift]
        recItem.submenu = recMenu
        updateRecordingMenu(state: recordingStatus)
        NSApp.mainMenu = main
    }

    private func callRecordingJS(_ action: String) {
        let js = "window.HasnaNotes && window.HasnaNotes.recording && window.HasnaNotes.recording.\(action) && window.HasnaNotes.recording.\(action)()"
        web?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func updateRecordingMenu(state: String) {
        recordingStatus = state
        recordingMenuTitleItem?.title = "Recorder \(state.capitalized)"
        let active = state == "recording" || state == "paused" || state == "stopping" || state == "transcribing"
        recordingStartItem?.isEnabled = !active
        recordingPauseItem?.isEnabled = state == "recording"
        recordingResumeItem?.isEnabled = state == "paused"
        recordingStopItem?.isEnabled = state == "recording" || state == "paused"
    }

    @objc private func recordingStart(_ sender: Any?) { callRecordingJS("start") }
    @objc private func recordingPause(_ sender: Any?) { callRecordingJS("pause") }
    @objc private func recordingResume(_ sender: Any?) { callRecordingJS("resume") }
    @objc private func recordingStop(_ sender: Any?) { callRecordingJS("stop") }

    // MARK: - Menu-bar status item (NSStatusItem) — recording control

    /// Drive both the in-app Recording menu (existing) and the menu-bar status item from a
    /// single contract lifecycle message.
    private func handleRecordingLifecycle(state: String, elapsedMs: Double) {
        // Keep the in-app menu's coarse status in sync (map verbs → status it understands).
        switch state {
        case "started", "resumed", "tick": updateRecordingMenu(state: "recording")
        case "paused":                      updateRecordingMenu(state: "paused")
        case "stopping":                    updateRecordingMenu(state: "stopping")
        case "transcribing":                updateRecordingMenu(state: "transcribing")
        case "complete", "error", "stopped": updateRecordingMenu(state: state == "error" ? "error" : "idle")
        default: break
        }
        recordingLifecycleStatus = recordingStatus

        recordingElapsedMs = elapsedMs
        recordingElapsedSyncedAt = Date()

        switch state {
        case "started", "resumed", "tick":
            recordingPaused = false
            showStatusItem()
            startStatusTicker()
        case "paused":
            recordingPaused = true
            showStatusItem()
            stopStatusTicker()          // hold the displayed time while paused
            refreshStatusTitle()
        case "stopping", "transcribing":
            recordingPaused = false
            showStatusItem()
            stopStatusTicker()
            refreshStatusTitle()
        case "complete", "error", "stopped":
            recordingPaused = false
            // Back to the IDLE menu-bar presence (never torn down while the app runs):
            // the quick-capture entry must survive the end of a recording.
            stopStatusTicker()
            refreshStatusTitle()
            // A deferred quit (applicationShouldTerminate) waits for this terminal
            // state: the recording is stopped and its note saved (or errored) — finish.
            if quitPendingRecordingStop {
                quitPendingRecordingStop = false
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        default:
            break
        }
        refreshStatusMenuEnabled()
    }

    // Menu-bar TEMPLATE glyphs (assets/brand/notes-menubar{,-rec}.svg, bundled
    // into Resources/brand by scripts/build_notes.sh). Template images are
    // monochrome — macOS tints them for light/dark menu bars, and contentTintColor
    // carries the recording state (docs/brand-visual-system.md → "Menu bar"). Nil when
    // running the bare binary outside the .app bundle; the title-only presentation
    // below then keeps its legacy symbol prefixes.
    private lazy var statusGlyphIdle: NSImage? = loadStatusGlyph("notes-menubar")
    private lazy var statusGlyphRec: NSImage? = loadStatusGlyph("notes-menubar-rec")

    private func loadStatusGlyph(_ name: String) -> NSImage? {
        guard let url = Bundle.main.resourceURL?
            .appendingPathComponent("brand", isDirectory: true)
            .appendingPathComponent("\(name).svg"),
            let img = NSImage(contentsOf: url) else { return nil }
        img.isTemplate = true                       // macOS tints template images itself
        img.size = NSSize(width: 18, height: 18)    // authored on the 18pt menu-bar grid
        return img
    }

    /// Apply glyph + title + tint to the status button. With a bundled template glyph
    /// the title drops its "●"/"❚❚" symbol prefix (the glyph + tint carry the state);
    /// without one (bare `swift run`) the legacy text-only presentation stays.
    /// A nil tint leaves the template image to macOS (the quiet idle presentation).
    private func setStatusButton(glyph: NSImage?, title: String, fallbackTitle: String, tint: NSColor?) {
        guard let button = statusItem?.button else { return }
        button.image = glyph
        button.imagePosition = glyph == nil ? .noImage : .imageLeading
        button.title = glyph == nil ? fallbackTitle : title
        button.contentTintColor = tint
    }

    /// Create (once) and reveal the menu-bar status item, building its menu lazily.
    /// One menu serves both modes; refreshStatusMenuEnabled() toggles item visibility:
    ///   idle      → Start Recording · Open Hasna Notes
    ///   recording → elapsed timer · Pause/Resume · Stop · Open Hasna Notes
    private func showStatusItem() {
        if statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            if let button = item.button {
                button.font = NSFont.menuBarFont(ofSize: 0)
                // Image/title/tint are state-driven — refreshStatusTitle() below sets them.
            }
            let menu = NSMenu()
            // Visibility is managed manually per recording state — don't let AppKit
            // re-enable items whose target implements their selector.
            menu.autoenablesItems = false
            let timer = NSMenuItem(title: "Recording 0:00", action: nil, keyEquivalent: "")
            timer.isEnabled = false
            menu.addItem(timer)
            statusTimerItem = timer
            statusStartItem = menu.addItem(withTitle: "Start Recording", action: #selector(recordingStart(_:)), keyEquivalent: "")
            statusStartItem?.target = self
            let controlsSep = NSMenuItem.separator()
            menu.addItem(controlsSep)
            statusControlsSeparator = controlsSep
            statusPauseItem = menu.addItem(withTitle: "Pause", action: #selector(recordingPause(_:)), keyEquivalent: "")
            statusPauseItem?.target = self
            statusResumeItem = menu.addItem(withTitle: "Resume", action: #selector(recordingResume(_:)), keyEquivalent: "")
            statusResumeItem?.target = self
            statusStopItem = menu.addItem(withTitle: "Stop", action: #selector(recordingStop(_:)), keyEquivalent: "")
            statusStopItem?.target = self
            menu.addItem(NSMenuItem.separator())
            let open = menu.addItem(withTitle: "Open Hasna Notes", action: #selector(openMainWindow(_:)), keyEquivalent: "")
            open.target = self
            open.isEnabled = true
            item.menu = menu
            statusItem = item
        }
        statusItem?.isVisible = true
        refreshStatusTitle()
        refreshStatusMenuEnabled()
    }

    /// Tear down the status item — app termination only (the item is otherwise a
    /// permanent fixture: recording stop returns it to the idle presentation).
    private func hideStatusItem() {
        stopStatusTicker()
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
        }
        statusItem = nil
        statusTimerItem = nil
        statusStartItem = nil
        statusControlsSeparator = nil
        statusPauseItem = nil
        statusResumeItem = nil
        statusStopItem = nil
    }

    /// A lightweight 1s NSTimer ticks the menu title between the web's periodic syncs so the
    /// elapsed clock stays current even if the web tick cadence is coarse.
    private func startStatusTicker() {
        guard statusTicker == nil else { return }
        let t = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            DispatchQueue.main.async { self?.refreshStatusTitle() }
        }
        RunLoop.main.add(t, forMode: .common)
        statusTicker = t
    }

    private func stopStatusTicker() {
        statusTicker?.invalidate()
        statusTicker = nil
    }

    /// Compute the current elapsed (last web-reported value + wall-clock drift while running)
    /// and format it as m:ss for the status-item title.
    private func refreshStatusTitle() {
        let active = recordingLifecycleStatus == "recording" || recordingLifecycleStatus == "paused"
            || recordingLifecycleStatus == "stopping" || recordingLifecycleStatus == "transcribing"
        if !active {
            // Idle: the quiet untinted template glyph — presence without alarm.
            statusTimerItem?.title = "Not recording"
            setStatusButton(glyph: statusGlyphIdle, title: "", fallbackTitle: "PN", tint: nil)
            return
        }
        if recordingLifecycleStatus == "transcribing" {
            statusTimerItem?.title = "Transcribing"
            setStatusButton(glyph: statusGlyphIdle, title: "TRANS", fallbackTitle: "TRANS", tint: BrandColor.accent)
            return
        }
        if recordingLifecycleStatus == "stopping" {
            statusTimerItem?.title = "Stopping"
            setStatusButton(glyph: statusGlyphIdle, title: "STOP", fallbackTitle: "STOP", tint: BrandColor.accent)
            return
        }
        var ms = recordingElapsedMs
        if !recordingPaused {
            ms += Date().timeIntervalSince(recordingElapsedSyncedAt) * 1000.0
        }
        let total = Int(max(0, ms) / 1000.0)
        let label = String(format: "%d:%02d", total / 60, total % 60)
        statusTimerItem?.title = "Recording \(label)"
        if recordingPaused {
            // Paused: the dot-less card glyph + secondary tint (state without the red).
            setStatusButton(glyph: statusGlyphIdle, title: "REC", fallbackTitle: "❚❚ REC", tint: NSColor.secondaryLabelColor)
        } else {
            // Recording: the dotted card glyph tinted red (mirrors the legacy "● REC").
            setStatusButton(glyph: statusGlyphRec, title: "REC", fallbackTitle: "● REC", tint: NSColor.systemRed)
        }
    }

    private func refreshStatusMenuEnabled() {
        let active = recordingStatus == "recording" || recordingStatus == "paused"
            || recordingStatus == "stopping" || recordingStatus == "transcribing"
        // Idle: Start Recording + Open only. Active: timer + transport controls.
        statusStartItem?.isHidden = active
        statusStartItem?.isEnabled = !active
        statusTimerItem?.isHidden = !active
        statusControlsSeparator?.isHidden = !active
        if !active {
            statusPauseItem?.isHidden = true
            statusResumeItem?.isHidden = true
            statusStopItem?.isHidden = true
            return
        }
        statusStopItem?.isHidden = false
        statusPauseItem?.isHidden = recordingPaused
        statusResumeItem?.isHidden = !recordingPaused
        if recordingLifecycleStatus == "stopping" || recordingLifecycleStatus == "transcribing" {
            statusPauseItem?.isHidden = true
            statusResumeItem?.isHidden = true
            statusStopItem?.isEnabled = false
        } else {
            statusStopItem?.isEnabled = recordingStatus == "recording" || recordingStatus == "paused"
        }
    }

    /// Bring the main app window forward (status-item "Open Hasna Notes").
    @objc private func openMainWindow(_ sender: Any?) {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
