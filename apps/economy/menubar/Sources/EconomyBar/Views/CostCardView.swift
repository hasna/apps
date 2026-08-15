import SwiftUI

struct CostCardView: View {
  let label: String
  let cost: Double
  let sessions: Int
  let requests: Int
  let tokens: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(.caption)
        .fontWeight(.semibold)
        .foregroundStyle(.secondary)

      Text(fmtCost(cost))
        .font(.headline.monospacedDigit())
        .foregroundStyle(.primary)

      Text("\(sessions) session\(sessions == 1 ? "" : "s")")
        .font(.caption)
        .foregroundStyle(.tertiary)

      Text("\(fmtTokens(tokens)) tok / \(requests) req")
        .font(.system(size: 10).monospacedDigit())
        .foregroundStyle(.tertiary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(10)
    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
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
