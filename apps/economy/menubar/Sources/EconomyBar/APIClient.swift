import Foundation

enum APIError: Error {
  case offline
  case serverError(Int)
  case decodingError(Error)
}

actor APIClient {
  private let base = "http://localhost:3456"
  private let session: URLSession

  init() {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 5
    session = URLSession(configuration: config)
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

  func fetchGoals() async throws -> [GoalStatus] {
    try await get("/api/goals")
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
