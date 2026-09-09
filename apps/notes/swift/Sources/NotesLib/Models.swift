import Foundation

public enum JSONValue: Codable, Sendable, Equatable {
    case null, bool(Bool), integer(Int64), number(Double), string(String)
    case array([JSONValue]), object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let value = try? c.decode(Bool.self) { self = .bool(value) }
        else if let value = try? c.decode(Int64.self) { self = .integer(value) }
        else if let value = try? c.decode(Double.self) { self = .number(value) }
        else if let value = try? c.decode(String.self) { self = .string(value) }
        else if let value = try? c.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .integer(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    public var object: [String: JSONValue]? { if case .object(let v) = self { return v }; return nil }
    public var string: String? { if case .string(let v) = self { return v }; return nil }
}

public struct Note: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let tenantId: String
    public let clientId: String?
    public let slug: String?
    public let title: String
    public let bodyMarkdown: String
    public let frontmatterJson: [String: JSONValue]
    public let folder: String?
    public let labels: [String]
    public let pinned: Bool
    public let archived: Bool
    public let revision: Int
    public let contentHash: String
    public let source: String
    public let agentProvenanceJson: [String: JSONValue]
    public let deletedAt: String?
    public let createdAt: String
    public let updatedAt: String

    public var isDeleted: Bool { deletedAt != nil }
}

public struct NoteInput: Encodable, Sendable {
    public var clientId: String?
    public var slug: String?
    public var title: String?
    public var bodyMarkdown: String?
    public var frontmatterJson: [String: JSONValue]?
    public var folder: JSONValue?
    public var labels: [String]?
    public var pinned: Bool?
    public var archived: Bool?
    public var source: String?
    public var agentProvenanceJson: [String: JSONValue]?
    public var baseRevision: Int?

    public init(clientId: String? = nil, title: String? = nil, bodyMarkdown: String? = nil, labels: [String]? = nil, pinned: Bool? = nil, baseRevision: Int? = nil) {
        self.clientId = clientId; self.title = title; self.bodyMarkdown = bodyMarkdown
        self.labels = labels; self.pinned = pinned; self.baseRevision = baseRevision
    }
}

public struct NotesPage: Codable, Sendable {
    public let data: [Note]
    public let nextCursor: String?
    public let hasMore: Bool
}
public struct NoteChange: Codable, Sendable {
    public let sequence: String
    public let noteId: String
    public let action: String
    public let note: Note?
}
public struct ChangesPage: Codable, Sendable {
    public let changes: [NoteChange]
    public let cursor: String
    public let hasMore: Bool
}
public struct NoteDeletion: Codable, Sendable {
    public let deleted: Bool
    public let id: String
    public let revision: Int
}
public struct NoteLabel: Codable, Sendable, Identifiable {
    public let name: String
    public let count: Int
    public var id: String { name }
}
public struct LabelsPage: Codable, Sendable { public let data: [NoteLabel] }
public struct LabelMutation: Codable, Sendable { public let updated: Int }
public struct NotesExport: Codable, Sendable {
    public let exportId: String
    public let notes: [Note]
}

public struct NotesAPIError: Error, LocalizedError, Sendable {
    public let code: String
    public let message: String
    public let status: Int
    public let details: JSONValue?
    public var errorDescription: String? { message }

    public init(_ code: String, _ message: String, status: Int = 0, details: JSONValue? = nil) {
        self.code = code; self.message = message; self.status = status; self.details = details
    }

    public var currentNote: Note? {
        guard let current = details?.object?["current"], let data = try? JSONEncoder().encode(current) else { return nil }
        return try? JSONDecoder().decode(Note.self, from: data)
    }
}
