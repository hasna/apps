import SwiftUI

struct CostCardView: View {
  let label: String
  let cost: Double
  let sessions: Int

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(label)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .frame(width: 52, alignment: .leading)
      Text(fmtCost(cost))
        .font(.subheadline.weight(.semibold).monospacedDigit())
        .foregroundStyle(.primary)
      Spacer()
      Text("\(sessions) session\(sessions == 1 ? "" : "s")")
        .font(.caption)
        .foregroundStyle(.tertiary)
    }
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
