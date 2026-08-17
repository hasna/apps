import CryptoKit
import Darwin
import Foundation

/// Native implementation of the Node-safe `@hasna/events/durable-spool`
/// contract for `notes/note.created`. It writes only note identity metadata;
/// titles, labels, bodies, and credentials never enter event state.
public struct NoteCreatedEventSpool {
    public struct ReconcileSummary: Equatable {
        public var establishedBaseline: Bool
        public var enqueued: Int
        public var deduped: Int

        public init(establishedBaseline: Bool = false, enqueued: Int = 0, deduped: Int = 0) {
            self.establishedBaseline = establishedBaseline
            self.enqueued = enqueued
            self.deduped = deduped
        }
    }

    private enum SpoolError: Error {
        case invalidEvent
        case identityCollision
        case posix(String, Int32)
    }

    private let rootURL: URL
    private let eventsURL: URL
    private let stateURL: URL
    private let intentsURL: URL
    private let fallbackIntentsURL: URL
    private let seenURL: URL
    private let baselineURL: URL
    private let inboxURL: URL
    private let linkOperation: (String, String) -> Int32

    public init(
        root: URL,
        linkOperation: @escaping (String, String) -> Int32 = { Darwin.link($0, $1) }
    ) {
        rootURL = root
        eventsURL = root.appendingPathComponent("events", isDirectory: true)
        stateURL = eventsURL.appendingPathComponent("notes-note-created", isDirectory: true)
        intentsURL = stateURL.appendingPathComponent("intents", isDirectory: true)
        fallbackIntentsURL = root
            .appendingPathComponent("notes", isDirectory: true)
            .appendingPathComponent(".note-created-intents", isDirectory: true)
        seenURL = stateURL.appendingPathComponent("seen", isDirectory: true)
        baselineURL = stateURL.appendingPathComponent("baseline-v1.json")
        inboxURL = eventsURL
            .appendingPathComponent("spool", isDirectory: true)
            .appendingPathComponent("inbox", isDirectory: true)
        self.linkOperation = linkOperation
    }

    /// Persisted before the Markdown rename. A crash after the note save but
    /// before spool publication is recovered from this intent on next startup.
    public func beginCreate(_ note: Note) throws {
        let payload = try eventData(note)
        do {
            try atomicWrite(payload, to: intentURL(note.id))
        } catch {
            try atomicWrite(payload, to: fallbackIntentURL(note.id))
        }
    }

    /// Remove an intent only when the note write itself failed.
    public func cancelCreate(_ id: UUID) {
        try? removeAndSync(intentURL(id))
        try? removeAndSync(fallbackIntentURL(id))
    }

    /// Publish after the note save. Failure deliberately leaves the intent in
    /// place and never rolls back or reports the successful note save as failed.
    @discardableResult
    public func commitCreate(_ note: Note) -> Bool {
        do {
            _ = try enqueue(note)
            try markSeen(note.id)
            try removeIntentCopies(note.id)
            return true
        } catch {
            return false
        }
    }

    /// Startup recovery and clean first-run baseline. Existing historical notes
    /// are marked seen without delivery; crash-surviving intents are always
    /// enqueued first. Later unseen files are reconciled as creates.
    public func reconcile(
        store: MarkdownStore,
        strictLoader: ((MarkdownStore) throws -> [Note])? = nil
    ) throws -> ReconcileSummary {
        let notes = try strictLoader?(store) ?? store.loadAllStrict()
        try recoverStaleSpoolTemps()
        let byID = Dictionary(uniqueKeysWithValues: notes.map { ($0.id.uuidString.lowercased(), $0) })
        var summary = ReconcileSummary()

        try ensureDirectory(intentsURL)
        try ensureDirectory(fallbackIntentsURL)
        var intentNoteIDs = Set<String>()
        for directory in [intentsURL, fallbackIntentsURL] {
            let files = try FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            ).filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
            for file in files { intentNoteIDs.insert(try intentNoteID(file)) }
        }

        for noteID in intentNoteIDs.sorted() {
            guard let note = byID[noteID] else { continue }
            if try enqueue(note) { summary.enqueued += 1 } else { summary.deduped += 1 }
            try markSeen(note.id)
            try removeIntentCopies(note.id)
        }

