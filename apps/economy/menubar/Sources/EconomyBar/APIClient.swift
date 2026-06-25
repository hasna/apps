import Foundation

enum APIError: Error {
  case offline
  case serverError(Int)
  case decodingError(Error)
}

actor APIClient {
  static let defaultsKey = "economy.apiBaseURL"
  static let tokenDefaultsKey = "economy.apiToken"
  static let defaultBaseURL = "http://127.0.0.1:3456"

  private var base: String
  private var apiToken: String
  private let session: URLSession

  init(baseURL: String? = nil, session injectedSession: URLSession? = nil) {
    base = Self.normalizeBaseURL(baseURL ?? UserDefaults.standard.string(forKey: Self.defaultsKey) ?? Self.defaultBaseURL)
    apiToken = Self.normalizeAPIToken(UserDefaults.standard.string(forKey: Self.tokenDefaultsKey) ?? "")
    if let injectedSession {
      session = injectedSession
    } else {
      let config = URLSessionConfiguration.default
      config.timeoutIntervalForRequest = 5
      session = URLSession(configuration: config)
    }
  }

  static func storedBaseURL() -> String {
    normalizeBaseURL(UserDefaults.standard.string(forKey: defaultsKey) ?? defaultBaseURL)
  }

  static func storedAPIToken() -> String {
    normalizeAPIToken(UserDefaults.standard.string(forKey: tokenDefaultsKey) ?? "")
  }

  static func hasStoredAPIToken() -> Bool {
    !storedAPIToken().isEmpty
  }

  static func normalizeBaseURL(_ value: String) -> String {
    var normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized.isEmpty { normalized = defaultBaseURL }
    if !normalized.contains("://") { normalized = "http://\(normalized)" }
    if normalized.hasSuffix("/") { normalized.removeLast() }
    return normalized
  }

  static func normalizeAPIToken(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func setBaseURL(_ value: String) -> String {
    let normalized = Self.normalizeBaseURL(value)
    base = normalized
    UserDefaults.standard.set(normalized, forKey: Self.defaultsKey)
    return normalized
  }

  func setAPIToken(_ value: String) -> String {
    let normalized = Self.normalizeAPIToken(value)
    apiToken = normalized
    if normalized.isEmpty {
      UserDefaults.standard.removeObject(forKey: Self.tokenDefaultsKey)
    } else {
      UserDefaults.standard.set(normalized, forKey: Self.tokenDefaultsKey)
    }
    return normalized
  }

  func isOnline() async -> Bool {
    guard let url = URL(string: "\(base)/health") else { return false }
    var req = URLRequest(url: url)
    req.timeoutInterval = 1.5
    authorize(&req)
    do {
      let (_, response) = try await session.data(for: req)
      guard let http = response as? HTTPURLResponse else { return false }
      return (200..<300).contains(http.statusCode)
    } catch {
      return false
    }
  }

  func fetchSummary(period: String, machine: String? = nil) async throws -> CostSummary {
    try await get(path("/api/summary", [
      URLQueryItem(name: "period", value: period),
      machineQueryItem(machine),
    ]))
  }

  func fetchDaily(days: Int, machine: String? = nil) async throws -> [DailyEntry] {
    try await get(path("/api/daily", [
      URLQueryItem(name: "days", value: String(days)),
      machineQueryItem(machine),
    ]))
  }

  func fetchHourly(hours: Int = 12, machine: String? = nil) async throws -> [HourlyEntry] {
    try await get(path("/api/hourly", [
      URLQueryItem(name: "hours", value: String(hours)),
      machineQueryItem(machine),
    ]))
  }

  func fetchProjects(period: String = "month", machine: String? = nil) async throws -> [ProjectStat] {
    try await get(path("/api/projects", [
      URLQueryItem(name: "period", value: period),
      machineQueryItem(machine),
    ]))
  }

  func fetchAgents(period: String = "month", machine: String? = nil) async throws -> [AgentStat] {
    try await get(path("/api/breakdown", [
      URLQueryItem(name: "by", value: "agent"),
      URLQueryItem(name: "period", value: period),
      machineQueryItem(machine),
    ]))
  }

  func fetchAccounts(period: String = "month", machine: String? = nil) async throws -> [AccountStat] {
    try await get(path("/api/accounts", [
      URLQueryItem(name: "period", value: period),
      machineQueryItem(machine),
    ]))
  }

  func fetchSavings(period: String = "month") async throws -> SavingsSummary {
    try await get(path("/api/savings", [
      URLQueryItem(name: "period", value: period),
    ]))
  }

  func fetchUsage() async throws -> UsageResponse {
    try await get("/api/usage?period=month")
  }

  func fetchSubscriptions() async throws -> [SubscriptionPlan] {
    try await get("/api/subscriptions")
  }

  func fetchFleet(period: String = "today", machine: String? = nil) async throws -> FleetResponse {
    try await get(path("/api/fleet", [
      URLQueryItem(name: "period", value: period),
      machineQueryItem(machine),
    ]))
  }

  func fetchMachines() async throws -> [FleetMachine] {
    try await get("/api/machines")
  }

  func fetchSessions(search: String, limit: Int, machine: String? = nil) async throws -> [SessionStat] {
    guard var components = URLComponents(string: "\(base)/api/sessions") else { throw APIError.offline }
    var queryItems = [URLQueryItem(name: "limit", value: String(limit))]
    let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty {
      queryItems.append(URLQueryItem(name: "search", value: trimmed))
    }
    if let machine, !machine.isEmpty {
      queryItems.append(URLQueryItem(name: "machine", value: machine))
    }
    components.queryItems = queryItems
    guard let url = components.url else { throw APIError.offline }
    return try await get(url)
  }

  func sync() async throws {
    guard let url = URL(string: "\(base)/api/sync") else { throw APIError.offline }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    authorize(&req)
    req.httpBody = try? JSONEncoder().encode(["sources": "all"])
    let (_, response) = try await session.data(for: req)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw APIError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0)
    }
  }

  private func get<T: Decodable>(_ path: String) async throws -> T {
    guard let url = URL(string: "\(base)\(path)") else { throw APIError.offline }
    return try await get(url)
  }

  private func path(_ path: String, _ queryItems: [URLQueryItem?]) -> String {
    var components = URLComponents()
    components.path = path
    components.queryItems = queryItems.compactMap { $0 }
    return components.string ?? path
  }

  private func machineQueryItem(_ machine: String?) -> URLQueryItem? {
    guard let machine, !machine.isEmpty else { return nil }
    return URLQueryItem(name: "machine", value: machine)
  }

  private func get<T: Decodable>(_ url: URL) async throws -> T {
    do {
      var req = URLRequest(url: url)
      authorize(&req)
      let (data, response) = try await session.data(for: req)
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

  private func authorize(_ request: inout URLRequest) {
    guard !apiToken.isEmpty else { return }
    request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
  }
}
