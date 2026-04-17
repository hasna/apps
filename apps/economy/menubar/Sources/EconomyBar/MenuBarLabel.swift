import SwiftUI

struct MenuBarLabel: View {
  let todayCost: Double
  let weekCost: Double
  let monthCost: Double
  let isOffline: Bool

  private var displayCost: Double {
    if todayCost > 0 { return todayCost }
    if weekCost > 0 { return weekCost }
    return monthCost
  }

  private var periodHint: String {
    if todayCost > 0 { return "" }
    if weekCost > 0 { return "/w" }
    if monthCost > 0 { return "/m" }
    return ""
  }

  var body: some View {
    if isOffline {
      Text("$—")
        .font(.system(size: 12, weight: .medium).monospacedDigit())
        .opacity(0.5)
    } else {
      Text(fmtCost(displayCost) + periodHint)
        .font(.system(size: 12, weight: .medium).monospacedDigit())
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    if usd >= 10_000 {
      return String(format: "$%.0fk", usd / 1_000)
    } else if usd >= 1_000 {
      return String(format: "$%.1fk", usd / 1_000)
    } else if usd >= 0.01 {
      return String(format: "$%.2f", usd)
    } else if usd > 0 {
      return String(format: "$%.1f¢", usd * 100)
    } else {
      return "$0"
    }
  }
}
