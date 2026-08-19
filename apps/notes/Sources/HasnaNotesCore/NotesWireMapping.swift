import Foundation

// Hasna Notes — mapping between the Swift `Note` model and the
// personalnotes/v1 wire note (`NotesWireNote`).
//
// The server schema is deliberately smaller than the Swift/web model: it
// carries `archived` (bool), the soft-delete `deletedAt` tombstone, labels,
// folder, title, bodyMarkdown — and two opaque JSON round-trip fields:
// `frontmatterJson` and `agentProvenanceJson`. All Swift-specific metadata
// (machine attribution, actor provenance, title metadata, archive/trash/
// restore timestamps, the web layer's own updatedAt stamp) rides in those
// two fields so a load->save cycle preserves it byte-for-byte.
//
// Status mapping (the web UI's lifecycle vocabulary):
//   .trash    <-> wire `deletedAt` set (soft delete — trash is never purged)
//   .archived <-> wire `archived: true`
//   .active   <-> neither
// `trashExpiresAt` is derived client-side from `deletedAt` + the retention
// preference, matching the web UI's legacy fallback (trashedAt + retention).

public enum NotesWireMapping {
    /// Key inside `frontmatterJson` holding the app's Swift metadata.
    public static let swiftMetaKey = "swift"

    /// Swift-specific metadata round-tripped through `frontmatterJson.swift`.
    public struct SwiftMeta: Equatable {
        public var createdAt: String?
        public var updatedAt: String?
        public var contentFormat: String?
        public var titleLocked: Bool?
        public var titleSource: String?
        public var titleContentFingerprint: String?
        public var archivedAt: String?
        public var trashedAt: String?
        public var trashExpiresAt: String?
        public var restoredAt: String?

        public init() {}

        public init(
            createdAt: String? = nil,
            updatedAt: String? = nil,
            contentFormat: String? = nil,
            titleLocked: Bool? = nil,
            titleSource: String? = nil,
            titleContentFingerprint: String? = nil,
            archivedAt: String? = nil,
            trashedAt: String? = nil,
            trashExpiresAt: String? = nil,
            restoredAt: String? = nil
        ) {
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.contentFormat = contentFormat
            self.titleLocked = titleLocked
            self.titleSource = titleSource
            self.titleContentFingerprint = titleContentFingerprint
            self.archivedAt = archivedAt
            self.trashedAt = trashedAt
            self.trashExpiresAt = trashExpiresAt
            self.restoredAt = restoredAt
        }

        public init?(json: [String: Any]) {
            guard json.isEmpty == false else { return nil }
            createdAt = json["createdAt"] as? String
            updatedAt = json["updatedAt"] as? String
            contentFormat = json["contentFormat"] as? String
            titleLocked = json["titleLocked"] as? Bool
            titleSource = json["titleSource"] as? String
            titleContentFingerprint = json["titleContentFingerprint"] as? String
            archivedAt = json["archivedAt"] as? String
            trashedAt = json["trashedAt"] as? String
            trashExpiresAt = json["trashExpiresAt"] as? String
            restoredAt = json["restoredAt"] as? String
        }

        public var json: [String: Any] {
            var out: [String: Any] = [:]
            out["createdAt"] = createdAt ?? ""
            out["updatedAt"] = updatedAt ?? ""
            out["contentFormat"] = contentFormat ?? ""
            out["titleLocked"] = titleLocked ?? false
            out["titleSource"] = titleSource ?? ""
            out["titleContentFingerprint"] = titleContentFingerprint ?? ""
            out["archivedAt"] = archivedAt ?? ""
            out["trashedAt"] = trashedAt ?? ""
            out["trashExpiresAt"] = trashExpiresAt ?? ""
            out["restoredAt"] = restoredAt ?? ""
            return out
        }
    }

