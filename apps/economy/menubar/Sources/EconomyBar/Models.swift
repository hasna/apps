import Foundation

struct APIResponse<T: Decodable>: Decodable {
  let data: T
}

struct CostSummary: Decodable {
  let total_usd: Double
  let sessions: Int
  let requests: Int
  let tokens: Int
}

struct DailyEntry: Decodable {
  let date: String
  let agent: String
  let cost_usd: Double
}

struct ProjectStat: Decodable, Identifiable {
  var id: String { project_path ?? project_name ?? "unknown" }
  let project_path: String?
  let project_name: String?
  let sessions: Int
  let cost_usd: Double
  let last_active: String?

  var displayName: String {
    if let project_name, !project_name.isEmpty { return project_name }
    if let project_path, let last = project_path.split(separator: "/").last { return String(last) }
    return "—"
  }
}

struct SessionStat: Decodable, Identifiable {
  let id: String
  let agent: String
  let project_path: String?
  let project_name: String?
  let total_cost_usd: Double
  let total_tokens: Int
  let request_count: Int
  let started_at: String
  let ended_at: String?

  var displayProject: String {
    if let project_name, !project_name.isEmpty { return project_name }
    if let project_path, let last = project_path.split(separator: "/").last { return String(last) }
    return "Unknown project"
  }

  var shortId: String {
    String(id.prefix(12))
  }

  var startedAtLabel: String {
    let formatter = ISO8601DateFormatter()
    guard let date = formatter.date(from: started_at) else { return started_at }
    let relative = RelativeDateTimeFormatter()
    relative.unitsStyle = .short
    return relative.localizedString(for: date, relativeTo: Date())
  }
}

struct GoalStatus: Decodable, Identifiable {
  var id: String
  let period: String
  let project_path: String?
  let agent: String?
  let limit_usd: Double
  let current_spend_usd: Double
  let percent_used: Double
  let is_on_track: Bool
  let is_at_risk: Bool
  let is_over: Bool
}
