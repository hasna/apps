import Foundation

/// Reads and writes notes as Markdown files with YAML frontmatter under
/// `~/.hasna/apps/notes/notes/<id>.md`. The markdown files are the source of truth.
///
/// This type is pure (no UI, no Combine) so it can be unit-tested in isolation and is
/// forward-compatible with the `@hasna/personalnotes` catalog/CLI that indexes the
/// same directory.
public struct MarkdownStore {
    public let rootURL: URL
    public let notesURL: URL

    /// Default data root: `~/.hasna/apps/notes/`. Notes live in `<root>/notes/`.
    public init(root: URL? = nil) {
        let resolvedRoot = root ?? FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent(".hasna", isDirectory: true)
            .appendingPathComponent("apps", isDirectory: true)
            .appendingPathComponent("notes", isDirectory: true)
        self.rootURL = resolvedRoot
        self.notesURL = resolvedRoot.appendingPathComponent("notes", isDirectory: true)
    }

    /// Ensure the notes directory exists. Safe to call repeatedly.
    public func ensureDirectory() throws {
        try FileManager.default.createDirectory(at: notesURL, withIntermediateDirectories: true)
    }

    public func fileURL(for id: UUID) -> URL {
        notesURL.appendingPathComponent("\(id.uuidString.lowercased()).md")
    }

    // MARK: - Loading

