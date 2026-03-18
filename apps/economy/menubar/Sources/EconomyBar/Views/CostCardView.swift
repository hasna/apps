import SwiftUI

struct CostCardView: View {
  let label: String
  let cost: Double
  let sessions: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label)
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(.secondary)
        .textCase(.uppercase)
      Text(fmtCost(cost))
        .font(.system(size: 22, weight: .bold).monospacedDigit())
        .foregroundStyle(cost > 0 ? Color.green : Color.primary)
      Text("\(sessions) sessions")
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .background(RoundedRectangle(cornerRadius: 8).fill(.background.secondary))
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 0.01 { return String(format: "$%.2f", usd) }
    if usd > 0 { return String(format: "%.1f¢", usd * 100) }
    return "$0.00"
  }
}
