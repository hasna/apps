import SwiftUI

struct AgentRowView: View {
  let agent: AgentStat

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 1) {
        Text(agent.displayName)
          .font(.system(size: 12))
          .lineLimit(1)
        Text("\(agent.sessions) sessions / \(agent.requests) req / \(fmtTokens(agent.total_tokens)) tok")
          .font(.system(size: 10).monospacedDigit())
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 1) {
        Text(fmtCost(agent.api_equivalent_usd))
          .font(.system(size: 12, weight: .medium).monospacedDigit())
          .foregroundStyle(.primary)
        Text(agent.billable_usd > 0
          ? "billable \(fmtCost(agent.billable_usd))"
          : "included \(fmtCost(agent.subscription_included_usd))")
          .font(.system(size: 10).monospacedDigit())
          .foregroundStyle(.secondary)
      }
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 1000 { return String(format: "$%.0f", usd) }
    if usd >= 0.01 { return String(format: "$%.2f", usd) }
    if usd > 0 { return String(format: "$%.1f¢", usd * 100) }
    return "$0.00"
  }

  private func fmtTokens(_ tokens: Int) -> String {
    if tokens >= 1_000_000_000 { return String(format: "%.1fB", Double(tokens) / 1_000_000_000) }
    if tokens >= 1_000_000 { return String(format: "%.1fM", Double(tokens) / 1_000_000) }
    if tokens >= 1_000 { return String(format: "%.1fK", Double(tokens) / 1_000) }
    return "\(tokens)"
  }
}