    /// Scan the notes directory and parse every `.md` file. Skips unreadable files.
    public func loadAll() throws -> [Note] {
        try ensureDirectory()
        let contents = try FileManager.default.contentsOfDirectory(
            at: notesURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        var notes: [Note] = []
        for url in contents where url.pathExtension.lowercased() == "md" {
            guard let raw = try? String(contentsOf: url, encoding: .utf8) else { continue }
            if let note = MarkdownStore.parse(raw, fallbackID: idFromFilename(url)) {
                notes.append(note)
            }
        }
        // Newest-updated first.
        notes.sort { $0.updatedAt > $1.updatedAt }
        return notes
    }

    private func idFromFilename(_ url: URL) -> UUID? {
        let name = url.deletingPathExtension().lastPathComponent
        return UUID(uuidString: name)
    }

    // MARK: - Saving (atomic)

    /// Serialize and write a note atomically: write to a temp file in the same
    /// directory, then `rename` into place so readers never see a partial file.
    ///
    /// Unless `preserveRev` is true, an overwrite bumps the per-note monotonic
    /// `rev` past whatever is currently on disk (every local mutation is a new
    /// revision; sync orders versions by `rev`, not wall clocks). New files keep
    /// their initial rev. Sync-applied writes pass `preserveRev: true`.
    public func save(_ note: Note, preserveRev: Bool = false) throws {
        try ensureDirectory()
        var note = note
        let target = fileURL(for: note.id)
        if !preserveRev,
           let raw = try? String(contentsOf: target, encoding: .utf8),
           let existing = MarkdownStore.parse(raw, fallbackID: note.id) {
            note.rev = max(note.rev, existing.rev) + 1
        }
        let serialized = MarkdownStore.serialize(note)
        let data = Data(serialized.utf8)

        let tempURL = notesURL.appendingPathComponent(".\(note.id.uuidString.lowercased()).\(UUID().uuidString).tmp")
        try data.write(to: tempURL, options: .atomic)
        // Atomic replace. `replaceItemAt` handles the existing-file case; fall back to
        // a plain move when the target does not yet exist.
        if FileManager.default.fileExists(atPath: target.path) {
            _ = try FileManager.default.replaceItemAt(target, withItemAt: tempURL)
        } else {
            try FileManager.default.moveItem(at: tempURL, to: target)
        }
    }

    public func delete(_ note: Note) throws {
        let target = fileURL(for: note.id)
        if FileManager.default.fileExists(atPath: target.path) {
            try FileManager.default.removeItem(at: target)
        }
    }

    // MARK: - Frontmatter parsing

    /// Parse a markdown document with optional YAML frontmatter into a `Note`.
    /// If there is no frontmatter, the whole text becomes the body and a title is
    /// derived from the first non-empty line.
    public static func parse(_ raw: String, fallbackID: UUID? = nil) -> Note? {
        let normalized = raw.replacingOccurrences(of: "\r\n", with: "\n")

        guard normalized.hasPrefix("---\n") || normalized == "---" else {
            return noteFromBareBody(normalized, fallbackID: fallbackID)
        }

        // Find the closing delimiter line.
        let lines = normalized.components(separatedBy: "\n")
        guard lines.first == "---" else {
            return noteFromBareBody(normalized, fallbackID: fallbackID)
        }
        var closingIndex: Int? = nil
        for i in 1..<lines.count where lines[i] == "---" {
            closingIndex = i
            break
        }
        guard let close = closingIndex else {
            return noteFromBareBody(normalized, fallbackID: fallbackID)
        }

        let frontmatterLines = Array(lines[1..<close])
        let bodyLines = close + 1 < lines.count ? Array(lines[(close + 1)...]) : []
        // The body is everything after the closing `---`, preserved byte-for-byte.
        // The serializer emits the body immediately after `---\n` (no blank separator),
        // so no leading-newline stripping is needed and would corrupt bodies that
        // legitimately begin with a newline.
        let body = bodyLines.joined(separator: "\n")

        let fields = parseFrontmatter(frontmatterLines)

        let id = fields["id"].flatMap { UUID(uuidString: $0) } ?? fallbackID ?? UUID()
        let title = fields["title"].flatMap(unquote) ?? "Untitled Note"
        // Back-compat: old files used `tags`; the user-facing schema is now `labels`.
        let labels = fields["labels"].map(parseScalarList)
            ?? fields["tags"].map(parseScalarList)
            ?? []
        let status = fields["status"].flatMap { NoteStatus(rawValue: $0.trimmingCharacters(in: .whitespaces)) } ?? .active
        // `folder` is optional and absent from legacy notes — default to "" (no folder).
        let folder = fields["folder"].flatMap(unquote) ?? ""
        let contentFormat = fields["contentFormat"].flatMap(unquote)
            ?? fields["contentType"].flatMap(unquote)
            ?? "markdown"
        let parsedTitleSource = fields["titleSource"]
            .flatMap { NoteTitleSource(rawValue: ($0.trimmingCharacters(in: .whitespaces))) }
        let titleSource = parsedTitleSource ?? (Note.isDefaultTitle(title) ? .defaultTitle : .manual)
        let titleLocked = fields["titleLocked"].flatMap(parseBool)
            ?? (titleSource == .manual && !Note.isDefaultTitle(title))
        let titleContentFingerprint = fields["titleContentFingerprint"].flatMap(unquote) ?? ""
        // v2 auto-detect: v1 files (no `rev` key) read as rev 1 without migration.
        let rev = fields["rev"].flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }.map { max(1, $0) } ?? 1
        let createdAt = fields["createdAt"].flatMap(parseDate) ?? Date()
        let updatedAt = fields["updatedAt"].flatMap(parseDate) ?? createdAt
        let author = fields["author"].flatMap(unquote) ?? Note.currentAuthor
        // Back-compat: legacy notes written by the old app carry `open-notes-app`; keep
        // that value verbatim. Notes with no `agent` key fall back to the current name.
        let agent = fields["agent"].flatMap(unquote) ?? Note.appAgent
        let machine = fields["machine"].flatMap(unquote) ?? Note.currentMachine
        let machineFriendlyName = fields["machineFriendlyName"].flatMap(unquote)
            ?? legacyMachineFriendlyName(fields: fields, machine: machine)
        let createdByActorType = fields["createdByActorType"].flatMap(unquote) ?? "human"
        let createdByName = fields["createdByName"].flatMap(unquote) ?? author
        let archivedAt = fields["archivedAt"].flatMap(unquote).flatMap(optionalDate)
        let trashedAt = fields["trashedAt"].flatMap(unquote).flatMap(optionalDate)
        let trashExpiresAt = fields["trashExpiresAt"].flatMap(unquote).flatMap(optionalDate)
        let restoredAt = fields["restoredAt"].flatMap(unquote).flatMap(optionalDate)

        return Note(
            id: id, title: title, labels: labels, status: status, folder: folder,
            contentFormat: contentFormat,
            titleLocked: titleLocked, titleSource: titleSource,
            titleContentFingerprint: titleContentFingerprint,
            rev: rev,
            createdAt: createdAt, updatedAt: updatedAt,
            author: author, agent: agent,
            machine: machine, machineFriendlyName: machineFriendlyName,
            createdByActorType: createdByActorType, createdByName: createdByName,
            archivedAt: archivedAt, trashedAt: trashedAt,
            trashExpiresAt: trashExpiresAt, restoredAt: restoredAt,
            body: body
        )
    }

