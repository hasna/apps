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
  var id: String { project_path }
  let project_path: String
  let project_name: String
  let sessions: Int
  let cost_usd: Double
  let last_active: String?
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
