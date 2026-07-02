// PersonalNotes — native macOS shell hosting the bundled web UI in a WKWebView.
//
// The UI itself lives in `web/` (copied into the app bundle at
// Contents/Resources/web). This shell:
//   1. opens a hidden-titlebar window and loads index.html offline (file://),
//   2. tags the document with the `native` body class so the web UI drops its
//      desktop-frame chrome and fills the OS window edge-to-edge, and
//   3. bridges REAL notes data between the on-disk Markdown store
//      (`PersonalNotesCore.MarkdownStore`) and the web UI:
//        - reads the store + the fleet manifest at launch and injects
//          `window.__BOOT__ = { notes, machines, thisMachine }` as a
//          document-start user script (available before the page's JS runs),
//        - receives `{action, note}` messages on the `notes` message handler
//          (save / create / delete), writes them to disk, then pushes fresh
//          data back into the page via `window.PersonalNotes.hydrate(...)`.
import AppKit
import WebKit
import PersonalNotesCore
import Foundation

// MARK: - AI sidecar

/// Spawns and supervises the bundled Node AI sidecar (`Resources/ai-sidecar/server.mjs`).
///
/// The sidecar provides note auto-titling (`/title`) and voice-note transcription
/// (`/transcribe`) via the Vercel AI SDK + OpenAI. The host:
///   - finds a `node` binary,
///   - picks a free loopback TCP port,
///   - reads the OpenAI key from `OPENAI_API_KEY` (or `~/.hasna/apps/notes/secrets/openai.env`),
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
    /// port and health are always recoverable: `~/Library/Logs/PersonalNotes/sidecar.log`.
    private static let logFileURL: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/PersonalNotes", isDirectory: true)
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
    /// Internal (not private) because SyncScheduler reuses the same resolution.
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

    /// Optional per-app secrets file: `~/.hasna/apps/notes/secrets/<name>.env`.
    /// Lets users hand the shell app a key without exporting env vars globally.
    private static func secretsFile(_ name: String) -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hasna/apps/notes/secrets/\(name).env")
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

// MARK: - Sync scheduler

/// Thread-safe byte sink: collects a child's stderr from the FileHandle
/// readability callback (which runs on its own queue) while the owning thread
/// drains stdout to EOF — the two pipes must never be read sequentially from
/// one thread (see SyncScheduler.runTick).
private final class PipeBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func append(_ chunk: Data) {
        lock.lock()
        defer { lock.unlock() }
        data.append(chunk)
    }

    var bytes: Data {
        lock.lock()
        defer { lock.unlock() }
        return data
    }
}

/// Background timer that keeps the local store fresh while the GUI is open by
/// running the bundled CLI (`Resources/bin/personalnotes.mjs sync --json`) —
/// the SAME sync engine the `personalnotes sync --watch` daemon and manual CLI
/// runs use. Sync never REQUIRES the GUI: the installed daemon/service is the
/// primary scheduler; the pid-based run lock in the data root keeps the two
/// from double-running (a colliding run reports `skipped`, not an error).
///
/// `@unchecked Sendable`: `timer` is created/cancelled on the main thread only
/// (start/stop from app lifecycle); `child` is touched only on the private
/// serial `queue` where ticks run; `onDidSync` is an immutable @Sendable value.
final class SyncScheduler: @unchecked Sendable {
    /// Serial background queue (the notesQueue pattern): each tick spawns the
    /// CLI and waits for it HERE — never on the main thread.
    private let queue = DispatchQueue(label: "PersonalNotes.sync-scheduler", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var child: Process?
    /// Called on `queue` after every completed (non-skipped) run so the host
    /// can rebuild the boot payload and hydrate the web UI.
    private let onDidSync: @Sendable () -> Void

    init(onDidSync: @escaping @Sendable () -> Void) {
        self.onDidSync = onDidSync
    }

    /// `~/.config/personalnotes/config.json` (or $PERSONALNOTES_CONFIG) — the
    /// sync client config written by `personalnotes auth ...`. Read-only here.
    private static func clientConfig() -> [String: Any] {
        let env = ProcessInfo.processInfo.environment
        let url: URL
        if let override = env["PERSONALNOTES_CONFIG"], !override.isEmpty {
            url = URL(fileURLWithPath: override)
        } else {
            url = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".config/personalnotes/config.json")
        }
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return obj
    }

