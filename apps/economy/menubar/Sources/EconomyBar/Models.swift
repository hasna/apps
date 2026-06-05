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

struct HourlyEntry: Decodable {
  let hour: String
  let agent: String
  let cost_usd: Double
}

struct ProjectStat: Decodable, Identifiable {
  var id: String { project_path ?? project_name ?? "unknown" }
  let project_path: String?
  let project_name: String?
  let sessions: Int
  let requests: Int?
  let total_tokens: Int?
  let cost_usd: Double
  let last_active: String?

  var displayName: String {
    if let project_name, !project_name.isEmpty { return project_name }
    if let project_path, let last = project_path.split(separator: "/").last { return String(last) }
    return "—"
  }
}

struct AgentStat: Decodable, Identifiable {
  var id: String { agent }
  let agent: String
  let sessions: Int
  let requests: Int
  let total_tokens: Int
  let api_equivalent_usd: Double
  let billable_usd: Double
  let metered_api_usd: Double
  let subscription_included_usd: Double
  let estimated_usd: Double
  let unknown_usd: Double
  let cost_usd: Double
  let last_active: String?

  var displayName: String {
    agent.prefix(1).uppercased() + String(agent.dropFirst())
  }
}

struct AccountStat: Decodable, Identifiable {
  var id: String { account_key }
  let account_key: String
  let account_tool: String
  let account_name: String
  let account_email: String?
  let account_source: String
  let sessions: Int
  let requests: Int
  let total_tokens: Int
  let api_equivalent_usd: Double
  let billable_usd: Double
  let metered_api_usd: Double
  let subscription_included_usd: Double
  let estimated_usd: Double
  let unknown_usd: Double
  let cost_usd: Double
  let last_active: String?

  var displayName: String {
    if let account_email, !account_email.isEmpty { return account_email }
    if !account_name.isEmpty { return account_name }
    return account_key
  }

  var agentLabel: String {
    account_tool.prefix(1).uppercased() + String(account_tool.dropFirst())
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

struct SavingsSummary: Decodable {
  let saved_usd: Double
  let api_equivalent_usd: Double
  let subscription_fee_usd: Double
}

struct UsageSnapshot: Decodable, Identifiable {
  private let snapshot_id: String?
  let agent: String
  let metric: String
  let value: Double
  let unit: String
  let date: String?
  let machine_id: String?

  var id: String {
    snapshot_id ?? "\(agent)-\(metric)-\(date ?? "")-\(machine_id ?? "")"
  }

  var displayAgent: String {
    agent.prefix(1).uppercased() + String(agent.dropFirst())
  }

  var displayMetric: String {
    metric.replacingOccurrences(of: "_", with: " ")
  }

  var displayValue: String {
    if unit == "percent" { return String(format: "%.0f%%", value) }
    if unit == "epoch_ms" { return String(format: "%.0f ms", value) }
    return "\(String(format: "%.0f", value)) \(unit)"
  }

  enum CodingKeys: String, CodingKey {
    case snapshot_id = "id"
    case agent
    case metric
    case value
    case unit
    case date
    case machine_id
  }
}

struct UsageResponse: Decodable {
  let snapshots: [UsageSnapshot]
}

struct SubscriptionPlan: Decodable, Identifiable {
  let id: String
  let agent: String?
  let provider: String
  let plan: String
  let monthly_fee_usd: Double
  let included_usage_usd: Double
  let billing_cycle_start: String?
  let reset_policy: String
  let active: Int

  var displayName: String {
    "\(provider) / \(plan)"
  }

  var agentLabel: String {
    guard let agent, !agent.isEmpty else { return "All agents" }
    return agent.prefix(1).uppercased() + String(agent.dropFirst())
  }
}

struct FleetMachine: Decodable {
  let machine_id: String
  let sessions: Int
  let requests: Int
  let total_cost_usd: Double
  let last_active: String?

  var displayName: String {
    machine_id
  }
}

struct FleetResponse: Decodable {
  let summary: CostSummary
  let machines: [FleetMachine]
  let current_machine: String
}
