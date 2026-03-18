import SwiftUI

struct GoalProgressView: View {
  let goals: [GoalStatus]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("GOALS")
        .font(.caption)
        .fontWeight(.semibold)
        .foregroundStyle(.secondary)

      ForEach(goals) { goal in
        GoalRowView(goal: goal)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

struct GoalRowView: View {
  let goal: GoalStatus

  private var statusColor: Color {
    if goal.is_over { return .red }
    if goal.is_at_risk { return .orange }
    return .primary
  }

  private var barColor: Color {
    if goal.is_over { return .red }
    if goal.is_at_risk { return .orange }
    return .primary
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack {
        Text(scopeLabel)
          .font(.caption)
          .fontWeight(.medium)
        Spacer()
        Text("\(fmtCost(goal.current_spend_usd)) / \(fmtCost(goal.limit_usd))")
          .font(.caption.monospacedDigit())
          .foregroundStyle(statusColor)
      }
      // Progress bar
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          RoundedRectangle(cornerRadius: 2)
            .fill(Color.primary.opacity(0.1))
            .frame(height: 4)
          RoundedRectangle(cornerRadius: 2)
            .fill(barColor.opacity(0.8))
            .frame(width: min(CGFloat(goal.percent_used / 100) * geo.size.width, geo.size.width), height: 4)
        }
      }
      .frame(height: 4)
    }
  }

  private var scopeLabel: String {
    let scope = goal.project_path.flatMap { $0.split(separator: "/").last.map(String.init) }
      ?? goal.agent
      ?? "Global"
    return "\(goal.period.capitalized) · \(scope)"
  }

  private func fmtCost(_ usd: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .currency
    f.currencySymbol = "$"
    f.maximumFractionDigits = 2
    f.minimumFractionDigits = 0
    return f.string(from: NSNumber(value: usd)) ?? "$\(usd)"
  }
}