    private static func isSignedIn(_ config: [String: Any]) -> Bool {
        let env = ProcessInfo.processInfo.environment
        let candidates = [config["apiKey"] as? String, config["token"] as? String,
                          env["PERSONALNOTES_API_KEY"], env["PERSONALNOTES_TOKEN"]]
        return candidates.contains { !($0 ?? "").isEmpty }
    }

    /// Interval in minutes from config `syncIntervalMinutes` — default 5,
    /// floor 1 — mirroring `resolveSyncInterval` in sync/daemon.mjs.
    static func intervalMinutes(_ config: [String: Any]) -> Double {
        var minutes = 5.0
        if let n = config["syncIntervalMinutes"] as? NSNumber {
            minutes = n.doubleValue
        } else if let s = config["syncIntervalMinutes"] as? String, let n = Double(s) {
            minutes = n
        }
        if !minutes.isFinite || minutes <= 0 { minutes = 5.0 }
        return max(1.0, minutes)
    }

    /// Locate the bundled CLI entry (`Resources/bin/personalnotes.mjs`).
    private static func cliScript() -> URL? {
        guard let res = Bundle.main.resourceURL else { return nil }
        let script = res.appendingPathComponent("bin/personalnotes.mjs")
        return FileManager.default.fileExists(atPath: script.path) ? script : nil
    }

    /// Start the timer (called once at launch, main thread). No-ops — with an
    /// NSLog explaining why — when the user is not signed in, the bundled CLI
    /// is missing, or node cannot be found; the app works fine without sync.
    func start() {
        let config = SyncScheduler.clientConfig()
        guard SyncScheduler.isSignedIn(config) else {
            NSLog("PersonalNotes sync: not signed in (run: personalnotes auth device) — GUI sync timer off")
            return
        }
        guard let script = SyncScheduler.cliScript() else {
            NSLog("PersonalNotes sync: bundled CLI missing — GUI sync timer off")
            return
        }
        guard let node = AISidecar.findNode() else {
            NSLog("PersonalNotes sync: no node binary found — GUI sync timer off")
            return
        }
        let interval = SyncScheduler.intervalMinutes(config) * 60.0
        let t = DispatchSource.makeTimerSource(queue: queue)
        // First run shortly after launch, then every interval. The leeway is
        // the scheduler-level jitter (≤10% of the interval), mirroring the
        // daemon's jittered ticks.
        t.schedule(deadline: .now() + 20,
                   repeating: interval,
                   leeway: .seconds(max(1, Int(interval * 0.1))))
        t.setEventHandler { [weak self] in
            self?.runTick(node: node, script: script)
        }
        timer = t
        t.resume()
        NSLog("PersonalNotes sync: GUI timer on (every \(Int(interval))s via bundled CLI)")
    }

    /// Cancel the timer (app terminate, main thread). An in-flight CLI run is
    /// deliberately left to finish on its own: it holds the run lock, persists
    /// its pending batch, and exits — killing it mid-run would only exercise
    /// the crash-resume path for no benefit.
    func stop() {
        timer?.cancel()
        timer = nil
    }

