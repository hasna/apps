import Foundation

// Hasna Notes — Swift-side client transport + HTTP store, mirroring the
// canonical TS resolver (`client/transport.mjs`) and store
// (`client/http-store.mjs`) so the macOS app host talks the same
// personalnotes/v1 dialect as the CLI and MCP server.
//
// SAFETY: the API key lives only inside this module's request headers; it is
// never logged, returned, or embedded in errors. An API URL without its key
// FAILS CLOSED at resolution — there is no anonymous fallback and no default
// localhost server. The macOS app additionally refuses the `local` transport
// (cloud-only storage): see HasnaNotesApp's bridge.

public enum NotesHttpError: Error, Equatable, CustomStringConvertible {
    /// URL present without a key (or empty required input). Never a fallback.
    case failClosed(String)
    /// Non-2xx response carrying the dialect `{"error":{code,message}}` envelope.
    case request(status: Int, code: String, message: String)
    /// Transport-level failure (connection, DNS, macOS Local Network Privacy).
    case transport(String)
    /// Response body could not be parsed as the expected wire shape.
    case invalidResponse(String)

    public var description: String {
        switch self {
        case .failClosed(let message): return message
        case .request(let status, let code, let message):
            return "Notes API error \(status) \(code): \(message)"
        case .transport(let message): return "cannot reach the Notes API: \(message)"
        case .invalidResponse(let message): return "invalid Notes API response: \(message)"
        }
    }
}

/// One note in the personalnotes/v1 wire dialect (§3 of the protocol contract).
/// Fixed fields are decoded from the wire; `frontmatterJson` is opaque
/// server-side storage that round-trips the app's Swift metadata
/// (`NotesWireMapping.swiftMeta`).
public struct NotesWireNote: Equatable {
    public let id: String
    public let title: String
    public let bodyMarkdown: String
    public let labels: [String]
    public let folder: String?
    public let archived: Bool
    public let revision: Int
    public let deletedAt: String?
    public let createdAt: String?
    public let updatedAt: String?
    public let frontmatterJson: [String: Any]
    public let agentProvenanceJson: [String: Any]
    public let source: String?

    public init?(json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        self.title = json["title"] as? String ?? "Untitled"
        self.bodyMarkdown = json["bodyMarkdown"] as? String ?? ""
        self.labels = (json["labels"] as? [String]) ?? []
        self.folder = json["folder"] as? String
        self.archived = (json["archived"] as? Bool) ?? false
        self.revision = (json["revision"] as? Int) ?? 1
        self.deletedAt = json["deletedAt"] as? String
        self.createdAt = json["createdAt"] as? String
        self.updatedAt = json["updatedAt"] as? String
        self.frontmatterJson = (json["frontmatterJson"] as? [String: Any]) ?? [:]
        self.agentProvenanceJson = (json["agentProvenanceJson"] as? [String: Any]) ?? [:]
        self.source = json["source"] as? String
    }

    /// Soft-deleted notes carry `deletedAt` (the dialect's trash tombstone).
    public var isDeleted: Bool { deletedAt != nil }

    public static func == (lhs: NotesWireNote, rhs: NotesWireNote) -> Bool {
        lhs.id == rhs.id && lhs.title == rhs.title && lhs.bodyMarkdown == rhs.bodyMarkdown
            && lhs.labels == rhs.labels && lhs.folder == rhs.folder && lhs.archived == rhs.archived
            && lhs.revision == rhs.revision && lhs.deletedAt == rhs.deletedAt
            && lhs.createdAt == rhs.createdAt && lhs.updatedAt == rhs.updatedAt
            && NSDictionary(dictionary: lhs.frontmatterJson).isEqual(to: rhs.frontmatterJson)
            && NSDictionary(dictionary: lhs.agentProvenanceJson).isEqual(to: rhs.agentProvenanceJson)
    }
}

/// Client transport resolution. Mirrors `resolveNotesClientTransport` in
/// client/transport.mjs exactly:
///   - URL + key present  -> `.http`
///   - URL present, no key -> `.failClosed` (never a local fallback)
///   - neither present    -> `.local` (the CLI/MCP default; the macOS app
///                           deliberately rejects this case — cloud-only)
public enum NotesClientTransport: Equatable {
    case http
    case local
    case failClosed(message: String)
}

public enum NotesTransportResolver {
    public static let apiUrlEnv = "HASNA_NOTES_API_URL"
    public static let apiKeyEnv = "HASNA_NOTES_API_KEY"

    /// Retired selector names, mirroring transport.mjs RETIRED_SELECTOR_ENV_KEYS.
    /// They fail loud even when blank so a stale station fragment cannot be
    /// silently ignored.
    public static let retiredSelectorEnvKeys = [
        "PERSONALNOTES_MODE", "HASNA_NOTES_STORAGE_MODE", "HASNA_NOTES_MODE",
        "NOTES_STORAGE_MODE", "NOTES_MODE",
    ]

