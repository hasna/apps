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
    if usd >= 0.01 {
      return String(format: "$%.2f", usd)
    } else if usd > 0 {
      return String(format: "%.1f¢", usd * 100)
    } else {
      return "$0.00"
    }
  }
}