    /// Runs ON `queue` (timer handler). Spawns one CLI sync run and waits for
    /// it; a tick that fires while a run is still active is skipped.
    private func runTick(node: String, script: URL) {
        guard child == nil else { return }
        let proc = Process()
        if node == "/usr/bin/env" {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            proc.arguments = ["node", script.path, "sync", "--json"]
        } else {
            proc.executableURL = URL(fileURLWithPath: node)
            proc.arguments = [script.path, "sync", "--json"]
        }
        let out = Pipe(), err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        do {
            try proc.run()
        } catch {
            NSLog("PersonalNotes sync: failed to launch CLI: \(error.localizedDescription)")
            return
        }
        child = proc
        // Two pipes, one thread: reading them SEQUENTIALLY can deadlock — if
        // the child fills the ~64 KB stderr pipe buffer (a Node stack trace,
        // deprecation spew) while we are still blocked draining stdout, the
        // child stalls on its stderr write and never closes stdout, wedging
        // this serial queue (and every future tick) forever. Collect stderr
        // concurrently on the pipe's callback queue; drain stdout here.
        let errBuffer = PipeBuffer()
        let errDone = DispatchSemaphore(value: 0)
        err.fileHandleForReading.readabilityHandler = { @Sendable handle in
            let chunk = handle.availableData
            if chunk.isEmpty { // EOF
                handle.readabilityHandler = nil
                errDone.signal()
                return
            }
            errBuffer.append(chunk)
        }
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        proc.waitUntilExit()
        // Bounded wait for the stderr EOF callback (imminent once the child
        // exited — Process closed our copy of the write end at launch); a
        // timeout can only truncate an error message, never wedge the queue.
        _ = errDone.wait(timeout: .now() + 10)
        err.fileHandleForReading.readabilityHandler = nil
        let errData = errBuffer.bytes
        child = nil

        let summary = (try? JSONSerialization.jsonObject(with: outData)) as? [String: Any]
        if let summary, (summary["skipped"] as? Bool) == true {
            return // another runner (the daemon) is already syncing this store
        }
        if proc.terminationStatus != 0 {
            let message = String(data: errData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            NSLog("PersonalNotes sync: CLI exited \(proc.terminationStatus) \(message)")
        } else if let summary {
            let pulled = summary["pulled"] as? [String: Any]
            let total = ["created", "updated", "purged"]
                .compactMap { (pulled?[$0] as? NSNumber)?.intValue }
                .reduce(0, +)
            NSLog("PersonalNotes sync: ok (pulled \(total) change(s))")
        }
        // Refresh the UI after success AND failure: pulled rows must appear,
        // and the Settings sync row must reflect what sync-status.json now
        // records (an auth failure must surface, never stay a stale green).
        onDidSync()
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

private func machineAliases(_ machine: FleetMachine, fallbackID: String? = nil) -> Set<String> {
    var aliases = Set<String>()
    let id = fallbackID ?? machine.id
    if !id.isEmpty { aliases.insert(id) }
    if !machine.id.isEmpty { aliases.insert(machine.id) }
    if let slug = machine.slug, !slug.isEmpty { aliases.insert(slug) }
    return aliases
}

private func machineJSON(_ machine: FleetMachine, notes: [Note], fallbackID: String? = nil) -> [String: Any] {
    let id = fallbackID ?? machine.id
    let aliases = machineAliases(machine, fallbackID: fallbackID)
    let machineNotes = notes.filter { aliases.contains($0.machine) }
    let activeNotes = machineNotes.filter { $0.status != .archived && $0.status != .trash }
    let latestNoteDate = machineNotes
        .map(\.updatedAt)
        .max()
    let updatedAt = machine.updatedAt ?? latestNoteDate
    let recentActivityAt = [machine.recentActivityAt, machine.lastSeenAt, updatedAt, latestNoteDate]
        .compactMap { $0 }
        .max()
    var obj: [String: Any] = [
        "id": id,
        "slug": machine.slug ?? id,
        "displayName": machine.displayName,
        "platform": machine.platform,
        "status": machine.status ?? (machine.online == true ? "online" : (machine.online == false ? "offline" : "unknown")),
        "noteCount": activeNotes.count,
        "activeNoteCount": activeNotes.count,
        "archivedNoteCount": machineNotes.filter { $0.status == .archived }.count,
        "trashNoteCount": machineNotes.filter { $0.status == .trash }.count,
        "totalNoteCount": machineNotes.count,
    ]
    if let friendlyName = machine.friendlyName, !friendlyName.isEmpty {
        obj["friendlyName"] = friendlyName
    }
    if let online = machine.online {
        obj["online"] = online
    }
    if let updatedAt {
        obj["updatedAt"] = MarkdownStore.iso8601(updatedAt)
    }
    if let latestNoteDate {
        obj["latestNoteUpdatedAt"] = MarkdownStore.iso8601(latestNoteDate)
    }
    if let lastSeenAt = machine.lastSeenAt {
        obj["lastSeenAt"] = MarkdownStore.iso8601(lastSeenAt)
    }
    if let recentActivityAt {
        obj["recentActivityAt"] = MarkdownStore.iso8601(recentActivityAt)
    }
    return obj
}

// MARK: - Machine manifest cache

/// Process-wide cache in front of `FleetManifest.load` (a plain read of
/// `~/.hasna/machines/machines.json` — friendly names/slugs for machine rows).
/// `bootJSON()` runs after EVERY autosave, so the file is re-read at most once per TTL.
/// No manifest file just means machine rows come purely from note frontmatter.
/// `@unchecked Sendable`: all state is guarded by `lock`.
final class ManifestCache: @unchecked Sendable {
    static let shared = ManifestCache()
    private let lock = NSLock()
    private var machines: [FleetMachine]?
    private var loadedAt = Date.distantPast
    private let ttl: TimeInterval = 60

    func fleet() -> [FleetMachine] {
        lock.lock()
        defer { lock.unlock() }
        if let machines, Date().timeIntervalSince(loadedAt) < ttl { return machines }
        let parsed = FleetManifest.load()
        machines = parsed
        loadedAt = Date()
        return parsed
    }
}

// MARK: - Notes bridge

/// Owns the on-disk store and the boot/hydrate/save/delete round-trip. Kept separate
/// from the message-handler object so the WKWebView retain graph (see WeakScriptProxy)
/// stays clean.
/// `@unchecked Sendable`: every stored property is an immutable value (the stores are
/// stateless wrappers over the on-disk files); mutations are serialized by the app
/// delegate's `notesQueue`, and the manifest cache carries its own lock.
final class NotesBridge: @unchecked Sendable {
    let store = MarkdownStore()
    let labelStore: LabelStore
    let settingsStore: SettingsStore
    let thisMachine: String

    init() {
        self.labelStore = LabelStore(root: store.rootURL)
        self.settingsStore = SettingsStore(root: store.rootURL)
        // The BOOT payload's `thisMachine` and every new note's `machine:` field
        // share ONE stable identity — `Note.currentMachine` ($PERSONALNOTES_MACHINE
        // → sync client config `machine` → short hostname). The old cosmetic
        // Computer Name fabricated phantom machine rows that never matched
        // manifest slugs.
        self.thisMachine = Note.currentMachine
    }

    /// Load all notes from disk (newest first). Never throws to the caller — a broken
    /// store yields an empty list and the UI falls back gracefully.
    func loadNotes() -> [Note] {
        (try? store.loadAll()) ?? []
    }

    /// Build the machine list: manifest first, then any machine ids seen in notes
    /// (so a note from a machine missing from the manifest still gets a row), then
    /// guarantee `thisMachine` is present.
    func machinePayloads(notes: [Note]) -> [[String: Any]] {
        var machinesByID: [String: FleetMachine] = [:]
        var aliases = Set<String>()
        let manifest = ManifestCache.shared.fleet()
        for m in manifest {
            machinesByID[m.id] = m
            aliases.formUnion(machineAliases(m))
        }
        // Machines fabricated from note frontmatter (not in the manifest) carry
        // platform "unknown" — hardcoding "macos" invented facts for rows the
        // manifest never described (synced Linux notes included).
        for n in notes where !n.machine.isEmpty && !aliases.contains(n.machine) && machinesByID[n.machine] == nil {
            machinesByID[n.machine] = FleetMachine(id: n.machine, platform: "unknown")
            aliases.insert(n.machine)
        }
        // This machine's own row IS known to be macOS (the shell only runs there).
        if !thisMachine.isEmpty && !aliases.contains(thisMachine) && machinesByID[thisMachine] == nil {
            machinesByID[thisMachine] = FleetMachine(id: thisMachine, platform: "macos")
        }
        return machinesByID.values
            .sorted { a, b in
                let lhsAliases = machineAliases(a)
                let rhsAliases = machineAliases(b)
                let lhs = (a.recentActivityAt ?? a.lastSeenAt ?? a.updatedAt ?? notes.filter { note in lhsAliases.contains(note.machine) }.map(\.updatedAt).max()) ?? .distantPast
                let rhs = (b.recentActivityAt ?? b.lastSeenAt ?? b.updatedAt ?? notes.filter { note in rhsAliases.contains(note.machine) }.map(\.updatedAt).max()) ?? .distantPast
                if lhs != rhs { return lhs > rhs }
                return a.displayName.localizedCaseInsensitiveCompare(b.displayName) == .orderedAscending
            }
            .map { machineJSON($0, notes: notes) }
    }

    func machineDetails(id rawID: String) -> [String: Any] {
        let id = rawID.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = loadNotes()
        let machines = machinePayloads(notes: notes)
        if let match = machines.first(where: { ($0["id"] as? String) == id || ($0["slug"] as? String) == id }) {
            return match
        }
        return machineJSON(FleetMachine(id: id, platform: "unknown"), notes: notes)
    }

    /// Last sync outcome, written by the CLI/daemon/GUI timer to
    /// `<root>/sync-status.json` (see sync/daemon.mjs). Missing or unreadable
    /// means never synced. Passed through verbatim so the web Settings row can
    /// render it honestly — an `error` status must never display as synced.
    func syncStatusJSON() -> [String: Any] {
        let url = store.rootURL.appendingPathComponent("sync-status.json")
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ["status": "never"]
        }
        return obj
    }

    /// The `{notes, machines, thisMachine}` boot payload as a JSON string.
    func bootJSON() -> String {
        let notes = loadNotes()
        let payload: [String: Any] = [
            "notes": notes.map(noteJSON),
            "machines": machinePayloads(notes: notes),
            "labels": labelStore.load(),
            "thisMachine": thisMachine,
            "settings": ["trashRetentionDays": settingsStore.load().trashRetentionDays],
            "sync": syncStatusJSON(),
            "listDefaults": ["limit": 10],
        ]
        return jsonString(payload)
    }

    // MARK: mutations

    /// Build a `Note` from a JS message payload. New notes (create) get a fresh UUID,
    /// `machine = thisMachine`, and `agent = Note.appAgent`. Saves preserve the id and
    /// (for existing notes) the original createdAt/machine on disk.
    private func note(from dict: [String: Any], isCreate: Bool, allowMachineChange: Bool = false) -> Note {
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

        // Preserve the existing on-disk createdAt + machine when saving an existing note,
        // except for the explicit move-to-machine action.
        let existing: Note? = isCreate ? nil : loadNotes().first(where: { $0.id == id })
        let createdAt = existing?.createdAt
            ?? (dict["createdAt"] as? String).flatMap(MarkdownStore.parseDate)
            ?? Date()
        // Respect the client's updatedAt stamp (the web layer sets it at commit time).
        // Re-stamping with Date() here made the hydrate echo of every save compare
        // "newer" than the edit that produced it, so the web editor adopted its own
        // echo — including stale echoes of earlier queued saves — and stomped
        // keystrokes still in flight. Callers that send no stamp keep the old behavior.
        let updatedAt = (dict["updatedAt"] as? String).flatMap(MarkdownStore.parseDate) ?? Date()
        let machine = allowMachineChange
            ? ((dict["machine"] as? String) ?? existing?.machine ?? thisMachine)
            : (existing?.machine ?? (dict["machine"] as? String) ?? thisMachine)
        let machineFriendlyName = allowMachineChange
            ? ((dict["machineFriendlyName"] as? String) ?? existing?.machineFriendlyName ?? "")
            : (existing?.machineFriendlyName ?? (dict["machineFriendlyName"] as? String) ?? "")
        let author = (dict["author"] as? String) ?? existing?.author ?? Note.currentAuthor
        let agent = (dict["agent"] as? String) ?? existing?.agent ?? Note.appAgent
        // `rev` is advisory here: MarkdownStore.save bumps past the on-disk value.
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

    /// Persist a create/save. Returns true on success.
    @discardableResult
    func save(_ dict: [String: Any], isCreate: Bool) -> Bool {
        let n = note(from: dict, isCreate: isCreate)
        do { try store.save(n); return true }
        catch { NSLog("PersonalNotes: save failed: \(error.localizedDescription)"); return false }
    }

    @discardableResult
    func move(_ dict: [String: Any]) -> Bool {
        guard let idStr = dict["id"] as? String,
              let id = UUID(uuidString: idStr),
              var existing = loadNotes().first(where: { $0.id == id }) else { return false }
        let target = (dict["machine"] as? String) ?? (dict["targetMachine"] as? String) ?? ""
        guard !target.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let changed = existing.machine != target
        existing.machine = target
        // Attribution only (schema v2): a stale friendly name must not describe the
        // old machine, so it is replaced or cleared alongside `machine`.
        let friendlyName = (dict["machineFriendlyName"] as? String)
            ?? (dict["targetMachineFriendlyName"] as? String) ?? ""
        existing.machineFriendlyName = friendlyName.isEmpty
            ? (changed ? "" : existing.machineFriendlyName)
            : friendlyName
        existing.updatedAt = Date()
        do { try store.save(existing); return true }
        catch { NSLog("PersonalNotes: move failed: \(error.localizedDescription)"); return false }
    }

    @discardableResult
    func archive(_ dict: [String: Any]) -> Bool {
        guard let idStr = dict["id"] as? String,
              let id = UUID(uuidString: idStr),
              var existing = loadNotes().first(where: { $0.id == id }) else { return false }
        existing.status = .archived
        existing.archivedAt = Date()
        existing.trashedAt = nil
        existing.trashExpiresAt = nil
        existing.updatedAt = Date()
        do { try store.save(existing); return true }
        catch { NSLog("PersonalNotes: archive failed: \(error.localizedDescription)"); return false }
    }

    @discardableResult
    func trash(_ dict: [String: Any]) -> Bool {
        guard let idStr = dict["id"] as? String,
              let id = UUID(uuidString: idStr),
              var existing = loadNotes().first(where: { $0.id == id }) else { return false }
        let now = Date()
        let retention = settingsStore.load().trashRetentionDays
        existing.status = .trash
        existing.trashedAt = now
        existing.trashExpiresAt = Calendar.current.date(byAdding: .day, value: retention, to: now)
        existing.updatedAt = now
        do { try store.save(existing); return true }
        catch { NSLog("PersonalNotes: trash failed: \(error.localizedDescription)"); return false }
    }

    @discardableResult
    func restore(_ dict: [String: Any]) -> Bool {
        guard let idStr = dict["id"] as? String,
              let id = UUID(uuidString: idStr),
              var existing = loadNotes().first(where: { $0.id == id }) else { return false }
        existing.status = .active
        existing.archivedAt = nil
        existing.trashedAt = nil
        existing.trashExpiresAt = nil
        existing.restoredAt = Date()
        existing.updatedAt = Date()
        do { try store.save(existing); return true }
        catch { NSLog("PersonalNotes: restore failed: \(error.localizedDescription)"); return false }
    }

    /// Delete the note identified by the payload's id.
    @discardableResult
    func delete(_ dict: [String: Any]) -> Bool {
        guard let idStr = dict["id"] as? String, let id = UUID(uuidString: idStr) else { return false }
        if let existing = loadNotes().first(where: { $0.id == id }), existing.status != .trash {
            return trash(dict)
        }
        return purge(dict)
    }

    @discardableResult
    func purge(_ dict: [String: Any]) -> Bool {
        guard let idStr = dict["id"] as? String, let id = UUID(uuidString: idStr) else { return false }
        // delete only needs the id; build a minimal Note for the path.
        let n = Note(id: id)
        do { try store.delete(n); return true }
        catch { NSLog("PersonalNotes: delete failed: \(error.localizedDescription)"); return false }
    }

    @discardableResult
    func updateSettings(_ dict: [String: Any]) -> Bool {
        let days = (dict["trashRetentionDays"] as? Int)
            ?? (dict["trashRetentionDays"] as? NSNumber)?.intValue
            ?? NotesSettings.defaultTrashRetentionDays
        do { try settingsStore.save(NotesSettings(trashRetentionDays: days)); return true }
        catch { NSLog("PersonalNotes: settings save failed: \(error.localizedDescription)"); return false }
    }

    @discardableResult
    func updateLabels(_ dict: [String: Any]) -> Bool {
        let labels = (dict["labels"] as? [String]) ?? (dict["tags"] as? [String]) ?? []
        do { try labelStore.save(labels); return true }
        catch { NSLog("PersonalNotes: labels save failed: \(error.localizedDescription)"); return false }
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

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    /// Transparent overlay covering the full native header band; drags the window except
    /// over web-reported interactive controls. Held so `applyDragExclusions` can update it.
    private var dragStrip: WindowDragStrip?
    let bridge = NotesBridge()
    let sidecar = AISidecar()
    /// Background sync timer (bundled CLI, same engine as the daemon). Created
    /// at launch; nil until then.
    private var syncScheduler: SyncScheduler?
    /// Serial queue for note mutations + the follow-up bootJSON rebuild. Script messages
    /// arrive on the main thread; running the disk-heavy save/boot work there froze
    /// typing (2 full store scans + manifest per autosave). The queue keeps saves ordered
    /// while the UI thread only hops back in to evaluate the hydrate JavaScript.
    private let notesQueue = DispatchQueue(label: "PersonalNotes.notes-bridge", qos: .userInitiated)
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

        // Background sync: keeps the store fresh while the app is open by
        // running the bundled CLI sync on a timer (never on the main thread).
        // Sync does not require the GUI — the `personalnotes sync --watch`
        // service is the primary scheduler; the store-level run lock keeps the
        // two from double-running. No-ops when the CLI is not signed in.
        //
        // After each run: rebuild the boot payload off-main and push it into
        // the page — the exact hydrate path every note mutation uses — so
        // pulled notes appear and the Settings sync row reflects the recorded
        // sync-status.json (success AND failure; errors must stay visible).
        // `bridge`/`notesQueue` are bound locally so the scheduler's closure
        // touches `self` only inside the main-thread hop, mirroring the
        // mutation path above.
        let syncBridge = bridge
        let syncNotesQueue = notesQueue
        let scheduler = SyncScheduler { [weak self] in
            syncNotesQueue.async { [weak self] in
                let fresh = syncBridge.bootJSON()
                DispatchQueue.main.async { [weak self] in
                    guard let self, let web = self.web else { return }
                    self.installUserScripts(into: web.configuration.userContentController, boot: fresh)
                    web.evaluateJavaScript("window.PersonalNotes && window.PersonalNotes.hydrate(\(fresh))", completionHandler: nil)
                }
            }
        }
        syncScheduler = scheduler
        scheduler.start()

        let frame = NSRect(x: 0, y: 0, width: 1280, height: 820)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "PersonalNotes"
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

        let cfg = WKWebViewConfiguration()

        // 1.+2. Install the document-start user scripts (native class, `window.__BOOT__`
        //    real notes data, `window.__AI__` sidecar flag). Reinstalled with fresh boot
        //    data after every mutation — see installUserScripts.
        let boot = bridge.bootJSON()
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
            NSLog("PersonalNotes: resourceURL is nil — cannot locate bundled web UI")
            return
        }
        let index = webDir.appendingPathComponent("index.html")
        NSLog("PersonalNotes: loading \(index.path) exists=\(FileManager.default.fileExists(atPath: index.path))")
        NSLog("PersonalNotes: boot payload bytes=\(boot.utf8.count) thisMachine=\(bridge.thisMachine)")
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
        // by scripts/build_personalnotes.sh. Empty when running the bare dev binary,
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
        NSLog("PersonalNotes: didFinish navigation")
        webView.evaluateJavaScript("document.body && document.body.classList.add('native')", completionHandler: nil)

        // Diagnostic: count how many note rows the page actually rendered. Proves REAL
        // notes (not the browser sample) reached the DOM. The class is `.note-row`.
        webView.evaluateJavaScript("document.querySelectorAll('.note-row').length") { result, _ in
            let count = (result as? Int) ?? (result as? NSNumber)?.intValue ?? -1
            NSLog("PersonalNotes: rendered \(count) note rows")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("PersonalNotes: didFail navigation: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("PersonalNotes: didFailProvisionalNavigation: \(error.localizedDescription)")
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
        if action == "machineDetails" {
            let machineID = (payload["machine"] as? String) ?? (payload["id"] as? String) ?? bridge.thisMachine
            let requestID = (payload["requestId"] as? String) ?? ""
            let bridge = self.bridge
            // machineDetails re-scans the whole store; compute off-main on the serial
            // notes queue (keeps ordering with mutations), hop back only to deliver.
            notesQueue.async { [weak self] in
                let details = jsonString([
                    "requestId": requestID,
                    "machine": bridge.machineDetails(id: machineID),
                ])
                DispatchQueue.main.async { [weak self] in
                    self?.web.evaluateJavaScript("window.PersonalNotes && window.PersonalNotes.machines && window.PersonalNotes.machines.receiveDetails(\(details))", completionHandler: nil)
                }
            }
            return
        }
        let noteDict = (payload["note"] as? [String: Any]) ?? [:]
        let destructiveConfirmed = (payload["confirmed"] as? Bool) == true || (noteDict["confirmed"] as? Bool) == true

        // Mutations are disk-heavy: `note(from:)` re-loads the whole store, and the
        // follow-up `bootJSON()` loads it again plus the fleet manifest. Script messages
        // arrive on the main thread, so doing that work here froze typing (every 600 ms
        // autosave). Hop to the serial notes queue — order-preserving, so rapid saves
        // land in sequence — and touch the main thread again only for the hydrate push.
        let note = NotesMutationPayload(dict: noteDict)
        let bridge = self.bridge
        notesQueue.async { [weak self] in
            func allowDestructive(_ action: String) -> Bool {
                if destructiveConfirmed { return true }
                NSLog("PersonalNotes: ignored unconfirmed destructive notes action '\(action)'")
                return false
            }

            var changed = false
            switch action {
            case "create": changed = bridge.save(note.dict, isCreate: true)
            case "save":   changed = bridge.save(note.dict, isCreate: false)
            case "move":   changed = bridge.move(note.dict)
            case "archive": changed = bridge.archive(note.dict)
            case "trash":
                guard allowDestructive(action) else { return }
                changed = bridge.trash(note.dict)
            case "restore": changed = bridge.restore(note.dict)
            case "purge":
                guard allowDestructive(action) else { return }
                changed = bridge.purge(note.dict)
            case "settings": changed = bridge.updateSettings(note.dict)
            case "labels": changed = bridge.updateLabels(note.dict)
            case "delete":
                guard allowDestructive(action) else { return }
                changed = bridge.delete(note.dict)
            default:
                NSLog("PersonalNotes: unknown notes action '\(action)'")
            }

            guard changed else { return }
            // After any mutation, reload from disk and push fresh data back into the page.
            // Also reinstall the document-start user scripts so a page reload re-injects
            // the CURRENT notes, not the launch-time `__BOOT__` snapshot.
            let fresh = bridge.bootJSON()
            DispatchQueue.main.async { [weak self] in
                guard let self, let web = self.web else { return }
                self.installUserScripts(into: web.configuration.userContentController, boot: fresh)
                web.evaluateJavaScript("window.PersonalNotes && window.PersonalNotes.hydrate(\(fresh))", completionHandler: nil)
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
    static let themePrefKey = "PersonalNotesThemePref"

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
    // expired-trash cleanup) and the prompt-driven machine move would no-op.
    // Each dialog runs as a sheet on the web view's window, never app-modal. The same
    // web view serves compact/quick-note mode, so both modes are covered.

    /// Shared NSAlert shell for the three JS dialogs.
    private func jsDialogAlert(message: String) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = "PersonalNotes"
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
        // Stop the sync timer (an in-flight CLI run finishes on its own — see
        // SyncScheduler.stop) and the AI sidecar child.
        syncScheduler?.stop()
        sidecar.stop()
        // Remove the message handlers so the proxies (and thus the controller→delegate
        // edge) are released cleanly. Belt-and-suspenders alongside the weak proxy.
        web?.configuration.userContentController.removeScriptMessageHandler(forName: notesHandlerName)
        web?.configuration.userContentController.removeScriptMessageHandler(forName: windowHandlerName)
        web?.configuration.userContentController.removeScriptMessageHandler(forName: recordingHandlerName)
        web?.evaluateJavaScript("window.PersonalNotes && window.PersonalNotes.destroy()", completionHandler: nil)
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
        appMenu.addItem(withTitle: "Hide PersonalNotes", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit PersonalNotes", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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
        let js = "window.PersonalNotes && window.PersonalNotes.recording && window.PersonalNotes.recording.\(action) && window.PersonalNotes.recording.\(action)()"
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

    // Menu-bar TEMPLATE glyphs (assets/brand/personalnotes-menubar{,-rec}.svg, bundled
    // into Resources/brand by scripts/build_personalnotes.sh). Template images are
    // monochrome — macOS tints them for light/dark menu bars, and contentTintColor
    // carries the recording state (docs/brand-visual-system.md → "Menu bar"). Nil when
    // running the bare binary outside the .app bundle; the title-only presentation
    // below then keeps its legacy symbol prefixes.
    private lazy var statusGlyphIdle: NSImage? = loadStatusGlyph("personalnotes-menubar")
    private lazy var statusGlyphRec: NSImage? = loadStatusGlyph("personalnotes-menubar-rec")

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
    ///   idle      → Start Recording · Open PersonalNotes
    ///   recording → elapsed timer · Pause/Resume · Stop · Open PersonalNotes
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
            let open = menu.addItem(withTitle: "Open PersonalNotes", action: #selector(openMainWindow(_:)), keyEquivalent: "")
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

    /// Bring the main app window forward (status-item "Open PersonalNotes").
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