    public static func isPresent(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public static func resolve(env: [String: String] = ProcessInfo.processInfo.environment) -> NotesClientTransport {
        for key in retiredSelectorEnvKeys where env[key] != nil {
            return .failClosed(
                message: "notes: \(key) was retired and must be unset. "
                    + "Clients select the HTTP API when \(apiUrlEnv) and \(apiKeyEnv) are set; "
                    + "without \(apiUrlEnv) they use the local store. "
                    + "Servers select PostgreSQL with HASNA_NOTES_DATABASE_URL."
            )
        }
        let apiUrlPresent = isPresent(env[apiUrlEnv])
        let apiKeyPresent = isPresent(env[apiKeyEnv])
        if apiUrlPresent && !apiKeyPresent {
            return .failClosed(
                message: "notes: \(apiUrlEnv) selects the HTTP API, but \(apiKeyEnv) is missing. "
                    + "Set \(apiKeyEnv), or unset \(apiUrlEnv) to use the local store."
            )
        }
        return apiUrlPresent ? .http : .local
    }
}

/// Plain HTTP client over the personalnotes/v1 wire dialect. The transport is
/// injectable so the smoke harness can exercise store verbs against a stub
/// without a live server.
public struct NotesHttpStore {
    public typealias NotesTransport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    public let apiUrl: String
    public let apiKey: String
    public let transport: NotesTransport

    /// Default transport: the shared URLSession.
    public static func urlSessionTransport() -> NotesTransport {
        { try await URLSession.shared.data(for: $0) }
    }

    public init(
        apiUrl: String,
        apiKey: String,
        transport: @escaping NotesTransport = { try await URLSession.shared.data(for: $0) }
    ) {
        var url = apiUrl
        while url.hasSuffix("/") { url.removeLast() }
        self.apiUrl = url
        self.apiKey = apiKey
        self.transport = transport
    }

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let url = URL(string: apiUrl + path) else {
            throw NotesHttpError.transport("invalid API URL for \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "authorization")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport(request)
        } catch {
            throw NotesHttpError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw NotesHttpError.invalidResponse("no HTTP response received")
        }
        var json: [String: Any]? = nil
        if !data.isEmpty {
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NotesHttpError.invalidResponse("\(method) \(path) returned non-JSON body")
            }
            json = object
        }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = json?["error"] as? [String: Any]
            let code = envelope?["code"] as? String ?? "http_\(http.statusCode)"
            let message = envelope?["message"] as? String ?? "Notes API \(method) \(path) failed"
            throw NotesHttpError.request(status: http.statusCode, code: code, message: message)
        }
        return json ?? [:]
    }

    // MARK: - verbs

    public func health() async throws -> [String: Any] {
        try await request("GET", "/health")
    }

    /// One paged list call (dialect superset: opaque `cursor` pages by seq DESC).
    /// Returns the page plus an opaque `nextCursor` when more rows exist — the
    /// macOS host pages to exhaustion so a tenant with more than the 200-row
    /// page cap is fully enumerated (server GAP-6).
    public func listPage(
        includeDeleted: Bool = false,
        limit: Int = 200,
        cursor: String? = nil
    ) async throws -> ([NotesWireNote], String?) {
        var query: [String] = []
        if includeDeleted { query.append("include_deleted=1") }
        query.append("limit=\(limit)")
        if let cursor { query.append("cursor=\(cursor)") }
        let suffix = "?" + query.joined(separator: "&")
        let json = try await request("GET", "/api/v1/notes\(suffix)")
        let rows = (json["data"] as? [[String: Any]]) ?? []
        let notes = rows.compactMap { NotesWireNote(json: $0) }
        let nextCursor = json["nextCursor"] as? String
        return (notes, nextCursor)
    }

    public func listNotes(includeDeleted: Bool = false, limit: Int? = nil) async throws -> [NotesWireNote] {
        let (notes, _) = try await listPage(includeDeleted: includeDeleted, limit: limit ?? 200)
        return notes
    }

    public func createNote(_ input: [String: Any]) async throws -> NotesWireNote {
        let json = try await request("POST", "/api/v1/notes", body: input)
        guard let note = NotesWireNote(json: json) else {
            throw NotesHttpError.invalidResponse("createNote returned an unparseable note")
        }
        return note
    }

    public func updateNote(id: String, _ input: [String: Any]) async throws -> NotesWireNote {
        let json = try await request("PATCH", "/api/v1/notes/\(id)", body: input)
        guard let note = NotesWireNote(json: json) else {
            throw NotesHttpError.invalidResponse("updateNote returned an unparseable note")
        }
        return note
    }

    /// Soft-delete (the dialect's trash tombstone): the row keeps answering
    /// the `include_deleted=1` list feed; nothing is ever purged.
    public func deleteNote(id: String) async throws {
        _ = try await request("DELETE", "/api/v1/notes/\(id)")
    }
}