    private static func string(_ json: [String: Any], _ key: String) -> String? {
        (json[key] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// Build a Swift `Note` from a wire note. Wire fields are canonical for
    /// the server-managed values; Swift metadata fills the rest.
    public static func note(from wire: NotesWireNote, retentionDays: Int) -> Note {
        let meta = SwiftMeta(json: (wire.frontmatterJson[swiftMetaKey] as? [String: Any]) ?? [:]) ?? SwiftMeta()
        let provenance = wire.agentProvenanceJson

        let id = UUID(uuidString: wire.id) ?? UUID()
        let status: NoteStatus = wire.isDeleted ? .trash : (wire.archived ? .archived : .active)

        let createdAt = meta.createdAt.flatMap(MarkdownStore.parseDate)
            ?? wire.createdAt.flatMap(MarkdownStore.parseDate)
            ?? Date()
        let updatedAt = meta.updatedAt.flatMap(MarkdownStore.parseDate)
            ?? wire.updatedAt.flatMap(MarkdownStore.parseDate)
            ?? createdAt

        // Trash timestamps: the server's deletedAt is canonical for when it
        // was trashed; expiry is derived client-side from the retention days
        // preference (the web UI's own legacy fallback does the same).
        var trashedAt: Date? = nil
        var trashExpiresAt: Date? = nil
        if wire.isDeleted {
            trashedAt = meta.trashedAt.flatMap(MarkdownStore.parseDate) ?? wire.deletedAt.flatMap(MarkdownStore.parseDate)
            if let trashed = trashedAt {
                trashExpiresAt = meta.trashExpiresAt.flatMap(MarkdownStore.parseDate)
                    ?? Calendar.current.date(byAdding: .day, value: max(1, retentionDays), to: trashed)
            }
        }

        let author = string(provenance, "author") ?? Note.currentAuthor
        let contentFormat = meta.contentFormat ?? "markdown"

        return Note(
            id: id,
            title: wire.title,
            labels: wire.labels,
            status: status,
            folder: wire.folder ?? "",
            contentFormat: contentFormat,
            titleLocked: meta.titleLocked ?? false,
            titleSource: meta.titleSource.flatMap { NoteTitleSource(rawValue: $0) },
            titleContentFingerprint: meta.titleContentFingerprint ?? "",
            rev: wire.revision,
            createdAt: createdAt,
            updatedAt: updatedAt,
            author: author,
            agent: string(provenance, "agent") ?? Note.appAgent,
            machine: string(provenance, "machine") ?? Note.currentMachine,
            machineFriendlyName: string(provenance, "machineFriendlyName") ?? "",
            createdByActorType: string(provenance, "createdByActorType") ?? "human",
            createdByName: string(provenance, "createdByName") ?? author,
            archivedAt: meta.archivedAt.flatMap(MarkdownStore.parseDate),
            trashedAt: trashedAt,
            trashExpiresAt: trashExpiresAt,
            restoredAt: meta.restoredAt.flatMap(MarkdownStore.parseDate),
            body: wire.bodyMarkdown
        )
    }

    private static func metaJSON(for note: Note) -> [String: Any] {
        SwiftMeta(
            createdAt: MarkdownStore.iso8601(note.createdAt),
            updatedAt: MarkdownStore.iso8601(note.updatedAt),
            contentFormat: note.contentFormat,
            titleLocked: note.titleLocked,
            titleSource: note.titleSource.rawValue,
            titleContentFingerprint: note.titleContentFingerprint,
            archivedAt: note.archivedAt.map(MarkdownStore.iso8601),
            trashedAt: note.trashedAt.map(MarkdownStore.iso8601),
            trashExpiresAt: note.trashExpiresAt.map(MarkdownStore.iso8601),
            restoredAt: note.restoredAt.map(MarkdownStore.iso8601)
        ).json
    }

    private static func provenanceJSON(for note: Note) -> [String: Any] {
        [
            "agent": note.agent,
            "machine": note.machine,
            "machineFriendlyName": note.machineFriendlyName,
            "author": note.author,
            "createdByActorType": note.createdByActorType,
            "createdByName": note.createdByName,
            "contentFormat": note.contentFormat,
        ]
    }

    /// Wire payload for create (POST /api/v1/notes).
    public static func wireCreatePayload(for note: Note) -> [String: Any] {
        [
            "title": note.title,
            "bodyMarkdown": note.body,
            "labels": note.labels,
            "folder": note.folder,
            "archived": note.status == .archived,
            "frontmatterJson": [swiftMetaKey: metaJSON(for: note)],
            "agentProvenanceJson": provenanceJSON(for: note),
            "source": "notes-app",
        ]
    }

    /// Wire payload for update (PATCH /api/v1/notes/:id). The server merges
    /// field-wise; sending the full note converges to last-write-wins.
    public static func wireUpdatePayload(for note: Note) -> [String: Any] {
        wireCreatePayload(for: note)
    }
}