        let baselineExists = try hasBaseline()
        if !baselineExists {
            for note in notes { try markSeen(note.id) }
            let baseline: [String: Any] = [
                "version": 1,
                "establishedAt": MarkdownStore.iso8601(Date()),
            ]
            try atomicWrite(jsonData(baseline), to: baselineURL)
            summary.establishedBaseline = true
        } else {
            for note in notes where try !isSeen(note.id) {
                if try enqueue(note) { summary.enqueued += 1 } else { summary.deduped += 1 }
                try markSeen(note.id)
            }
        }
        return summary
    }

    private func identity(_ id: UUID) -> String {
        "notes:note:\(id.uuidString.lowercased()):created"
    }

    private func event(_ note: Note) -> [String: Any] {
        let noteID = note.id.uuidString.lowercased()
        let createdAt = MarkdownStore.iso8601(note.createdAt)
        let eventID = identity(note.id)
        return [
            "id": eventID,
            "source": "notes",
            "type": "note.created",
            "time": createdAt,
            "subject": "note:\(noteID)",
            "severity": "info",
            "data": [
                "noteId": noteID,
                "createdAt": createdAt,
                "originMachine": note.machine.isEmpty ? "unknown" : note.machine,
            ],
            "dedupeKey": eventID,
            "schemaVersion": "notes.v1",
            "metadata": [:] as [String: Any],
        ]
    }

    private func eventData(_ note: Note) throws -> Data {
        try jsonData(event(note))
    }

    private func jsonData(_ object: [String: Any]) throws -> Data {
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(0x0a)
        return data
    }

    private func intentURL(_ id: UUID) -> URL {
        intentsURL.appendingPathComponent("\(id.uuidString.lowercased()).json")
    }

    private func fallbackIntentURL(_ id: UUID) -> URL {
        fallbackIntentsURL.appendingPathComponent("\(id.uuidString.lowercased()).json")
    }

    private func intentNoteID(_ url: URL) throws -> String {
        guard let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
              object["source"] as? String == "notes",
              object["type"] as? String == "note.created",
              let data = object["data"] as? [String: Any],
              let rawID = data["noteId"] as? String,
              let noteID = UUID(uuidString: rawID)?.uuidString.lowercased(),
              object["id"] as? String == "notes:note:\(noteID):created",
              object["dedupeKey"] as? String == "notes:note:\(noteID):created" else {
            throw SpoolError.invalidEvent
        }
        return noteID
    }

    private func removeIntentCopies(_ id: UUID) throws {
        try removeAndSync(intentURL(id))
        try removeAndSync(fallbackIntentURL(id))
    }

    private func seenMarkerURL(_ id: UUID) -> URL {
        seenURL.appendingPathComponent(id.uuidString.lowercased())
    }

    private func hasBaseline() throws -> Bool {
        var details = stat()
        guard Darwin.lstat(baselineURL.path, &details) == 0 else {
            if errno == ENOENT || errno == ENOTDIR { return false }
            throw SpoolError.posix("stat baseline", errno)
        }
        let data = try Data(contentsOf: baselineURL)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              (object["version"] as? NSNumber)?.intValue == 1 else {
            throw SpoolError.invalidEvent
        }
        return true
    }

    private func isSeen(_ id: UUID) throws -> Bool {
        var details = stat()
        guard Darwin.lstat(seenMarkerURL(id).path, &details) == 0 else {
            if errno == ENOENT || errno == ENOTDIR { return false }
            throw SpoolError.posix("stat seen marker", errno)
        }
        return true
    }

    private func markSeen(_ id: UUID) throws {
        try ensureDirectory(seenURL)
        let path = seenMarkerURL(id).path
        let fd = Darwin.open(path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        if fd < 0 {
            if errno == EEXIST { return }
            throw SpoolError.posix("open seen marker", errno)
        }
        defer { Darwin.close(fd) }
        guard Darwin.fsync(fd) == 0 else { throw SpoolError.posix("fsync seen marker", errno) }
        try fsyncDirectory(seenURL)
    }

    /// Returns true when stored, false when the identity already exists.
    private func enqueue(_ note: Note) throws -> Bool {
        try ensureDirectory(inboxURL)
        let identity = identity(note.id)
        let hash = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        let finalURL = inboxURL.appendingPathComponent("\(hash).json")
        let tempURL = inboxURL.appendingPathComponent(".tmp-\(getpid())-\(UUID().uuidString.lowercased())")
        let payload = try eventData(note)
        try writeExclusive(payload, to: tempURL)

        let linked = linkOperation(tempURL.path, finalURL.path)
        if linked != 0 {
            let code = errno
            if code != EEXIST {
                try? FileManager.default.removeItem(at: tempURL)
                throw SpoolError.posix("link event spool", code)
            }
            guard try sameIdentity(at: finalURL, identity: identity) else {
                try? FileManager.default.removeItem(at: tempURL)
                throw SpoolError.identityCollision
            }
        }
        try FileManager.default.removeItem(at: tempURL)
        try fsyncDirectory(inboxURL)
        return linked == 0
    }

    private func sameIdentity(at url: URL, identity: String) throws -> Bool {
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        return object?["id"] as? String == identity || object?["dedupeKey"] as? String == identity
    }

    public func recoverStaleSpoolTemps(olderThan: TimeInterval = 60) throws {
        try ensureDirectory(inboxURL)
        let now = Date()
        let files = try FileManager.default.contentsOfDirectory(
            at: inboxURL,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: []
        )
        for file in files where file.lastPathComponent.hasPrefix(".tmp-") {
            let values = try? file.resourceValues(forKeys: [.contentModificationDateKey])
            guard let modified = values?.contentModificationDate,
                  now.timeIntervalSince(modified) >= olderThan else { continue }
            guard let object = try? JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any],
                  let identity = (object["dedupeKey"] as? String) ?? (object["id"] as? String),
                  !identity.isEmpty else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            let hash = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
            let finalURL = inboxURL.appendingPathComponent("\(hash).json")
            if linkOperation(file.path, finalURL.path) != 0 {
                let code = errno
                guard code == EEXIST else {
                    throw SpoolError.posix("link recovered event spool", code)
                }
                guard try sameIdentity(at: finalURL, identity: identity) else {
                    throw SpoolError.identityCollision
                }
            }
            try? FileManager.default.removeItem(at: file)
        }
        try fsyncDirectory(inboxURL)
    }

    private func ensureDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        if url.path == fallbackIntentsURL.path {
            guard Darwin.chmod(url.path, S_IRWXU) == 0 else {
                throw SpoolError.posix("chmod fallback intent directory", errno)
            }
            try fsyncDirectory(url.deletingLastPathComponent())
            return
        }
        var protectedURL = url
        while protectedURL.path.hasPrefix(eventsURL.path) {
            guard Darwin.chmod(protectedURL.path, S_IRWXU) == 0 else {
                throw SpoolError.posix("chmod directory", errno)
            }
            if protectedURL.path == eventsURL.path { break }
            let parent = protectedURL.deletingLastPathComponent()
            if parent.path == protectedURL.path { break }
            protectedURL = parent
        }
    }

    private func atomicWrite(_ data: Data, to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try ensureDirectory(directory)
        let temp = directory.appendingPathComponent(".tmp-\(getpid())-\(UUID().uuidString.lowercased())")
        try writeExclusive(data, to: temp)
        guard Darwin.rename(temp.path, url.path) == 0 else {
            let code = errno
            try? FileManager.default.removeItem(at: temp)
            throw SpoolError.posix("rename state", code)
        }
        try fsyncDirectory(directory)
    }

    private func writeExclusive(_ data: Data, to url: URL) throws {
        let fd = Darwin.open(url.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw SpoolError.posix("open durable file", errno) }
        var closeNeeded = true
        defer { if closeNeeded { Darwin.close(fd) } }
        try data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let written = Darwin.write(fd, base.advanced(by: offset), rawBuffer.count - offset)
                guard written > 0 else { throw SpoolError.posix("write durable file", errno) }
                offset += written
            }
        }
        guard Darwin.fsync(fd) == 0 else { throw SpoolError.posix("fsync durable file", errno) }
        guard Darwin.close(fd) == 0 else { throw SpoolError.posix("close durable file", errno) }
        closeNeeded = false
    }

    private func fsyncDirectory(_ url: URL) throws {
        let fd = Darwin.open(url.path, O_RDONLY)
        guard fd >= 0 else { throw SpoolError.posix("open directory", errno) }
        defer { Darwin.close(fd) }
        guard Darwin.fsync(fd) == 0 else { throw SpoolError.posix("fsync directory", errno) }
    }

    private func removeAndSync(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
            try fsyncDirectory(url.deletingLastPathComponent())
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError {
            return
        }
    }
}
