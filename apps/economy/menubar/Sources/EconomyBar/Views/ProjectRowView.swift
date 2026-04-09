import SwiftUI

struct ProjectRowView: View {
  let project: ProjectStat

  var body: some View {
    HStack {
      Text(project.displayName)
        .font(.system(size: 12))
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer()
      Text(fmtCost(project.cost_usd))
        .font(.system(size: 12, weight: .medium).monospacedDigit())
        .foregroundStyle(.primary)
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
