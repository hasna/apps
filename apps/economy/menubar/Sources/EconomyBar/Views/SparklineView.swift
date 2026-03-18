import SwiftUI

struct SparklineView: View {
  let entries: [DailyEntry]
  @State private var hoveredIndex: Int? = nil

  private var dailyTotals: [(date: String, cost: Double)] {
    var map: [String: Double] = [:]
    for e in entries { map[e.date, default: 0] += e.cost_usd }
    return map.keys.sorted().map { (date: $0, cost: map[$0]!) }
  }

  var body: some View {
    let totals = dailyTotals
    let maxVal = totals.map(\.cost).max() ?? 1

    VStack(spacing: 4) {
      // Hover tooltip
      if let idx = hoveredIndex, idx < totals.count {
        HStack {
          Text(totals[idx].date)
            .font(.caption2)
            .foregroundStyle(.secondary)
          Spacer()
          Text(fmtCost(totals[idx].cost))
            .font(.caption2.monospacedDigit())
        }
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.15), value: hoveredIndex)
      } else {
        // placeholder to keep height stable
        Text(" ").font(.caption2)
      }

      // Bars
      HStack(alignment: .bottom, spacing: 2) {
        ForEach(Array(totals.enumerated()), id: \.offset) { i, entry in
          let height = maxVal > 0 ? max(CGFloat(entry.cost / maxVal) * 40, 2) : 2
          let isHovered = hoveredIndex == i
          Rectangle()
            .fill(isHovered ? Color.primary : Color.primary.opacity(0.35))
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .cornerRadius(2)
            .onHover { hovering in
              hoveredIndex = hovering ? i : nil
            }
        }
      }
      .frame(height: 40)

      // Date labels
      if let first = totals.first?.date, let last = totals.last?.date {
        HStack {
          Text(formatDate(first)).font(.caption2).foregroundStyle(.tertiary)
          Spacer()
          Text(formatDate(last)).font(.caption2).foregroundStyle(.tertiary)
        }
      }
    }
  }

  private func fmtCost(_ usd: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencySymbol = "$"
    formatter.maximumFractionDigits = 2
    formatter.minimumFractionDigits = 2
    return formatter.string(from: NSNumber(value: usd)) ?? String(format: "$%.2f", usd)
  }

  private func formatDate(_ d: String) -> String {
    let parts = d.split(separator: "-")
    guard parts.count == 3 else { return d }
    return "\(parts[1])/\(parts[2])"
  }
}
