import SwiftUI

struct CostCardView: View {
  let label: String
  let cost: Double
  let sessions: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label)
        .font(.caption)
        .fontWeight(.semibold)
        .foregroundStyle(.secondary)
        .textCase(.uppercase)
      Text(fmtCost(cost))
        .font(.system(size: 26, weight: .bold).monospacedDigit())
        .foregroundStyle(.primary)
        .lineLimit(1)
        .minimumScaleFactor(0.5)
      Text("\(sessions) session\(sessions == 1 ? "" : "s")")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 0.01 {
      let formatter = NumberFormatter()
      formatter.numberStyle = .currency
      formatter.currencySymbol = "$"
      formatter.minimumFractionDigits = 2
      formatter.maximumFractionDigits = 2
      return formatter.string(from: NSNumber(value: usd)) ?? String(format: "$%.2f", usd)
    }
    if usd > 0 { return String(format: "%.1f¢", usd * 100) }
    return "$0.00"
  }
}
