import SwiftUI

struct MenuBarLabel: View {
  let cost: Double
  let isOffline: Bool

  var body: some View {
    if isOffline {
      Text("$—")
        .font(.system(size: 12, weight: .medium).monospacedDigit())
        .opacity(0.5)
    } else {
      Text(fmtCost(cost))
        .font(.system(size: 12, weight: .medium).monospacedDigit())
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 10_000 {
      return String(format: "$%.0fk", usd / 1_000)
    } else if usd >= 1_000 {
      return String(format: "$%.1fk", usd / 1_000)
    } else if usd >= 0.01 {
      let formatter = NumberFormatter()
      formatter.numberStyle = .currency
      formatter.currencySymbol = "$"
      formatter.minimumFractionDigits = 2
      formatter.maximumFractionDigits = 2
      return formatter.string(from: NSNumber(value: usd)) ?? String(format: "$%.2f", usd)
    } else if usd > 0 {
      return String(format: "%.1f¢", usd * 100)
    } else {
      return "$0.00"
    }
  }
}
