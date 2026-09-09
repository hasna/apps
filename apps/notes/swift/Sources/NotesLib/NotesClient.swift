import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct NotesClient: Sendable {
    public typealias CredentialProvider = @Sendable () throws -> String?
    public let apiBase: URL
    private let credential: CredentialProvider
    private let timeout: TimeInterval
    private let maximum: Int

    public init(apiBase: URL, allowHTTPLoopback: Bool = false, timeout: TimeInterval = 30,
                maximumResponseBytes: Int = 8 * 1024 * 1024, credential: @escaping CredentialProvider) throws {
        let loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].contains(apiBase.host ?? "")
        guard let components = URLComponents(url: apiBase, resolvingAgainstBaseURL: false), components.host != nil,
              components.scheme == "https" || (allowHTTPLoopback && components.scheme == "http" && loopback),
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              timeout > 0, timeout.isFinite, maximumResponseBytes > 0 else {
            throw NotesAPIError("invalid_authority", "A complete HTTPS Notes API base without credentials, query or fragment is required.")
        }
        var normalized = components
        while normalized.percentEncodedPath.hasSuffix("/") { normalized.percentEncodedPath.removeLast() }
        normalized.percentEncodedPath += "/"
        guard let url = normalized.url else { throw NotesAPIError("invalid_authority", "Invalid Notes API base.") }
        self.apiBase = url; self.credential = credential; self.timeout = timeout; self.maximum = maximumResponseBytes
    }

    private func segment(_ value: String) throws -> String {
        guard !value.isEmpty, value != ".", value != "..",
              let encoded = value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) else {
            throw NotesAPIError("invalid_argument", "A nonempty resource identifier is required.")
        }
        return encoded
    }

    private func request<T: Decodable & Sendable>(_ method: String, _ path: String, body: Data? = nil,
                      query: [URLQueryItem] = [], idempotencyKey: String? = nil) async throws -> T {
        try Task.checkCancellation()
        let key: String
        do {
            guard let value = try credential(), !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !value.contains("\r"), !value.contains("\n") else { throw NotesAPIError("missing_credential", "Sign in to access Notes.") }
            key = value
        } catch let error as NotesAPIError where error.code == "missing_credential" { throw error }
        catch { throw NotesAPIError("missing_credential", "The Notes session could not be read.") }
        try Task.checkCancellation()
        guard let url = URL(string: path, relativeTo: apiBase)?.absoluteURL,
              url.absoluteString.hasPrefix(apiBase.absoluteString),
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw NotesAPIError("invalid_authority", "Notes request escaped its configured API base.")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let requestURL = components.url else { throw NotesAPIError("invalid_argument", "Invalid Notes query.") }
        var request = URLRequest(url: requestURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method; request.httpBody = body
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let idempotencyKey {
            guard idempotencyKey.range(of: "^[A-Za-z0-9._:-]{1,128}$", options: .regularExpression) != nil else {
                throw NotesAPIError("invalid_argument", "Invalid idempotency key.")
            }
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        let (data, status) = try await HTTPTransfer(maximum: maximum).run(request)
        try Task.checkCancellation()
        if !(200..<300).contains(status) {
            let envelope = try? JSONDecoder().decode(JSONValue.self, from: data)
            let sanitized = redact(envelope, credential: key)?.object?["error"]?.object
            throw NotesAPIError(sanitized?["code"]?.string ?? "request_failed", sanitized?["message"]?.string ?? "Notes request failed.",
                                status: status, details: sanitized?["details"])
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw NotesAPIError("invalid_json", "Notes API returned an invalid response.", status: status) }
    }

    private func redact(_ value: JSONValue?, credential: String) -> JSONValue? {
        guard let value else { return nil }
        switch value {
        case .string(let string): return .string(string.replacingOccurrences(of: credential, with: "[REDACTED]"))
        case .array(let items): return .array(items.compactMap { redact($0, credential: credential) })
        case .object(let items):
            var result: [String: JSONValue] = [:]
            for (key, item) in items { result[key.replacingOccurrences(of: credential, with: "[REDACTED]")] = redact(item, credential: credential) }
            return .object(result)
        default: return value
        }
    }

    public func list(limit: Int = 100, cursor: String? = nil, includeDeleted: Bool = false, label: String? = nil, search: String? = nil) async throws -> NotesPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if includeDeleted { query.append(URLQueryItem(name: "include_deleted", value: "1")) }
        if let label { query.append(URLQueryItem(name: "label", value: label)) }
        if let search { query.append(URLQueryItem(name: "search", value: search)) }
        return try await request("GET", "notes", query: query)
    }
    public func get(_ id: String) async throws -> Note { try await request("GET", "notes/\(segment(id))") }
    public func create(_ input: NoteInput, idempotencyKey: String? = nil) async throws -> Note {
        try await request("POST", "notes", body: JSONEncoder().encode(input), idempotencyKey: idempotencyKey)
    }
    public func update(_ id: String, input: NoteInput, idempotencyKey: String? = nil) async throws -> Note {
        try await request("PATCH", "notes/\(segment(id))", body: JSONEncoder().encode(input), idempotencyKey: idempotencyKey)
    }
    public func delete(_ id: String, baseRevision: Int? = nil, idempotencyKey: String? = nil) async throws -> NoteDeletion {
        try await request("DELETE", "notes/\(segment(id))", body: baseRevision.map { try JSONEncoder().encode(["baseRevision": $0]) }, idempotencyKey: idempotencyKey)
    }
    public func restore(_ id: String, baseRevision: Int? = nil, idempotencyKey: String? = nil) async throws -> Note {
        try await request("POST", "notes/\(segment(id))/restore", body: baseRevision.map { try JSONEncoder().encode(["baseRevision": $0]) }, idempotencyKey: idempotencyKey)
    }
    public func changes(cursor: String? = nil, limit: Int = 100) async throws -> ChangesPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await request("GET", "changes", query: query)
    }
    public func labels() async throws -> LabelsPage { try await request("GET", "labels") }
    public func renameLabel(_ label: String, to name: String, idempotencyKey: String? = nil) async throws -> LabelMutation {
        try await request("PATCH", "labels/\(segment(label))", body: JSONEncoder().encode(["name": name]), idempotencyKey: idempotencyKey)
    }
    public func deleteLabel(_ label: String, idempotencyKey: String? = nil) async throws -> LabelMutation {
        try await request("DELETE", "labels/\(segment(label))", idempotencyKey: idempotencyKey)
    }
    public func export() async throws -> NotesExport { try await request("POST", "export") }
}
