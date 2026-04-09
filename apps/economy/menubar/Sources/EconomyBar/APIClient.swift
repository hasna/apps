import Foundation

enum APIError: Error {
  case offline
  case serverError(Int)
  case decodingError(Error)
}

actor APIClient {
  static let defaultsKey = "economy.apiBaseURL"
  static let defaultBaseURL = "http://127.0.0.1:3456"

  private var base: String
  private let session: URLSession

  init() {
    base = Self.storedBaseURL()
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 5
    session = URLSession(configuration: config)
  }

  static func storedBaseURL() -> String {
    normalizeBaseURL(UserDefaults.standard.string(forKey: defaultsKey) ?? defaultBaseURL)
  }

  static func normalizeBaseURL(_ value: String) -> String {
    var normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized.isEmpty { normalized = defaultBaseURL }
    if !normalized.contains("://") { normalized = "http://\(normalized)" }
    if normalized.hasSuffix("/") { normalized.removeLast() }
    return normalized
  }

  func setBaseURL(_ value: String) -> String {
    let normalized = Self.normalizeBaseURL(value)
    base = normalized
    UserDefaults.standard.set(normalized, forKey: Self.defaultsKey)
    return normalized
  }

  func isOnline() async -> Bool {
    var req = URLRequest(url: URL(string: "\(base)/health")!)
    req.timeoutInterval = 1.5
    return (try? await session.data(for: req)) != nil
  }

  func fetchSummary(period: String) async throws -> CostSummary {
    try await get("/api/summary?period=\(period)")
  }

  func fetchDaily(days: Int) async throws -> [DailyEntry] {
    try await get("/api/daily?days=\(days)")
  }

  func fetchProjects() async throws -> [ProjectStat] {
    try await get("/api/projects")
  }

  func fetchSessions(search: String, limit: Int) async throws -> [SessionStat] {
    var components = URLComponents(string: "\(base)/api/sessions")!
    var queryItems = [URLQueryItem(name: "limit", value: String(limit))]
    let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty {
      queryItems.append(URLQueryItem(name: "search", value: trimmed))
    }
    components.queryItems = queryItems
    guard let url = components.url else { throw APIError.offline }
    return try await get(url)
  }

  func sync() async throws {
    let url = URL(string: "\(base)/api/sync")!
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONEncoder().encode(["sources": "all"])
    let (_, response) = try await session.data(for: req)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0)
    }
  }

  private func get<T: Decodable>(_ path: String) async throws -> T {
    let url = URL(string: "\(base)\(path)")!
    return try await get(url)
  }

  private func get<T: Decodable>(_ url: URL) async throws -> T {
    do {
      let (data, response) = try await session.data(from: url)
      guard let http = response as? HTTPURLResponse else { throw APIError.offline }
      guard http.statusCode == 200 else { throw APIError.serverError(http.statusCode) }
      do {
        let wrapper = try JSONDecoder().decode(APIResponse<T>.self, from: data)
        return wrapper.data
      } catch {
        throw APIError.decodingError(error)
      }
    } catch let error as APIError {
      throw error
    } catch {
      throw APIError.offline
    }
  }
}