    /// v1 back-compat: derive `machineFriendlyName` from the retired
    /// source/origin friendly-name keys when they described the note's own machine.
    /// Kept in lockstep with `machineFriendlyNameFromFields` in tools/notes-lib.mjs.
    private static func legacyMachineFriendlyName(fields: [String: String], machine: String) -> String {
        let sourceMachine = fields["sourceMachine"].flatMap(unquote) ?? ""
        let sourceName = fields["sourceMachineFriendlyName"].flatMap(unquote) ?? ""
        if !sourceName.isEmpty && (sourceMachine.isEmpty || sourceMachine == machine) { return sourceName }
        let originMachine = fields["originMachine"].flatMap(unquote) ?? ""
        let originName = fields["originMachineFriendlyName"].flatMap(unquote) ?? ""
        if !originName.isEmpty && originMachine == machine { return originName }
        return ""
    }

    private static func noteFromBareBody(_ text: String, fallbackID: UUID?) -> Note {
        let firstLine = text
            .components(separatedBy: "\n")
            .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })?
            .trimmingCharacters(in: CharacterSet(charactersIn: "# ").union(.whitespaces)) ?? "Untitled Note"
        return Note(
            id: fallbackID ?? UUID(),
            title: firstLine.isEmpty ? "Untitled Note" : String(firstLine.prefix(80)),
            body: text
        )
    }

    /// Minimal flat YAML parser: `key: value` per line. Sufficient for our schema.
    private static func parseFrontmatter(_ lines: [String]) -> [String: String] {
        var result: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if !key.isEmpty { result[key] = value }
        }
        return result
    }

    /// Parse a `labels: [...]` or legacy `tags: [...]` list. Strips the outer brackets,
    /// then splits on commas that are NOT inside a double-quoted segment, so a label
    /// like `"a,b"` stays intact.
    /// Each element is `unquote`d (which also unescapes), then trimmed of the surrounding
    /// whitespace that the serializer inserts between elements.
    private static func parseScalarList(_ value: String) -> [String] {
        var v = value.trimmingCharacters(in: .whitespaces)
        if v.hasPrefix("[") { v.removeFirst() }
        if v.hasSuffix("]") { v.removeLast() }

        let segments = splitTopLevelCommas(v)
        return segments.compactMap { segment -> String? in
            let trimmed = segment.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { return nil }
            // Evaluate emptiness on the UNQUOTED value: a quoted empty element (`""`) is
            // non-empty as a raw segment but empty as a label, so it must be pruned — matching
            // FolderStore, which drops empty names.
            guard let value = unquote(trimmed), !value.isEmpty else { return nil }
            return value
        }
    }

    private static func parseBool(_ value: String) -> Bool? {
        switch value.trimmingCharacters(in: .whitespaces).lowercased() {
        case "true", "yes", "1": return true
        case "false", "no", "0": return false
        default: return nil
        }
    }

    /// Split a string on commas that are outside of double-quoted segments. A backslash
    /// inside quotes escapes the next character (so an escaped quote does not end the
    /// segment). Quotes are preserved in the output segments for `unquote` to handle.
    private static func splitTopLevelCommas(_ s: String) -> [String] {
        var segments: [String] = []
        var current = ""
        var inQuotes = false
        var escaped = false
        for c in s {
            if escaped {
                current.append(c)
                escaped = false
                continue
            }
            switch c {
            case "\\" where inQuotes:
                current.append(c)
                escaped = true
            case "\"":
                inQuotes.toggle()
                current.append(c)
            case "," where !inQuotes:
                segments.append(current)
                current = ""
            default:
                current.append(c)
            }
        }
        segments.append(current)
        return segments
    }

    /// Reverse of `yamlScalar`. Strips surrounding quotes, then — for double-quoted
    /// values — unescapes the backslash sequences we emit (`\"`, `\\`, `\n`).
    /// Single-quoted values are taken verbatim (we never emit escapes inside them).
    private static func unquote(_ s: String) -> String? {
        let v = s.trimmingCharacters(in: .whitespaces)
        if v.count >= 2, v.hasPrefix("\"") && v.hasSuffix("\"") {
            let inner = String(v.dropFirst().dropLast())
            return unescapeDoubleQuoted(inner)
        }
        if v.count >= 2, v.hasPrefix("'") && v.hasSuffix("'") {
            return String(v.dropFirst().dropLast())
        }
        return v
    }

    /// Unescape a double-quoted scalar's interior. Processes escapes left-to-right in a
    /// single pass so `\\"` decodes to `\` + `"` (a literal backslash then a quote),
    /// not `"` + leftover. Recognizes `\\`, `\"`, and `\n`; any other `\x` keeps `x`.
    private static func unescapeDoubleQuoted(_ inner: String) -> String {
        var out = ""
        out.reserveCapacity(inner.count)
        var it = inner.makeIterator()
        while let c = it.next() {
            guard c == "\\" else { out.append(c); continue }
            switch it.next() {
            case "\\": out.append("\\")
            case "\"": out.append("\"")
            case "n": out.append("\n")
            case let other?: out.append(other)   // unknown escape: keep the char
            case nil: out.append("\\")            // trailing lone backslash
            }
        }
        return out
    }

    // MARK: - Serialization

    public static func serialize(_ note: Note) -> String {
        var lines: [String] = ["---"]
        lines.append("id: \(note.id.uuidString.lowercased())")
        lines.append("title: \(yamlScalar(note.title))")
        lines.append("labels: [\(note.labels.map(yamlScalar).joined(separator: ", "))]")
        lines.append("status: \(note.status.rawValue)")
        // Schema v2 — key order is fixed: id, title, labels, status, folder, content
        // format, title metadata, rev, createdAt, updatedAt, author, agent, machine
        // (+friendly name), actor provenance, archive/trash timestamps. Kept in
        // lockstep with FRONTMATTER_V2_KEYS in tools/notes-lib.mjs.
        lines.append("folder: \(yamlScalar(note.folder))")
        lines.append("contentFormat: \(yamlScalar(note.contentFormat))")
        lines.append("titleLocked: \(note.titleLocked ? "true" : "false")")
        lines.append("titleSource: \(note.titleSource.rawValue)")
        lines.append("titleContentFingerprint: \(yamlScalar(note.titleContentFingerprint))")
        lines.append("rev: \(max(1, note.rev))")
        lines.append("createdAt: \(iso8601(note.createdAt))")
        lines.append("updatedAt: \(iso8601(note.updatedAt))")
        lines.append("author: \(yamlScalar(note.author))")
        lines.append("agent: \(yamlScalar(note.agent))")
        lines.append("machine: \(yamlScalar(note.machine))")
        lines.append("machineFriendlyName: \(yamlScalar(note.machineFriendlyName))")
        lines.append("createdByActorType: \(yamlScalar(note.createdByActorType))")
        lines.append("createdByName: \(yamlScalar(note.createdByName))")
        lines.append("archivedAt: \(yamlScalar(note.archivedAt.map(iso8601) ?? ""))")
        lines.append("trashedAt: \(yamlScalar(note.trashedAt.map(iso8601) ?? ""))")
        lines.append("trashExpiresAt: \(yamlScalar(note.trashExpiresAt.map(iso8601) ?? ""))")
        lines.append("restoredAt: \(yamlScalar(note.restoredAt.map(iso8601) ?? ""))")
        lines.append("---")
        // Closing delimiter followed by a single newline, then the body verbatim.
        // Do NOT append a trailing terminator: the body must round-trip byte-for-byte
        // (an empty body, or a body with/without a trailing newline, is preserved as-is).
        var out = lines.joined(separator: "\n")
        out += "\n"
        out += note.body
        return out
    }

    /// Quote a scalar only when it contains characters that would confuse the flat parser.
    /// When quoting, escape backslash FIRST, then quote and newline, so the sequence is
    /// reversible by `unescapeDoubleQuoted`. A raw newline must never be emitted.
    /// A value already wrapped in single quotes (e.g. a title typed as `'hello'`) must
    /// also be double-quoted, or `unquote` would strip the user's quotes on read.
    private static func yamlScalar(_ value: String) -> String {
        // Leading/trailing whitespace of ANY kind (tab included) must force a
        // quote — the parser trims unquoted scalars, so an unquoted padded
        // value would lose its padding on read. Kept in lockstep with the JS
        // serializer's /^\s|\s$/ check in tools/notes-lib.mjs yamlScalar.
        let needsQuote = value.contains(":") || value.contains("#") ||
            value.contains("[") || value.contains("]") ||
            value.contains(",") || value.contains("\"") ||
            value.contains("\\") || value.contains("\n") ||
            (value.count >= 2 && value.hasPrefix("'") && value.hasSuffix("'")) ||
            (value.first?.isWhitespace ?? false) || (value.last?.isWhitespace ?? false) ||
            value.isEmpty
        if !needsQuote { return value }
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "\"\(escaped)\""
    }

    // MARK: - Dates

    private static func makeISOFormatter() -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }

    public static func iso8601(_ date: Date) -> String {
        makeISOFormatter().string(from: date)
    }

    public static func parseDate(_ value: String) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        if let d = makeISOFormatter().date(from: trimmed) { return d }
        // Tolerate fractional seconds.
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: trimmed)
    }

    private static func optionalDate(_ value: String) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return parseDate(trimmed)
    }
}
