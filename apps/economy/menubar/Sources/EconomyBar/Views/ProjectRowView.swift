import SwiftUI

struct ProjectRowView: View {
  let project: ProjectStat

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 1) {
        Text(project.displayName)
          .font(.system(size: 12))
          .lineLimit(1)
          .truncationMode(.middle)
        Text("\(project.sessions) sessions / \(project.requests ?? 0) req / \(fmtTokens(project.total_tokens ?? 0)) tok")
          .font(.system(size: 10).monospacedDigit())
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Spacer()
      Text(fmtCost(project.cost_usd))
        .font(.system(size: 12, weight: .medium).monospacedDigit())
        .foregroundStyle(.primary)
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
